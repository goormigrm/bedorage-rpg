// 로비: 캐릭터 선택 · 맵 선택 · 혼자 하기 · 방 만들기 · 방 목록/참가 · 준비 → 자동 시작
// 방은 정원 4명(호스트 + 게스트 3). 멤버 순서·준비·팀은 호스트가 'room' 메시지로 방송하는 것이 정본.

import { DIFFICULTY_LABEL, Difficulty } from '../core/bot'
import { CHARACTERS, CHARACTER_LIST, CharacterId } from '../core/characters'
import { buildMap } from '../core/map'
import { DEFAULT_MAP, MAPS, MAP_LIST, MapId, isMapId, isMapScale, scaleForPlayers } from '../core/maps'
import { MAX_PLAYERS, MIN_PLAYERS } from '../core/state'
import { WEAPONS } from '../core/weapons'
import {
  CtlMessage, LobbyLink, Member, ROOM_MODE_LABEL, RoomInfo, RoomLink, RoomMode,
  makeRoomCode, openLobby, openRoom,
} from '../net/room'
import { drawPortrait } from '../render/character'
import { drawMapPreview } from '../render/minimap'
import { isTouchDevice } from '../game/touch'
import { TEAM_NAMES } from '../render/hud'
import { SessionConfig } from '../game/session'

export interface LobbyHandlers {
  onStart: (cfg: Omit<SessionConfig, 'onExit'>) => void
  /** 페이지 공용 로비 통로 (main.ts 가 하나 열어 돌려 쓴다). 없으면 스스로 연다(테스트) */
  lobbyLink?: LobbyLink
}

/** 목표 킬: 5~50, 5 단위 */
const KILL_OPTIONS = Array.from({ length: 10 }, (_, i) => (i + 1) * 5)
/** 로비 미리보기용 고정 시드 (실제 판은 매번 다른 시드로 생성된다) */
const PREVIEW_SEED = 20260904

/** 닉네임 등 사용자 입력을 HTML 에 넣기 전에 */
function esc(t: string): string {
  return t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch)
}

export class Lobby {
  private char: CharacterId = 'cheolmyeon'
  private mapId: MapId = DEFAULT_MAP
  private killsSolo = 5
  private killsRoom = 5
  private previewTimer = 0
  private difficulty: Difficulty = 'normal'
  /** 혼자 하기 봇 수 (1~3) */
  private bots = 1
  /** 혼자 하기 모드: 개인전 / 2v2 팀전 (봇 3) */
  private soloMode: 'ffa' | 'teams' = 'ffa'
  private roomMode: RoomMode = 'ffa'
  /** 방 정원 (호스트가 방 만들 때 정한다). 2명만 모여도 시작할 수 있고, 나머지 자리는 난입으로 채운다 */
  private roomSize = 4
  /** 닉네임 (선택, 8자, localStorage 기억) */
  private nick = ''
  private lobbyLink: LobbyLink | null = null
  private link: RoomLink | null = null
  private role: 'host' | 'guest' | null = null
  /** 방 멤버 (순서 = 플레이어 인덱스, 호스트가 0) */
  private members: Member[] = []
  /** 호스트: 빈 자리를 봇으로 채운다 (2026-09-05). 게스트는 방 정보로 받아 안내만 본다 */
  private fillBots = false
  private botDiff: Difficulty = 'normal'
  private fillBotsRemote = false
  private hostId: string | null = null
  private myReady = false
  private myTeam = 0
  private waitTimer = 0
  /** 이번 입장에서 통로를 다시 연 횟수 (피어가 안 붙으면 2번까지 다시 연다) */
  private joinTries = 0
  private rooms: RoomInfo[] = []
  private starting = false
  private disposed = false

  /** 난입 요청 타임아웃 */
  private rejoinTimer = 0
  private onlineTimer = 0

  constructor(
    private host: HTMLElement,
    private handlers: LobbyHandlers,
  ) {
    try {
      // 닉네임은 배도라지 덕과 **같은 키**다(같은 출처 goormigrm.github.io) — 두 게임을 오가도 닉네임이 그대로다
      this.nick = (localStorage.getItem('bd.nick') ?? '').slice(0, 8)
    } catch {
      /* 저장소 없음 */
    }
    this.render()
    this.openLobbyList()
  }

