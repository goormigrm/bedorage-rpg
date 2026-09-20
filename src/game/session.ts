// 게임 세션: 혼자 하기(동료 봇) 와 협동(락스텝) 을 같은 루프로 돌린다. 렌더는 Three.js. 인원 1~4명.
// 협동: 플레이어 0 = 호스트. 호스트가 해시 비교·리싱크·이탈자 드롭 틱·난입을 정한다.

import { BotMemory, Difficulty, DIFFICULTY_LABEL, botInput, makeBot } from '../core/bot'
import { botSheet, gearLevelOf } from '../core/botsheet'
import { CHARACTERS, CHARACTER_LIST, CharacterId, displayNames } from '../core/characters'
import { CMD_ATTR, CMD_AUTOPICK, Input } from '../core/input'
import { buildMap } from '../core/map'
import { DEFAULT_MAP, MAPS, MapId, MapScale, scaleForPlayers } from '../core/maps'
import { areaView, createState, dropPlayer, hashState, interpSnapshot, joinPlayer, snapshot, step, syncSandbags } from '../core/sim'
import { ACTS, AREAS, NPC_RANGE, actReached, areaDef, areaLayout, buildAreaMap, isDeadEnd, isTown, npcNear, questPoints, townNpcs, tierQuests } from '../core/world'
import { GameMap } from '../core/map'
import { WaypointPanel } from '../ui/waypoints'
import { QuestLog, TownPanel } from '../ui/town'
import { showEnding, showIntro } from '../ui/ending'
import { showForgeFx } from '../ui/forgefx'
import { LORD_KIND, TIER_LABEL, tierOf } from '../core/monsters'
import { SkillPanel } from '../ui/skilltree'
import { CharSheet } from '../ui/charsheet'
import { Voice } from '../net/voice'
import { angleToRad } from '../core/fixedmath'
import { DeathRule, GameMode, GameState, TICK_MS, isTeamMatch, teamKills } from '../core/state'
import { PvpBotMemory, makePvpBot, pvpBotInput } from '../core/pvpbot'
import { Sheet, attrFree, sanitizeSheet } from '../core/items'
import { bindSettings, loadAutoPick, realMonstersOn, settingsHtml } from '../ui/settings'

import { commitSheet } from './save'
import { Inventory } from '../ui/inventory'
import { WEAPONS } from '../core/weapons'
import { drawPortrait } from '../render/character'
import { Lockstep } from '../net/lockstep'
import { CtlMessage, LobbyLink, RoomLink } from '../net/room'
import { VIEW_H, VIEW_W, setViewAspect } from '../render/hud'
import { worldDirToScreen } from '../render3d/camera'
import { U } from '../render3d/world3d'
import { Renderer3D } from '../render3d/renderer3d'
import { Sfx } from '../audio/sfx'
import { LocalInput } from './localInput'
import { TouchControls, enterLandscape, isTouchDevice } from './touch'
import { Ticker } from './ticker'

export interface SessionConfig {
  mode: 'solo' | 'p2p'
  /** 인원 = 길이. 인덱스가 플레이어 번호 */
  chars: CharacterId[]
  /** 투기장 팀 배정 (없으면 개인전). 던전은 쓰지 않는다 */
  teams?: number[]
  /** 투기장 목표 킬. 던전은 쓰지 않는다 */
  targetKills?: number
  /** 죽음 규칙 (방장이 정한다, 기본 0 = 없음) */
  deathRule?: DeathRule
  /** 난이도 0 보통 · 1 악몽 · 2 지옥 */
  tier?: number
  /** 판 종류: 던전(협동) · 투기장(PvP — 덕의 대전 규칙). 기본 던전 */
  kind?: GameMode
  /** 자리별 캐릭터 기록 (레벨·장비·가방). 내 것은 세이브에서, 남의 것은 방 메시지로 온다 */
  sheets?: (Sheet | undefined)[]
  seed: number
  localPlayer: number
  mapId?: MapId
  /** 맵 확장 배율. 생략하면 인원수로 정한다 */
  mapScale?: MapScale
  difficulty?: Difficulty
  link?: RoomLink
  delay?: number
  /** 대전: 플레이어 인덱스 순 피어 id (내 것 포함) */
  peerIds?: string[]
  /** 닉네임 (인덱스 순, 빈 문자열이면 캐릭터 이름) */
  names?: string[]
  /** 아직 아무도 없는 자리 (난입으로 채워진다) */
  absent?: boolean[]
  /** 봇 자리 (P2P 방을 봇으로 채움). 호스트가 입력을 만들어 보내고, 난입으로는 채워지지 않는다 */
  bots?: boolean[]
  /**
   * 호스트만: 로비 방송 통로. **게임 중에도 방을 계속 알려야** 남들이 난입할 수 있다.
   * 세션이 끝나면 세션이 정리한다.
   */
  lobby?: LobbyLink
  /** 방 정보 (난입 안내용) */
  roomInfo?: { map: string; mode: string; targetKills: number; size: number; deathRule?: number; tier?: number; kind?: string }
  /** 재접속: 호스트가 보내 준 그 시점의 판. 있으면 처음부터가 아니라 여기서 이어서 시작한다 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resumeState?: any
  resumeTick?: number
  onExit: () => void
  /** 새 판으로 갈아타기 (호스트가 나갔을 때 "혼자 이어하기" — main.ts 가 새 세션을 연다) */
  onRestart?: (cfg: Omit<SessionConfig, 'onExit' | 'onRestart'>) => void
}

interface PendingDrop {
  p: number
  tick: number
}

export class Session {
  /** 지역별 맵 (게임 시드 · 지역 번호로 만든다 — 모든 브라우저가 같은 세계). 투기장은 지역 0 하나 */
  private maps = new Map<number, GameMap>()
  /** 화면이 보는 지역 (내 캐릭터 — 죽어서 남을 보고 있으면 그 사람의 지역) */
  private viewArea = 0
  private waypoints!: WaypointPanel
  private town!: TownPanel
  private skills!: SkillPanel
  private chars!: CharSheet
  private quests!: QuestLog
  /** 음성 대화 (방이 있을 때만) */
  private voice: Voice | null = null
  private state: GameState
  private prev: GameState
  private renderer: Renderer3D
  private input = new LocalInput()
  private touch: TouchControls | null = null
  private sfx = new Sfx()
  /** 봇 기억: 던전은 동료 봇, 투기장은 덕의 PvP 봇 */
  private bots: (BotMemory | PvpBotMemory)[] = []
  /** 아래 조작 안내 띠 표시 여부 (처음 두 판 · 이후 메뉴에서) */
  private keysShown = true
  /**
   * 자동 조종(`?autopilot=1`): 내 캐릭터를 보통 난이도 봇이 움직인다. 방을 지키는 운영용 — tools/rooms.mjs 가 이 주소로
   * 브라우저를 여러 개 띄워 사람처럼 보이는 방을 만들어 둔다(2026-09-06). 주소 뒤 플래그라 다른 사람에게는 안 보인다.
   * 소리는 끄고 화면은 2fps 로만 그린다(탭이 여러 개라 부담을 줄인다)
   */
  private readonly autopilot = typeof location !== 'undefined' && location.search.includes('autopilot=1')
  private lastEmoteAt = -1e9
  /** 0.4초 넘는 멈춤 횟수·누적 시간 (운영 로그용) */
  private stallCount = 0
  private stallMs = 0
  private lockstep: Lockstep | null = null
  /** 받은 리싱크 횟수 (어긋남 — 시험·운영 확인용) */
  private resyncs = 0
  private peerIndex = new Map<string, number>()
  private pendingDrops: PendingDrop[] = []
  private dropped = new Set<number>()
  private acc = 0
  private last = performance.now()
  private raf = 0
  private root: HTMLElement
  private stage: HTMLElement
  private overlay: HTMLElement
  private paused = false
  private stallSince = -1
  private message = ''
  private disposed = false
  private hashes = new Map<number, number>()
  private names: string[]
  private pickerOpen = false
  /** 죽어서 기다리는 동안 보고 있는 사람. -1 = 내 시점 */
  private spectate = -1
  /** 나간 사람의 자리를 없애기까지 (짧게 — 자리가 비어야 남들이 난입할 수 있다) */
  private static readonly DROP_DELAY_TICKS = 60 * 3
  /** 혼자 남은 뒤 방을 닫기까지 기다리는 시간 */
  private static readonly ALONE_GRACE_TICKS = 60 * 30
  /** 혼자 남기 시작한 틱 (-1 = 혼자가 아니다) */
  private aloneSince = -1
  /** "봇과 계속하기" 를 골랐다 — 사람이 다시 들어왔다 나가기 전까지는 혼자 남음 안내를 다시 띄우지 않는다 */
  private aloneOk = false
  /** 자리별로 입력이 끊긴 시각(ms, -1 = 정상). 이만큼 넘게 아무 입력도 안 오면 나간 것으로 본다 */
  private silentSince: number[] = []
  /** 입력이 이만큼 안 오면 연결이 죽은 것으로 보고 자리를 비운다(호스트) / 호스트가 죽은 것으로 본다(게스트).
   *  나가기 메시지도 연결 끊김 신호도 못 받는 경우(탭이 멈춤·회선이 조용히 죽음)를 위한 마지막 그물 — 없으면 판이 영영 "상대 입력 대기 중" */
  private static readonly SILENT_DROP_MS = 12000
  /** 호스트만: 돌아오기로 한 사람 (틱이 되면 상태를 보낸다) */
  private pendingRejoin: {
    peerId: string
    p: number
    char: CharacterId
    team: number
    name: string
    sheet?: Sheet
    /** 판(resume)을 보냈는가 */
    sent: boolean
    /** 난입자가 "모두와 연결됐다" 고 했는가 */
    ready: boolean
    /** 이 시각(performance.now)까지 준비가 안 되면 끊는다 */
    deadline: number
  } | null = null
  /** 난입자 쪽: 아직 판에 들어가지 않은 관전 상태 (자리 배정 확정 전) */
  private joiningIn = false
  private joinReadySent = false
  /** 난입 준비 제한. 이 안에 모두와 연결되지 않으면 호스트가 끊고 자리를 되돌린다 */
  private static readonly JOIN_TIMEOUT_MS = 8000
  /** joinLive 를 방송하고 실제로 자리를 채우기까지의 여유 (메시지가 모두에게 닿을 시간) */
  private static readonly JOIN_LEAD_TICKS = 40
  /** 정해진 틱에 자리를 채울 사람들 (난입) */
  private pendingJoins: { p: number; tick: number; char: CharacterId; team: number; name: string; sheet?: Sheet }[] = []
  private syncMute: () => void = () => {}
  private inventory!: Inventory
  /** 마지막 자동 저장 시각 */
  private lastSave = performance.now()
  /** 저장하지 않은 플레이 시간 (막마다 초) — 저장할 때 세이브에 더하고 비운다 */
  private played: number[] = [0, 0, 0, 0]
  private playedAt = performance.now()
  private ticker: Ticker
  private lastTick = performance.now()
  private lobbyBeacon = 0

