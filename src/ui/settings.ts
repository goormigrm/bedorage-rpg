// 설정 칸 — **게임 안(Esc 메뉴)과 대기실에서 같은 화면**을 쓴다
// (2026-09-20 사용자: "대기실에서도 설정 화면 들어갈 수 있도록 해 줘").
// 값은 모두 브라우저에 남는다(localStorage). 게임 안에서 바꾸면 그 판에 바로 반영되고,
// 대기실에서 바꾼 것은 판에 들어갈 때 반영된다.

import { AUTOPICK_ALL, RARITY_COLORS, RARITY_NAMES } from '../core/items'
import { isTouchDevice } from '../game/touch'
import { DONATE_EVENTS } from '../core/donate'
import { loadStreamCfg, saveStreamCfg, stream, won } from '../game/stream'
import { connect as chzzkConnect, disconnect as chzzkDisconnect, hasToken, logout as chzzkLogout, redirectUri, startLogin } from '../net/chzzk'

const AUTOPICK_KEY = 'brpg.autopick'
const REAL_KEY = 'brpg.real'
const KEYS_KEY = 'brpg.keys'
const MUTE_KEY = 'brpg.muted'

const get = (k: string): string | null => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const set = (k: string, v: string): void => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* 저장 못 해도 이번 판은 반영된다 */
  }
}

/** 자동 줍기 등급 (기본은 모두) */
export function loadAutoPick(): number {
  const v = Number(get(AUTOPICK_KEY) ?? AUTOPICK_ALL)
  // 신화 등급(비트 16)이 생기기 전의 "모두"(15)는 모두로 (2026-09-19)
  if (v === 15) return AUTOPICK_ALL
  return Number.isInteger(v) && v >= 0 && v <= AUTOPICK_ALL ? v : AUTOPICK_ALL
}
export const saveAutoPick = (v: number): void => set(AUTOPICK_KEY, String(v))

/** 실사 괴물을 쓸지 — 저장한 값이 없으면 폰은 끔 · 컴퓨터는 켬 */
export function realMonstersOn(): boolean {
  const v = get(REAL_KEY)
  return v !== null ? v === '1' : !isTouchDevice()
}
export const setRealMonsters = (on: boolean): void => set(REAL_KEY, on ? '1' : '0')

/** 조작 안내 띠 */
export const keysShown = (): boolean => get(KEYS_KEY) !== '0'
export const setKeysShown = (on: boolean): void => set(KEYS_KEY, on ? '1' : '0')

/** 소리 (audio/sfx.ts 와 같은 열쇠) */
export const soundMuted = (): boolean => get(MUTE_KEY) === '1'
export const setSoundMuted = (m: boolean): void => set(MUTE_KEY, m ? '1' : '0')

export type SettingsOpts = {
  /** 조작 안내 줄을 보일까 (터치 기기는 띠가 없어 감춘다) */
  keys?: boolean
  /** 바뀐 값을 지금 판에도 알린다 (대기실에서는 없다 — 다음 판부터 반영) */
  onSound?: (muted: boolean) => void
  onReal?: (on: boolean) => void
  onKeys?: (on: boolean) => void
  onAutoPick?: (v: number) => void
}

const onoff = (name: string, on: boolean, yes = '켜기', no = '끄기') =>
  `<div class="srow"><b>${name}</b><div class="seg small" data-set="${name}">` +
  `<button type="button" data-on="1" class="${on ? 'on' : ''}">${yes}</button>` +
  `<button type="button" data-on="0" class="${on ? '' : 'on'}">${no}</button></div></div>`

