// 로비: 캐릭터 선택(1차 6명) · 혼자 하기(동료 봇) · 방 만들기(정원·죽음 규칙) · 방 목록/참가 · 준비 → 자동 시작
// 방은 정원 4명(호스트 + 게스트 3). 멤버 순서·준비는 호스트가 'room' 메시지로 방송하는 것이 정본.
// 덕에서 물려받은 팀전·목표 킬·맵 고르기는 협동에서 쓰지 않는다 — 방 메시지에는 호환용으로 남아 있다.
// **투기장(PvP)**: 배도라지 덕의 대전 방식(개인전·팀전·목표 킬·맵)을 이 게임 안에 이식했다 — RPG 에서 키운 캐릭터끼리 싸운다
// (2026-09-18 사용자: "덕 링크가 아니라 덕의 방식을 RPG 안에 이식"). 방 만들기·혼자 하기 창에서 '종류' 로 고른다.

import { DIFFICULTY_HINT, DIFFICULTY_LABEL, Difficulty } from '../core/bot'
import { bindSettings, settingsHtml } from './settings'
import { gearScore } from '../core/items'
import { CHARACTERS, CharacterId, PLAYABLE, isPlayable, ROLE_INFO } from '../core/characters'
import { buildMap } from '../core/map'
import { DEFAULT_MAP, MAPS, MAP_LIST, MapId, isMapId, isMapScale, scaleForPlayers } from '../core/maps'
import { DEATH_RULE_LABEL, DeathRule, GameMode, MAX_PLAYERS, MIN_PLAYERS } from '../core/state'
import { TIER_LABEL } from '../core/monsters'
import { tierOpen } from '../core/world'

/** 난이도 설명 (방 만들기 창) */
const TIER_DESC = [
  '처음 한 바퀴. 지역 레벨 1~30 · 괴물 피해가 낮고 방패가 덜 막는다',
  '같은 세계를 지역 레벨 +10 으로 — 괴물 피해 제대로 · 정예 능력 하나 더 · 전리품 등급·골드↑ (보통의 심연의 군주를 쓰러뜨리면 열린다)',
  '지역 레벨 +20 — 정예 능력 둘 더 · 전리품 등급·골드 더↑ (악몽의 심연의 군주를 쓰러뜨리면 열린다)',
]
import { CHAR_SKILLS, SKILLS, TREE_ACTIVE } from '../core/skills'
import { sanitizeSheet } from '../core/items'
import { exportSave, importSave, levelOf, playTimeOf, sheetOf } from '../game/save'
import { WEAPONS } from '../core/weapons'
import {
  CtlMessage, LobbyLink, Member, ROOM_MODE_LABEL, RoomInfo, RoomLink, RoomMode,
  makeRoomCode, openLobby, openRoom,
} from '../net/room'
import { drawPortrait } from '../render/character'
import { BonfireScene, SceneFrame } from './bonfire'
import { drawMapPreview } from '../render/minimap'
import { isTouchDevice } from '../game/touch'
import { ChatBox, cleanChat } from './chat'
import { StreamBadge, openStreamPanel } from './streamPanel'
import { SessionConfig } from '../game/session'

export interface LobbyHandlers {
  onStart: (cfg: Omit<SessionConfig, 'onExit'>) => void
  /** 페이지 공용 로비 통로 (main.ts 가 하나 열어 돌려 쓴다). 없으면 스스로 연다(테스트) */
  lobbyLink?: LobbyLink
}

/** 로비 미리보기용 고정 시드 (실제 판은 매번 다른 시드로 생성된다) */
const PREVIEW_SEED = 20260904
/** 투기장 목표 킬 (덕: 5~50 — RPG 투기장은 짧게 5~30) */
const KILL_OPTIONS = [5, 10, 15, 20, 30]
/** 투기장 맵: 덕의 셋 (던전 층은 빼고) */
const ARENA_MAPS = MAP_LIST.filter((m) => !m.fixedScale)
/** 죽음 규칙 설명 (방 만들기·혼자 하기 창) */
const DEATH_RULE_DESC = [
  '쓰러져도 잃는 것이 없습니다. 죽으면 그 막의 마을에서 다시 일어납니다.',
  '죽으면 골드 20% · 지금 레벨 경험치 10% 를 잃습니다 (레벨은 떨어지지 않음).',
  '한 번 죽으면 그 게임은 끝 — 관전만 합니다. 캐릭터는 마을에 들어설 때만 저장됩니다.',
]

/** 닉네임 등 사용자 입력을 HTML 에 넣기 전에 */
function esc(t: string): string {
  return t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch)
}

