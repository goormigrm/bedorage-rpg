// 치지직 방송 연동 UI (2026-09-23 사용자: "설정창이 너무 눈에 안 띄고, 치지직 방송 연동 상태는 설정에 들어가야 보이는 게 아니고
// 항상 떠 있어야 돼 — 대기실이든 게임 중이든. 눈에 띄게 배치하고 UI 도 수정").
// - StreamBadge: 로비(제목 아래)와 게임(왼쪽 위 단추 줄 맨 앞)에 늘 떠 있는 상태 단추. 연결 상태만 — 받은 채팅 · 후원의 개수 · 합계는 보이지 않는다(2026-09-23).
// - openStreamPanel: 단추를 누르면 여는 전용 창 — 로그인 · 연결 · 말풍선 · 표 · 금액 · 시험 · 최근 받은 것.

import { CHEER_EVENTS, DONATE_EVENTS, DON_CAP_CHOICES } from '../core/donate'
import { DEFAULT_BANNED, StreamStatus, cleanBanned, loadStreamCfg, saveStreamCfg, stream, won } from '../game/stream'
import { connect as chzzkConnect, disconnect as chzzkDisconnect, hasToken, logout as chzzkLogout, redirectUri, startLogin } from '../net/chzzk'

/** 치지직 · 프록시가 준 오류 글을 칸에 넣을 때 (태그가 되지 않게) */
const esc = (s: string): string => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch)

const STATUS_LABEL: Record<StreamStatus, string> = { off: '연결 안 됨', connecting: '연결 중…', on: 'LIVE 연결됨', error: '연결 문제' }

/** 늘 떠 있는 상태 단추 */
export class StreamBadge {
  readonly el: HTMLButtonElement
  private offStatus: () => void
  private offAct: () => void

  constructor(parent: HTMLElement, onOpen: () => void, first = false) {
    this.el = document.createElement('button')
    this.el.type = 'button'
    this.el.className = 'czbadge'
    this.el.onclick = (e) => {
      e.stopPropagation()
      onOpen()
    }
    // 게임 안에서 눌러도 사격이 되지 않게
    this.el.onmousedown = (e) => e.stopPropagation()
    if (first) parent.prepend(this.el)
    else parent.appendChild(this.el)
    this.offStatus = stream.onStatus(() => this.update())
    // 채팅 · 후원이 올 때는 불만 깜빡인다 — 전에는 채팅 한 줄마다 단추를 통째로 다시 그렸다(빠른 방송이면 초당 수십 번)
    this.offAct = stream.onActivity(() => this.ping())
    this.update()
  }

  update(): void {
    const st = stream.status
    const on = st === 'on'
    this.el.dataset.st = st
    const sub = on
      ? '받는 중'
      : st === 'connecting'
        ? '잠시만요'
        : st === 'error'
          ? '눌러서 확인'
          : hasToken()
            ? '눌러서 연결'
            : '눌러서 로그인'
    this.el.innerHTML = `<i class="czdot"></i><b>치지직</b><span class="czst">${STATUS_LABEL[st]}</span><small>${sub}</small>`
    this.el.title = stream.detail || '치지직 방송 연동 — 채팅 말풍선 · 후원 이벤트'
  }

  private pingAt = 0
  private ping(): void {
    const now = performance.now()
    if (now - this.pingAt < 400) return
    this.pingAt = now
    const dot = this.el.querySelector('.czdot') as HTMLElement | null
    if (!dot) return
    dot.classList.remove('ping')
    void dot.offsetWidth
    dot.classList.add('ping')
  }

  dispose(): void {
    this.offStatus()
    this.offAct()
    this.el.remove()
  }
}

/**
 * 전용 창을 연다. host 안에 덮개를 깔고 가운데 창. 닫으면 onClose. 돌려주는 함수로 닫는다.
 * 게임 안에서는 키가 게임으로 가지 않게 창 안의 keydown 을 멈춘다(Esc 는 창을 닫는다).
 */