  // ---------- 화면 ----------
  private render(): void {
    const h = this.host
    h.innerHTML = `
      <div class="lobby">
        <div class="season">BEDORAGE DUCK · P2P · 2~${MAX_PLAYERS} PLAYERS</div>
        <h1><span class="t1">배도라지</span> <span class="t2">덕</span></h1>
        <p class="tag"><b>최대 ${MAX_PLAYERS}인 쿼터뷰 슈터</b> · 서버 없는 P2P 대전 · 비공식 팬게임</p>
        <div class="feats"><span>덕코프식 시야</span><span>개인전 · 팀전</span><span>게임 중 난입 (개인전)</span><span>혼자 남아도 30초 대기</span><span>설치 없음 · 서버 없음</span></div>

        <div class="topbar">
          <div class="nickwrap" id="nick-card">
            <label for="nick">닉네임</label>
            <input class="nick big" id="nick" maxlength="8" placeholder="닉네임 (8자)" value="${this.nick.replace(/"/g, '&quot;')}" autocomplete="off" spellcheck="false">
          </div>
          <button class="mychar" id="my-char" title="캐릭터 목록으로">
            <canvas></canvas>
            <span><small>내 캐릭터</small><b id="my-char-name"></b></span>
          </button>
          <div class="topacts">
            <button class="btn main lg" id="btn-host">방 만들기</button>
            <button class="btn lg" id="btn-solo">혼자 하기</button>
          </div>
        </div>
        <div class="notice" id="net-notice">
          <b>서버가 없는 게임입니다.</b> 방을 만든 사람의 컴퓨터가 곧 방이라, <b>방장의 인터넷이 끊기면 방도 함께 사라집니다.</b><br>
          와이파이·폰 회선처럼 흔들리는 연결로 방을 만들면 판이 터질 수 있으니, 방은 가능하면 <b>유선(랜선) PC</b>에서 만들어 주세요.
        </div>

        <div class="status" id="status"></div>

        <div class="card rooms-card wide">
          <h2>방 목록 <span class="k" id="rooms-count"></span><span class="k" id="online">접속 확인 중</span><button class="lnk refresh" id="btn-refresh" title="목록을 다시 받아옵니다">새로고침</button></h2>
          <div class="rhead"><span>방</span><span>맵</span><span>모드</span><span>목표</span><span>인원</span><span>상태</span><span></span></div>
          <div class="rooms" id="rooms"><div class="empty">열린 방이 없습니다. 방을 만들거나 잠시 기다려 보세요.</div></div>
          <div class="pager" id="pager" hidden>
            <button class="btn secondary sm" id="pg-prev">이전</button>
            <span id="pg-label">1 / 1</span>
            <button class="btn secondary sm" id="pg-next">다음</button>
          </div>
          <p class="hintline dim">게임 중인 개인전 방도 자리가 있으면 <b>난입</b>할 수 있습니다.<br>팀전은 난입이 없고, 누가 나가면 그 자리에서 끝납니다.</p>
        </div>

        <div class="section-t">캐릭터 <small>내가 쓸 캐릭터. 리스폰 대기 중에도 바꿀 수 있다</small></div>
        <div class="chars" id="chars"></div>

        <div class="dlg" id="dlg-host" hidden>
          <div class="dbox">
            <h3>방 만들기</h3>
            <p class="cardp">정원을 정해 방을 엽니다.<br><b>둘만 모여도 시작</b>할 수 있고, 남은 자리는 <b>게임 중에도 난입</b>으로 채워집니다.</p>
            <div class="row"><label>정원</label><div class="seg" id="seg-size">
              ${[2, 3, 4].map((n) => `<button data-v="${n}" class="${n === 4 ? 'on' : ''}">${n}명</button>`).join('')}
            </div></div>
            <div class="row"><label>모드</label><div class="seg" id="seg-room-mode">
              <button data-v="ffa" class="on">개인전</button><button data-v="teams">팀전</button>
            </div></div>
            <div class="row"><label>목표 킬</label><select class="sel" id="kills-room">
              ${KILL_OPTIONS.map((k) => `<option value="${k}" ${k === 5 ? 'selected' : ''}>${k} 킬</option>`).join('')}
            </select></div>
            <div class="row"><label>맵</label><div class="seg" id="seg-map">
              ${MAP_LIST.map((m) => `<button data-v="${m.id}" class="${m.id === this.mapId ? 'on' : ''}" title="${m.desc}">${m.name}</button>`).join('')}
            </div></div>
            <div class="maprow">
              <p class="hintline" id="map-desc">${MAPS[this.mapId].desc}</p>
              <canvas id="map-preview" class="mappv"></canvas>
            </div>
            <div class="warn">방장의 연결이 곧 방입니다.<br>와이파이나 폰 회선이면 중간에 방이 터질 수 있어요.<br>랜선을 꽂은 PC가 가장 안전합니다.</div>
            <div class="dacts"><button class="btn secondary" data-close>취소</button><button class="btn main" id="btn-host-go">방 만들기</button></div>
          </div>
        </div>

        <div class="dlg" id="dlg-solo" hidden>
          <div class="dbox">
            <h3>혼자 하기</h3>
            <p class="cardp">봇과 대결.<br>죽으면 3초 뒤 먼 곳에 리스폰, 목표 킬을 먼저 채우면 승리.</p>
            <div class="row"><label>난이도</label><div class="seg" id="seg-diff">
              <button data-v="easy">쉬움</button><button data-v="normal" class="on">보통</button><button data-v="hard">어려움</button>
            </div></div>
            <div class="row"><label>봇 수</label><div class="seg" id="seg-bots">
              <button data-v="1" class="on">봇 1</button><button data-v="2">봇 2</button><button data-v="3">봇 3</button>
            </div></div>
            <div class="row"><label>모드</label><div class="seg" id="seg-solo-mode">
              <button data-v="ffa" class="on">개인전</button><button data-v="teams">팀전</button>
            </div></div>
            <div class="row"><label>목표 킬</label><select class="sel" id="kills-solo">
              ${KILL_OPTIONS.map((k) => `<option value="${k}" ${k === 5 ? 'selected' : ''}>${k} 킬</option>`).join('')}
            </select></div>
            <div class="row"><label>맵</label><div class="seg" id="seg-map2">
              ${MAP_LIST.map((m) => `<button data-v="${m.id}" class="${m.id === this.mapId ? 'on' : ''}" title="${m.desc}">${m.name}</button>`).join('')}
            </div></div>
            <div class="maprow">
              <p class="hintline" id="map-desc2">${MAPS[this.mapId].desc}</p>
              <canvas id="map-preview2" class="mappv"></canvas>
            </div>
            <div class="dacts"><button class="btn secondary" data-close>취소</button><button class="btn main" id="btn-solo-go">▶ 시작</button></div>
          </div>
        </div>

        <div class="joining" id="joining" hidden>
          <div class="jbox">
            <div class="jspin"></div>
            <h3 id="j-title">게임에 들어가는 중</h3>
            <ol class="jsteps" id="j-steps">
              <li data-s="1">방에 연결</li>
              <li data-s="2">자리 요청</li>
              <li data-s="3">판 받는 중</li>
            </ol>
            <p class="jhint" id="j-hint">릴레이에 따라 몇 초 걸립니다.</p>
            <button class="btn secondary" id="j-cancel">취소</button>
          </div>
        </div>

        <div class="foot">비공식 팬 프로젝트 · 비상업 · 문의 시 즉시 삭제 · <b>문제·제안은 철면수심 다음 카페 게시글로</b> · <a href="https://github.com/goormigrm/bedorage-rpg">github.com/goormigrm/bedorage-rpg</a></div>
      </div>`

    const chars = h.querySelector('#chars') as HTMLElement
    for (const c of CHARACTER_LIST) {
      const el = document.createElement('button')
      el.className = 'char' + (c.id === this.char ? ' on' : '')
      el.dataset.id = c.id
      el.style.setProperty('--c', '#' + c.bodyColor.toString(16).padStart(6, '0'))
      // 한 줄에 한 명. 설명이 카드 안에서 세 줄로 접히면 읽히지 않아 행으로 편다 (2026-09-06 요청)
      el.innerHTML = `
        <canvas></canvas>
        <div class="ct"><b>${c.name}</b><small>${c.basedOn} · ${WEAPONS[c.weapon].name} · HP ${c.maxHp}</small></div>
        <div class="pv"><b>${c.passiveName}</b> ${c.passiveDesc}</div>`
      el.onclick = () => this.selectChar(c.id)
      chars.appendChild(el)
      const cv = el.querySelector('canvas') as HTMLCanvasElement
      requestAnimationFrame(() => drawPortrait(cv, c))
    }

    const onMap = (v: string) => {
      if (isMapId(v)) this.mapId = v
      for (const id of ['#map-desc', '#map-desc2']) {
        const el = h.querySelector(id) as HTMLElement | null
        if (el) el.textContent = MAPS[this.mapId].desc
      }
      // 두 창의 맵 선택을 서로 맞춰 둔다 (맵은 하나뿐이다)
      for (const sel of ['#seg-map', '#seg-map2']) {
        h.querySelectorAll<HTMLButtonElement>(`${sel} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === this.mapId))
      }
      this.drawPreview()
      this.hostChanged()
    }
    this.seg('#seg-map', onMap)
    this.seg('#seg-map2', onMap)
    this.seg('#seg-diff', (v) => (this.difficulty = v as Difficulty))
    this.seg('#seg-bots', (v) => {
      this.bots = Number(v)
      this.drawPreview()
      // 팀전은 인원이 짝수여야 한다 (나 + 봇 = 4 또는 6)
      if (this.soloMode === 'teams' && (this.bots + 1) % 2 !== 0) this.setSeg('#seg-solo-mode', 'ffa')
    })
    this.seg('#seg-solo-mode', (v) => {
      this.soloMode = v as 'ffa' | 'teams'
      if (this.soloMode === 'teams' && (this.bots + 1) % 2 !== 0) this.setSeg('#seg-bots', '3')
    })
    const soloSel = h.querySelector('#kills-solo') as HTMLSelectElement
    soloSel.onchange = () => (this.killsSolo = Number(soloSel.value))
    const roomSel = h.querySelector('#kills-room') as HTMLSelectElement
    roomSel.onchange = () => {
      this.killsRoom = Number(roomSel.value)
      this.hostChanged()
    }
    this.seg('#seg-size', (v) => {
      this.roomSize = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Number(v)))
      if (this.roomMode === 'teams' && this.roomSize % 2 !== 0) this.setSeg('#seg-room-mode', 'ffa')
      this.announce()
      this.renderRoom()
    })
    this.seg('#seg-room-mode', (v) => {
      this.roomMode = v as RoomMode
      if (this.role === 'host') this.members.forEach((m, i) => (m.team = this.roomMode === 'teams' ? i % 2 : 0))
      this.myTeam = this.roomMode === 'teams' ? 0 : 0
      this.hostChanged()
    })
    const nickEl = h.querySelector('#nick') as HTMLInputElement
    const nickCard = h.querySelector('#nick-card') as HTMLElement | null
    const syncNickCard = () => nickCard?.classList.toggle('empty', this.nick.trim().length === 0)
    syncNickCard()
    this.syncNickCard = syncNickCard
    const applyNick = (save: boolean) => {
      this.nick = nickEl.value.trim().slice(0, 8)
      if (this.nick.length > 0) nickEl.classList.remove('need')
      syncNickCard()
      if (!save) return
      nickEl.value = this.nick
      try {
        localStorage.setItem('bd.nick', this.nick)
      } catch {
        /* 무시 */
      }
      this.pushSelf()
    }
    // 치는 즉시 강조를 풀어 준다 (change 는 포커스를 잃어야 온다)
    nickEl.addEventListener('input', () => applyNick(false))
    nickEl.addEventListener('change', () => applyNick(true))
    ;(h.querySelector('#btn-refresh') as HTMLButtonElement).onclick = () => this.refreshRooms()
    ;(h.querySelector('#btn-solo') as HTMLButtonElement).onclick = () => this.openDlg('#dlg-solo')
    ;(h.querySelector('#my-char') as HTMLButtonElement).onclick = () => h.querySelector('#chars')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    this.drawMyChar()
    ;(h.querySelector('#btn-host') as HTMLButtonElement).onclick = () => this.openDlg('#dlg-host')
    if (isTouchDevice()) {
      // 폰은 방을 만들 수 없다. 방장의 연결이 곧 방인데 폰 회선은 자주 흔들려 모두의 판이 터진다 (2026-09-05 요청)
      const hb = h.querySelector('#btn-host') as HTMLButtonElement
      hb.disabled = true
      hb.title = '폰에서는 방을 만들 수 없습니다'
      const nn = h.querySelector('#net-notice') as HTMLElement
      nn.innerHTML = `<b>폰에서는 방을 만들 수 없습니다.</b><br>
      이 게임은 서버가 없어 방을 만든 사람의 연결이 곧 방인데, 폰 회선은 자주 흔들려 모두의 판이 터집니다.<br>
      <b>방 목록에서 참가</b>하거나 <b>혼자 하기</b>를 이용해 주세요. 방은 랜선을 꽂은 PC에서 만드는 것이 가장 안전합니다.`
      nn.classList.add('strong')
      // 폰 가로 화면은 높이가 375px 안팎이라 제목·소개 띠·안내문에 밀려 방 목록이 화면 밖(스크롤 아래)에 있었다 —
      // "모바일에서는 방 목록이 안 보인다"(2026-09-06 제보). 소개 띠를 감추고 안내문을 방 목록 아래로 내린다
      h.querySelector('.lobby')?.classList.add('touch')
      const charsHead = h.querySelector('#chars')?.previousElementSibling
      if (charsHead) charsHead.before(nn)
    }
    ;(h.querySelector('#btn-solo-go') as HTMLButtonElement).onclick = () => {
      this.closeDlg()
      this.startSolo()
    }
    ;(h.querySelector('#btn-host-go') as HTMLButtonElement).onclick = () => {
      this.closeDlg()
      this.hostRoom()
    }
    h.querySelectorAll<HTMLElement>('.dlg').forEach((d) => {
      d.querySelectorAll<HTMLButtonElement>('[data-close]').forEach((b) => (b.onclick = () => this.closeDlg()))
      // 바깥을 누르면 닫힌다 (창 안쪽 클릭은 그대로)
      d.onclick = (e) => {
        if (e.target === d) this.closeDlg()
      }
    })
    ;(h.querySelector('#pg-prev') as HTMLButtonElement).onclick = () => {
      this.roomPage--
      this.renderRooms()
    }
    ;(h.querySelector('#pg-next') as HTMLButtonElement).onclick = () => {
      this.roomPage++
      this.renderRooms()
    }
    requestAnimationFrame(() => this.drawPreview())
  }

  private drawPreview(): void {
    // 두 창(방 만들기·혼자 하기)에 미리보기가 하나씩 있다. 열려 있는 쪽만 그린다 (숨긴 캔버스는 폭이 0)
    const cvs = ['#map-preview', '#map-preview2']
      .map((id) => this.host.querySelector(id) as HTMLCanvasElement | null)
      .filter((c): c is HTMLCanvasElement => !!c && c.clientWidth > 0)
    if (cvs.length === 0) return
    clearTimeout(this.previewTimer)
    this.previewTimer = window.setTimeout(() => {
      const players = this.role ? Math.max(2, this.members.length) : 1 + this.bots
      const map = buildMap(this.mapId, scaleForPlayers(players), PREVIEW_SEED)
      for (const cv of cvs) drawMapPreview(cv, map)
    }, 0)
  }

  /** 호스트 설정(맵·목표·모드)이 바뀌면 방송·목록 갱신 */
  private hostChanged(): void {
    if (this.role !== 'host') return
    this.members.forEach((m) => (m.ready = false))
    this.myReady = false
    this.broadcastRoom()
    this.announce()
    this.renderRoom()
  }

  /** 상단 바의 "내 캐릭터" 초상·이름. 캐릭터 목록이 아래라 위에서는 누굴 골랐는지 안 보였다 (2026-09-05) */
  private drawMyChar(): void {
    const def = CHARACTER_LIST.find((c) => c.id === this.char)
    const el = this.host.querySelector('#my-char') as HTMLElement | null
    if (!def || !el) return
    ;(el.querySelector('#my-char-name') as HTMLElement).textContent = def.name
    el.style.setProperty('--c', '#' + def.bodyColor.toString(16).padStart(6, '0'))
    const cv = el.querySelector('canvas') as HTMLCanvasElement
    requestAnimationFrame(() => drawPortrait(cv, def))
  }

  private selectChar(id: CharacterId): void {
    this.char = id
    this.host.querySelectorAll('.char').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.id === id))
    this.drawMyChar()
    this.myReady = false
    this.pushSelf()
  }

  private seg(sel: string, cb: (v: string) => void): void {
    const el = this.host.querySelector(sel) as HTMLElement
    el.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        el.querySelectorAll('button').forEach((x) => x.classList.remove('on'))
        b.classList.add('on')
        cb(b.dataset.v!)
      }
    })
  }

  /** 세그먼트 값을 코드에서 바꾸고 콜백까지 실행 */
  private setSeg(sel: string, v: string): void {
    const el = this.host.querySelector(sel) as HTMLElement | null
    const b = el?.querySelector(`button[data-v="${v}"]`) as HTMLButtonElement | null
    b?.click()
  }

  private status(text: string, kind: '' | 'ok' | 'bad' = '', html = ''): void {
    const s = this.host.querySelector('#status') as HTMLElement
    s.classList.add('show')
    s.innerHTML = html + (text ? `<div class="st ${kind}">${text}</div>` : '')
  }

  private hideStatus(): void {
    ;(this.host.querySelector('#status') as HTMLElement).classList.remove('show')
  }

  // ---------- 방 목록 ----------
  /** 통로가 페이지 공용이면 닫지 않는다 — 닫았다 다시 열면 Trystero 캐시 때문에 새 통로가 죽는다(main.ts 주석) */
  private get sharedLobby(): boolean {
    return !!this.handlers.lobbyLink
  }

  private openLobbyList(): void {
    if (this.lobbyLink) return
    this.lobbyLink = this.handlers.lobbyLink ?? openLobby()
    this.lobbyLink.onRooms((rooms) => {
      this.rooms = rooms
      this.renderRooms()
    })
    if (!this.onlineTimer) {
      this.onlineTimer = window.setInterval(() => {
        if (this.disposed) return
        const el = this.host.querySelector('#online')
        if (el) el.textContent = this.lobbyLink ? `접속 ${this.lobbyLink.onlineCount()}명` : '연결 중…'
      }, 1500)
    }
  }

  /**
   * 방 목록을 다시 받아온다.
   * 공용 로비 방은 **서로 연결된 사람의 방송만** 보이므로, 늦게 들어왔거나 릴레이가 흔들리면
   * 남의 방이 안 보일 수 있다. 통로를 닫았다 다시 열어 처음부터 다시 찾는다.
   */
  private refreshRooms(): void {
    const btn = this.host.querySelector('#btn-refresh') as HTMLButtonElement | null
    if (btn) {
      btn.disabled = true
      btn.textContent = '찾는 중…'
    }
    if (this.lobbyLink && !this.sharedLobby) {
      this.lobbyLink.leave()
      this.lobbyLink = null
    }
    this.rooms = []
    this.renderRooms()
    // 이전 통로가 정리될 짬을 준 뒤 다시 연다 (공용 통로면 그대로 두고 방송만 다시)
    window.setTimeout(() => {
      if (this.disposed) return
      this.openLobbyList()
      this.announce()
      window.setTimeout(() => {
        if (this.disposed) return
        const b = this.host.querySelector('#btn-refresh') as HTMLButtonElement | null
        if (b) {
          b.disabled = false
          b.textContent = '새로고침'
        }
      }, 2500)
    }, 350)
  }

  /** 한 페이지에 보여 줄 방 수 (더 많으면 페이지로 넘긴다) */
  private static readonly ROOMS_PER_PAGE = 6
  private roomPage = 0

  private renderRooms(): void {
    const el = this.host.querySelector('#rooms') as HTMLElement | null
    if (!el) return
    const visible = this.rooms.filter((r) => r.state !== 'closed' && !(this.link && r.code === this.link.code))
    const count = this.host.querySelector('#rooms-count')
    if (count) count.textContent = visible.length > 0 ? `${visible.length}개` : ''
    const head = this.host.querySelector('.rhead') as HTMLElement | null
    if (head) head.hidden = visible.length === 0
    if (visible.length === 0) {
      el.innerHTML = '<div class="empty">열린 방이 없습니다. 방을 만들거나 잠시 기다려 보세요.</div>'
      this.renderPager(0, 0)
      return
    }
    // 페이지: 방이 많아져도 목록이 길어지지 않는다
    const per = Lobby.ROOMS_PER_PAGE
    const pages = Math.max(1, Math.ceil(visible.length / per))
    this.roomPage = Math.min(Math.max(0, this.roomPage), pages - 1)
    const page = visible.slice(this.roomPage * per, this.roomPage * per + per)
    el.innerHTML = page
      .map((r) => {
        const c = (CHARACTERS as Record<string, { name: string } | undefined>)[r.hostChar]
        const m = isMapId(r.map) ? MAPS[r.map].name : r.map
        // 게임 중이어도 자리가 남아 있으면 난입할 수 있다. 단 팀전은 짝이 안 맞아 난입 불가
        const room = r.count < r.max
        const teamsPlaying = r.state === 'playing' && r.mode === 'teams'
        const canJoin = r.state === 'open' || (r.state === 'playing' && room && !teamsPlaying)
        const st =
          r.state === 'open'
            ? '<span class="pill ok">참가 가능</span>'
            : r.state === 'full'
              ? '<span class="pill">정원 참</span>'
              : teamsPlaying
                ? '<span class="pill">난입 불가</span>'
                : room
                  ? '<span class="pill ok">난입 가능</span>'
                  : '<span class="pill">게임 중</span>'
        return `<div class="room">
          <span class="rhost"><b>${r.hostName && r.hostName.trim() ? esc(r.hostName.trim()) : c ? c.name : r.hostChar}</b>의 방</span>
          <span class="rmap">${m}</span>
          <span class="rmode">${ROOM_MODE_LABEL[r.mode] ?? r.mode}</span>
          <span class="rkill">${r.targetKills}킬</span>
          <span class="rcount">${r.count}/${r.max}명</span>
          <span class="rstate">${st}</span>
          <span class="ract"><button class="btn" data-code="${r.code}" ${canJoin ? '' : 'disabled'}>${r.state === 'playing' ? '난입' : '참가'}</button></span>
        </div>`
      })
      .join('')
    el.querySelectorAll('button[data-code]').forEach((b) => {
      const code = (b as HTMLElement).dataset.code!
      const info = visible.find((r) => r.code === code)
      ;(b as HTMLButtonElement).onclick = () => this.join(code, info?.state === 'playing')
    })
    this.renderPager(this.roomPage, pages)
  }

  private renderPager(page: number, pages: number): void {
    const el = this.host.querySelector('#pager') as HTMLElement | null
    if (!el) return
    el.hidden = pages <= 1
    if (pages <= 1) return
    ;(el.querySelector('#pg-label') as HTMLElement).textContent = `${page + 1} / ${pages}`
    ;(el.querySelector('#pg-prev') as HTMLButtonElement).disabled = page <= 0
    ;(el.querySelector('#pg-next') as HTMLButtonElement).disabled = page >= pages - 1
  }

  /** 방 만들기·혼자 하기 창. 닉네임이 없으면 먼저 채우게 한다 */
  private openDlg(sel: string): void {
    if (!this.requireNick()) return
    if (sel === '#dlg-host' && isTouchDevice()) {
      this.status('폰에서는 방을 만들 수 없습니다. 방 목록에서 참가하거나 혼자 하기를 이용해 주세요.', 'bad')
      return
    }
    this.closeDlg()
    const d = this.host.querySelector(sel) as HTMLElement | null
    if (!d) return
    d.hidden = false
    this.drawPreview()
  }

  private closeDlg(): void {
    this.host.querySelectorAll<HTMLElement>('.dlg').forEach((d) => (d.hidden = true))
  }

  private announce(state?: RoomInfo['state']): void {
    if (!this.lobbyLink || this.role !== 'host' || !this.link) return
    this.lobbyLink.announce({
      code: this.link.code,
      hostChar: this.char,
      hostName: this.nick,
      map: this.mapId,
      targetKills: this.killsRoom,
      mode: this.roomMode,
      count: this.members.length,
      max: this.roomSize,
      state: state ?? (this.members.length >= this.roomSize ? 'full' : 'open'),
    })
  }

  // ---------- 혼자 하기 ----------
  private startSolo(): void {
    // 봇은 나와 다른 캐릭터를 우선, 모자라면 중복 허용
    const chars: CharacterId[] = [this.char]
    const pool = CHARACTER_LIST.map((c) => c.id)
    while (chars.length < 1 + this.bots) {
      const rest = pool.filter((id) => !chars.includes(id))
      const pick = rest.length > 0 ? rest : pool
      chars.push(pick[Math.floor(Math.random() * pick.length)])
    }
    // 팀전: 앞뒤로 번갈아 배정 (4명 → 2:2, 6명 → 3:3)
    const teams =
      this.soloMode === 'teams' && chars.length % 2 === 0 ? chars.map((_, i) => i % 2) : undefined
    this.handlers.onStart({
      mode: 'solo',
      chars,
      teams,
      names: chars.map((_, i) => (i === 0 ? this.nick : '')),
      targetKills: this.killsSolo,
      seed: (Math.random() * 0xffffffff) >>> 0,
      localPlayer: 0,
      mapId: this.mapId,
      difficulty: this.difficulty,
    })
  }

  // ---------- 방 만들기 / 참가 ----------
  /** 방에 들어가기 전 닉네임 확인. 비어 있으면 입력칸으로 보낸다 */
  private syncNickCard: () => void = () => {}

  private requireNick(): boolean {
    if (this.nick.trim().length > 0) return true
    const el = this.host.querySelector('#nick') as HTMLInputElement | null
    el?.focus()
    el?.classList.add('need')
    this.syncNickCard()
    setTimeout(() => el?.classList.remove('need'), 1200)
    this.status('닉네임을 먼저 입력해 주세요. 게임 중 캐릭터 위에 표시됩니다. (8자까지)', 'bad')
    return false
  }

  private hostRoom(): void {
    if (!this.requireNick()) return
    if (isTouchDevice()) return // 버튼이 막혀 있지만 혹시 몰라 한 번 더
    this.closeLink()
    const code = makeRoomCode()
    this.role = 'host'
    this.link = openRoom(code, 'host')
    this.hostId = this.link.selfId
    this.myReady = false
    this.myTeam = 0
    this.members = [{ id: this.link.selfId, char: this.char, ready: false, team: 0, name: this.nick }]
    this.wireLink()
    this.announce()
    this.renderRoom()
    this.renderRooms()
  }

  /** 게임 중인 방에 난입하려는 중인가 */
  private barging = false
  private bargeSent = false

  /**
   * 방에 들어간다. 대기실이든 게임 중이든 **연결되는 피어마다** "자리 주세요"(joinAsk) 를 보낸다.
   * - 풀 메시라 피어는 한 명씩 연결된다. 전에는 **처음 연결된 한 명에게만** 보냈는데, 그게 게스트면
   *   호스트는 영영 못 듣고 15초 뒤 실패했다(기존 인원이 3명이면 첫 연결이 호스트일 확률은 1/3 —
   *   "세 번째는 되는데 네 번째는 계속 실패" 의 원인).
   * - 대기실 호스트는 joinAsk 를 무시하고 room 을 보낸다 → 대기실. 게임 중인 호스트는 joinAt/resume 을 보낸다 → 난입.
   *   그래서 초대 링크로 게임 중인 방에 들어와도 그대로 난입이 된다.
   */
  private join(code: string, barge = false): void {
    if (!this.requireNick()) return
    // 같은 방에 이미 들어가는 중이면 그대로 둔다. 버튼을 두 번 누르면 전에는 나갔다 다시 들어갔는데,
    // 같은 피어 id 로 0.3초 안에 나갔다 들어오면 시그널링이 새 연결을 잘 못 만들어 20초를 헛기다렸다
    if (this.link && this.role === 'guest' && this.link.code === code) return
    this.closeLink()
    this.barging = barge
    this.bargeSent = false
    this.role = 'guest'
    this.link = openRoom(code, 'guest')
    this.hostId = null
    this.members = []
    this.myReady = false
    this.myTeam = 0
    this.wireLink()
    if (barge) {
      // 누르자마자 **화면을 덮어** 들어가는 중임을 보여 준다. 전에는 옆의 작은 글씨뿐이라
      // 아무 일도 안 일어난 줄 알고 다시 누르게 됐다(2026-09-05 요청)
      this.showJoining(1)
    } else {
      this.renderRoom()
    }
    this.joinTries = 0
    this.armJoinWait(code, barge)
  }

  /**
   * 피어가 붙지 않으면 통로를 **다시 연다**(8초 → 6초 → 6초, 합쳐 20초). 릴레이 신호가 한 번 새거나 상대가 옛 연결을 아직
   * 정리하지 못했을 때 새 구독·새 방송으로 다시 두드리는 것이 그냥 기다리는 것보다 낫다(2026-09-06 사용자 제보:
   * 나갔다가 같은 방에 난입하면 20초 뒤 "연결되지 않았습니다", 새로고침하면 됨). 세 번째도 안 되면 포기한다
   */
  private armJoinWait(code: string, barge: boolean): void {
    clearTimeout(this.waitTimer)
    this.waitTimer = window.setTimeout(() => {
      if (!this.link || this.hostId || this.bargeSent) return
      if (this.joinTries < 2) {
        this.joinTries++
        console.warn(`[lobby] ${code}: 피어가 붙지 않아 통로를 다시 연다 (${this.joinTries}번째)`)
        const old = this.link
        this.link = null
        old.leave()
        this.link = openRoom(code, 'guest')
        this.wireLink()
        if (barge) this.showJoining(1)
        this.armJoinWait(code, barge)
        return
      }
      this.status(
        '연결되지 않았습니다. 방이 아직 열려 있는지 확인하세요. 회사·학교망이면 폰 핫스팟으로 시도해 보세요.',
        'bad',
        `<div class="row"><button class="btn secondary" id="btn-cancel">닫기</button></div>`,
      )
      this.bindCancel()
      this.closeLink()
    }, this.joinTries === 0 ? 8000 : 6000)
  }

  private wireLink(): void {
    const link = this.link!
    link.onPeerJoin((id) => {
      if (this.link !== link) return
      // 연결되는 피어마다 자리를 묻는다 (게스트는 무시하고, 호스트만 답한다)
      link.sendCtl({ t: 'joinAsk', char: this.char, name: this.nick }, id)
      if (!this.bargeSent) {
        this.bargeSent = true
        if (this.barging) this.showJoining(2)
        // 호스트가 답하지 않으면 포기한다. **핸들을 저장**해야 성공·취소 때 지울 수 있다 —
        // 전에는 저장하지 않아 첫 시도의 타이머가 두 번째 시도를 죽였다
        clearTimeout(this.rejoinTimer)
        this.rejoinTimer = window.setTimeout(() => {
          if (this.link === link && this.barging) this.giveUpRejoin('방이 응답하지 않습니다. 잠시 뒤 다시 시도해 보세요.')
        }, 15000)
      }
      // 새로 들어온 피어에게 내 상태를 알린다 (대기실 호스트는 hello 를 받고 멤버로 넣는다)
      this.sendHello(id)
    })
    link.onPeerLeave((id) => {
      if (this.link !== link) return
      this.peerGone(id)
    })
    link.onCtl((m, from) => {
      if (this.link !== link) return
      this.onCtl(m, from)
    })
  }

  /** 난입에 실패했을 때 (자리가 없거나 방이 응답하지 않음) */
  private giveUpRejoin(why: string): void {
    clearTimeout(this.rejoinTimer)
    this.hideJoining()
    this.closeLink()
    this.status(why, 'bad', `<div class="row"><button class="btn secondary" id="btn-cancel">닫기</button></div>`)
    this.bindCancel()
  }

  private peerGone(id: string): void {
    if (this.role === 'host') {
      const before = this.members.length
      this.members = this.members.filter((m) => m.id !== id)
      if (this.members.length !== before) {
        this.broadcastRoom()
        this.announce()
        this.renderRoom()
      }
    } else if (id === this.hostId) {
      this.status('호스트가 방을 닫았습니다.', 'bad', `<div class="row"><button class="btn secondary" id="btn-cancel">닫기</button></div>`)
      this.bindCancel()
      this.closeLink()
    }
  }

  private onCtl(m: CtlMessage, from: string): void {
    switch (m.t) {
      case 'resume': {
        // 진행 중인 방에 끼어든다(난입). 호스트가 보내 준 그 시점의 판으로 시작한다.
        // 초대 링크로 들어와도(barging=false) 호스트가 게임 중이면 이 길로 온다
        if (this.role !== 'guest' || !this.link) return
        this.barging = false
        this.showJoining(3)
        clearTimeout(this.rejoinTimer)
        clearTimeout(this.waitTimer)
        const c = m.cfg as {
          chars: CharacterId[]
          teams?: number[]
          names: string[]
          targetKills: number
          seed: number
          map: string
          scale: number
          delay: number
          peerIds: string[]
          bots?: boolean[]
          difficulty?: Difficulty
        }
        const link = this.link!
        this.launch({
          mode: 'p2p',
          chars: c.chars,
          teams: c.teams,
          names: c.names,
          targetKills: c.targetKills,
          seed: c.seed,
          localPlayer: m.p,
          mapId: isMapId(c.map) ? c.map : DEFAULT_MAP,
          mapScale: c.scale as SessionConfig['mapScale'],
          link,
          delay: c.delay,
          peerIds: c.peerIds,
          bots: c.bots,
          difficulty: c.difficulty,
          resumeState: m.state,
          resumeTick: m.tick,
        })
        return
      }
      case 'rejoinNo': {
        // 게임 중인 호스트가 거절했다 (팀전·자리 없음·이미 끝남). 대기실이라면 이 메시지는 오지 않는다
        if (this.role === 'guest') this.giveUpRejoin(m.why)
        return
      }
      case 'hello':
        this.onHello(m, from)
        break
      case 'room': {
        if (this.role !== 'guest') return
        clearTimeout(this.waitTimer)
        this.hostId = from
        this.members = m.members
        this.fillBotsRemote = !!m.fillBots
        this.roomMode = m.mode
        this.killsRoom = m.targetKills
        // 정원은 호스트가 정한다 — 안 받으면 게스트 화면에 제 기본값(4)이 보인다
        if (typeof m.size === 'number') this.roomSize = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, m.size))
        if (isMapId(m.map)) this.mapId = m.map
        const me = this.members.find((x) => x.id === this.link?.selfId)
        if (me) {
          this.myReady = me.ready
          this.myTeam = me.team
        }
        this.renderRoom()
        break
      }
      case 'full':
        this.status('방이 가득 찼습니다.', 'bad', `<div class="row"><button class="btn secondary" id="btn-cancel">닫기</button></div>`)
        this.bindCancel()
        this.closeLink()
        break
      case 'start':
        if (this.role === 'guest' && from === this.hostId) this.launchFrom(m.players, m.seed, m.delay, m.mode, m.map, m.targetKills, m.scale, m.botDiff)
        break
      case 'leave':
        this.peerGone(from)
        break
      default:
        break
    }
  }

  /** 호스트: 멤버 추가/갱신 */
  private onHello(m: Extract<CtlMessage, { t: 'hello' }>, from: string): void {
    if (this.role !== 'host' || !this.link) return
    const existing = this.members.find((x) => x.id === from)
    const name = (m.name ?? '').slice(0, 8)
    if (existing) {
      existing.char = m.char
      existing.ready = m.ready
      existing.name = name
      if (this.roomMode === 'teams') existing.team = m.team === 1 ? 1 : 0
    } else {
      if (this.members.length >= this.roomSize || this.starting) {
        this.link.sendCtl({ t: 'full' }, from)
        return
      }
      this.members.push({ id: from, char: m.char, ready: false, team: this.autoTeam(), name })
    }
    this.broadcastRoom()
    this.announce()
    this.renderRoom()
    this.maybeStart()
  }

  /** 인원이 적은 팀 */
  private autoTeam(): number {
    if (this.roomMode !== 'teams') return 0
    const a = this.members.filter((m) => m.team === 0).length
    const b = this.members.filter((m) => m.team === 1).length
    return a <= b ? 0 : 1
  }

  private broadcastRoom(): void {
    if (this.role !== 'host' || !this.link) return
    this.link.sendCtl({ t: 'room', mode: this.roomMode, targetKills: this.killsRoom, map: this.mapId, members: this.members, size: this.roomSize, fillBots: this.fillBots })
  }

  private sendHello(to?: string): void {
    if (!this.link) return
    this.link.sendCtl({ t: 'hello', char: this.char, ready: this.myReady, team: this.myTeam, name: this.nick }, to)
  }

  /** 내 캐릭터·준비·팀이 바뀌었다: 호스트면 정본 갱신 후 방송, 게스트면 hello */
  private pushSelf(): void {
    if (!this.link) return
    if (this.role === 'host') {
      const me = this.members[0]
      if (me) {
        me.char = this.char
        me.ready = this.myReady
        me.team = this.roomMode === 'teams' ? this.myTeam : 0
        me.name = this.nick
      }
      this.broadcastRoom()
      this.announce()
      this.renderRoom()
      this.maybeStart()
    } else {
      this.sendHello()
      this.renderRoom()
    }
  }

  private toggleReady(): void {
    if (!this.link || !this.hostId) return
    this.myReady = !this.myReady
    this.pushSelf()
  }

  private changeTeam(): void {
    if (!this.link || this.roomMode !== 'teams') return
    this.myTeam = this.myTeam === 0 ? 1 : 0
    this.myReady = false
    this.pushSelf()
  }

  /** 호스트: 둘 이상 모두 준비면 시작 */
  private maybeStart(): void {
    if (this.role !== 'host' || this.starting || !this.link) return
    const link = this.link
    if (this.members.length < MIN_PLAYERS) return
    if (!this.members.every((m) => m.ready)) return
    if (this.roomMode === 'teams' && (!this.members.some((m) => m.team === 0) || !this.members.some((m) => m.team === 1))) return
    this.starting = true
    const seed = (Math.random() * 0xffffffff) >>> 0
    // 입력 지연(틱). RTT 가 낮아도 **지터**(왔다 갔다 하는 값)가 있으면 한 틱만 늦어도 전원이 멈춘다.
    // 무선·모바일이 섞이면 특히 그렇다. 그래서 하한을 3틱(50ms)으로 두고 RTT 절반을 더한다.
    const delay = Math.max(3, Math.min(8, Math.ceil(link.rtt / 2 / 16.7) + 2))
    // 자리는 **정원만큼** 잡아 둔다. 빈 자리는 판에 나오지 않다가 난입으로 채워진다 — 또는 (호스트가 켰으면) 봇이 앉는다
    const players: Member[] = this.members.map((m, i) => ({ ...m, team: this.roomMode === 'teams' ? m.team : i }))
    while (players.length < this.roomSize) {
      const bot = this.fillBots
      players.push({
        id: '',
        char: bot ? this.pickBotChar(players) : 'cheolmyeon',
        ready: false,
        team: this.roomMode === 'teams' ? players.length % 2 : players.length,
        name: '',
        bot,
      })
    }
    const map = this.mapId
    const kills = this.killsRoom
    const mode = this.roomMode
    const scale = scaleForPlayers(players.length)
    const botDiff = players.some((p) => p.bot) ? this.botDiff : undefined
    link.sendCtl({ t: 'start', seed, targetKills: kills, delay, map, scale, mode, players, botDiff })
    this.announce('playing')
    setTimeout(() => this.launchFrom(players, seed, delay, mode, map, kills, scale, botDiff), 150)
  }

  /** 대기실 제목용 호스트 이름 (닉네임 → 캐릭터 이름 → '호스트') */
  private hostName(): string {
    const h = this.members[0]
    if (!h) return '호스트'
    const nick = (h.name ?? '').trim()
    if (nick) return esc(nick)
    const c = (CHARACTERS as Record<string, { name: string } | undefined>)[h.char]
    return c ? c.name : '호스트'
  }

  /** 봇 캐릭터: 이미 앉은 사람과 겹치지 않게 (혼자 하기와 같은 규칙) */
  private pickBotChar(players: Member[]): CharacterId {
    const used = new Set(players.map((p) => p.char))
    const pool = CHARACTER_LIST.map((c) => c.id)
    const rest = pool.filter((id) => !used.has(id))
    const pick = rest.length > 0 ? rest : pool
    return pick[Math.floor(Math.random() * pick.length)]
  }

  private launchFrom(players: Member[], seed: number, delay: number, mode: RoomMode, map: string, targetKills: number, scale: number, botDiff?: string): void {
    const link = this.link
    if (!link) return
    const idx = players.findIndex((p) => p.id === link.selfId)
    if (idx < 0) return
    const chars = players.map((p) => (p.char in CHARACTERS ? (p.char as CharacterId) : 'cheolmyeon'))
    const teams = mode === 'teams' ? players.map((p) => p.team) : undefined
    this.launch({
      mode: 'p2p',
      chars,
      teams,
      targetKills,
      seed,
      localPlayer: idx,
      mapId: isMapId(map) ? map : DEFAULT_MAP,
      mapScale: isMapScale(scale) ? scale : scaleForPlayers(players.length),
      link,
      delay,
      peerIds: players.map((p) => p.id),
      names: players.map((p) => p.name ?? ''),
      // id 가 빈 자리는 아직 아무도 없다 → 판에 나오지 않다가 난입으로 채워진다. 봇 자리는 처음부터 있다
      absent: players.map((p) => p.id === '' && !p.bot),
      bots: players.some((p) => p.bot) ? players.map((p) => !!p.bot) : undefined,
      difficulty: botDiff === 'easy' || botDiff === 'hard' ? botDiff : 'normal',
    })
  }

  private launch(cfg: Omit<SessionConfig, 'onExit'>): void {
    this.link = null // 세션이 링크를 가져간다
    // 호스트는 **게임 중에도 방을 알려야** 남들이 난입할 수 있다 → 로비 통로를 세션에 넘긴다
    const iamHost = cfg.localPlayer === 0 && cfg.mode === 'p2p'
    if (this.lobbyLink) {
      if (iamHost) {
        cfg = {
          ...cfg,
          lobby: this.lobbyLink,
          roomInfo: { map: String(cfg.mapId ?? this.mapId), mode: this.roomMode, targetKills: cfg.targetKills, size: this.roomSize },
        }
      } else if (!this.sharedLobby) {
        this.lobbyLink.leave()
      }
      this.lobbyLink = null
    }
    this.handlers.onStart(cfg)
  }

  private renderRoom(): void {
    const link = this.link
    if (!link) return
    const connected = this.role === 'host' || !!this.hostId
    // 방 코드는 안 보여 준다 — 코드로 들어갈 길이 없으니 쓸 일이 없다(방 목록에서 뺀 것과 같은 이유, 2026-09-05)
    const title = this.role === 'host' ? '내 방' : `${this.hostName()}의 방`
    const teams = this.roomMode === 'teams'
    const slots: string[] = []
    for (let i = 0; i < this.roomSize; i++) {
      const m = this.members[i]
      if (!m) {
  slots.push(`<div class="slot empty"><div class="who">${i + 1}번 자리</div><div class="cname">비어 있음</div><div class="rd">기다리는 중</div></div>`)
        continue
      }
      const mine = m.id === link.selfId
      const c = (CHARACTERS as Record<string, { name: string } | undefined>)[m.char]
      const who = (i === 0 ? '호스트' : `${i + 1}`) + (mine ? ' · 나' : '')
      const badge = teams ? `<span class="team ${m.team === 0 ? 'team-a' : 'team-b'}">${TEAM_NAMES[m.team]}</span>` : ''
      const nick = (m.name ?? '').trim()
      slots.push(`<div class="slot ${m.ready ? 'ready' : ''} ${mine ? 'mine' : ''}">
        <div class="who">${who}${badge}</div>
        <div class="cname">${nick ? esc(nick) : c ? c.name : m.char}</div>
        <div class="rd">${nick ? `${c ? c.name : m.char}<br>` : ''}${m.ready ? '준비 완료' : '준비 안 됨'}</div>
      </div>`)
    }
    const html = `
      <div class="room-head"><div class="section-t" style="margin:0">${title}</div>
        <div class="row"><button class="btn secondary" id="btn-cancel">${this.role === 'host' ? '방 닫기' : '나가기'}</button></div></div>
      <p class="roomhint dim">이 사이트 안에서만 함께합니다.<br>친구는 <b>방 목록</b>에서 이 방을 찾아 들어옵니다.</p>
      <div class="setrow">
        <span><b>맵</b>${MAPS[this.mapId].name}</span>
        <span><b>모드</b>${ROOM_MODE_LABEL[this.roomMode]}</span>
        <span><b>목표</b>${this.killsRoom}킬</span>
        <span><b>인원</b>${this.members.length}/${this.roomSize}명</span>
        ${connected && link.peers.size > 0 ? `<span><b>핑</b>${link.rtt} ms</span>` : ''}
      </div>
      <div class="slots">${slots.join('')}</div>
      ${
        this.role === 'host'
          ? `<div class="setrow botrow">
        <label class="chk"><input type="checkbox" id="chk-bots" ${this.fillBots ? 'checked' : ''}> 빈 자리는 <b>봇</b>으로 채우기</label>
        <div class="seg small" id="seg-botdiff" ${this.fillBots ? '' : 'hidden'}>
          ${(['easy', 'normal', 'hard'] as Difficulty[]).map((d) => `<button data-v="${d}" class="${d === this.botDiff ? 'on' : ''}">${DIFFICULTY_LABEL[d]}</button>`).join('')}
        </div>
        <span class="dim hintline">봇 자리는 난입으로 채워지지 않습니다</span>
      </div>`
          : this.fillBotsRemote
            ? `<p class="roomhint dim">빈 자리는 호스트가 <b>봇</b>으로 채웁니다.</p>`
            : ''
      }
      <div class="room-actions">
        <button class="btn main" id="btn-ready" ${connected ? '' : 'disabled'}>${this.myReady ? '준비 취소' : '준비'}</button>
        ${teams ? `<button class="btn secondary" id="btn-team" ${connected ? '' : 'disabled'}>팀 바꾸기</button>` : ''}
      </div>
      <p class="roomhint">둘 이상 모이고 모두 준비를 누르면 자동으로 시작합니다.</p>`
    const readyCount = this.members.filter((m) => m.ready).length
    const st = !connected
      ? '연결 중… (최대 20초)'
      : this.members.length < MIN_PLAYERS
        ? this.role === 'host'
          ? '방 목록에 올라갔습니다. 상대가 들어오길 기다리는 중…'
          : '다른 사람이 들어오길 기다리는 중…'
        : readyCount === this.members.length
          ? '모두 준비. 시작합니다…'
          : this.myReady
            ? `준비 ${readyCount}/${this.members.length} · 나머지를 기다리는 중…`
            : '준비를 누르세요.'
    this.status(st, connected ? 'ok' : '', html)
    this.bindCancel()
    const chk = this.host.querySelector('#chk-bots') as HTMLInputElement | null
    if (chk) {
      chk.onchange = () => {
        this.fillBots = chk.checked
        this.broadcastRoom()
        this.renderRoom()
      }
      this.host.querySelectorAll<HTMLButtonElement>('#seg-botdiff button').forEach((b) => {
        b.onclick = () => {
          this.botDiff = b.dataset.v as Difficulty
          this.renderRoom()
        }
      })
    }
    ;(this.host.querySelector('#btn-ready') as HTMLButtonElement).onclick = () => this.toggleReady()
    const teamBtn = this.host.querySelector('#btn-team') as HTMLButtonElement | null
    if (teamBtn) teamBtn.onclick = () => this.changeTeam()
  }

  /**
   * 난입 진행 화면. 로비를 덮고 단계(연결 → 자리 요청 → 판 받는 중)를 보여 준다.
   * 릴레이에 따라 첫 연결까지 몇 초 걸리는데, 그동안 아무 표시가 없으면 버튼을 또 누르게 된다.
   */
  private showJoining(step: number): void {
    const el = this.host.querySelector('#joining') as HTMLElement | null
    if (!el) return
    el.hidden = false
    const steps = el.querySelectorAll<HTMLElement>('#j-steps li')
    steps.forEach((li) => {
      const n = Number(li.dataset.s)
      li.classList.toggle('done', n < step)
      li.classList.toggle('now', n === step)
    })
    const hint = el.querySelector('#j-hint') as HTMLElement
    hint.textContent =
      step === 1 ? '릴레이에 따라 몇 초 걸립니다. 버튼을 다시 누를 필요는 없습니다.'
        : step === 2 ? '방장에게 자리를 물어보는 중입니다.'
          : '곧 화면이 게임으로 바뀝니다.'
    const cancel = el.querySelector('#j-cancel') as HTMLButtonElement
    cancel.hidden = step >= 3
    cancel.onclick = () => {
      this.hideJoining()
      this.closeLink()
      this.hideStatus()
      this.renderRooms()
    }
  }

  private hideJoining(): void {
    const el = this.host.querySelector('#joining') as HTMLElement | null
    if (el) el.hidden = true
  }

  private bindCancel(): void {
    const cancel = this.host.querySelector('#btn-cancel') as HTMLButtonElement | null
    if (cancel) {
      cancel.onclick = () => {
        this.closeLink()
        this.hideStatus()
        this.renderRooms()
      }
    }
  }

  private closeLink(): void {
    clearTimeout(this.waitTimer)
    clearTimeout(this.rejoinTimer)
    this.hideJoining()
    this.barging = false
    this.bargeSent = false
    if (this.link) {
      if (this.role === 'host' && this.lobbyLink) this.lobbyLink.announce(null)
      this.link.sendCtl({ t: 'leave' })
      this.link.leave()
      this.link = null
    }
    this.members = []
    this.hostId = null
    this.myReady = false
    this.myTeam = 0
    this.role = null
    this.starting = false
  }

  dispose(): void {
    this.disposed = true
    clearInterval(this.onlineTimer)
    this.closeLink()
    if (this.lobbyLink) {
      if (!this.sharedLobby) this.lobbyLink.leave()
      this.lobbyLink = null
    }
  }
}