export class Lobby {
  private char: CharacterId = 'cheolmyeon'
  /** 던전 미리보기 맵 (게임은 1막 마을에서 시작한다) */
  private mapId: MapId = 'town1'
  private killsRoom = 10
  /** 판 종류: 던전(협동) · 투기장(PvP). 방 만들기·혼자 하기 공용, 게스트는 방 정보로 받는다 */
  private kind: GameMode = 'dungeon'
  /** 투기장 맵 (덕의 맵 셋 중) */
  private arenaMap: MapId = 'studio'
  /** 죽음 규칙 (혼자 하기·방 만들기 공용, 게스트는 방 정보로 받는다) */
  private deathRule: DeathRule = 0
  /** 난이도 (0 보통 · 1 악몽 · 2 지옥) — 방장 캐릭터가 연 것만 */
  private tier = 0
  private previewTimer = 0
  private roomMode: RoomMode = 'ffa'
  /** 방 정원 (호스트가 방 만들 때 정한다). 2명만 모여도 시작할 수 있고, 나머지 자리는 난입으로 채운다 */
  private roomSize = 4
  /** 닉네임 (선택, 8자, localStorage 기억) */
  private nick = ''
  /** 대기실 채팅 (방에 들어가 있는 동안만) */
  private roomChat: ChatBox | null = null
  /** 치지직 방송 연동 단추 (로비 · 대기실 내내 떠 있다) · 열린 창을 닫는 함수 */
  private czBadge: StreamBadge | null = null
  private czClose: (() => void) | null = null
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
  /** 20초 동안 안 붙으면 "처음부터 다시 참가" 를 스스로 한 번 더 한다 (2026-09-19 여러 탭 시험: 첫 참가는 자주 실패하고, 다시 누르면 곧 붙었다) */
  private joinRestarts = 0
  private rooms: RoomInfo[] = []
  private starting = false
  private disposed = false
  private bonfire: BonfireScene | null = null

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
      // 마지막으로 고른 캐릭터 (캐릭터 = 세이브 칸이라 다음에도 그 캐릭터로 이어 하게)
      const last = localStorage.getItem('brpg.char') as CharacterId | null
      if (last && last in CHARACTERS && isPlayable(last)) this.char = last
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
      <div class="lobby d2">
        <canvas class="bonfire" id="bonfire"></canvas>
        <div class="czdock" id="czdock"></div>
        <div class="d2-title">
          <h1><span class="t1">배도라지</span><span class="t2">RPG</span></h1>
          <p class="tag">종소리에 끌려 떨어진 배도라지 크루 · 최대 ${MAX_PLAYERS}인 협동 · 서버 없는 P2P · 비공식 팬게임</p>
        </div>
        <div class="d2-char" id="my-char">
          <button class="arrow" id="char-prev" title="이전 캐릭터">◀</button>
          <div class="ci" id="char-info"></div>
          <button class="arrow" id="char-next" title="다음 캐릭터">▶</button>
          <p class="pickhint">발판 위의 캐릭터를 눌러 고를 수도 있습니다</p>
        </div>
        <div class="d2-side">
          <div class="panel">
            <div class="nickwrap" id="nick-card">
              <label for="nick">닉네임</label>
              <input class="nick big" id="nick" maxlength="8" placeholder="닉네임 (비우면 캐릭터 이름)" value="${this.nick.replace(/"/g, '&quot;')}" autocomplete="off" spellcheck="false">
            </div>
            <button class="btn main lg" id="btn-host">게임 만들기</button>
            <p class="hintline">혼자 시작해도 되고, 친구는 아래 <b>게임 목록</b>에서 들어온다 (최대 ${MAX_PLAYERS}명 · 게임 중에도).</p>
            <div class="status" id="status"></div>
            <div class="roomchat" id="roomchat" hidden></div>
          </div>
          <div class="panel rooms-card">
            <h2>게임 목록 <span class="k" id="rooms-count"></span><span class="k" id="online">접속 확인 중</span><button class="lnk refresh" id="btn-refresh" title="목록을 다시 받아옵니다">새로고침</button></h2>
            <div class="rhead"><span>게임</span><span>종류</span><span>규칙</span><span>맵</span><span>인원</span><span>상태</span><span></span></div>
            <div class="rooms" id="rooms"><div class="empty">열린 게임이 없습니다. 게임을 만들거나 잠시 기다려 보세요.</div></div>
            <div class="pager" id="pager" hidden>
              <button class="btn secondary sm" id="pg-prev">이전</button>
              <span id="pg-label">1 / 1</span>
              <button class="btn secondary sm" id="pg-next">다음</button>
            </div>
          </div>
          <div class="panel small">
            <div class="savebtns"><button class="lnk" id="btn-settings" title="소리 · 실사 괴물 · 조작 안내 · 자동 줍기">설정</button><button class="lnk" id="btn-export" title="세이브를 파일로 받아 둡니다 — 다른 PC 로 옮기거나 백업">세이브 내보내기</button>
            <label class="lnk" title="받아 둔 세이브 파일을 불러옵니다 (지금 세이브를 덮어씁니다)">가져오기<input type="file" id="file-import" accept=".json,application/json" hidden></label></div>
            <div class="notice" id="net-notice">서버가 없는 게임입니다 — <b>게임을 만든 사람의 연결이 곧 게임</b>이라, 만든 사람이 나가면 게임도 닫힙니다(캐릭터는 저장돼 있다). 가능하면 유선 PC 에서 만들어 주세요.</div>
            <div class="notice">비공식 팬 프로젝트 · 비상업 · 문의 시 즉시 삭제 · 문제·제안은 철면수심 다음 카페 게시글로 · <a href="https://github.com/goormigrm/bedorage-rpg">github.com/goormigrm/bedorage-rpg</a> · <a href="https://github.com/goormigrm/bedorage-rpg/blob/main/CREDITS.md" target="_blank" rel="noopener">괴물 모델 출처 (CC BY)</a></div>
          </div>
        </div>
        <div class="chars" id="chars" hidden></div>

        <div class="dlg" id="dlg-host" hidden>
          <div class="dbox">
            <h3>게임 만들기</h3>
            <p class="cardp"><b>던전</b>: 방장이 연 가장 뒤 막의 마을에서 시작합니다. 혼자 시작해도 되고, 남은 자리는 친구가 <b>게임 중에도</b> 들어와 채웁니다.<br><b>투기장</b>: 키운 캐릭터끼리 배도라지 덕의 대전(PvP). 둘 이상이면 되고, 빈 자리는 봇으로 채울 수 있습니다.</p>
            <div class="row"><label>정원</label><div class="seg" id="seg-size">
              ${[2, 3, 4].map((n) => `<button data-v="${n}" class="${n === 4 ? 'on' : ''}">${n}명</button>`).join('')}
            </div></div>