  constructor(
    host: HTMLElement,
    private cfg: SessionConfig,
  ) {
    this.state = createState(this.matchCfg(cfg.seed), this.mapOf)
    // 재접속: 호스트가 보내 준 판으로 갈아 끼운다. 맵의 모래주머니 상태도 그때로 맞춘다 (지역 맵은 시드로 다시 만든다)
    if (cfg.resumeState) {
      this.state = cfg.resumeState as GameState
      this.state.events = []
      this.state.evSpans = []
      if (this.arena) syncSandbags(this.state, this.mapOf(0))
      // 아무도 없는 자리(나갔거나 아직 안 온 자리)는 입력을 기다리면 안 된다.
      // 이걸 빠뜨려 난입한 사람이 빈 자리 입력을 기다리다 멈추고, 그 사람이 멈추니
      // 락스텝 특성상 방 전체가 함께 멈췄다(2026-09-06 제보).
      // 내 자리도 마찬가지다 — 난입자는 호스트가 joinLive 로 활성화할 때까지 **관전만** 한다.
      // 그래서 기존 사람들은 내가 준비되는 동안 내 입력을 전혀 기다리지 않는다.
      this.state.players.forEach((p, i) => {
        if (p.left) this.dropped.add(i)
      })
      if (this.state.players[cfg.localPlayer].left) {
        this.joiningIn = true
        this.message = '자리에 앉는 중… 모두와 연결되면 들어갑니다'
        this.spectate = this.nextAlive(-1) // 들어가기 전에는 남의 시점으로 본다
      }
    }
    // 아직 아무도 없는 자리도 같은 취급 (다시 하기로 판을 새로 짜도 유지된다)
    cfg.absent?.forEach((a, i) => {
      if (a && i !== cfg.localPlayer) this.dropped.add(i)
    })
    this.prev = interpSnapshot(this.state)
    this.makeBots(cfg.seed)

    host.innerHTML = `
      <div class="game-root">
        <div class="game-stage" id="stage">
          <div class="game-ui">
            <div class="top-right"><button class="btn secondary" id="btn-voice-mode" hidden title="음성 방식 바꾸기">눌러서 말하기</button><button class="btn secondary" id="btn-voice" hidden>음성 (B)</button><button class="btn secondary" id="btn-mute">소리</button><button class="btn secondary" id="btn-lobby">로비로</button></div>
            <div class="keys"><b>WASD</b> 이동 · <b>마우스</b> 조준·<b>좌클릭</b> 사격 · <b>우클릭</b> 정조준 · <b>Q·E</b> 스킬 · <b>R</b> 궁극기 · <b>Space</b> 구르기 · <b>Shift</b> 달리기 · <b>F</b> 이동·열기·일으키기 · <b>T</b> 타운 포털 · <b>I</b> 가방 · <b>K</b> 스킬 · <b>C</b> 능력치 · <b>J</b> 퀘스트 · <b>M</b> 지도 · <b>1·2</b> 배운 스킬 · <b>B</b> 음성 · <b>V</b> 신호 · <b>Esc</b> 메뉴</div>
            <div class="winbtns" id="winbtns">
              <button class="wbtn" data-win="bag" title="가방 (I)">가방<small>I</small></button>
              <button class="wbtn" data-win="skill" title="스킬 (K)">스킬<small>K</small></button>
              <button class="wbtn" data-win="attr" title="능력치 (C)">능력치<small>C</small></button>
              <button class="wbtn" data-win="quest" title="퀘스트 (J)">퀘스트<small>J</small></button>
              <button class="wbtn" data-win="map" title="지도 (M)">지도<small>M</small></button>
            </div>
            <div class="overlay" id="overlay" hidden><div class="box" id="overlay-box"></div></div>
          </div>
        </div>
      </div>`
    this.root = host.querySelector('.game-root') as HTMLElement
    this.stage = host.querySelector('#stage') as HTMLElement
    this.overlay = host.querySelector('#overlay') as HTMLElement
    // 조작 안내 띠: 처음 두 판만 보이고 그 뒤로는 감춘다(화면 아래 34px). Esc 메뉴에서 다시 켤 수 있다 (2026-09-05)
    try {
      const games = Number(localStorage.getItem('brpg.games') ?? '0')
      localStorage.setItem('brpg.games', String(games + 1))
      const pref = localStorage.getItem('brpg.keys')
      this.keysShown = pref !== null ? pref === '1' : games < 2
    } catch {
      this.keysShown = true
    }
    this.applyKeys()
    this.viewArea = this.wantedArea()
    this.renderer = new Renderer3D(this.stage, this.map)
    this.renderer.setRealMonsters(realMonstersOn())
    this.areaBanner()
    // 캔버스가 UI 아래에 오도록 UI 를 맨 뒤로
    const ui = this.stage.querySelector('.game-ui') as HTMLElement
    this.stage.appendChild(ui)
    if (isTouchDevice()) {
      this.touch = new TouchControls(this.root)
      this.touch.setMarkVisible(true)
      this.root.classList.add('touching')
      void enterLandscape()
    }
    this.input.attach(this.stage, this.touch)
    // 자동 줍기 등급은 각자의 옵션이지만 줍기는 sim 이 한다 → 판에 들어오자마자 명령으로 모두에게 알린다 (난입도 같은 길)
    this.input.queueCmd(CMD_AUTOPICK, loadAutoPick())
    this.waypoints = new WaypointPanel(
      this.stage.querySelector('.game-ui') as HTMLElement,
      () => this.state.players[this.cfg.localPlayer],
      (cmd, arg) => this.input.queueCmd(cmd, arg),
      (open) => {
        this.input.uiOpen = open || this.inventory?.open
        this.sfx.blip()
      },
      () => tierOf(this.state.tier).lvl,
    )
    this.town = new TownPanel(
      this.stage.querySelector('.game-ui') as HTMLElement,
      () => this.state,
      () => this.state.players[this.cfg.localPlayer],
      (cmd, arg) => this.input.queueCmd(cmd, arg),
      (open) => {
        this.input.uiOpen = open || this.inventory?.open || this.waypoints?.open
        this.sfx.blip()
      },
    )
    this.skills = new SkillPanel(
      this.stage.querySelector('.game-ui') as HTMLElement,
      () => this.state.players[this.cfg.localPlayer],
      (cmd, arg) => this.input.queueCmd(cmd, arg),
      (open) => {
        this.input.uiOpen = open || this.inventory?.open || this.town?.open !== null
        this.sfx.blip()
      },
    )
    this.chars = new CharSheet(
      this.stage.querySelector('.game-ui') as HTMLElement,
      () => this.state.players[this.cfg.localPlayer],
      (cmd, arg) => this.input.queueCmd(cmd, arg),
      (open) => {
        this.input.uiOpen = open || this.inventory?.open || this.skills?.open || this.town?.open !== null
        this.sfx.blip()
      },
    )
    this.quests = new QuestLog(this.stage.querySelector('.game-ui') as HTMLElement, () => this.state.players[this.cfg.localPlayer], () => this.sfx.blip())
    this.inventory = new Inventory(
      this.stage.querySelector('.game-ui') as HTMLElement,
      () => this.state.players[this.cfg.localPlayer],
      (cmd, arg) => this.input.queueCmd(cmd, arg),
      (open) => {
        this.input.uiOpen = open
        this.sfx.blip()
      },
    )
    this.bindWinButtons()
    // 도입 장면: **새 캐릭터로 처음** 던전에 들어섰을 때 한 번 (레벨 1 · 아직 아무 퀘스트도 받지 않았다)
    if (!this.arena && !cfg.resumeState) {
      const me = this.state.players[this.cfg.localPlayer]
      if (me && me.level === 1 && !(me.quests ?? []).some((q) => q > 0)) {
        showIntro(this.stage.querySelector('.game-ui') as HTMLElement, () => this.sfx.blip())
      }
    }
    ;(host.querySelector('#btn-lobby') as HTMLButtonElement).onclick = () => this.exit()
    // 음성 대화: 같은 게임(방)에 있는 사람끼리 (최대 4명)
    if (cfg.link) {
      this.voice = new Voice(cfg.link)
      const vb = host.querySelector('#btn-voice') as HTMLButtonElement
      const mb = host.querySelector('#btn-voice-mode') as HTMLButtonElement
      vb.hidden = false
      mb.hidden = false
      // 눌러서 말하기: 버튼을 누르고 있는 동안 · 계속 켜기: 누를 때마다 켜고 끈다
      vb.onpointerdown = (e) => {
        e.preventDefault()
        if (this.voice?.mode === 'ptt') void this.voice.hold(true).then(() => this.syncVoiceUi())
        else void this.toggleVoice()
      }
      const release = () => {
        if (this.voice?.mode === 'ptt') void this.voice.hold(false).then(() => this.syncVoiceUi())
      }
      vb.onpointerup = release
      vb.onpointerleave = release
      mb.onclick = () => {
        if (!this.voice) return
        this.voice.setMode(this.voice.mode === 'ptt' ? 'open' : 'ptt')
        this.syncVoiceUi()
        this.message = this.voice.mode === 'ptt' ? '음성: 눌러서 말하기 — B(또는 음성 버튼)를 누르는 동안만 들린다' : '음성: 계속 켜기 — B(또는 음성 버튼)로 켜고 끈다'
        setTimeout(() => (this.message = ''), 2500)
      }
      this.syncVoiceUi()
      window.addEventListener('keyup', this.onKeyUp)
    }
    const muteBtn = host.querySelector('#btn-mute') as HTMLButtonElement
    const syncMute = () => (muteBtn.textContent = this.sfx.muted ? '소리 꺼짐' : '소리 켜짐')
    muteBtn.onclick = () => {
      this.sfx.toggle()
      syncMute()
    }
    // 자동 조종 탭(방 지키기)은 소리를 안 낸다 — 크롬을 여러 개 띄우니 배경음이 겹친다
    if (this.autopilot) this.sfx.setMuted(true)
    syncMute()
    this.syncMute = syncMute
    // 던전은 어두운 음악, 투기장은 덕의 추격 음악
    this.sfx.setBgmStyle(cfg.kind === 'arena' ? 'chase' : 'dark')
    this.sfx.startBgm()

    this.names = this.computeNames()

    if (cfg.mode === 'p2p' && cfg.link) {
      const ids = cfg.peerIds ?? []
      ids.forEach((id, i) => {
        if (id) this.peerIndex.set(id, i)
      })
      this.lockstep = this.newLockstep()
      cfg.link.onCtl((m, from) => this.onCtl(m, from))
      cfg.link.onPeerLeave((id) => this.onPeerGone(id))
      // 메시는 피어마다 다른 시점에 완성된다. 평소 패킷은 최근 8틱만 겹치므로,
      // 8틱 넘게 늦게 붙은 피어에게는 지난 입력을 몰아 보내야 그쪽이 멈추지 않는다
      cfg.link.onPeerJoin((id) => {
        this.lockstep?.resendTo(id)
        this.checkJoinReady()
      })
      if (this.joiningIn) {
        // 세션이 열리기 전에 온 패킷은 받을 곳이 없었다 → 모두에게 지난 입력을 다시 달라고 한다
        cfg.link.sendCtl({ t: 'inputsPlease' })
        this.checkJoinReady()
      }
    }

    window.addEventListener('keydown', this.onKey)
    window.addEventListener('resize', this.fit)
    this.fit()
    this.startLobbyBeacon()
    this.ticker = new Ticker(() => this.tick())
    this.ticker.start()
    this.raf = this.autopilot ? (setTimeout(() => this.frame(performance.now()), 500) as unknown as number) : requestAnimationFrame(this.frame)
    // 디버그·운영 훅. others = 나와 봇 자리를 뺀 '사람' 수 (방 지키기 스크립트가 판을 이어갈지 방을 다시 열지 정한다)
    ;(window as unknown as { __bd?: unknown }).__bd = {
      tick: () => this.state.tick,
      phase: () => this.state.phase,
      state: () => this.state,
      map: () => this.map,
      /** 내 지역 번호 · 그 지역의 판 (여러 지역이면 state() 의 몬스터 칸은 다른 지역일 수 있다) */
      area: () => this.state.players[this.cfg.localPlayer]?.area,
      /** 내 자리 번호 (여러 탭 P2P 확인에서 내 캐릭터를 찾는다) */
      me: () => this.cfg.localPlayer,
      view: () => areaView(this.state, this.viewArea),
      /** 보는 지역의 자리들 (출구 · 웨이포인트 · 포털 자리) — 브라우저 확인용 */
      layout: () => areaLayout(this.viewArea, this.map),
      others: () => this.state.players.filter((p, i) => i !== this.cfg.localPlayer && !p.left && !p.vacant && !this.cfg.bots?.[i]).length,
      names: () => this.names,
      bots: () => this.cfg.bots ?? [],
      stalls: () => ({ count: this.stallCount, ms: Math.round(this.stallMs), now: this.stallSince >= 0 ? Math.round(performance.now() - this.stallSince) : 0 }),
      // P2P 확인용: 60틱마다의 상태 해시(틱 → 해시)와 받은 리싱크 수 — 탭끼리 같은 틱의 해시가 같으면 어긋나지 않은 것
      hashes: () => Object.fromEntries(this.hashes),
      // 난입 진행 (호스트): 판 보냄 · 준비 · 그 자리 입력을 받았나 · 가장 앞선 입력 틱 vs 지금 틱
      join: () => {
        const r = this.pendingRejoin
        return r ? { p: r.p, sent: r.sent, ready: r.ready, heard: this.lockstep?.heardFrom(r.p), latest: this.lockstep?.latestFrom(r.p), tick: this.state.tick, left: Math.round(r.deadline - performance.now()) } : null
      },
      resyncs: () => this.resyncs,
      audio: () => this.sfx.stats(),
      /** GPU: 컴파일된 셰이더 · 지오메트리 · 텍스처 수 (첫 던전 버벅임 확인 — 2026-09-20) */
      gpu: () => this.renderer.gpuInfo(),
      /** 실사 괴물 모델: 받은 종류 · 받는 중 · 실패 */
      models: () => this.renderer.monsterModels(),
      /** 확인용 카메라 당김 (0.3 = 가까이) */
      zoom: (k: number) => this.renderer.setDebugZoom(k),
      mv: () => this.renderer.debugMonsters(),
    }
  }