/** 설정 칸 HTML. 바깥에서 `<div class="settings">…</div>` 로 감싸 준다 */
export function settingsHtml(o: SettingsOpts = {}): string {
  const ap = loadAutoPick()
  const btns = RARITY_NAMES.map(
    (n, r) =>
      `<button type="button" data-r="${r}" class="${ap & (1 << r) ? 'on' : ''}" style="--rc:${RARITY_COLORS[r]}" title="${n} 아이템을 밟으면 ${ap & (1 << r) ? '줍습니다 (누르면 끔)' : '줍지 않습니다 (누르면 켬)'}">${n}</button>`,
  ).join('')
  const state = ap === AUTOPICK_ALL ? '모두 줍기' : ap === 0 ? '꺼짐 — F 로만' : '켠 등급만'
  return (
    `<div class="settings">` +
    onoff('소리', !soundMuted()) +
    onoff('실사 괴물', realMonstersOn()) +
    `<p class="apn">실사 괴물은 처음 만날 때 모델을 받습니다. 느린 기기·데이터가 아까우면 끄세요.</p>` +
    (o.keys === false ? '' : onoff('조작 안내', keysShown(), '보기', '숨기기')) +
    `<div class="autopick"><div class="aph"><b>자동 줍기</b><span>${state}</span></div><div class="apr">${btns}</div>` +
    `<p class="apn">밟으면 내 아이템을 줍습니다. 끈 등급 · 남이 버린 아이템은 F 로 줍습니다.</p></div>` +
    streamHtml() +
    `</div>`
  )
}

/** 치지직 · 프록시가 준 오류 글을 칸에 넣을 때 (태그가 되지 않게) */
const esc = (s: string): string => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch)

const STATUS_LABEL = { off: '연결 안 됨', connecting: '연결 중', on: '연결됨', error: '문제 있음' } as const

/**
 * 치지직 방송 연동 칸 (2026-09-23): 로그인 · 연결 · 채팅 말풍선 · 후원 이벤트 표 · 금액 · 시험.
 * 방송하는 사람만 쓰는 것이라 접어 둔다(펼친 상태는 기억한다).
 */
function streamHtml(): string {
  const c = loadStreamCfg()
  const st = stream.status
  const open = get('brpg.chzzk.open') === '1'
  const login = hasToken()
  const btn = st === 'on' || st === 'connecting'
    ? `<button type="button" class="btn secondary sm" data-cz="off">연결 끊기</button>`
    : login
      ? `<button type="button" class="btn main sm" data-cz="on">연결</button>`
      : `<button type="button" class="btn main sm" data-cz="login">치지직 로그인</button>`
  const rows = DONATE_EVENTS.map(
    (e, i) =>
      `<div class="czr"><input type="number" min="0" step="500" data-amt="${i}" value="${c.amounts[i]}" title="0 이면 끕니다"><b>${e.name}</b><span>${e.desc}</span>` +
      `<button type="button" class="lnk" data-try="${i}" title="이 금액으로 시험 후원 (판 안에서 — 던전에서 일어납니다)">시험</button></div>`,
  ).join('')
  return (
    `<details class="chzzk"${open ? ' open' : ''}><summary><b>치지직 방송 연동</b><span class="czs ${st}">${STATUS_LABEL[st]}</span></summary>` +
    `<div class="czbox">` +
    `<p class="apn">방송하는 사람만 씁니다. 채팅은 괴물 말풍선으로, 후원은 금액에 따라 판에 이벤트로 들어갑니다(다른 사람 화면에도 같이).</p>` +
    `<div class="czrow">${btn}${login ? `<button type="button" class="lnk" data-cz="logout">로그아웃</button>` : ''}<span class="czd">${esc(stream.detail)}</span></div>` +
    onoff('채팅 말풍선', c.bubbles) +
    onoff('후원 이벤트 표', c.table, '보이기', '숨기기') +
    `<div class="czh"><b>후원 금액 → 이벤트</b><button type="button" class="lnk" data-cz="chat">채팅 시험</button><button type="button" class="lnk" data-cz="reset">금액 처음대로</button></div>` +
    `<div class="czt">${rows}</div>` +
    `<p class="apn">금액이 넘는 것 중 가장 비싼 이벤트가 일어납니다. 마을에서 받은 후원은 던전에 나가면 일어납니다. 0 원이면 그 이벤트를 끕니다.<br>` +
    `로그인이 안 되면 치지직 개발자센터 앱의 로그인 리디렉션 URL 에 <code>${esc(redirectUri())}</code> 이 있어야 합니다.</p>` +
    `</div></details>`
  )
}