<div class="row"><label>종류</label><div class="seg" id="seg-kind">
              <button data-v="dungeon" class="on">던전 (협동)</button><button data-v="arena">투기장 (PvP)</button>
            </div></div>
            <div class="dungeon-only">
              <div class="row"><label>죽음 규칙</label><div class="seg" id="seg-death">
                ${DEATH_RULE_LABEL.map((l, i) => `<button data-v="${i}" class="${i === 0 ? 'on' : ''}">${l}</button>`).join('')}
              </div></div>
              <p class="hintline" id="death-desc">${DEATH_RULE_DESC[0]}</p>
              <div class="row" id="row-tier"><label>난이도</label><div class="seg" id="seg-tier">
                ${TIER_LABEL.map((l, i) => `<button data-v="${i}" class="${i === 0 ? 'on' : ''}">${l}</button>`).join('')}
              </div></div>
              <p class="hintline" id="tier-desc">${TIER_DESC[0]}</p>
            </div>
            <div class="arena-only" hidden>
              <div class="row"><label>모드</label><div class="seg" id="seg-room-mode">
                <button data-v="ffa" class="on">개인전</button><button data-v="teams">2v2 팀전</button>
              </div></div>
              <div class="row"><label>목표 킬</label><div class="seg" id="seg-kills">
                ${KILL_OPTIONS.map((k) => `<button data-v="${k}" class="${k === 10 ? 'on' : ''}">${k}</button>`).join('')}
              </div></div>
              <div class="row"><label>맵</label><div class="seg" id="seg-amap">
                ${ARENA_MAPS.map((m) => `<button data-v="${m.id}" class="${m.id === 'studio' ? 'on' : ''}" title="${m.desc}">${m.name}</button>`).join('')}
              </div></div>
            </div>
            <div class="maprow arena-only" hidden>
              <p class="hintline" id="map-desc">${MAPS[this.mapId].name} — ${MAPS[this.mapId].desc} 판마다 새로 만들어집니다.</p>
              <canvas id="map-preview" class="mappv"></canvas>
            </div>
            <div class="warn">방장의 연결이 곧 방입니다.<br>와이파이나 폰 회선이면 중간에 방이 터질 수 있어요.<br>랜선을 꽂은 PC가 가장 안전합니다.</div>
            <div class="dacts"><button class="btn secondary" data-close>취소</button><button class="btn main" id="btn-host-go">만들기</button></div>
          </div>
        </div>

        <div class="dlg" id="dlg-settings" hidden>
          <div class="dbox">
            <h3>설정</h3>
            <p class="cardp">여기서 바꾼 것은 이 브라우저에 남고, <b>게임에 들어가면 그대로 적용</b>됩니다. 게임 안에서는 <b>Esc</b> 로 같은 화면을 엽니다.</p>
            <div id="settings-box"></div>
            <div class="dacts"><button class="btn main" data-close>닫기</button></div>
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

        <div class="foot d2foot">비공식 팬 프로젝트 · 비상업 · 문의 시 즉시 삭제 · <b>문제·제안은 철면수심 다음 카페 게시글로</b> · <a href="https://github.com/goormigrm/bedorage-rpg">github.com/goormigrm/bedorage-rpg</a> · <a href="https://github.com/goormigrm/bedorage-rpg/blob/main/CREDITS.md" target="_blank" rel="noopener">괴물 모델 출처 (CC BY)</a></div>
      </div>`
    this.czBadge?.dispose()
    const dock = h.querySelector('#czdock') as HTMLElement | null
    this.czBadge = dock ? new StreamBadge(dock, () => this.openCz()) : null

    const chars = h.querySelector('#chars') as HTMLElement
    for (const id of PLAYABLE) {
      const c = CHARACTERS[id]
      const el = document.createElement('button')
      el.className = 'char' + (c.id === this.char ? ' on' : '')
      el.dataset.id = c.id
      el.style.setProperty('--c', '#' + c.bodyColor.toString(16).padStart(6, '0'))
      // 한 줄에 한 명. 설명이 카드 안에서 세 줄로 접히면 읽히지 않아 행으로 편다 (2026-09-06 요청)
      el.innerHTML = `
        <canvas></canvas>
        <div class="ct"><b>${c.name} <em class="lv">Lv ${levelOf(c.id)}</em></b><small>${c.basedOn} · ${WEAPONS[c.weapon].name} · HP ${c.maxHp}</small></div>
        <div class="pv"><b>${c.passiveName}</b> ${c.passiveDesc}
          <div class="sk">${CHAR_SKILLS[c.id].map((sid, k) => `<span class="${k === 2 ? 'ult' : ''}"><i>${['Q', 'E', 'R'][k]}</i>${SKILLS[sid].name}</span>`).join('')}</div></div>`
      el.onclick = () => this.selectChar(c.id)
      chars.appendChild(el)
      const cv = el.querySelector('canvas') as HTMLCanvasElement
      requestAnimationFrame(() => drawPortrait(cv, c))
    }

    // 죽음 규칙: 두 창(방 만들기·혼자 하기)이 같은 값을 쓴다
    const onDeath = (v: string) => {
      const r = Number(v)
      this.deathRule = (r === 1 || r === 2 ? r : 0) as DeathRule
      for (const id of ['#death-desc', '#death-desc2']) {
        const el = h.querySelector(id) as HTMLElement | null
        if (el) el.textContent = DEATH_RULE_DESC[this.deathRule]
      }
      for (const sel of ['#seg-death', '#seg-death2']) {
        h.querySelectorAll<HTMLButtonElement>(`${sel} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === String(this.deathRule)))
      }
      this.hostChanged()
    }
    this.seg('#seg-death', onDeath)
    this.seg('#seg-tier', (v) => {
      const t = Number(v) || 0
      if (!tierOpen(sheetOf(this.char), t)) return
      this.tier = t
      this.syncTier()
      this.hostChanged()
    })
    // 종류: 던전 / 투기장 — 두 창이 같은 값을 쓰고, 해당 줄만 보인다
    const onKind = (v: string) => {
      this.kind = v === 'arena' ? 'arena' : 'dungeon'
      this.syncKind()
      this.hostChanged()
    }
    this.seg('#seg-kind', onKind)
    const onKills = (v: string) => {
      this.killsRoom = Number(v) || 10
      this.hostChanged()
    }
    this.seg('#seg-kills', onKills)
    const onAMap = (v: string) => {
      if (isMapId(v)) this.arenaMap = v
      this.drawPreview()
      this.hostChanged()
    }
    this.seg('#seg-amap', onAMap)
    this.seg('#seg-room-mode', (v) => {
      this.roomMode = v === 'teams' ? 'teams' : 'ffa'
      if (this.roomMode === 'teams' && this.roomSize % 2 !== 0) this.roomSize = 4
      if (this.role === 'host') this.members.forEach((m, i) => (m.team = this.roomMode === 'teams' ? i % 2 : 0))
      this.hostChanged()
    })
    this.syncKind()
    this.seg('#seg-size', (v) => {
      this.roomSize = Math.max(2, Math.min(MAX_PLAYERS, Number(v)))
      this.announce()
      this.renderRoom()
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
    ;(h.querySelector('#btn-export') as HTMLButtonElement).onclick = () => exportSave()
    ;(h.querySelector('#btn-settings') as HTMLButtonElement).onclick = () => this.openSettings()
    const fileEl = h.querySelector('#file-import') as HTMLInputElement
    fileEl.onchange = async () => {
      const f = fileEl.files?.[0]
      if (!f) return
      try {
        const n = await importSave(f)
        this.status(`세이브를 불러왔습니다 — 캐릭터 ${n}명`, 'ok')
        this.render()
      } catch (e) {
        this.status(`세이브를 불러오지 못했습니다: ${(e as Error).message}`, 'bad')
      }
    }
    // 모닥불 장면: 발판 위의 캐릭터를 누르거나 ◀ ▶ 로 고른다. 무대는 오른쪽 패널·아래 카드에 가리지 않는 칸에 맞춘다
    this.bonfire?.dispose()
    this.bonfire = new BonfireScene(
      h.querySelector('#bonfire') as HTMLCanvasElement,
      PLAYABLE,
      (id) => this.selectChar(id),
      () => this.sceneFrame(),
      (id) => `레벨 ${levelOf(id)}`,
    )
    this.bonfire.select(this.char)
    const step = (d: number) => {
      const i = PLAYABLE.indexOf(this.char)
      this.selectChar(PLAYABLE[(i + d + PLAYABLE.length) % PLAYABLE.length])
    }
    ;(h.querySelector('#char-prev') as HTMLButtonElement).onclick = () => step(-1)
    ;(h.querySelector('#char-next') as HTMLButtonElement).onclick = () => step(1)
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

  /** 종류에 맞는 줄만 보이게 (두 창 모두) */
  private syncKind(): void {
    const arena = this.kind === 'arena'
    this.host.querySelectorAll<HTMLElement>('.arena-only').forEach((el) => (el.hidden = !arena))
    this.host.querySelectorAll<HTMLElement>('.dungeon-only').forEach((el) => (el.hidden = arena))
    for (const sel of ['#seg-kind', '#seg-kind2']) {
      this.host.querySelectorAll<HTMLButtonElement>(`${sel} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === this.kind))
    }
    const lab = this.host.querySelector('#bots-label')
    if (lab) lab.textContent = arena ? '상대 봇' : '동료 봇'
    const md = this.host.querySelector('#map-desc')
    const md2 = this.host.querySelector('#map-desc2')
    const m = MAPS[arena ? this.arenaMap : this.mapId]
    for (const el of [md, md2]) if (el) el.textContent = `${m.name} — ${m.desc}${arena ? '' : ' 판마다 새로 만들어집니다.'}`
    this.drawPreview()
  }

  private drawPreview(): void {
    // 두 창(방 만들기·혼자 하기)에 미리보기가 하나씩 있다. 열려 있는 쪽만 그린다 (숨긴 캔버스는 폭이 0)
    const cvs = ['#map-preview']
      .map((id) => this.host.querySelector(id) as HTMLCanvasElement | null)
      .filter((c): c is HTMLCanvasElement => !!c && c.clientWidth > 0)
    if (cvs.length === 0) return
    clearTimeout(this.previewTimer)
    this.previewTimer = window.setTimeout(() => {
      const players = this.role ? Math.max(2, this.members.length) : 1
      const id = this.kind === 'arena' ? this.arenaMap : this.mapId
      const map = buildMap(id, MAPS[id].fixedScale ? 1 : scaleForPlayers(players), PREVIEW_SEED)
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
    if (!isPlayable(this.char)) this.char = PLAYABLE[0]
    const c = CHARACTERS[this.char]
    const el = this.host.querySelector('#char-info') as HTMLElement | null
    if (!el) return
    const played = playTimeOf(c.id)
    const own = CHAR_SKILLS[c.id]
    // 스킬 설명 (2026-09-19 요청 "스킬들 설명 보이게"): Q · E · R 은 설명과 재사용 대기를 다 보이고,
    // 스킬 트리에서 더 배우는 셋은 이름표 — 마우스를 올리면 설명
    const extra = (TREE_ACTIVE[c.id] ?? []).filter((sid) => !own.includes(sid))
    const cd = (sid: keyof typeof SKILLS) => `${Math.round(SKILLS[sid].cd / 60)}초`
    const role = ROLE_INFO[c.role]
    el.innerHTML = `<div class="ch-l"><b class="cn">${c.name}<span class="role-chip" style="--rc:${role.color}" title="${role.desc}">${role.name}</span></b><span class="cl">레벨 ${levelOf(c.id)} · ${WEAPONS[c.weapon].name} · 체력 ${c.maxHp}${played ? ` · 플레이 ${played}` : ''}</span>
      <div class="cp"><i>${c.passiveName}</i> ${c.passiveDesc}</div>
      <div class="crole" style="--rc:${role.color}" title="${role.desc}"><b>${role.name}</b> ${role.short} <small>(던전)</small></div></div>
      <div class="ch-r"><div class="skd">${own
        .map(
          (sid, k) => `<div class="s${k === 2 ? ' ult' : ''}"><i>${['Q', 'E', 'R'][k]}</i><div><b>${SKILLS[sid].name}</b><em>${k === 2 ? '궁극기 · ' : ''}재사용 ${cd(sid)}</em><span>${SKILLS[sid].desc}</span></div></div>`,
        )
        .join('')}</div>
      ${extra.length ? `<div class="skx"><small>스킬 트리(K)에서 더 배우는 스킬</small>${extra.map((sid) => `<span tabindex="0" data-tip="${SKILLS[sid].desc.replace(/"/g, '&quot;')} (재사용 ${cd(sid)})">${SKILLS[sid].name}</span>`).join('')}</div>` : ''}</div>`
    this.bonfire?.select(this.char)
    // 카드 높이가 캐릭터마다 달라 무대 칸도 바뀐다
    requestAnimationFrame(() => this.bonfire?.refit())
  }

  /** 모닥불 무대를 담을 칸: 오른쪽 패널(넓은 화면)과 아래 캐릭터 카드를 뺀 곳 (캔버스 픽셀) */
  private sceneFrame(): SceneFrame {
    const cv = this.host.querySelector('#bonfire') as HTMLElement | null
    const c = cv?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight)
    const f: SceneFrame = { x0: 0, x1: c.width, y0: 0, y1: c.height }
    const side = this.host.querySelector('.d2-side') as HTMLElement | null
    if (side && getComputedStyle(side).position === 'fixed') f.x1 = side.getBoundingClientRect().left - c.left - 12
    const card = this.host.querySelector('#my-char') as HTMLElement | null
    if (card) {
      const r = card.getBoundingClientRect()
      // 카드가 캔버스 아래쪽에 겹쳐 있으면 그 위까지만
      if (r.top > c.top + c.height * 0.4 && r.top < c.bottom) f.y1 = r.top - c.top - 6
    }
    const title = this.host.querySelector('.d2-title') as HTMLElement | null
    if (title) {
      // 제목(왼쪽 위) 아래부터 — 뒤 단 이름패가 제목과 겹치지 않게
      const r = title.getBoundingClientRect()
      f.y0 = Math.min(c.height * 0.3, Math.max(0, r.bottom - c.top))
    }
    return f
  }

  private selectChar(id: CharacterId): void {
    queueMicrotask(() => this.syncTier())
    this.char = id
    try {
      localStorage.setItem('brpg.char', id)
    } catch {
      /* 저장 못 해도 이번엔 반영된다 */
    }
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
        // 게임 중이어도 자리가 남아 있으면 난입할 수 있다. 단 투기장 팀전은 짝이 안 맞아 난입 불가
        const room = r.count < r.max
        const arenaRoom = r.kind === 'arena'
        const teamsPlaying = arenaRoom && r.state === 'playing' && r.mode === 'teams'
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
        // 두 줄 (2026-09-19 사용자 — 좁은 칸에 일곱 칸을 늘어놓아 한글이 한 글자씩 세로로 쪼개졌다):
        // 1줄 "○○의 방 [상태]" · 2줄 "던전 · 보통 · 죽음 없음 · 맵 · 1/4명" · 오른쪽에 참가 단추
        const rule = arenaRoom
          ? [ROOM_MODE_LABEL[r.mode] ?? r.mode, `${r.targetKills}킬`]
          : [TIER_LABEL[r.tier ?? 0] ?? '보통', `죽음 ${DEATH_RULE_LABEL[r.deathRule ?? 0] ?? '없음'}`]
        // 레벨 · 템 수준 (2026-09-20 요청 — 난입할 때 내게 맞는 방인지 보라고)
        const power = r.lv ? [`Lv ${r.lv}`, `템 ${r.gs ?? 0}`] : []
        const meta = [arenaRoom ? '투기장' : '던전', ...rule, ...power, m, `${r.count}/${r.max}명`]
        return `<div class="room">
          <div class="rmain">
            <div class="rtop"><span class="rhost"><b>${r.hostName && r.hostName.trim() ? esc(r.hostName.trim()) : c ? c.name : r.hostChar}</b>의 방</span>${st}</div>
            <div class="rmeta">${meta.map((t) => `<span>${esc(String(t))}</span>`).join('')}</div>
          </div>
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
  /** 설정 창 (게임 안 Esc 메뉴와 같은 칸 — ui/settings.ts). 로비에서도 대기실에서도 연다 (2026-09-20 요청) */
  private openSettings(): void {
    this.closeDlg()
    const d = this.host.querySelector('#dlg-settings') as HTMLElement | null
    const box = this.host.querySelector('#settings-box') as HTMLElement | null
    if (!d || !box) return
    // 조작 안내 띠는 컴퓨터에만 있다
    const o = { keys: !isTouchDevice() }
    box.innerHTML = settingsHtml(o)
    bindSettings(box, o)
    d.hidden = false
  }

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
    this.syncTier()
    this.drawPreview()
  }

  /**
   * 난이도 단추: 이 캐릭터가 연 것만 누를 수 있다 (앞 난이도의 심연의 군주를 쓰러뜨리면 열린다).
   * **고를 것이 보통 하나뿐이면 줄을 숨긴다** (2026-09-23 사용자: "난이도가 설정이 안 되는데 — 없는 거면 선택 자체를 없애 줘").
   * 처음 하는 캐릭터는 늘 이렇다. 악몽이 열리면 그때 줄이 나타난다.
   */
  private syncTier(): void {
    const sheet = sheetOf(this.char)
    if (!tierOpen(sheet, this.tier)) this.tier = 0
    const choice = tierOpen(sheet, 1)
    const row = this.host.querySelector('#row-tier') as HTMLElement | null
    if (row) row.hidden = !choice
    this.host.querySelectorAll<HTMLButtonElement>('#seg-tier button').forEach((b) => {
      const t = Number(b.dataset.v)
      b.disabled = !tierOpen(sheet, t)
      // 아직 안 열린 것은 보이지도 않게 (악몽만 열렸으면 지옥 단추는 숨긴다)
      b.hidden = b.disabled
      b.classList.toggle('on', t === this.tier)
    })
    const d = this.host.querySelector('#tier-desc') as HTMLElement | null
    if (d) d.textContent = choice ? TIER_DESC[this.tier] : '난이도는 보통입니다 — 4막의 심연의 군주를 쓰러뜨리면 악몽 난이도가 열립니다.'
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
      map: this.kind === 'arena' ? this.arenaMap : this.mapId,
      targetKills: this.killsRoom,
      mode: this.roomMode,
      deathRule: this.deathRule,
      tier: this.tier,
      kind: this.kind,
      count: this.members.length,
      max: this.roomSize,
      // 목록에서 "나와 비슷한 방인가" 를 보라고 (2026-09-20 요청). 봇 자리는 빼고 사람만 센다
      ...this.partyPower(),
      state: state ?? (this.members.length >= this.roomSize ? 'full' : 'open'),
    })
  }

  /** 방 사람들의 평균 레벨 · 평균 템 수준 (방송용) */
  private partyPower(): { lv: number; gs: number } {
    const humans = this.members.filter((m) => !m.bot && m.sheet)
    if (humans.length === 0) return { lv: 1, gs: 0 }
    const lv = humans.reduce((a, m) => a + (m.sheet!.level ?? 1), 0) / humans.length
    const gs = humans.reduce((a, m) => a + gearScore(m.sheet!.equip), 0) / humans.length
    return { lv: Math.round(lv), gs: Math.round(gs) }
  }

  // ---------- 방 만들기 / 참가 ----------
  /** 방에 들어가기 전 닉네임 확인. 비어 있으면 입력칸으로 보낸다 */
  private syncNickCard: () => void = () => {}

  private requireNick(): boolean {
    if (this.nick.trim().length > 0) return true
    this.nick = CHARACTERS[this.char].name.slice(0, 8)
    if (this.nick) return true
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
    this.members = [{ id: this.link.selfId, char: this.char, ready: false, team: 0, name: this.nick, sheet: sheetOf(this.char) }]
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
  private join(code: string, barge = false, auto = false): void {
    if (!this.requireNick()) return
    if (!auto) this.joinRestarts = 0
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
      // 통로를 두 번 다시 열어도 안 되면, 사람이 "참가" 를 다시 누르는 것과 똑같이 처음부터 한 번 더 (링크를 닫고 잠깐 쉬었다가)
      if (this.joinRestarts < 1) {
        this.joinRestarts++
        console.warn(`[lobby] ${code}: 처음부터 다시 참가한다`)
        this.closeLink()
        this.status('연결이 늦어 다시 시도하는 중…')
        window.setTimeout(() => this.join(code, barge, true), 1500)
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
      link.sendCtl({ t: 'joinAsk', char: this.char, name: this.nick, sheet: sheetOf(this.char) }, id)
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
          deathRule?: number
          tier?: number
          kind?: string
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
          deathRule: (c.deathRule === 1 || c.deathRule === 2 ? c.deathRule : 0) as DeathRule,
          tier: Math.max(0, Math.min(2, Number(c.tier) || 0)),
          kind: c.kind === 'arena' ? 'arena' : 'dungeon',
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
      case 'chat': {
        const text = cleanChat(m.text)
        if (text && this.roomChat) {
          this.roomChat.add(this.memberName(from), text, 'ally')
        }
        break
      }
      case 'room': {
        if (this.role !== 'guest') return
        clearTimeout(this.waitTimer)
        this.hostId = from
        this.members = m.members
        this.fillBotsRemote = !!m.fillBots
        this.roomMode = m.mode
        this.killsRoom = m.targetKills
        this.deathRule = (m.deathRule === 1 || m.deathRule === 2 ? m.deathRule : 0) as DeathRule
        this.tier = Math.max(0, Math.min(2, Number(m.tier) || 0))
        this.kind = m.kind === 'arena' ? 'arena' : 'dungeon'
        // 정원은 호스트가 정한다 — 안 받으면 게스트 화면에 제 기본값(4)이 보인다
        if (typeof m.size === 'number') this.roomSize = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, m.size))
        if (isMapId(m.map)) {
          if (this.kind === 'arena') this.arenaMap = m.map
          else this.mapId = m.map
        }
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
        if (this.role === 'guest' && from === this.hostId) {
          this.deathRule = (m.deathRule === 1 || m.deathRule === 2 ? m.deathRule : 0) as DeathRule
          this.tier = Math.max(0, Math.min(2, Number(m.tier) || 0))
          this.kind = m.kind === 'arena' ? 'arena' : 'dungeon'
          this.launchFrom(m.players, m.seed, m.delay, m.mode, m.map, m.targetKills, m.scale, m.botDiff)
        }
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
      existing.sheet = m.sheet ? sanitizeSheet(m.sheet) : undefined
      if (this.roomMode === 'teams') existing.team = m.team === 1 ? 1 : 0
    } else {
      if (this.members.length >= this.roomSize || this.starting) {
        this.link.sendCtl({ t: 'full' }, from)
        return
      }
      this.members.push({ id: from, char: m.char, ready: false, team: this.autoTeam(), name, sheet: m.sheet ? sanitizeSheet(m.sheet) : undefined })
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
    this.link.sendCtl({ t: 'room', mode: this.roomMode, targetKills: this.killsRoom, map: this.kind === 'arena' ? this.arenaMap : this.mapId, members: this.members, size: this.roomSize, fillBots: this.fillBots, deathRule: this.deathRule, tier: this.tier, kind: this.kind })
  }

  private sendHello(to?: string): void {
    if (!this.link) return
    this.link.sendCtl({ t: 'hello', char: this.char, ready: this.myReady, team: this.myTeam, name: this.nick, sheet: sheetOf(this.char) }, to)
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
        me.sheet = sheetOf(this.char)
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
    // 던전은 혼자여도 시작한다(남은 자리는 게임 중 난입으로) — 투기장은 상대가 있어야 한다
    if (this.members.length < (this.kind === 'arena' ? 2 : MIN_PLAYERS)) return
    if (!this.members.every((m) => m.ready)) return
    if (this.roomMode === 'teams' && (!this.members.some((m) => m.team === 0) || !this.members.some((m) => m.team === 1))) return
    this.starting = true
    const seed = (Math.random() * 0xffffffff) >>> 0
    // 입력 지연(틱). RTT 가 낮아도 **지터**(왔다 갔다 하는 값)가 있으면 한 틱만 늦어도 전원이 멈춘다.
    // 무선·모바일이 섞이면 특히 그렇다. 그래서 하한을 3틱(50ms)으로 두고 RTT 절반을 더한다.
    // 사람이 둘 이상이면 여유를 한 틱 더 (2026-09-23 최적화): 호스트는 게스트끼리의 RTT 를 재지 못한다(4인 메시) —
    // 그 길이 가장 느릴 때가 많아 "상대 입력 대기" 멈춤이 났다. 혼자(봇만)는 멈출 일이 없으니 그대로 3.
    const people = this.members.length
    const delay = people > 1 ? Math.max(4, Math.min(9, Math.ceil(link.rtt / 2 / 16.7) + 3)) : Math.max(3, Math.min(8, Math.ceil(link.rtt / 2 / 16.7) + 2))
    // 자리는 **정원만큼** 잡아 둔다. 빈 자리는 판에 나오지 않다가 난입으로 채워진다 — 또는 (호스트가 켰으면) 봇이 앉는다
    const teamsOn = this.kind === 'arena' && this.roomMode === 'teams'
    if (teamsOn && (!this.members.some((m) => m.team === 0) || !this.members.some((m) => m.team === 1))) {
      this.starting = false
      return
    }
    const players: Member[] = this.members.map((m, i) => ({ ...m, team: teamsOn ? m.team : i }))
    while (players.length < this.roomSize) {
      const bot = this.fillBots
      players.push({
        id: '',
        char: bot ? this.pickBotChar(players) : 'cheolmyeon',
        ready: false,
        team: teamsOn ? players.length % 2 : players.length,
        name: '',
        bot,
      })
    }
    const map = this.kind === 'arena' ? this.arenaMap : this.mapId
    const kills = this.killsRoom
    const mode = this.roomMode
    const scale = MAPS[map].fixedScale ? 1 : scaleForPlayers(players.length)
    const botDiff = players.some((p) => p.bot) ? this.botDiff : undefined
    link.sendCtl({ t: 'start', seed, targetKills: kills, delay, map, scale, mode, players, botDiff, deathRule: this.deathRule, tier: this.tier, kind: this.kind })
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

  /**
   * 봇 캐릭터: 이미 앉은 사람과 겹치지 않게 (혼자 하기와 같은 규칙).
   * 던전은 **모자란 역할부터**(2026-09-19 — 봇이 탱커만 셋 앉기도 했다): 탱커가 없으면 탱커, 힐러가 없으면 힐러, 그다음 딜러.
   */
  private pickBotChar(players: Member[]): CharacterId {
    const used = new Set(players.map((p) => p.char))
    const pool = [...PLAYABLE]
    let rest = pool.filter((id) => !used.has(id))
    if (this.kind !== 'arena') {
      const roles = players.map((p) => (CHARACTERS as Record<string, { role: string } | undefined>)[p.char]?.role)
      const want = !roles.includes('tank') ? 'tank' : !roles.includes('heal') ? 'heal' : 'dps'
      const byRole = rest.filter((id) => CHARACTERS[id].role === want)
      if (byRole.length > 0) rest = byRole
    }
    const pick = rest.length > 0 ? rest : pool
    return pick[Math.floor(Math.random() * pick.length)]
  }

  private launchFrom(players: Member[], seed: number, delay: number, mode: RoomMode, map: string, targetKills: number, scale: number, botDiff?: string): void {
    const link = this.link
    if (!link) return
    const idx = players.findIndex((p) => p.id === link.selfId)
    if (idx < 0) return
    const chars = players.map((p) => (p.char in CHARACTERS ? (p.char as CharacterId) : 'cheolmyeon'))
    const teams = this.kind === 'arena' && mode === 'teams' ? players.map((p) => p.team) : undefined
    this.launch({
      mode: 'p2p',
      kind: this.kind,
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
      // 모두가 같은 기록으로 판을 만든다 (내 것은 세이브의 최신)
      sheets: players.map((p) => (p.id === link.selfId ? sheetOf(p.char as CharacterId) : p.sheet ? sanitizeSheet(p.sheet) : undefined)),
      names: players.map((p) => p.name ?? ''),
      // id 가 빈 자리는 아직 아무도 없다 → 판에 나오지 않다가 난입으로 채워진다. 봇 자리는 처음부터 있다
      absent: players.map((p) => p.id === '' && !p.bot),
      bots: players.some((p) => p.bot) ? players.map((p) => !!p.bot) : undefined,
      difficulty: botDiff === 'easy' || botDiff === 'hard' ? botDiff : 'normal',
      deathRule: this.deathRule,
      tier: this.kind === 'arena' ? 0 : this.tier,
    })
  }

  private launch(cfg: Omit<SessionConfig, 'onExit'>): void {
    this.link = null // 세션이 링크를 가져간다
    // 대기실 대화는 게임 안 채팅이 이어받는다
    const chatLog = this.roomChat?.history()
    this.hideRoomChat()
    if (chatLog?.length) cfg = { ...cfg, chatLog }
    // 호스트는 **게임 중에도 방을 알려야** 남들이 난입할 수 있다 → 로비 통로를 세션에 넘긴다
    const iamHost = cfg.localPlayer === 0 && cfg.mode === 'p2p'
    if (this.lobbyLink) {
      if (iamHost) {
        cfg = {
          ...cfg,
          lobby: this.lobbyLink,
          roomInfo: { map: String(cfg.mapId ?? this.mapId), mode: this.roomMode, targetKills: cfg.targetKills ?? 0, size: this.roomSize, deathRule: this.deathRule, tier: this.tier, kind: this.kind },
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
    this.showRoomChat()
    const connected = this.role === 'host' || !!this.hostId
    // 방 코드는 안 보여 준다 — 코드로 들어갈 길이 없으니 쓸 일이 없다(방 목록에서 뺀 것과 같은 이유, 2026-09-05)
    const title = this.role === 'host' ? '내 게임' : `${this.hostName()}의 게임`
    const teams = this.kind === 'arena' && this.roomMode === 'teams'
    const slots: string[] = []
    // 파티 구성 (던전 — 역할은 던전에서만 효과가 있다)
    const roleCount: Record<string, number> = { tank: 0, dps: 0, heal: 0 }
    for (let i = 0; i < this.roomSize; i++) {
      const m = this.members[i]
      if (!m) {
        slots.push(`<div class="slot empty"><div class="who">${i + 1}번</div><div class="cname">빈 자리</div><div class="rd">기다리는 중</div></div>`)
        continue
      }
      const mine = m.id === link.selfId
      const c = (CHARACTERS as Record<string, { name: string; role: keyof typeof ROLE_INFO } | undefined>)[m.char]
      const role = c && this.kind !== 'arena' ? ROLE_INFO[c.role] : null
      if (c && this.kind !== 'arena') roleCount[c.role]++
      const roleChip = role ? `<span class="role-chip" style="--rc:${role.color}" title="${role.desc}">${role.name}</span>` : ''
      const who = (i === 0 ? '방장' : `${i + 1}번`) + (mine ? ' · 나' : '')
      const badge = teams ? `<span class="team ${m.team === 0 ? 'team-a' : 'team-b'}">${m.team === 0 ? 'A팀' : 'B팀'}</span>` : ''
      const nick = (m.name ?? '').trim()
      // 레벨 · 템 수준 (2026-09-20 요청): 누가 얼마나 키웠는지 보고 자리를 고르라고
      const power = m.sheet ? `<span class="pw">Lv ${m.sheet.level ?? 1} · 템 ${gearScore(m.sheet.equip)}</span>` : ''
      slots.push(`<div class="slot ${m.ready ? 'ready' : ''} ${mine ? 'mine' : ''}">
        <div class="who">${who}${badge}</div>
        <div class="cname">${nick ? esc(nick) : c ? c.name : m.char}${power}</div>
        <div class="rd">${nick ? `<span class="rc">${c ? c.name : m.char}</span>` : ''}${roleChip}<span class="rs">${m.ready ? '준비 완료' : i === 0 ? '' : '준비 안 됨'}</span></div>
      </div>`)
    }
    const html = `
      <div class="room-head"><div class="section-t" style="margin:0">${title}</div>
        <div class="row"><button class="btn secondary" id="btn-settings-room">설정</button><button class="btn secondary" id="btn-cancel">${this.role === 'host' ? '방 닫기' : '나가기'}</button></div></div>
      <p class="roomhint dim">이 사이트 안에서만 함께합니다.<br>친구는 <b>방 목록</b>에서 이 방을 찾아 들어옵니다.</p>
      <div class="setrow">
        ${this.kind === 'arena'
          ? `<span><b>투기장</b>${MAPS[this.arenaMap].name}</span><span><b>모드</b>${ROOM_MODE_LABEL[this.roomMode]}</span><span><b>목표</b>${this.killsRoom}킬</span>`
          : `<span><b>던전</b>방장이 연 막의 마을에서 시작</span><span><b>난이도</b>${TIER_LABEL[this.tier] ?? '보통'}</span><span><b>죽음 규칙</b>${DEATH_RULE_LABEL[this.deathRule]}</span>`}
        <span><b>인원</b>${this.members.length}/${this.roomSize}명</span>
        ${connected && link.peers.size > 0 ? `<span><b>핑</b>${link.rtt} ms</span>` : ''}
      </div>
      <div class="slots">${slots.join('')}</div>
      ${this.kind !== 'arena' ? `<p class="roomhint party">파티 구성 — ${(['tank', 'dps', 'heal'] as const).map((r) => `<span style="color:${ROLE_INFO[r].color}">${ROLE_INFO[r].name} ${roleCount[r]}</span>`).join(' · ')}${this.members.length > 1 && roleCount.heal === 0 ? ' <span class="dim">(힐러가 있으면 오래 버팁니다)</span>' : ''}</p>` : ''}
      ${
        this.role === 'host'
          ? `<div class="setrow botrow">
        <label class="chk"><input type="checkbox" id="chk-bots" ${this.fillBots ? 'checked' : ''}> 빈 자리는 봇으로 채우기</label>
        <span class="botdifflabel" id="lbl-botdiff" ${this.fillBots ? '' : 'hidden'}><b>봇 실력</b></span>
        <div class="seg small" id="seg-botdiff" ${this.fillBots ? '' : 'hidden'}>
          ${(['easy', 'normal', 'hard'] as Difficulty[]).map((d) => `<button data-v="${d}" class="${d === this.botDiff ? 'on' : ''}" title="${DIFFICULTY_HINT[d]}">${DIFFICULTY_LABEL[d]}</button>`).join('')}
        </div>
        <p class="dim hintline" id="hint-botdiff" ${this.fillBots ? '' : 'hidden'}>봇이 얼마나 잘 싸우는가입니다 — 게임 난이도(보통 · 악몽 · 지옥)와는 다릅니다. ${DIFFICULTY_HINT[this.botDiff]}.<br>봇은 <b>방장과 같은 레벨 · 그 레벨의 장비</b>로 들어옵니다. 봇 자리는 난입으로 채워지지 않습니다.</p>
      </div>`
          : this.fillBotsRemote
            ? `<p class="roomhint dim">빈 자리는 호스트가 <b>봇</b>으로 채웁니다.</p>`
            : ''
      }
      <div class="room-actions">
        <button class="btn main" id="btn-ready" ${connected ? '' : 'disabled'}>${this.myReady ? '준비 취소' : this.role === 'host' ? '▶ 게임 시작' : '준비'}</button>
        ${teams ? `<button class="btn secondary" id="btn-team" ${connected ? '' : 'disabled'}>팀 바꾸기</button>` : ''}
      </div>
      <p class="roomhint">${this.kind === 'arena' ? '둘 이상 모이고 모두 준비를 누르면 시작합니다. 빈 자리는 봇으로 채울 수 있습니다.' : '"게임 시작" 을 누르면 바로 시작합니다(들어온 사람이 있으면 모두 준비한 뒤). 남은 자리는 게임 중에도 들어올 수 있습니다.'}</p>`
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
            : this.role === 'host'
              ? '▶ 게임 시작을 누르세요.'
              : '준비를 누르세요.'
    this.status(st, connected ? 'ok' : '', html)
    this.bindCancel()
    const setBtn = this.host.querySelector('#btn-settings-room') as HTMLButtonElement | null
    if (setBtn) setBtn.onclick = () => this.openSettings()
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

  /**
   * 대기실 채팅 (2026-09-23). #status 는 renderRoom 이 통째로 다시 그려 입력칸 포커스가 날아가므로 그 바깥 칸에 둔다.
   * 보낸 사람 이름은 받은 쪽이 피어 id 로 멤버에서 찾는다 (글에 실린 번호는 믿지 않는다).
   */
  private showRoomChat(): void {
    if (this.roomChat || !this.link) return
    const box = this.host.querySelector('#roomchat') as HTMLElement | null
    if (!box) return
    box.hidden = false
    this.roomChat = new ChatBox(
      box,
      (text) => {
        const link = this.link
        if (!link) return false
        const me = this.members.findIndex((x) => x.id === link.selfId)
        this.roomChat?.add(this.memberName(link.selfId), text, 'me')
        link.sendCtl({ t: 'chat', p: me, text })
        return true
      },
      { docked: true },
    )
  }

  private hideRoomChat(): void {
    this.roomChat?.dispose()
    this.roomChat = null
    const box = this.host.querySelector('#roomchat') as HTMLElement | null
    if (box) box.hidden = true
  }

  /** 대기실에서 보이는 이름 (닉네임 → 캐릭터 이름) */
  private memberName(id: string): string {
    const m = this.members.find((x) => x.id === id)
    if (!m) return id === this.link?.selfId ? this.nick || '나' : '손님'
    const nick = (m.name ?? '').trim()
    return nick || ((CHARACTERS as Record<string, { name: string } | undefined>)[m.char]?.name ?? m.char)
  }

  private closeLink(): void {
    this.hideRoomChat()
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

  /** 치지직 방송 연동 창 */
  private openCz(): void {
    if (this.czClose) return
    this.czClose = openStreamPanel(this.host, () => (this.czClose = null))
  }

  dispose(): void {
    this.disposed = true
    this.czClose?.()
    this.czBadge?.dispose()
    this.czBadge = null
    this.bonfire?.dispose()
    this.bonfire = null
    clearInterval(this.onlineTimer)
    this.closeLink()
    if (this.lobbyLink) {
      if (!this.sharedLobby) this.lobbyLink.leave()
      this.lobbyLink = null
    }
  }
}