  /**
   * 게임 중에도 방을 방송한다(호스트만). 이게 없으면 시작하는 순간 방이 목록에서 사라져
   * 아무도 난입할 수 없다. 자리가 차면 'full', 세션이 끝나면 방송을 멈춘다.
   */
  private startLobbyBeacon(): void {
    const lobby = this.cfg.lobby
    const info = this.cfg.roomInfo
    if (!lobby || !info || !this.isHost) return
    const beat = () => {
      if (this.disposed) return
      const count = this.state.players.filter((p) => !p.left).length
      lobby.announce({
        code: this.cfg.link?.code ?? '',
        hostChar: this.state.players[0].char,
        hostName: this.cfg.names?.[0] ?? '',
        map: info.map,
        mode: info.mode as never,
        targetKills: info.targetKills,
        deathRule: info.deathRule,
        tier: info.tier,
        kind: info.kind,
        count,
        max: info.size,
        state: this.state.phase === 'over' || count >= info.size ? 'full' : 'playing',
      })
    }
    beat()
    this.lobbyBeacon = window.setInterval(beat, 2000)
  }

  /** 표시 이름: 닉네임이 있으면 닉네임, 없으면 캐릭터 이름(중복이면 번호) */
  private computeNames(): string[] {
    const base = displayNames(this.state.players.map((p) => p.char))
    return base.map((n, i) => {
      if (this.state.players[i].vacant) return '빈 자리'
      const nick = this.cfg.names?.[i]?.trim()
      return nick ? nick.slice(0, 8) : n
    })
  }

  private newLockstep(): Lockstep {
    const start = this.cfg.resumeTick ?? 0
    const ls = new Lockstep(
      this.cfg.link!,
      this.cfg.delay ?? 3,
      this.cfg.localPlayer,
      this.peerIndex,
      this.cfg.chars.length,
      start,
    )
    this.cfg.bots?.forEach((b, i) => {
      if (b) ls.setBot(i)
    })
    // 이어서 시작하는 경우(난입), 지나간 틱은 빈 입력으로 메워 둔다.
    // **먼저** 해야 한다 — rejoin 은 기다림을 되살리므로 drop 뒤에 부르면 빈 자리를 다시 기다린다.
    if (start > 0) for (let i = 0; i < this.cfg.chars.length; i++) ls.rejoin(i, start)
    // 나간 자리 · 아직 아무도 없는 자리는 입력을 기다리지 않는다 (둘 다 dropped 에 들어 있다)
    for (const d of this.dropped) ls.drop(d)
    return ls
  }

  /** 지역의 맵 (없으면 만든다) */
  private mapOf = (area: number): GameMap => {
    let m = this.maps.get(area)
    if (!m) {
      m = this.arena ? buildMap(this.mapIdFor(), this.cfg.mapScale ?? scaleForPlayers(this.cfg.chars.length), this.cfg.seed) : buildAreaMap(this.cfg.seed, area)
      this.maps.set(area, m)
    }
    return m
  }

  /** 화면이 보는 지역의 맵 */
  private get map(): GameMap {
    return this.mapOf(this.viewArea)
  }

  /** 화면이 볼 지역: 살아 있으면 내 지역, 죽어서 남을 보고 있으면 그 사람의 지역 */
  private wantedArea(): number {
    const me = this.state.players[this.cfg.localPlayer]
    const spec = this.spectate >= 0 ? this.state.players[this.spectate] : undefined
    if (me && !me.alive && spec && spec.alive) return spec.area
    return me?.area ?? 0
  }

  /** 지역이 바뀌었으면 3D 세계를 그 지역 맵으로 바꾼다 */
  private syncView(): void {
    const want = this.wantedArea()
    if (want === this.viewArea) return
    this.viewArea = want
    this.renderer.setMap(this.map)
    this.prev = interpSnapshot(areaView(this.state, want))
    if (this.waypoints?.open) this.waypoints.toggle(false)
    this.areaBanner()
  }

  /** 지역 이름 배너 (들어설 때) */
  private areaBanner(): void {
    if (this.arena) return
    const a = areaDef(this.viewArea)
    const t = this.state.tier ?? 0
    const tag = t > 0 ? `${TIER_LABEL[t]} · ` : ''
    // 막다른 옆길은 들어서자마자 알린다 (다음 맵이 없다 — 끝의 금빛 상자를 열고 들어온 곳으로 돌아간다)
    const sub = isDeadEnd(a.id)
      ? `${tag}지역 레벨 ${a.level + tierOf(t).lvl} · 막다른 옆길 — 끝에 금빛 상자, 나가는 길은 ${AREAS[a.links[0]].name} 쪽뿐`
      : a.kind === 'town'
        ? `${tag}${a.act + 1}막 · ${a.lore ?? '안전지대'}`
        : `${tag}지역 레벨 ${a.level + tierOf(t).lvl}${a.lore ? ` · ${a.lore}` : ''}`
    this.renderer.banner(a.name, sub)
  }

  /** 계속 켜기 방식: 음성 켜기/끄기 (버튼 · B) */
  private async toggleVoice(): Promise<void> {
    if (!this.voice) return
    const was = this.voice.on
    const on = await this.voice.toggle()
    this.syncVoiceUi()
    if (!was && !on) this.message = '마이크를 쓸 수 없습니다 (브라우저 권한을 확인하세요)'
    else this.message = on ? '음성 켜짐 — 같은 게임의 모두에게 들린다' : ''
    setTimeout(() => {
      if (this.message.startsWith('음성') || this.message.startsWith('마이크')) this.message = ''
    }, 2500)
  }

  /** 음성 버튼 모양: 방식 · 켜짐 · 말하는 중 */
  private syncVoiceUi(): void {
    const v = this.voice
    if (!v) return
    const vb = this.stage.querySelector('#btn-voice') as HTMLButtonElement | null
    const mb = this.stage.querySelector('#btn-voice-mode') as HTMLButtonElement | null
    if (mb) mb.textContent = v.mode === 'ptt' ? '방식: 눌러서 말하기' : '방식: 계속 켜기'
    if (vb) {
      vb.textContent = v.mode === 'ptt' ? (v.live ? '말하는 중… (B)' : '누르고 말하기 (B)') : v.on ? '음성 끄기 (B)' : '음성 켜기 (B)'
      vb.classList.toggle('live', v.live)
    }
  }