/** 설정 칸의 단추를 잇는다. 값이 바뀌면 칸을 다시 그리고 다시 잇는다 */
export function bindSettings(box: HTMLElement, o: SettingsOpts = {}): void {
  const redraw = () => {
    unStatus()
    box.innerHTML = settingsHtml(o)
    bindSettings(box, o)
  }
  // 연결 상태가 바뀌면 칸을 다시 그린다 (칸이 닫혔으면 그만 듣는다)
  const unStatus = stream.onStatus(() => {
    if (!box.isConnected) {
      unStatus()
      return
    }
    // 금액을 고치는 중이면 다시 그리지 않는다 (입력이 날아간다)
    if (box.contains(document.activeElement) && (document.activeElement as HTMLElement).tagName === 'INPUT') return
    redraw()
  })
  bindStream(box, redraw)
  box.querySelectorAll<HTMLButtonElement>('.srow .seg button').forEach((b) => {
    b.onclick = () => {
      const on = b.dataset.on === '1'
      const name = (b.parentElement as HTMLElement).dataset.set
      if (name === '소리') {
        setSoundMuted(!on)
        o.onSound?.(!on)
      } else if (name === '실사 괴물') {
        setRealMonsters(on)
        o.onReal?.(on)
      } else if (name === '채팅 말풍선' || name === '후원 이벤트 표') {
        const c = loadStreamCfg()
        if (name === '채팅 말풍선') c.bubbles = on
        else c.table = on
        saveStreamCfg(c)
      } else {
        setKeysShown(on)
        o.onKeys?.(on)
      }
      redraw()
    }
  })
  box.querySelectorAll<HTMLButtonElement>('.autopick button[data-r]').forEach((b) => {
    b.onclick = () => {
      const v = loadAutoPick() ^ (1 << Number(b.dataset.r))
      saveAutoPick(v)
      o.onAutoPick?.(v)
      redraw()
    }
  })
}

/** 방송 연동 칸의 단추 · 금액 칸 */
function bindStream(box: HTMLElement, redraw: () => void): void {
  const det = box.querySelector<HTMLDetailsElement>('details.chzzk')
  if (det) det.ontoggle = () => set('brpg.chzzk.open', det.open ? '1' : '0')
  box.querySelectorAll<HTMLButtonElement>('[data-cz]').forEach((b) => {
    b.onclick = () => {
      const a = b.dataset.cz
      if (a === 'login') startLogin()
      else if (a === 'on') {
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
      else if (a === 'chat') stream.fakeChat()
      else if (a === 'reset') {
        const c = loadStreamCfg()
        c.amounts = DONATE_EVENTS.map((e) => e.amount)
        saveStreamCfg(c)
      }
      redraw()
    }
  })
  box.querySelectorAll<HTMLInputElement>('input[data-amt]').forEach((inp) => {
    inp.onchange = () => {
      const c = loadStreamCfg()
      const v = Math.max(0, Math.round(Number(inp.value) || 0))
      c.amounts[Number(inp.dataset.amt)] = v
      saveStreamCfg(c)
      inp.value = String(v)
    }
    // 금액 칸에서 친 글자가 게임 키(WASD · 숫자 스킬)로 가지 않게
    inp.onkeydown = (e) => e.stopPropagation()
  })
  box.querySelectorAll<HTMLButtonElement>('[data-try]').forEach((b) => {
    b.onclick = () => {
      const c = loadStreamCfg()
      const i = Number(b.dataset.try)
      stream.fakeDonation(c.amounts[i] || DONATE_EVENTS[i].amount)
      b.textContent = `${won(c.amounts[i] || DONATE_EVENTS[i].amount)} 보냄`
      setTimeout(() => (b.textContent = '시험'), 1500)
    }
  })
}