export function openStreamPanel(host: HTMLElement, onClose?: () => void): () => void {
  const wrap = document.createElement('div')
  wrap.className = 'czpanel-wrap'
  wrap.innerHTML = `<div class="czpanel" role="dialog" aria-label="치지직 방송 연동"></div>`
  host.appendChild(wrap)
  const box = wrap.querySelector('.czpanel') as HTMLElement
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    offStatus()
    offAct()
    window.removeEventListener('keydown', onKey, true)
    wrap.remove()
    onClose?.()
  }
  const draw = () => {
    box.innerHTML = panelHtml()
    bindPanel(box, draw, close)
  }
  const busy = () => box.contains(document.activeElement) && ['INPUT', 'TEXTAREA'].includes((document.activeElement as HTMLElement).tagName)
  const offStatus = stream.onStatus(() => {
    if (!busy()) draw()
  })
  const offAct = stream.onActivity(() => {
    // 받은 것은 보여 주지 않는다 — 불만 한 번 깜빡인다
    const dot = box.querySelector('.czdot') as HTMLElement | null
    if (dot) {
      dot.classList.remove('ping')
      void dot.offsetWidth
      dot.classList.add('ping')
    }
  })
  // 잡는 단계에서 먼저 받는다 — 게임의 Esc(메뉴) · 이동 키보다 앞서
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      e.preventDefault()
      close()
    } else if (box.contains(e.target as Node)) e.stopPropagation()
  }
  window.addEventListener('keydown', onKey, true)
  wrap.onmousedown = (e) => {
    e.stopPropagation()
    if (e.target === wrap) close()
  }
  draw()
  return close
}

const toggle = (key: string, name: string, on: boolean, yes = '켜기', no = '끄기') =>
  `<div class="cztg"><b>${name}</b><div class="seg small" data-tg="${key}">` +
  `<button type="button" data-on="1" class="${on ? 'on' : ''}">${yes}</button>` +
  `<button type="button" data-on="0" class="${on ? '' : 'on'}">${no}</button></div></div>`

/**
 * 가릴 말 목록을 펼쳐 두었나 — 처음에는 접어 둔다: 창을 방송 화면에 띄운 채 열면 욕 목록이 그대로 보인다 (2026-09-25 방송 개선 3)
 */
let banOpen = false

/** 방송 안전 · 참여 (2026-09-25 사용자 고른 방송 개선 3 · 5 · 7) */
function safetyHtml(c: ReturnType<typeof loadStreamCfg>): string {
  const caps = DON_CAP_CHOICES.map((s) => `<button type="button" data-cap="${s}" class="${c.stackMax === s ? 'on' : ''}">${s}초</button>`).join('')
  const ban = banOpen
    ? `<textarea class="czban" data-banned rows="3" spellcheck="false" placeholder="쉼표나 줄바꿈으로 나눕니다">${esc(c.banned.join(', '))}</textarea>` +
      `<div class="czh sm"><button type="button" class="lnk" data-cz="banhide">목록 접기</button><button type="button" class="lnk" data-cz="banreset">처음 목록으로</button></div>` +
      `<p class="czn">⚠ 이 창을 방송 화면에 띄운 채 펼치면 목록이 그대로 보입니다.</p>`
    : `<div class="cztg"><b>가릴 말 ${c.banned.length}개</b><button type="button" class="lnk" data-cz="banshow">목록 보기 · 고치기</button></div>`
  return (
    `<div class="czcols czsafe">` +
    `<div class="czcol">` +
    `<div class="czh"><b>🛡 방송 화면 거르기</b></div>` +
    ban +
    toggle('maskLinks', '주소(링크)는 [링크] 로', c.maskLinks) +
    toggle('antiSpam', '도배 거르기 (같은 말 · 몰아 쓰기)', c.antiSpam) +
    `<p class="czn">괴물 말풍선 · 후원 글 · 닉네임에서 가릴 말은 <b>○○</b> 로 — 글자 사이에 띄어쓰기 · 숫자 · 기호를 끼워도 걸립니다. 후원은 거르지 않고 글만 가립니다.</p>` +
    `</div>` +
    `<div class="czcol">` +
    `<div class="czh"><b>방해 효과 · 시청자 참여</b></div>` +
    `<div class="cztg"><b>같은 방해 효과 최대</b><div class="seg small" data-capseg>${caps}</div></div>` +
    `<p class="czn">화면 흔들림 · 암흑 · 거꾸로 걷기 · 스킬 봉인이 몰려도 이 시간을 넘게 이어 붙지 않습니다 — 넘는 만큼은 버려집니다 (화면 흔들림은 15초까지).</p>` +
    toggle('named', '시청자 이름 괴물 (채팅 !참여)', c.named) +
    `<div class="czbtns"><button type="button" class="btn secondary sm" data-cz="join">참여 시험</button></div>` +
    `<p class="czn">채팅에 <b>!참여</b> → 최근 15분 안에 참여한 사람 중 <b>추첨</b>으로 한 명씩, 화면의 정예 · 우두머리 머리 위에 그 시청자 이름이 붙고 그 시청자의 채팅은 그 괴물이 말합니다. 잡으면 "○○ 처치!".</p>` +
    `</div></div>`
  )
}