  /** 눌러서 말하기: B 를 떼면 멈춘다 */
  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key.toLowerCase() !== 'b' || !this.voice || this.voice.mode !== 'ptt') return
    void this.voice.hold(false).then(() => this.syncVoiceUi())
  }

  /** 자리별로 지금 말하고 있나 */
  private speakingList(): boolean[] | undefined {
    const v = this.voice
    if (!v) return undefined
    return this.cfg.chars.map((_, i) => (i === this.cfg.localPlayer ? v.on && v.speaking(null) : !!this.cfg.peerIds?.[i] && v.speaking(this.cfg.peerIds[i])))
  }

  /** 내 캐릭터가 웨이포인트 곁에 서 있나 (창을 열 때) */
  private nearWaypoint(): boolean {
    const me = this.state.players[this.cfg.localPlayer]
    if (!me || !me.alive || me.downed || me.left) return false
    const l = areaLayout(me.area, this.mapOf(me.area))
    return !!l.wp && Math.hypot(me.x - l.wp.x, me.y - l.wp.y) <= 60
  }

  /** 화면·소리가 보는 판 (내 지역) */
  private view(): GameState {
    return areaView(this.state, this.viewArea)
  }

  private get arena(): boolean {
    return this.cfg.kind === 'arena'
  }

  /** 투기장 맵 (방장이 고른 덕의 맵). 던전은 지역마다 world.ts 가 정한다 */
  private mapIdFor(): MapId {
    const m = this.cfg.mapId && !MAPS[this.cfg.mapId]?.fixedScale ? this.cfg.mapId : 'studio'
    return m
  }

  private matchCfg(seed: number): Parameters<typeof createState>[0] {
    return {
      seed,
      sheets: this.sheetsFor(),
      chars: this.cfg.chars,
      absent: this.cfg.absent,
      deathRule: this.cfg.deathRule,
      tier: this.arena ? 0 : this.cfg.tier ?? 0,
      mode: this.arena ? 'arena' : 'dungeon',
      teams: this.arena ? this.cfg.teams : undefined,
      targetKills: this.cfg.targetKills,
      // 방장이 연 가장 뒤 막의 마을에서 시작한다 (디아블로 2)
      area: this.arena ? undefined : ACTS[actReached(this.sheetsFor()[0]?.quests ?? [])].town,
      // 동료 봇 = 용병: 1번 자리(방장·혼자 하는 나)를 따라다닌다 (GUIDE 8장 — D4 에서 마을의 용병 대장으로 옮긴다)
      follow: this.arena ? undefined : this.cfg.chars.map((_, i) => (i !== 0 && (this.cfg.mode === 'solo' || this.cfg.bots?.[i]) ? 0 : -1)),
    }
  }

  /**
   * 자리별 기록. 사람은 받은 것(내 것은 세이브), 봇은 **방장에 맞춘 한 벌** — 레벨 · 그 레벨짜리 장비 · 스킬 · 능력치.
   * 전에는 레벨만 맞고 맨몸이라 "하다가 껐다 다시 켜면 봇이 너무 약했다"(2026-09-20 제보).
   * 방장(0번 자리) 기준인 것이 중요하다 — 내 세이브로 정하면 사람마다 봇이 달라져 판이 어긋난다(락스텝).
   */
  private sheetsFor(): (Sheet | undefined)[] {
    const tier = this.cfg.tier ?? 0
    const sheets = this.cfg.sheets
    // 방장 = 0번 자리. 아직 안 왔으면 자리 순서로 처음 있는 사람 (모두가 같은 답을 낸다)
    const host = sheets?.[0] ?? sheets?.find((s) => s)
    const hostLvl = host?.level ?? 1
    const hostQuests = host ? tierQuests(host, tier) : []
    const hostBonus = questPoints(hostQuests)
    // 템 수준도 방장에 맞춘다 (레벨만 보면 장비를 안 갈아입은 방장 곁에 봇만 번쩍인다)
    const hostIlvl = gearLevelOf(host)
    return this.cfg.chars.map((c, i) => {
      const s = sheets?.[i]
      // 퀘스트·웨이포인트는 이 판의 난이도 것으로 (악몽·지옥은 따로 진행한다 — 디아블로 2)
      if (s) return { ...s, quests: tierQuests(s, tier), wps: tier > 0 ? (s.twps?.[tier] ?? 0) : s.wps }
      const botSeat = this.cfg.mode === 'solo' || this.cfg.bots?.[i]
      return botSeat ? botSheet(c, hostLvl, hostIlvl, this.cfg.seed + i * 977, hostQuests, hostBonus) : undefined
    })
  }

  /**
   * 내 캐릭터를 세이브에 적는다. **하드코어는 마을에 있을 때만** — 던전에서 적으면 탈락해도 얻은 것이 남는다(GUIDE 5.3).
   * 탈락했으면 적지 않는다(마지막으로 마을에 들어온 뒤 얻은 것을 잃는다).
   */
  private saveMine(final: boolean): void {
    const me = this.state.players[this.cfg.localPlayer]
    if (!me || me.vacant || this.joiningIn) return
    void final
    if (this.state.mode === 'dungeon' && this.state.deathRule === 2 && (me.out || !isTown(me.area))) return
    this.notePlayed()
    commitSheet(me, this.state.tier ?? 0, this.played.map((sec, act) => ({ act, sec })).filter((x) => x.sec > 0))
    this.played = [0, 0, 0, 0]
    this.lastSave = performance.now()
  }

  /** 지난번부터 흐른 시간을 지금 내가 있는 막에 더한다 (창이 숨겨져 멈춘 시간·10초 넘는 틈은 빼고) */
  private notePlayed(): void {
    const now = performance.now()
    const dt = (now - this.playedAt) / 1000
    this.playedAt = now
    const me = this.state?.players[this.cfg.localPlayer]
    if (this.arena || !me || me.vacant || dt <= 0 || document.hidden) return
    this.played[areaDef(me.area).act] += Math.min(dt, 60)
  }

  private makeBots(seed: number): void {
    this.bots = this.cfg.chars.map((_, i) => this.newBot((seed ^ 0x9e37) + i * 7919))
  }

  private newBot(seed: number): BotMemory | PvpBotMemory {
    return this.arena ? makePvpBot(seed) : makeBot(seed)
  }

  /** 봇 입력 (던전 동료 · 투기장 상대) */
  private botFor(i: number, diff: Difficulty): Input {
    const a = this.state.players[i]?.area ?? 0
    const v = areaView(this.state, a)
    if (this.arena) return pvpBotInput(v, this.mapOf(a), i, this.bots[i] as PvpBotMemory, diff)
    const inp = botInput(v, this.mapOf(a), i, this.bots[i] as BotMemory, diff)
    // 봇 동료는 능력치 포인트가 생기면 추천대로 쓴다 (명령으로 — 모두의 sim 이 같게)
    const bp = this.state.players[i]
    if (bp && !inp.cmd && attrFree(bp.level, bp.attr) > 0) return { ...inp, cmd: CMD_ATTR, arg: 10 }
    return inp
  }

  private get isHost(): boolean {
    return this.cfg.mode === 'p2p' && this.cfg.link?.role === 'host'
  }

  private fit = (): void => {
    const w = window.innerWidth
    const h = window.innerHeight
    // 화면 비율에 맞춰 논리 폭을 바꾼다 → 폰 가로에서 좌우 검은 여백이 거의 사라진다
    if (setViewAspect(w / h)) this.renderer.resize()
    this.stage.style.width = `${VIEW_W}px`
    this.stage.style.height = `${VIEW_H}px`
    // flex 로 가운데 두면 화면보다 큰 요소가 한쪽으로 쏠린다(폰에서 오른쪽으로 붙던 원인).
    // 절반씩 되돌리는 translate 로 정확히 가운데에 놓는다.
    const s = Math.min(w / VIEW_W, h / VIEW_H)
    this.stage.style.transform = `translate(-50%, -50%) scale(${s})`
    this.renderer.resize()
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'n' || e.key === 'N') {
      this.sfx.toggle()
      this.syncMute()
      return
    }
    // 관전 중 대상 바꾸기 (A/D 와 좌우 화살표 둘 다)
    const k = e.key.toLowerCase()
    // 가방 창: I 또는 Tab (Esc 로도 닫힌다)
    if (k === 'i' || e.key === 'Tab') {
      if (this.overlay.hidden) this.inventory.toggle()
      e.preventDefault()
      return
    }
    if (e.key === 'Escape' && this.inventory.open) {
      this.inventory.toggle(false)
      e.preventDefault()
      return
    }
    // 퀘스트 기록: J
    if (k === 'j' && !this.arena) {
      this.quests.toggle()
      e.preventDefault()
      return
    }
    if (e.key === 'Escape' && this.quests.open) {
      this.quests.toggle(false)
      e.preventDefault()
      return
    }
    // 전체 지도: M (2026-09-20 — 미니맵은 주변만 보여 준다)
    if (k === 'm' && !this.arena) {
      if (this.overlay.hidden) this.renderer.mapOpen = !this.renderer.mapOpen
      this.applyKeys()
      e.preventDefault()
      return
    }
    if (e.key === 'Escape' && this.renderer.mapOpen) {
      this.renderer.mapOpen = false
      this.applyKeys()
      e.preventDefault()
      return
    }
    // 스킬 창: K (Esc 로도 닫힌다)
    if (k === 'k') {
      if (this.overlay.hidden) this.skills.toggle()
      e.preventDefault()
      return
    }
    if (e.key === 'Escape' && this.skills.open) {
      this.skills.toggle(false)
      e.preventDefault()
      return
    }
    // 능력치 창: C (Esc 로도 닫힌다)
    if (k === 'c' && !this.arena) {
      if (this.overlay.hidden) this.chars.toggle()
      e.preventDefault()
      return
    }
    if (e.key === 'Escape' && this.chars.open) {
      this.chars.toggle(false)
      e.preventDefault()
      return
    }
    // 마을 NPC: 곁에서 F 로 창을 연다 (닫을 때도 F · Esc)
    if (this.town.open && (k === 'f' || e.key === 'Escape')) {
      this.town.show(null)
      e.preventDefault()
      return
    }
    if (k === 'f' && !this.arena) {
      const me = this.state.players[this.cfg.localPlayer]
      const npc = me && me.alive && !me.left ? npcNear(me.area, me.x, me.y) : null
      if (npc) {
        this.town.show(npc)
        return
      }
    }
    // 웨이포인트: 곁에서 F 로 창을 연다 (닫을 때도 F · Esc)
    if (this.waypoints.open && (k === 'f' || e.key === 'Escape')) {
      this.waypoints.toggle(false)
      e.preventDefault()
      return
    }
    if (k === 'f' && !this.arena && this.nearWaypoint()) {
      this.waypoints.toggle(true)
      return
    }
    if (this.spectate >= 0 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || k === 'a' || k === 'd')) {
      const next = this.nextAlive(e.key === 'ArrowLeft' || k === 'a' ? this.spectate - 2 : this.spectate)
      if (next >= 0) this.spectate = next
      e.preventDefault()
      return
    }
    // 신호: 커서가 가리키는 곳에 "여기" 를 찍는다 (협동이라 언제나)
    if (k === 'b' && this.voice) {
      e.preventDefault()
      if (e.repeat) return
      if (this.voice.mode === 'ptt') void this.voice.hold(true).then(() => this.syncVoiceUi())
      else void this.toggleVoice()
      return
    }
    if (e.key === 'v' || e.key === 'V') {
      this.sendMark()
      e.preventDefault()
      return
    }
    // 빠른 감정 표현: 7·8·9 (1·2 는 스킬, 3 은 물약 자리 — GUIDE 16장)
    if (!this.pickerOpen && (e.key === '7' || e.key === '8' || e.key === '9')) {
      this.sendEmote(Number(e.key) - 6)
      e.preventDefault()
      return
    }
    if (e.key === 'Escape') {
      if (this.state.phase === 'over') return
      if (this.pickerOpen) {
        // 취소 = 지금 캐릭터 그대로
        this.input.pendingChar = CHARACTER_LIST.findIndex((c) => c.id === this.state.players[this.cfg.localPlayer].char) + 1
        e.preventDefault()
        return
      }
      if (this.overlay.hidden) this.showMenu()
      else this.hideOverlay()
      e.preventDefault()
    }
  }

  private applyKeys(): void {
    const el = this.stage.querySelector('.keys') as HTMLElement | null
    // 전체 지도가 열려 있으면 띠를 감춘다 — 지도 위에 겹쳐 글자가 섞인다 (2026-09-20)
    if (el) el.hidden = !this.keysShown || this.renderer?.mapOpen === true
  }

  /**
   * 오른쪽 아래 창 단추 (2026-09-20 사용자: "가방 · 스킬 · 능력치 · 퀘스트는 단축키 안 써도 클릭으로 열 수 있게").
   * 누르면 단축키와 똑같이 여닫는다. 투기장에는 능력치 · 퀘스트가 없다.
   */
  private bindWinButtons(): void {
    const box = this.stage.querySelector('#winbtns') as HTMLElement | null
    if (!box) return
    const open: Record<string, () => void> = {
      bag: () => this.inventory.toggle(),
      skill: () => this.skills.toggle(),
      attr: () => this.chars.toggle(),
      quest: () => this.quests.toggle(),
      map: () => {
        this.renderer.mapOpen = !this.renderer.mapOpen
        this.applyKeys()
      },
    }
    box.querySelectorAll<HTMLButtonElement>('.wbtn').forEach((b) => {
      const w = b.dataset.win as string
      if (this.arena && (w === 'attr' || w === 'quest' || w === 'map')) {
        b.hidden = true
        return
      }
      b.onclick = () => {
        if (!this.overlay.hidden) return
        // 다른 창이 열려 있으면 닫고 연다 (창끼리 겹치지 않게 — 키로 열 때와 같다)
        open[w]?.()
        this.sfx.blip()
      }
    })
  }

  /** 창 단추에 지금 열린 창을 표시한다 */
  private syncWinButtons(): void {
    const box = this.stage.querySelector('#winbtns') as HTMLElement | null
    if (!box) return
    const on: Record<string, boolean> = {
      bag: this.inventory.open,
      skill: this.skills.open,
      attr: this.chars.open,
      quest: this.quests.open,
      map: this.renderer.mapOpen,
    }
    box.querySelectorAll<HTMLButtonElement>('.wbtn').forEach((b) => b.classList.toggle('on', !!on[b.dataset.win as string]))
  }

  private showMenu(): void {
    const solo = this.cfg.mode === 'solo'
    if (solo) this.paused = true
    // 설정은 대기실과 같은 칸을 쓴다 (ui/settings.ts) — 바꾸면 이 판에 바로 반영한다
    this.showOverlay(
      solo ? '일시정지' : '메뉴',
      solo ? '봇은 기다려 줍니다.' : '대전 중에는 게임이 멈추지 않습니다.',
      [
        { label: '계속', primary: true, onClick: () => this.hideOverlay() },
        { label: '로비로', primary: false, onClick: () => this.exit() },
      ],
      settingsHtml({ keys: !this.touch }),
    )
    const box = this.overlay.querySelector('.settings') as HTMLElement | null
    if (box)
      bindSettings(box, {
        keys: !this.touch,
        onSound: (m) => {
          if (this.sfx.muted !== m) this.sfx.toggle()
          this.syncMute()
        },
        onReal: (on) => this.renderer.setRealMonsters(on),
        onKeys: (on) => {
          this.keysShown = on
          this.applyKeys()
        },
        // 자동 줍기 등급은 각자의 옵션이지만 줍기는 sim 이 한다 → 명령으로 모두에게 알린다
        onAutoPick: (v) => this.input.queueCmd(CMD_AUTOPICK, v),
      })
  }

  private showOverlay(
    title: string,
    desc: string,
    buttons: { label: string; primary: boolean; onClick: () => void }[],
    extraHtml = '',
  ): void {
    const box = this.overlay.querySelector('#overlay-box') as HTMLElement
    box.innerHTML = `<h2>${title}</h2><p>${desc}</p>${extraHtml}<div class="row"></div>`
    const row = box.querySelector('.row') as HTMLElement
    for (const b of buttons) {
      const btn = document.createElement('button')
      btn.className = 'btn' + (b.primary ? '' : ' secondary')
      btn.textContent = b.label
      btn.onclick = b.onClick
      row.appendChild(btn)
    }
    this.overlay.hidden = false
    this.touch?.setVisible(false)
  }

  private hideOverlay(): void {
    this.overlay.hidden = true
    this.touch?.setVisible(true)
    if (this.cfg.mode === 'solo' && this.state.phase !== 'over') this.paused = false
  }

  // ---------- 캐릭터 교체 창 ----------
  /** 터치 메뉴 버튼 */
  private pollTouchMenu(): void {
    if (this.touch?.takeMark()) this.sendMark()
    if (this.touch?.takeEmote()) this.sendEmote(1)
    if (this.touch?.takeMenu()) {
      if (this.overlay.hidden) this.showMenu()
      else this.hideOverlay()
    }
  }

  private showPicker(): void {
    const box = this.overlay.querySelector('#overlay-box') as HTMLElement
    box.classList.add('picker')
    const cur = this.state.players[this.cfg.localPlayer].char
    box.innerHTML = `<h2>캐릭터 교체</h2><p>고르는 동안은 소환되지 않습니다. 고르면 상대에게서 먼 곳에 리스폰.<br><b>1~9</b> 키 또는 클릭 · <b>Esc</b> 그대로</p><div class="pick-grid"></div>`
    const grid = box.querySelector('.pick-grid') as HTMLElement
    CHARACTER_LIST.forEach((c, i) => {
      const el = document.createElement('button')
      el.className = 'pick' + (c.id === cur ? ' on' : '')
      el.innerHTML = `<canvas></canvas><b>${c.name}</b><small>${WEAPONS[c.weapon].name} · HP ${c.maxHp}<br>${c.passiveName}</small>${i < 9 ? `<span class="key">${i + 1}</span>` : ''}`
      el.onclick = () => (this.input.pendingChar = i + 1)
      grid.appendChild(el)
      const cv = el.querySelector('canvas') as HTMLCanvasElement
      requestAnimationFrame(() => drawPortrait(cv, c))
    })
    this.overlay.hidden = false
    this.pickerOpen = true
    this.input.pickerOpen = true
    this.touch?.setVisible(false)
  }

  private hidePicker(): void {
    const box = this.overlay.querySelector('#overlay-box') as HTMLElement
    box.classList.remove('picker')
    box.innerHTML = ''
    this.overlay.hidden = true
    this.pickerOpen = false
    this.input.pickerOpen = false
    this.touch?.setVisible(true)
  }

  // ---------- 대전: 피어 ----------

  /**
   * 멈춘 동안 누구 입력이 안 오는지 본다. SILENT_DROP_MS 넘게 조용한 사람은 나간 것으로 처리한다.
   * 호스트만 게스트를 비운다(모두 같은 틱에 비우도록 drop 을 방송하는 건 호스트의 일). 게스트는 호스트가 조용할 때만 움직인다
   */
  private watchSilent(t: number, now: number): void {
    if (!this.lockstep) return
    for (let i = 0; i < this.state.players.length; i++) {
      if (i === this.cfg.localPlayer || this.dropped.has(i) || this.cfg.bots?.[i] || this.lockstep.isBot(i)) continue
      const p = this.state.players[i]
      if (p.left || p.vacant) continue
      if (this.lockstep.latestFrom(i) >= t) {
        this.silentSince[i] = -1
        continue
      }
      if (!(this.silentSince[i] >= 0)) {
        this.silentSince[i] = now
        continue
      }
      if (now - this.silentSince[i] < Session.SILENT_DROP_MS) continue
      if (!this.isHost && i !== 0) continue
      const id = [...this.peerIndex].find(([, v]) => v === i)?.[0]
      this.silentSince[i] = -1
      console.warn(`[session] ${this.names[i]} 입력이 ${Math.round(Session.SILENT_DROP_MS / 1000)}초 없음 → 나간 것으로 처리`)
      if (id) this.onPeerGone(id)
      else this.dropSeat(i)
    }
  }

  /** 피어 id 를 모를 때(전달받은 목록이 비었을 때) 자리만으로 이탈 처리 — onPeerGone 의 자리 부분과 같다 */
  private dropSeat(idx: number): void {
    if (this.dropped.has(idx)) return
    this.dropped.add(idx)
    this.lockstep?.drop(idx)
    if (this.isHost) {
      const tick = this.state.tick + Session.DROP_DELAY_TICKS
      this.pendingDrops.push({ p: idx, tick })
      this.cfg.link?.sendCtl({ t: 'drop', p: idx, tick })
    }
  }

  /** 피어가 나갔다 (연결 끊김 또는 leave 메시지) */
  private onPeerGone(id: string): void {
    if (this.disposed) return
    const idx = this.peerIndex.get(id)
    if (idx === undefined) return
    // 자리를 받아 놓고 앉기 전에 나간 난입자: 배정을 물린다. 안 그러면 그 자리에 유령이 소환되고
    // 모두가 그 입력을 기다리다 멈춘다 (난입 버튼을 두 번 누르면 같은 id 로 나갔다 들어와 이렇게 된다)
    if (this.isHost && this.pendingRejoin?.peerId === id) {
      this.cancelJoin(id, false)
      return
    }
    if (this.dropped.has(idx)) return
    // 투기장 팀전은 한 명만 빠져도 짝이 안 맞아 그 자리에서 끝낸다 (덕 규칙)
    if (isTeamMatch(this.state) && this.state.phase !== 'over') {
      if (this.isHost) this.cfg.link?.sendCtl({ t: 'abort', p: idx })
      this.abortMatch(idx)
      return
    }
    this.dropped.add(idx)
    this.lockstep?.drop(idx)
    if (idx === 0) {
      // 호스트가 나가면 방은 끝. 던전이면 **지금 판 그대로 혼자 이어하기**를 고를 수 있다(2026-09-19 M8) —
      // 판은 모두가 똑같이 들고 있으므로(락스텝) 내 것을 그대로 쓰면 된다
      const buttons = [{ label: '로비로', primary: !this.canContinueSolo(), onClick: () => this.exit() }]
      if (this.canContinueSolo()) buttons.unshift({ label: '혼자 이어하기', primary: true, onClick: () => this.continueSolo() })
      this.showOverlay(
        '호스트가 나갔습니다',
        this.canContinueSolo() ? '방이 닫혔습니다. 지금 판을 그대로 혼자 이어 갈 수 있습니다(봇 동료는 함께 남습니다).' : '방이 닫혔습니다.',
        buttons,
      )
      this.paused = true
      return
    }
    if (this.isHost) {
      // 나가면 곧 자리를 비운다. 비어야 남들이 **난입**으로 들어올 수 있다.
      // (락스텝은 이미 그 사람 입력을 빈 입력으로 채우므로 경기는 멈추지 않는다)
      const tick = this.state.tick + Session.DROP_DELAY_TICKS
      this.pendingDrops.push({ p: idx, tick })
      this.cfg.link?.sendCtl({ t: 'drop', p: idx, tick })
      this.message = `${this.names[idx]} 나감 · 빈 자리는 난입으로 채워집니다`
      setTimeout(() => {
        if (this.message.startsWith(this.names[idx])) this.message = ''
      }, 4000)
    }
  }

  /** 혼자 이어하기가 되는가: 던전 · 판이 끝나지 않음 · 내가 자리에 앉아 있음 */
  private canContinueSolo(): boolean {
    const me = this.state.players[this.cfg.localPlayer]
    return !!this.cfg.onRestart && this.state.mode === 'dungeon' && this.state.phase !== 'over' && !!me && !me.left && !me.vacant && !this.joiningIn
  }

  /**
   * 혼자 이어하기: 지금 판을 복사해 사람 자리(나 빼고)는 비우고, 봇 자리는 내가 이어서 몬다.
   * 새 세션은 방 없이(mode 'solo') 같은 시드 · 같은 판에서 시작한다 — 퀘스트 · 웨이포인트 · 가방은 그대로다.
   */
  private continueSolo(): void {
    this.saveMine(true)
    const lp = this.cfg.localPlayer
    const st = JSON.parse(JSON.stringify(this.state)) as GameState
    st.players.forEach((p, i) => {
      if (i !== lp && !this.cfg.bots?.[i] && !p.left) dropPlayer(st, i)
    })
    const { link: _link, lobby: _lobby, peerIds: _peers, onExit: _exit, onRestart, ...rest } = this.cfg
    void _link
    void _lobby
    void _peers
    void _exit
    this.dispose()
    onRestart!({ ...rest, mode: 'solo', resumeState: st, resumeTick: st.tick, absent: st.players.map((p, i) => i !== lp && !!p.left) })
  }

  /** step 직후 호출: 정해진 틱에 도달한 이탈을 상태에 반영하고, 혼자 남았는지 본다 */
  private applyDrops(): void {
    if (this.pendingDrops.length === 0) {
      this.checkAlone()
      return
    }
    const t = this.state.tick
    const keep: PendingDrop[] = []
    for (const d of this.pendingDrops) {
      if (d.tick <= t) {
        dropPlayer(this.state, d.p)
        // 호스트가 **나를** 비웠다(내 입력이 오래 안 갔다): 판에 남아 있어 봐야 유령이다 → 안내하고 로비로
        if (d.p === this.cfg.localPlayer && !this.isHost && this.overlay.hidden) {
          this.showOverlay('연결이 끊겼습니다', '내 입력이 한동안 방에 닿지 않아 자리가 비워졌습니다. 로비에서 다시 난입할 수 있습니다.', [
            { label: '로비로', primary: true, onClick: () => this.exit() },
          ])
          this.paused = true
        }
      } else keep.push(d)
    }
    this.pendingDrops = keep
    this.checkAlone()
  }

  /**
   * 혼자 남았을 때. 바로 끝내지 않고 **30초 기다린다** — 그동안 누가 난입하면 그대로 이어서 한다.
   * 방은 계속 방송되고 있으므로 목록에서 "게임 중 · 난입 가능" 으로 보인다.
   */
  private checkAlone(): void {
    // 던전은 혼자여도 판을 이어 간다 — 혼자 시작한 방에 친구가 난입하는 것이 기본 흐름이다(2026-09-18: 30초 뒤 방이 닫혀 난입이 막혔다).
    // "혼자 남으면 닫기" 는 상대가 없으면 의미가 없는 투기장(덕 규칙)에만 둔다
    if (this.cfg.mode !== 'p2p' || this.state.phase === 'over' || !this.arena) return
    // **사람**만 센다. 봇 자리는 남아 있어도 혼자다 — 전에는 봇을 세서 봇으로 채운 방은 사람이 다 나가도 영영 "게임 중" 으로
    // 남았다(2026-09-06 사용자 제보: 판이 끝난 뒤에도 방 지키기 방이 목록에 그대로). 방 지키기는 이 안내의 "로비로" 를 눌러 방을 새로 연다
    const remaining = this.state.players.filter((p, i) => !p.left && !this.cfg.bots?.[i]).length
    if (remaining >= 2) {
      if (this.aloneSince >= 0) {
        this.aloneSince = -1
        this.message = ''
      }
      this.aloneOk = false
      return
    }
    if (this.aloneOk) return
    if (this.aloneSince < 0) this.aloneSince = this.state.tick
    const left = Session.ALONE_GRACE_TICKS - (this.state.tick - this.aloneSince)
    const hasBots = this.cfg.bots?.some(Boolean) ?? false
    if (left > 0) {
      this.message = `${hasBots ? '사람은 혼자 남았습니다' : '혼자 남았습니다'} · ${Math.ceil(left / 60)}초 안에 아무도 안 들어오면 방이 닫힙니다`
      return
    }
    if (this.overlay.hidden) {
      this.message = ''
      const buttons = [{ label: '로비로', primary: true, onClick: () => this.exit() }]
      if (hasBots)
        buttons.push({
          label: '봇과 계속하기',
          primary: false,
          onClick: () => {
            this.aloneOk = true
            this.aloneSince = -1
            this.paused = false
            this.hideOverlay()
          },
        })
      this.showOverlay('아무도 들어오지 않았습니다', hasBots ? '봇만 남았습니다. 방을 닫거나 봇과 계속할 수 있습니다.' : '방을 닫습니다.', buttons)
      this.paused = true
    }
  }

  private onCtl(m: CtlMessage, from: string): void {
    if (this.disposed) return
    switch (m.t) {
      case 'hash': {
        if (!this.isHost) return
        const mine = this.hashes.get(m.tick)
        if (mine === undefined) return
        if (mine !== m.h) this.cfg.link?.sendCtl({ t: 'resync', tick: this.state.tick, state: snapshot(this.state) }, from)
        break
      }
      case 'resync': {
        if (this.isHost || !this.lockstep || this.peerIndex.get(from) !== 0) return
        const target = this.state.tick
        const snap = m.state as GameState
        this.state = snap
        this.state.events = []
        this.state.evSpans = []
        if (this.arena) syncSandbags(this.state, this.mapOf(0))
        while (this.state.tick < target && this.lockstep.hasAll(this.state.tick)) {
          step(this.state, this.mapOf, this.lockstep.get(this.state.tick))
          this.applyDrops()
        }
        this.syncView()
        this.prev = interpSnapshot(this.view())
        this.resyncs++
        this.message = '동기화됨'
        setTimeout(() => (this.message = ''), 1200)
        break
      }
      case 'drop': {
        if (this.peerIndex.get(from) !== 0) return
        this.dropped.add(m.p)
        this.lockstep?.drop(m.p)
        this.pendingDrops.push({ p: m.p, tick: m.tick })
        break
      }
      case 'joinAsk': {
        if (!this.isHost) break
        this.onJoinAsk(m.char as CharacterId, m.name, from, m.sheet)
        break
      }
      case 'joinReady': {
        if (this.isHost && this.pendingRejoin?.peerId === from) this.pendingRejoin.ready = true
        break
      }
      case 'inputsPlease': {
        this.lockstep?.resendTo(from)
        break
      }
      case 'joinLive': {
        if (this.peerIndex.get(from) !== 0) return
        // 난입자의 피어 id 를 모두가 기록한다 (없으면 그 사람 입력을 버려 방 전체가 멈춘다)
        if (m.id && m.id !== this.cfg.link?.selfId) {
          this.peerIndex.set(m.id, m.p)
          if (this.cfg.peerIds) this.cfg.peerIds[m.p] = m.id
        }
        this.pendingJoins.push({ p: m.p, tick: m.tick, char: m.char as CharacterId, team: m.team, name: m.name, sheet: m.sheet })
        if (m.id === this.cfg.link?.selfId) this.message = '들어갑니다…'
        break
      }
      case 'joinCancel': {
        if (this.peerIndex.get(from) !== 0) return
        this.applyJoinCancel(m.p, m.id)
        break
      }
      case 'abort': {
        if (this.peerIndex.get(from) !== 0) return
        this.abortMatch(m.p)
        break
      }
      case 'emote': {
        // 누구 것이든 본다(보이는 사람만 그려진다). 번호는 보낸 사람 자리와 맞아야 한다
        if (m.p !== this.cfg.localPlayer && this.peerIndex.get(from) === m.p) this.renderer.showEmote(m.p, m.id)
        break
      }
      case 'mark': {
        // 같은 편이 찍은 것만 본다 (던전은 모두 같은 편)
        const from = this.state.players[m.p]
        const me = this.state.players[this.cfg.localPlayer]
        if (from && me && from.team === me.team && m.p !== this.cfg.localPlayer) {
          this.renderer.addMark(m.x, m.y)
          this.sfx.mark()
        }
        break
      }
      case 'rematch':
        if (this.peerIndex.get(from) === 0) this.restart(m.seed)
        break
      case 'leave':
        this.onPeerGone(from)
        break
      default:
        break
    }
  }

  /** 투기장 다시 하기 (던전에는 없다 — 세계가 이어져 있다) */
  private restart(seed: number): void {
    // 다시 하기: 이번 판에서 키운 것을 들고 간다 (내 것은 세이브에도 적는다)
    this.saveMine(true)
    this.cfg.sheets = this.state.players.map((p) => (p.vacant ? undefined : { level: p.level, xp: p.xp, gold: p.gold, equip: p.equip, bag: p.bag }))
    // 맵도 시드로 새로 생성한다 (매 판 구조물이 달라진다)
    this.cfg.seed = seed
    this.maps.clear()
    this.viewArea = 0
    this.renderer.setMap(this.map)
    this.state = createState({ ...this.matchCfg(seed), absent: undefined }, this.mapOf)
    // 이미 나간 사람은 처음부터 빠진 채로
    for (const d of this.dropped) dropPlayer(this.state, d)
    this.state.events = []
    this.prev = interpSnapshot(this.view())
    this.makeBots(seed)
    this.hashes.clear()
    this.pendingDrops = []
    this.acc = 0
    this.paused = false
    // 끊김·혼자 남음 집계는 판마다 (방 지키기 기록이 판 단위다)
    this.stallCount = 0
    this.stallMs = 0
    this.stallSince = -1
    this.silentSince.length = 0
    this.aloneSince = -1
    this.aloneOk = false
    this.hideOverlay()
    if (this.cfg.link) this.lockstep = this.newLockstep()
  }

  /** 시뮬레이션 진행 (워커 타이머가 16ms 마다 호출, 탭이 뒤에 있어도 돈다) */
  private tick(): void {
    if (this.disposed) return
    const now = performance.now()
    const dt = Math.min(0.25, (now - this.lastTick) / 1000)
    this.lastTick = now
    if (this.paused || this.state.phase === 'over') return
    const lp = this.cfg.localPlayer
    const me = this.state.players[lp]
    const n = this.state.players.length
    this.acc += dt * 1000
    let steps = 0
    // 멈췄다 풀리면 밀린 틱을 몰아서 처리한다. 너무 많이 몰면 화면이 튀므로
    // 한 번에 최대 4틱만 따라잡는다(나머지는 다음 호출에서). 렌더 쪽 스무딩과 짝이다.
    // 난입해서 관전 중일 때는 아무도 나를 기다리지 않으니 빨리 따라잡는다 (그래야 빨리 자리에 앉는다)
    const maxSteps = this.joiningIn ? 16 : 4
    // 난입 중(관전)에는 **받은 입력이 있는 만큼** 시간과 상관없이 따라잡는다. 시간(acc)으로만 돌리면 실시간 속도라
    // 판을 받고 맵·3D 를 준비하는 동안 벌어진 간격(던전은 20~25틱)을 영영 못 좁혀 호스트의 "10틱 안" 조건에 걸렸다(2026-09-18)
    const catchUp = () => this.joiningIn && this.lockstep !== null && this.lockstep.hasAll(this.state.tick)
    while ((this.acc >= TICK_MS || catchUp()) && steps < maxSteps) {
      const t = this.state.tick
      const localIn = this.autopilot
        ? this.botFor(lp, 'normal')
        : this.input.sample(
            this.renderer,
            me.x,
            me.y,
            // 터치 조작이면 조준을 대신 해 준다 (스틱 두 개는 폰에서 무리)
            this.touch ? { state: this.view(), map: this.map, me: this.cfg.localPlayer } : undefined,
          )
      let inputs: Input[]
      if (this.lockstep) {
        this.lockstep.pushLocal(t, localIn)
        // 봇 자리: 호스트가 지금 판을 보고 입력을 만들어 자리 패킷으로 보낸다 (게스트는 받기만)
        if (this.isHost && this.cfg.bots) {
          for (let i = 0; i < this.cfg.bots.length; i++) {
            if (!this.cfg.bots[i] || this.dropped.has(i)) continue
            this.lockstep.pushBot(i, t, this.botFor(i, this.cfg.difficulty ?? 'normal'))
          }
        }
        if (!this.lockstep.hasAll(t)) {
          if (this.stallSince < 0) this.stallSince = now
          this.watchSilent(t, now)
          break
        }
        if (this.silentSince.length) this.silentSince.length = 0
        if (this.stallSince >= 0) {
          // 0.4초 넘게 멈춘 것만 '끊김' 으로 센다 (화면에 "상대 입력 대기 중…" 이 뜨는 기준과 같다). 방 지키기 로그가 읽는다
          const d = now - this.stallSince
          if (d > 400 && this.state.phase === 'playing') {
            // 카운트다운(시작 직후 상대 입력이 처음 오기까지 기다리는 것)은 세지 않는다 — 판 중의 끊김만
            this.stallCount++
            this.stallMs += d
          }
          this.stallSince = -1
        }
        inputs = this.lockstep.get(t)
      } else {
        inputs = new Array(n)
        for (let i = 0; i < n; i++) {
          inputs[i] = i === lp ? localIn : this.botFor(i, this.cfg.difficulty ?? 'normal')
        }
      }
      this.prev = interpSnapshot(this.view())
      step(this.state, this.mapOf, inputs)
      this.applyDrops()
      // 지역을 건너갔으면 3D 세계를 바꾼 뒤에 이벤트를 그 지역 것만 보여 준다
      this.syncView()
      const view = this.view()
      this.renderer.onEvents(view.events, view, lp, this.names)
      this.sfx.onEvents(view.events, view, lp)
      // 벼리기 결과는 대장장이 창에도 카드로 띄운다 (2026-09-20 "뭐가 나왔는지 확실하게")
      for (const e of view.events) {
        if (e.type !== 'forge' || e.p !== this.cfg.localPlayer) continue
        const it = this.state.players[e.p]?.bag.find((b) => b.uid === e.uid)
        if (!it) continue
        this.town.forgeResult(it, e.up)
        showForgeFx(this.stage.querySelector('.game-ui') as HTMLElement, it, e.up)
      }
      if (this.lockstep && this.state.tick % 60 === 0) {
        const h = hashState(this.state)
        this.hashes.set(this.state.tick, h)
        if (this.hashes.size > 10) this.hashes.delete(Math.min(...this.hashes.keys()))
        if (!this.isHost) this.cfg.link?.sendCtl({ t: 'hash', tick: this.state.tick, h }, this.cfg.peerIds?.[0])
        this.lockstep.prune(this.state.tick)
      }
      this.applyJoins()
      if (this.isHost) this.serveJoin()
      for (const e of this.state.events) {
        if (e.type === 'over') {
          this.saveMine(true)
          this.onOver()
        } else if (e.type === 'levelup' && e.p === this.cfg.localPlayer) this.saveMine(false)
        // 최종 보스: 엔딩 (따라잡는 중에 본 것이면 띄우지 않는다)
        else if (e.type === 'bossDown' && e.kind === LORD_KIND && !this.joiningIn) {
          this.saveMine(false)
          showEnding(this.stage.querySelector('.game-ui') as HTMLElement, this.state.tier ?? 0, () => this.sfx.blip())
        }
        // 마을에 들어설 때 저장 (하드코어는 이때만 저장된다)
        else if (e.type === 'areaEnter' && e.p === this.cfg.localPlayer && isTown(e.area)) this.saveMine(false)
        // 내가 죽으면: 투기장 개인전은 나를 죽인 사람, 아니면 살아 있는 동료를 본다
        else if (e.type === 'death' && e.p === this.cfg.localPlayer) {
          this.spectate = this.arena && !isTeamMatch(this.state) && e.by >= 0 && e.by !== e.p ? e.by : this.nextAlive(-1)
        } else if (e.type === 'respawn' && e.p === this.cfg.localPlayer) {
          this.spectate = -1
        } else if (e.type === 'join' && e.p === this.cfg.localPlayer) {
          // 난입 확정: 관전을 끝내고 내 시점으로
          this.joiningIn = false
          this.spectate = -1
          this.message = ''
        }
      }
      this.acc -= TICK_MS
      steps++
    }
    if (this.acc > TICK_MS * 8) this.acc = TICK_MS * 8
    if (this.acc < 0) this.acc = 0
    // 30초마다 자동 저장 (탭이 갑자기 닫혀도 잃는 게 작게)
    if (now - this.lastSave > 30000) this.saveMine(false)
    else if (now - this.playedAt > 5000) this.notePlayed()
  }

  private frame = (now: number): void => {
    if (this.disposed) return
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    const lp = this.cfg.localPlayer
    let message = this.message
    if (this.lockstep && this.stallSince >= 0 && now - this.stallSince > 400) message = '상대 입력 대기 중…'
    this.pollTouchMenu()
    // 발소리는 sim 이벤트가 아니라 이동 상태로 낸다(틱마다 이벤트를 만들면 패킷이 무거워진다)
    this.sfx.updateSteps(this.state, lp, dt)
    const alpha = Math.min(1, this.acc / TICK_MS)
    const choosing = false
    if (choosing && !this.pickerOpen) this.showPicker()
    else if (!choosing && this.pickerOpen) this.hidePicker()
    const sub = this.cfg.chars.map((_, i) => this.subLabel(i))
    // 죽어서 기다리는 동안만 남의 시점. 살아 있으면 언제나 내 시점
    const me = this.state.players[lp]
    // 보던 사람이 죽었으면 다음으로 넘긴다 (투기장 팀전은 아군만 — 상대 시점은 적 위치를 알려 준다)
    if (this.spectate >= 0) {
      const t = this.state.players[this.spectate]
      const okTeam = !isTeamMatch(this.state) || t.team === this.state.players[lp].team
      if (!t || !t.alive || t.left || !okTeam) this.spectate = this.nextAlive(this.spectate)
    }
    const spec = !me.alive && !me.choosing && this.spectate >= 0 && this.state.players[this.spectate]?.alive ? this.spectate : -1
    if (spec < 0 && this.spectate >= 0 && me.alive) this.spectate = -1
    this.syncView()
    const view = this.view()
    this.skills.refresh()
    this.chars.refresh()
    this.quests.refresh()
    this.syncWinButtons()
    // NPC 창: 멀어지면 닫고, 거래가 끝나면 다시 그린다
    if (this.town.open) {
      const me = this.state.players[this.cfg.localPlayer]
      const n = me ? townNpcs(me.area).find((q) => q.id === this.town.open) : undefined
      if (!n || !me || Math.hypot(me.x - n.x, me.y - n.y) > NPC_RANGE + 40) this.town.show(null)
      else this.town.refresh()
    }
    this.renderer.draw(this.prev, view, alpha, dt, {
      showHud: true,
      localPlayer: lp,
      viewer: spec >= 0 ? spec : undefined,
      spectateLabel:
        spec >= 0
          ? this.spectateCandidates() > 1
            ? `${this.names[spec]} 시점 · ◀ A · D ▶ 로 바꾸기`
            : `${this.names[spec]} 시점`
          : undefined,
      cameraMode: 'follow',
      names: this.names,
      subLabels: sub,
      ping: this.cfg.link ? this.cfg.link.rtt : undefined,
      message,
      cursor: this.aimCursor(),
      touch: this.touch !== null,
      floorName: this.arena ? `투기장 · ${this.map.name}` : areaDef(this.viewArea).name,
      speaking: this.speakingList(),
    })
    this.raf = this.autopilot ? (setTimeout(() => this.frame(performance.now()), 500) as unknown as number) : requestAnimationFrame(this.frame)
  }

  /** 조준선 화면 좌표. 터치면 화면 중앙에서 조준 방향으로 띄운다 */
  private aimCursor(): { x: number; y: number } {
    if (!this.touch) return this.input.mouse
    const me = this.state.players[this.cfg.localPlayer]
    const r = angleToRad(me.aim)
    // 표적이 있으면 조준선을 **실제 조준점**(표적 위, 일부러 넣은 흔들림 포함)에 그린다 —
    // 폰에서는 사람이 이동과 사격만 하므로, 자동 조준이 어디를 겨누는지 보여야 한다 (2026-09-05)
    if (me.aimDist > 0) {
      const ax = me.x + Math.cos(r) * me.aimDist
      const ay = me.y + Math.sin(r) * me.aimDist
      return this.renderer.worldToScreen(ax * U, 0.6, ay * U)
    }
    const d = worldDirToScreen(Math.cos(r), Math.sin(r))
    const len = Math.hypot(d.x, d.y) || 1
    return { x: VIEW_W / 2 + (d.x / len) * 190, y: VIEW_H / 2 + (d.y / len) * 190 }
  }

  private subLabel(i: number): string {
    // 캐릭터 이름은 점수판 이름 줄에 "닉네임(캐릭터)" 로 들어가므로 여기서는 역할만
    if (i === this.cfg.localPlayer) return '나'
    if (this.arena) {
      const ally = isTeamMatch(this.state) && this.state.players[i].team === this.state.players[this.cfg.localPlayer].team
      if (this.cfg.mode === 'solo' || this.cfg.bots?.[i]) return `AI · ${DIFFICULTY_LABEL[this.cfg.difficulty ?? 'normal']}${ally ? ' · 아군' : ''}`
      return ally ? '아군' : '상대'
    }
    if (this.cfg.mode === 'solo' || this.cfg.bots?.[i]) return `동료 봇 · ${DIFFICULTY_LABEL[this.cfg.difficulty ?? 'normal']}`
    return '동료'
  }

  /** 버튼이 여러 개인 분기에서 통계 표를 붙이기 쉽게 */
  private showOverlayWithStats(
    title: string,
    desc: string,
    stats: string,
    buttons: { label: string; primary: boolean; onClick: () => void }[],
  ): void {
    this.showOverlay(title, desc, buttons, stats)
  }

  /** 결과 화면 통계표 (투기장만 — 던전에는 결과 화면이 없다) */
  private statsTable(): string {
    return this.arenaTable()
  }

  /** 투기장 결과표 (덕 그대로): 킬 · 데스 · 연속 · 명중 · 헤드 · 준/받은 피해 */
  private arenaTable(): string {
    const teams = isTeamMatch(this.state)
    const rows = this.state.players
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => !p.vacant)
      .sort((a, b) => b.p.kills - a.p.kills || a.p.deaths - b.p.deaths)
      .map(({ p, i }) => {
        const acc = p.shots > 0 ? Math.round((p.hits / p.shots) * 100) : 0
        const headPct = p.hits > 0 ? Math.round((p.heads / p.hits) * 100) : 0
        const me = i === this.cfg.localPlayer ? ' class="me"' : ''
        const team = teams ? `<td>${p.team === 0 ? 'A팀' : 'B팀'}</td>` : ''
        return `<tr${me}><td class="nick">${this.names[i]}</td>${team}<td>${CHARACTERS[p.char].name}</td>
          <td class="n">${p.kills}</td><td class="n">${p.deaths}</td><td class="n">${p.bestStreak}</td>
          <td class="n">${acc}%</td><td class="n">${headPct}%</td>
          <td class="n">${Math.round(p.dmgDealt)}</td><td class="n">${Math.round(p.dmgTaken)}</td></tr>`
      })
      .join('')
    return `<div class="stats"><table>
      <thead><tr><th>이름</th>${teams ? '<th>팀</th>' : ''}<th>캐릭터</th><th>킬</th><th>데스</th><th>연속</th><th>명중</th><th>헤드</th><th>준 피해</th><th>받은 피해</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <p class="statsnote">명중률은 탄 단위입니다 (산탄총 한 발 = 탄 7개). 연속은 죽지 않고 이어 간 최다 킬.</p></div>`
  }

  /**
   * 투기장 팀전 중단 (덕 규칙): 누가 나가면 그 자리에서 끝내고 결과표를 띄운다. 승자는 그때까지의 팀 킬.
   */
  private abortMatch(gone: number): void {
    if (this.state.phase === 'over' || this.disposed) return
    const p = this.state.players[gone]
    if (p) {
      p.left = true
      this.dropped.add(gone)
      this.lockstep?.drop(gone)
    }
    const k0 = teamKills(this.state, 0)
    const k1 = teamKills(this.state, 1)
    const winner = k0 === k1 ? -1 : k0 > k1 ? 0 : 1
    this.state.phase = 'over'
    this.state.winner = winner
    this.message = ''
    const myTeam = this.state.players[this.cfg.localPlayer].team
    const title = winner < 0 ? '경기 중단 · 무승부' : winner === myTeam ? '경기 중단 · 우세승' : '경기 중단 · 열세'
    this.showOverlay(title, `${this.names[gone]} 님이 나가서 팀전을 끝냈습니다 · A팀 ${k0} : ${k1} B팀`, [{ label: '로비로', primary: true, onClick: () => this.exit() }], this.statsTable())
    this.paused = true
  }

  /** 빠른 감정 표현. 1.2초에 한 번. sim 밖(컨트롤 메시지) */
  private sendEmote(id: number): void {
    const lp = this.cfg.localPlayer
    const me = this.state.players[lp]
    if (!me || me.left) return
    const now = performance.now()
    if (now - this.lastEmoteAt < 1200) return
    this.lastEmoteAt = now
    this.renderer.showEmote(lp, id)
    this.cfg.link?.sendCtl({ t: 'emote', p: lp, id })
  }

  /**
   * 팀 신호를 찍는다. 커서(=조준하는 지면)를 같은 편에게 알린다.
   * sim 밖(컨트롤 메시지)이라 결정론에 영향이 없고, 봇전에서는 내 화면에만 남는다.
   */
  private sendMark(): void {
    const lp = this.cfg.localPlayer
    const me = this.state.players[lp]
    if (!me || !me.alive) return
    const c = this.input.mouse
    const w = this.renderer.screenToWorld(c.x, c.y)
    this.renderer.addMark(w.x, w.y)
    this.sfx.mark()
    this.cfg.link?.sendCtl({ t: 'mark', p: lp, x: Math.round(w.x), y: Math.round(w.y) })
  }

  /**
   * 진행 중인 방에 새로 들어오겠다는 요청(호스트만 처리).
   * 비어 있는 자리를 찾아 **앞선 틱 T** 를 정해 모두에게 알리고, T 에 그 자리를 채운다.
   * 그 사람에게는 T 시점의 판 전체를 보내 준다(재입장과 같은 길).
   */
  private onJoinAsk(char: CharacterId, name: string, peerId: string, sheet?: Sheet): void {
    if (this.state.phase === 'over') {
      this.cfg.link?.sendCtl({ t: 'rejoinNo', why: '이미 끝난 판입니다' }, peerId)
      return
    }
    // 투기장 팀전은 난입 불가 — 짝이 안 맞는다 (덕 규칙)
    if (isTeamMatch(this.state)) {
      this.cfg.link?.sendCtl({ t: 'rejoinNo', why: '팀전에는 난입할 수 없습니다' }, peerId)
      return
    }
    // 같은 사람이 다시 물어봤다 (연결이 늦어 두 번 보냈거나 버튼을 두 번 눌렀다): 이미 배정 중이면 그대로 둔다
    const seated = this.peerIndex.get(peerId)
    if (seated !== undefined && !this.dropped.has(seated)) return
    if (this.pendingRejoin) {
      if (this.pendingRejoin.peerId === peerId) return
      this.cfg.link?.sendCtl({ t: 'rejoinNo', why: '다른 사람이 먼저 들어오는 중입니다' }, peerId)
      return
    }
    // 아무도 없는 자리 찾기
    let slot = -1
    for (let i = 0; i < this.state.players.length; i++) {
      if (this.state.players[i].left) {
        slot = i
        break
      }
    }
    if (slot < 0) {
      this.cfg.link?.sendCtl({ t: 'rejoinNo', why: '자리가 없습니다' }, peerId)
      return
    }
    // 이제 그 사람의 입력 패킷을 이 자리 것으로 받는다 (아직 기다리지는 않는다 — 자리는 dropped 그대로)
    this.peerIndex.set(peerId, slot)
    // 다음에 난입하는 사람에게 넘겨줄 목록에도 넣는다 (빠지면 그 사람이 이 사람 입력을 못 받는다)
    if (this.cfg.peerIds) this.cfg.peerIds[slot] = peerId
    this.pendingRejoin = {
      peerId,
      p: slot,
      char,
      team: slot,
      name,
      sheet,
      sent: false,
      ready: false,
      deadline: performance.now() + Session.JOIN_TIMEOUT_MS,
    }
  }

  /**
   * 호스트, 매 틱: 난입 진행. 판을 보내고 → 준비를 기다리고 → 준비되면 활성화 틱을 방송하고 → 늦으면 끊는다.
   * 기존 사람들은 이 사이 어느 단계에서도 그 자리를 기다리지 않는다.
   */
  private serveJoin(): void {
    const r = this.pendingRejoin
    if (!r) return
    if (!r.sent) {
      r.sent = true
      const cfg = {
        chars: this.cfg.chars,
        teams: this.cfg.teams,
        names: this.cfg.names ?? [],
        targetKills: this.cfg.targetKills ?? 0,
        deathRule: this.cfg.deathRule ?? 0,
        tier: this.cfg.tier ?? 0,
        kind: this.cfg.kind ?? 'dungeon',
        seed: this.cfg.seed,
        map: this.cfg.mapId ?? DEFAULT_MAP,
        scale: this.arena ? this.mapOf(0).scale : 1,
        delay: this.cfg.delay ?? 3,
        peerIds: this.cfg.peerIds ?? [],
        bots: this.cfg.bots,
        difficulty: this.cfg.difficulty,
      }
      // 자리 정보(캐릭터·이름)는 joinLive 때 확정한다. 지금은 판만 준다
      this.cfg.link?.sendCtl({ t: 'resume', p: r.p, tick: this.state.tick, state: snapshot(this.state), cfg }, r.peerId)
      return
    }
    // 준비됐고, 그 사람 입력 패킷이 실제로 오고 있고, **판도 거의 따라잡았다** → 조금 뒤 틱에 모두 같이 자리를 채운다.
    // 따라잡기 전에 활성화하면 활성화 틱에서 모두가 그 사람 입력을 기다린다 (실측 0.45초 멈춤).
    const caughtUp = (this.lockstep?.latestFrom(r.p) ?? -1) >= this.state.tick - 10
    if (r.ready && caughtUp && this.lockstep?.heardFrom(r.p)) {
      const tick = this.state.tick + Session.JOIN_LEAD_TICKS
      const live = { t: 'joinLive' as const, p: r.p, tick, char: r.char, team: r.team, name: r.name, id: r.peerId, sheet: r.sheet }
      this.cfg.link?.sendCtl(live)
      this.pendingJoins.push({ p: r.p, tick, char: r.char, team: r.team, name: r.name, sheet: r.sheet })
      this.pendingRejoin = null
      return
    }
    // 늦으면 끊는다. 기존 사람들 판은 아무 영향이 없다 (그 자리는 계속 빈 자리였다)
    if (performance.now() > r.deadline) this.cancelJoin(r.peerId, true)
  }

  /**
   * 호스트: 난입자의 배정을 물리고 모두에게 알린다.
   * kick 이면(준비가 늦었다) 그 사람에게도 알려 로비로 돌려보낸다 — 붙잡고 기다리지 않는다.
   */
  private cancelJoin(peerId: string, kick: boolean): void {
    const r = this.pendingRejoin
    if (!r) return
    this.pendingRejoin = null
    this.applyJoinCancel(r.p, peerId)
    this.cfg.link?.sendCtl({ t: 'joinCancel', p: r.p, id: peerId })
    if (kick) this.cfg.link?.sendCtl({ t: 'rejoinNo', why: '연결이 늦어 들어가지 못했습니다. 다시 시도해 보세요.' }, peerId)
  }

  /** 모두: 자리 p 의 배정을 물린다 — 그 자리 입력을 다시 기다리지 않는다. 내가 그 사람이면 로비로 */
  private applyJoinCancel(p: number, peerId: string): void {
    this.pendingJoins = this.pendingJoins.filter((j) => j.p !== p)
    if (this.peerIndex.get(peerId) === p) this.peerIndex.delete(peerId)
    if (this.cfg.peerIds && this.cfg.peerIds[p] === peerId) this.cfg.peerIds[p] = ''
    this.lockstep?.drop(p)
    if (this.joiningIn && peerId === this.cfg.link?.selfId) this.leaveAsRejected('연결이 늦어 들어가지 못했습니다')
  }

  /** 난입자: 호스트가 받아 주지 않았다 → 로비로 */
  private leaveAsRejected(why: string): void {
    if (this.disposed) return
    this.paused = true
    this.showOverlay('들어가지 못했습니다', `${why}. 잠시 뒤 다시 시도해 보세요.`, [
      { label: '로비로', primary: true, onClick: () => this.exit() },
    ])
  }

  /**
   * 난입자: 호스트가 준 피어 목록(자리에 있는 사람들)과 전부 연결되면 호스트에게 알린다.
   * 호스트는 이걸 받고 나서야 활성화 틱을 정한다 — 그래야 어느 게스트도 내 입력을 못 받아 멈추는 일이 없다.
   */
  private checkJoinReady(): void {
    if (!this.joiningIn || this.joinReadySent) return
    const link = this.cfg.link
    if (!link) return
    const ids = this.cfg.peerIds ?? []
    const need = this.state.players.map((p, i) => (p.left ? '' : ids[i] ?? '')).filter((id) => id && id !== link.selfId)
    if (need.some((id) => !link.peers.has(id))) return
    this.joinReadySent = true
    link.sendCtl({ t: 'joinReady' }, ids[0])
    this.message = '연결 완료 · 자리를 기다리는 중…'
  }

  /** 정해진 틱이 되면 자리를 채운다 (모두가 같은 틱에) */
  private applyJoins(): void {
    if (this.pendingJoins.length === 0) return
    const t = this.state.tick
    const keep: typeof this.pendingJoins = []
    for (const j of this.pendingJoins) {
      if (j.tick <= t) {
        const js = j.sheet ? sanitizeSheet(j.sheet) : undefined
        const jt = this.state.tier ?? 0
        joinPlayer(this.state, this.mapOf, j.p, j.char, j.team, js ? { ...js, quests: tierQuests(js, jt), wps: jt > 0 ? (js.twps?.[jt] ?? 0) : js.wps } : undefined)
        this.cfg.chars[j.p] = j.char
        if (this.cfg.names) this.cfg.names[j.p] = j.name
        if (this.cfg.teams) this.cfg.teams[j.p] = j.team
        this.names = this.computeNames()
        this.makeBotFor(j.p)
        this.dropped.delete(j.p)
        // 이 틱 전의 입력은 모두 빈 입력으로 (난입자는 관전 중에도 입력을 보내고 있었다)
        this.lockstep?.activate(j.p, j.tick)
      } else keep.push(j)
    }
    this.pendingJoins = keep
  }

  /** 난입한 자리의 봇 기억을 새로 만든다 (봇이 조종하던 자리였을 수 있다) */
  private makeBotFor(idx: number): void {
    this.bots[idx] = this.newBot((this.cfg.seed ^ 0x9e37) + idx * 7919 + this.state.tick)
  }

  /**
   * 관전 대상 후보: 나를 뺀 살아 있는 사람 중 from 다음 사람.
   * **팀전에서는 아군만** 본다 — 상대 시점을 보면 적 위치가 그대로 드러나 팀전이 성립하지 않는다.
   * 개인전은 누구든 볼 수 있다(어차피 곧 리스폰하고, 배우는 재미가 있다).
   */
  private nextAlive(from: number): number {
    const n = this.state.players.length
    const teams = isTeamMatch(this.state)
    const myTeam = this.state.players[this.cfg.localPlayer].team
    for (let k = 1; k <= n; k++) {
      const i = (from + k + n) % n
      const p = this.state.players[i]
      if (i === this.cfg.localPlayer || !p.alive || p.left) continue
      if (teams && p.team !== myTeam) continue
      return i
    }
    return -1
  }

  /** 지금 볼 수 있는 사람 수 (안내 문구에 "바꾸기" 를 넣을지 정한다) */
  private spectateCandidates(): number {
    let c = 0
    for (const p of this.state.players) {
      if (p.id === this.cfg.localPlayer || !p.alive || p.left) continue
      c++
    }
    return c
  }

  private onOver(): void {
    const w = this.state.winner
    const lp = this.cfg.localPlayer
    setTimeout(() => {
      if (this.disposed) return
      // 던전은 끝이 없다 — 판이 끝나는 것은 하드코어로 모두 탈락했을 때뿐 (결과표 없이 로비로)
      if (!this.arena) {
        this.showOverlay('모두 쓰러졌다', '하드코어 — 마지막으로 마을에 들어온 뒤 얻은 것은 저장되지 않았습니다.', [{ label: '로비로', primary: true, onClick: () => this.exit() }])
        return
      }
      const won = this.state.players[lp].team === w
      const desc = isTeamMatch(this.state)
        ? `${w === 0 ? 'A팀' : 'B팀'} 승리 · A팀 ${teamKills(this.state, 0)} : ${teamKills(this.state, 1)} B팀`
        : this.state.players.map((p, i) => `${this.names[i]} ${p.kills}`).join(' · ')
      const stats = this.statsTable()
      const again = () => {
        const seed = (Math.random() * 0xffffffff) >>> 0
        if (this.isHost) this.cfg.link?.sendCtl({ t: 'rematch', seed })
        this.restart(seed)
      }
      const btns = [
        { label: '다시 하기', primary: true, onClick: again },
        { label: '로비로', primary: false, onClick: () => this.exit() },
      ]
      if (this.cfg.mode === 'solo') this.showOverlay(won ? '승리!' : '패배', desc, btns, stats)
      else if (this.isHost) this.showOverlayWithStats(won ? '승리!' : '패배', desc, stats, btns)
      else this.showOverlay(won ? '승리!' : '패배', desc + ' · 방장이 다시 시작하길 기다리는 중', [{ label: '로비로', primary: false, onClick: () => this.exit() }], stats)
    }, 2200)
  }


  private exit(): void {
    this.saveMine(true)
    if (this.cfg.link) this.cfg.link.sendCtl({ t: 'leave' })
    this.dispose()
    this.cfg.onExit()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.voice?.dispose()
    this.voice = null
    window.removeEventListener('keyup', this.onKeyUp)
    clearInterval(this.lobbyBeacon)
    if (this.cfg.lobby) {
      // 방송만 거둔다. 통로는 페이지 공용이라 닫지 않는다 — 닫으면 다음 로비의 새 방이 남에게 안 보인다(main.ts 주석, 2026-09-06)
      this.cfg.lobby.announce(null)
    }
    cancelAnimationFrame(this.raf)
    this.ticker.stop()
    this.input.dispose()
    this.inventory.dispose()
    this.touch?.dispose()
    this.sfx.dispose()
    window.removeEventListener('keydown', this.onKey)
    window.removeEventListener('resize', this.fit)
    this.renderer.dispose()
    this.root.remove()
    // 게임 방 통로를 **닫는다**(2026-09-06). 전에는 안 닫아서 페이지가 그 방에 계속 붙어 있었고, 같은 방에 다시 난입하면
    // Trystero 가 캐시한 옛 방을 돌려줘 피어 연결 이벤트가 안 나 joinAsk 를 보내지 못했다 → 15초 뒤 "연결되지 않았습니다".
    // 방금 보낸 leave 메시지가 나갈 짬을 준 뒤 닫는다
    const link = this.cfg.link
    if (link) setTimeout(() => link.leave(), 300)
  }
}