function panelHtml(): string {
  const c = loadStreamCfg()
  const st = stream.status
  const login = hasToken()
  const main =
    st === 'on' || st === 'connecting'
      ? `<button type="button" class="btn secondary" data-cz="off">연결 끊기</button>`
      : login
        ? `<button type="button" class="btn main czgo" data-cz="on">치지직 연결</button>`
        : `<button type="button" class="btn main czgo" data-cz="login">치지직 로그인</button>`
  const rows = DONATE_EVENTS.map(
    (e, i) =>
      `<div class="czr"><input type="number" min="0" step="500" data-amt="${i}" value="${c.amounts[i]}" title="0 이면 끕니다"><b>${e.name}</b><span title="${e.desc}">${e.desc}</span>` +
      `<button type="button" class="lnk" data-try="${i}" title="이 금액으로 시험 후원 — 던전에서 일어납니다">시험</button></div>`,
  ).join('')
  // 응원 금액표 (2026-09-23 사용자: "응원도 가격에 따라서 효과를 다르게") — 후원 글에 !응원 이면 이 표로
  const cheers = CHEER_EVENTS.map(
    (e, i) =>
      `<div class="czr cheer"><input type="number" min="0" step="500" data-cheer="${i}" value="${c.cheers[i]}" title="0 이면 끕니다"><span title="${e.desc}">${e.desc}</span>` +
      `<button type="button" class="lnk" data-cheertry="${i}" title="이 금액 + !응원 으로 시험 후원 — 던전에서 일어납니다">시험</button></div>`,
  ).join('')
  return (
    `<div class="czhead"><i class="czdot" data-st="${st}"></i><h3>치지직 방송 연동</h3><span class="czs" data-st="${st}">${STATUS_LABEL[st]}</span>` +
    `<button type="button" class="czx" data-cz="close" title="닫기 (Esc)">✕</button></div>` +
    `<p class="czlead">채팅은 <b>괴물 말풍선</b>으로, 후원은 금액에 따라 <b>판에 이벤트</b>로 들어갑니다. 같은 방 사람들 화면에도 똑같이 일어납니다.</p>` +
    `<div class="czrow">${main}${login ? `<button type="button" class="lnk" data-cz="logout">로그아웃</button>` : ''}<span class="czd">${esc(stream.detail)}</span></div>` +
    `<div class="czcols">` +
    `<div class="czcol">` +
    `<p class="czsub">받은 채팅 · 후원의 개수와 합계는 어디에도 보이지 않습니다 — 방송 화면에 수입이 드러나지 않게.</p>` +
    toggle('bubbles', '채팅 말풍선', c.bubbles) +
    toggle('table', '후원 이벤트 표 (게임 왼쪽 아래)', c.table, '보이기', '숨기기') +
    `<div class="czbtns"><button type="button" class="btn secondary sm" data-cz="chat">채팅 시험</button></div>` +
    `<p class="czn">채팅 시험은 게임 안 <b>괴물 머리 위</b>에 뜹니다 — 괴물이 보이는 곳(던전)에서 누르세요. 창은 닫히지 않으니 여러 번 눌러 보세요.</p>` +
    `<div class="czh"><b>💚 후원 글에 !응원 입력 — 금액 → 효과</b></div>` +
    `<div class="czt">${cheers}</div>` +
    `<p class="czn">후원 글에 <b>!응원</b> 입력 → 괴롭히는 대신 <b>돕습니다</b> — 금액이 넘는 단계 중 가장 비싼 것 · 0 원이면 끔 · 던전에서 일어납니다.</p>` +
    `</div>` +
    `<div class="czcol">` +
    `<div class="czh"><b>후원 금액 → 이벤트</b><button type="button" class="lnk" data-cz="reset">금액 처음대로</button></div>` +
    `<div class="czt">${rows}</div>` +
    `<p class="czn">금액이 넘는 것 중 가장 비싼 이벤트가 일어납니다 · 0 원이면 끔 · 마을에서 받은 후원은 던전에 나가면 일어납니다.</p>` +
    `</div></div>` +
    safetyHtml(c) +
    (st === 'error' || !login ? `<p class="czn">로그인이 안 되면 치지직 개발자센터 앱의 로그인 리디렉션 URL 이 <code>${esc(redirectUri())}</code> 인지 확인하세요.</p>` : '')
  )
}

/** 단추 글을 잠깐 바꿔 눌린 것을 알린다 */
function flashBtn(b: HTMLButtonElement, text: string): void {
  const was = b.dataset.was ?? b.textContent ?? ''
  b.dataset.was = was
  b.textContent = text
  // 거듭 누르면 되돌리는 시계를 새로 (앞 시계가 방금 바꾼 글을 먼저 되돌리지 않게) · 눌릴 때마다 한 번 반짝
  window.clearTimeout(Number(b.dataset.timer ?? 0))
  b.classList.remove('sent')
  void b.offsetWidth
  b.classList.add('sent')
  b.dataset.timer = String(
    window.setTimeout(() => {
      b.textContent = was
      b.classList.remove('sent')
      delete b.dataset.was
      delete b.dataset.timer
    }, 1400),
  )
}

function bindPanel(box: HTMLElement, redraw: () => void, close: () => void): void {
  box.querySelectorAll<HTMLButtonElement>('[data-cz]').forEach((b) => {
    b.onclick = () => {
      const a = b.dataset.cz
      if (a === 'close') return close()
      if (a === 'login') return startLogin()
      if (a === 'on') {
        const c = loadStreamCfg()
        c.auto = true
        saveStreamCfg(c)
        void chzzkConnect()
      } else if (a === 'off') {
        const c = loadStreamCfg()
        c.auto = false
        saveStreamCfg(c)
        chzzkDisconnect()
      } else if (a === 'logout') chzzkLogout()
      else if (a === 'chat') {
        // 게임 밖(로비)에서는 받을 곳이 없다 — 단추에 알린다
        if (!stream.inGame) {
          flashBtn(b, '게임 안에서 됩니다')
          return
        }
        // 못 띄우는 곳이면 까닭을 단추에 (마을 · 말풍선 끔). 화면에 괴물이 없을 뿐이면 보내고, 게임이 30초 동안 기다린다
        const why = stream.sayBlock?.()
        if (why && why !== 'wait') {
          flashBtn(b, why)
          return
        }
        // 창은 닫지 않는다 — 여러 번 눌러 볼 수 있게 (2026-09-26 사용자: "버튼 눌렀다고 창이 꺼지게 하지 마")
        stream.fakeChat()
        flashBtn(b, why === 'wait' ? '보냄 — 괴물이 보이면 뜹니다' : '보냄 ✓')
        return
      }
      else if (a === 'join') {
        if (!stream.inGame) {
          flashBtn(b, '게임 안에서 됩니다')
          return
        }
        if (!loadStreamCfg().named) {
          flashBtn(b, '이름 괴물이 꺼져 있습니다')
          return
        }
        stream.fakeJoin()
        flashBtn(b, '참여 보냄 ✓')
        return
      } else if (a === 'banshow') banOpen = true
      else if (a === 'banhide') banOpen = false
      else if (a === 'banreset') {
        const c = loadStreamCfg()
        c.banned = [...DEFAULT_BANNED]
        saveStreamCfg(c)
      } else if (a === 'reset') {
        const c = loadStreamCfg()
        c.amounts = DONATE_EVENTS.map((e) => e.amount)
        c.cheers = CHEER_EVENTS.map((e) => e.amount)
        saveStreamCfg(c)
      }
      redraw()
    }
  })
  box.querySelectorAll<HTMLButtonElement>('[data-tg] button').forEach((b) => {
    b.onclick = () => {
      const c = loadStreamCfg()
      const on = b.dataset.on === '1'
      const tg = (b.parentElement as HTMLElement).dataset.tg
      if (tg === 'bubbles') c.bubbles = on
      else if (tg === 'maskLinks') c.maskLinks = on
      else if (tg === 'antiSpam') c.antiSpam = on
      else if (tg === 'named') c.named = on
      else c.table = on
      saveStreamCfg(c)
      redraw()
    }
  })
  box.querySelectorAll<HTMLButtonElement>('[data-cap]').forEach((b) => {
    b.onclick = () => {
      const c = loadStreamCfg()
      c.stackMax = Number(b.dataset.cap)
      saveStreamCfg(c)
      redraw()
    }
  })
  const ban = box.querySelector<HTMLTextAreaElement>('textarea[data-banned]')
  if (ban) {
    ban.onchange = () => {
      const c = loadStreamCfg()
      c.banned = cleanBanned(ban.value.split(/[,\n]/))
      saveStreamCfg(c)
    }
  }
  box.querySelectorAll<HTMLInputElement>('input[data-amt]').forEach((inp) => {
    inp.onchange = () => {
      const c = loadStreamCfg()
      const v = Math.max(0, Math.round(Number(inp.value) || 0))
      c.amounts[Number(inp.dataset.amt)] = v
      saveStreamCfg(c)
      inp.value = String(v)
    }
  })
  box.querySelectorAll<HTMLInputElement>('input[data-cheer]').forEach((inp) => {
    inp.onchange = () => {
      const c = loadStreamCfg()
      const v = Math.max(0, Math.round(Number(inp.value) || 0))
      c.cheers[Number(inp.dataset.cheer)] = v
      saveStreamCfg(c)
      inp.value = String(v)
    }
  })
  box.querySelectorAll<HTMLButtonElement>('[data-cheertry]').forEach((b) => {
    b.onclick = () => {
      const c = loadStreamCfg()
      const i = Number(b.dataset.cheertry)
      const amt = c.cheers[i] || CHEER_EVENTS[i].amount
      stream.fakeCheer(amt)
      b.textContent = `${won(amt)} 보냄`
      setTimeout(() => (b.textContent = '시험'), 1500)
    }
  })
  box.querySelectorAll<HTMLButtonElement>('[data-try]').forEach((b) => {
    b.onclick = () => {
      const c = loadStreamCfg()
      const i = Number(b.dataset.try)
      const amt = c.amounts[i] || DONATE_EVENTS[i].amount
      stream.fakeDonation(amt)
      b.textContent = `${won(amt)} 보냄`
      setTimeout(() => (b.textContent = '시험'), 1500)
    }
  })
}
