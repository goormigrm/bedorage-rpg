// 효과음·배경음. 파일 없이 Web Audio 로 절차 생성한다 (오실레이터 + 노이즈 + 필터).
// sim 을 바꾸지 않는다: SimEvent 를 받아 소리만 낸다. 나중에 public/sfx/ 에 파일이 생기면 여기서 교체하면 된다.
// 브라우저 자동재생 정책: 첫 클릭/키 입력 전에는 소리가 나지 않는다 (그 전 이벤트는 버린다).

import { GameState, SPRINT_MUL, SimEvent } from '../core/state'
import { CHARACTERS } from '../core/characters'
import { WEAPONS, WeaponId } from '../core/weapons'
import { MONSTER_LIST, BOSS_PATS } from '../core/monsters'
import { worldDirToScreen } from '../render3d/camera'

const STORAGE_KEY = 'brpg.muted'
const MASTER = 0.8
const BGM_LEVEL = 0.15

interface Spatial {
  gain: number
  /** -1(왼쪽) ~ +1(오른쪽). **화면 기준**이라 헤드폰으로 들으면 보이는 방향과 일치한다 */
  pan: number
  /** 0(가까움) ~ 1(멂). 멀수록 고음을 깎아 거리감을 준다 */
  far: number
}

/**
 * 듣는 사람 기준 상대 위치(월드) → 스테레오 배치.
 * **화면 기준으로 돌려서** 패닝한다. 카메라가 45° 돌아가 있어 월드 x 를 그대로 쓰면
 * 헤드폰에서 들리는 방향과 눈에 보이는 방향이 어긋난다.
 */
/**
 * 2026-09-19 "게임 중에 갑자기 소리가 안 들리다가 시간이 지나면 다시 들린다" — 재현은 못 했고 아래 셋을 막는다:
 *  ① 위치가 없는 이벤트(NaN)로 gain 에 NaN 을 넣으면 예외가 나 그 프레임의 소리가 모두 빠졌다 → 가운데 소리로
 *  ② 떼 전투에서 음원이 수백 개 겹치면 오디오 스레드가 밀려 소리가 끊긴다 → 한 프레임 남의 소리 16개 · 동시 음원 140개까지
 *  ③ 오디오 장치가 바뀌거나 잠들어 AudioContext 가 멈추면(suspended) 키를 누를 때까지 조용했다 → statechange 에서 바로 되살린다
 * 상태는 `__bd.audio()` 로 본다 (멈춘 적 · 버린 소리 수).
 */
// 2026-09-23 사용자: "몹이 많이 소환됐을 때 소리가 버벅거린다 — 렉은 없었던 것 같은데".
// 원인: 괴물 휘두르기 · 투사체 · 맞음 · 폭발 소리에 되풀이 제한이 없어, 후원으로 괴물이 백 마리 가까이 몰리면
// 한 프레임 16개(초당 수백 개)씩 소리가 새로 생겼다. 소리 하나에 노드가 5~7개(음량 · 좌우 · 필터 · 음원)라
// 화면(메인 스레드)은 멀쩡한데 **오디오 스레드만 밀려** 끊겼다. → 동시 음원 · 한 프레임 · 초당 개수를 모두 줄이고,
// 같은 종류 소리는 짧은 간격 안에 하나만 낸다.
const MAX_LIVE = 56
const FRAME_BUDGET = 6
/** 남의 소리 초당 상한 (토큰 통 — 한꺼번에는 FRAME_BUDGET 까지, 오래 두고는 초당 이만큼) */
const OTHER_PER_SEC = 36
/** 이보다 멀면(px) 남의 소리는 내지 않는다 — 화면 밖 멀리서 나는 소리는 어차피 작다 */
const FAR_CULL = 760
/** 버리지 않는 소리 (드물고 중요하다) */
const KEEP = new Set(['start', 'over', 'levelup', 'death', 'down', 'revive', 'respawn', 'loot', 'pickup', 'equip', 'drop'])

function spatial(wdx: number, wdy: number): Spatial {
  if (!Number.isFinite(wdx) || !Number.isFinite(wdy)) return { gain: 1, pan: 0, far: 0 }
  const d = Math.hypot(wdx, wdy)
  const s = worldDirToScreen(wdx, wdy)
  const sl = Math.hypot(s.x, s.y) || 1
  // 좌우 성분이 클수록 강하게 치우친다. 정면·후면(세로 성분)은 가운데로.
  const lr = s.x / sl
  const near = Math.min(1, d / 90) // 아주 가까우면 가운데 (귀에 붙는 느낌 방지)
  return {
    gain: Math.max(0.12, 1 / (1 + (d / 420) ** 1.7)),
    pan: Math.max(-0.9, Math.min(0.9, lr * 0.9 * near)),
    far: Math.max(0, Math.min(1, (d - 260) / 900)),
  }
}

export class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private bgmGain: GainNode | null = null
  private noise: AudioBuffer | null = null
  private mutedFlag: boolean
  private lastWall = 0
  /** 같은 종류 괴물 소리의 마지막 시각 (휘두르기 · 투사체 · 맞음 · 폭발) */
  private lastSwipe = 0
  private lastMShot = 0
  private lastShotEnd = 0
  private lastBoom = 0
  /** 남의 소리 토큰 (초당 OTHER_PER_SEC 만큼 찬다) */
  private tokens = OTHER_PER_SEC
  private tokenAt = 0
  /** 몬스터 소리 되풀이 제한 (무리 전투에서 같은 소리가 수십 번 겹치면 귀가 아프다) */
  private lastMHit = 0
  private lastMDeath = 0
  private lastMelee = 0
  private lastKill = 0
  /** 괴물 목소리 되풀이 제한 (ms 시각): 아무 괴물 · 종류마다 · 보스 · 곁의 괴물 옆 소리 */
  private lastVoice = 0
  private kindVoice = new Map<number, number>()
  private lastBossRoar = 0
  private nextIdle = 0
  /** 보스 대사 소리 (public/voice/boss_<종류>.wav) · 받는 중 · 긴 잔향 임펄스 (처음 쓸 때 만든다) */
  private lineBufs = new Map<number, AudioBuffer | null>()
  private lineLoading = new Set<number>()
  private verbIr: AudioBuffer | null = null
  private lastCountdownSec = -1
  private unlockOff: (() => void) | null = null
  private bgmTimer = 0
  private bgmNextBeat = 0
  private bgmBeatIndex = 0
  private bgmOn = false
  /** 보스전 (0 = 아님 · 1 = 싸우는 중 · 2 = 성남 — 체력 30% 아래). 던전 배경음이 보스 곡으로 바뀐다 (2026-09-19 M7) */
  private boss = 0
  /** 교전 강도 0..1 (배경음 레이어) */
  private intensity = 0
  /** 발소리: 플레이어별 걸음 위상(0~1). 1 을 넘을 때마다 한 걸음 */
  private stepPhase: number[] = []
  /** 발소리 좌우 번갈아 */
  private stepFlip: boolean[] = []
  /** 지금 울리는 음원 수 · 버린 소리 수 · AudioContext 가 멈췄던 횟수 (진단 — __bd.audio()) */
  private live = 0
  private dropped = 0
  private stalls = 0

  constructor() {
    // 음성 합성 목소리 목록은 처음 부를 때 늦게 채워진다 — 미리 한 번 불러 둔다 (보스 대사 TTS)
    try {
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.getVoices()
    } catch {
      /* 음성 합성 없음 */
    }
    let m = false
    try {
      m = localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      /* 저장소 없음 */
    }
    this.mutedFlag = m
    const unlock = () => {
      if (this.ensure() && this.ctx && this.ctx.state !== 'running') void this.ctx.resume()
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    this.unlockOff = () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }

  get muted(): boolean {
    return this.mutedFlag
  }

  setMuted(v: boolean): void {
    this.mutedFlag = v
    try {
      localStorage.setItem(STORAGE_KEY, v ? '1' : '0')
    } catch {
      /* 무시 */
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v ? 0 : MASTER, this.ctx.currentTime, 0.02)
  }

  toggle(): boolean {
    this.setMuted(!this.mutedFlag)
    return this.mutedFlag
  }

  private ensure(): boolean {
    if (this.ctx) return true
    if (typeof AudioContext === 'undefined') return false
    // 버퍼를 한 단계 넉넉하게 (2026-09-23 — 괴물이 몰려 CPU 가 바쁠 때 소리가 끊기던 것). 효과음이 20ms 안팎 늦는 대신 덜 끊긴다
    let ctx: AudioContext
    try {
      ctx = new AudioContext({ latencyHint: 'balanced' })
    } catch {
      ctx = new AudioContext()
    }
    const master = ctx.createGain()
    master.gain.value = this.mutedFlag ? 0 : MASTER
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.knee.value = 18
    comp.ratio.value = 6
    comp.attack.value = 0.003
    comp.release.value = 0.16
    master.connect(comp)
    comp.connect(ctx.destination)
    const bgm = ctx.createGain()
    bgm.gain.value = BGM_LEVEL
    bgm.connect(master)
    const len = ctx.sampleRate
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    this.ctx = ctx
    this.master = master
    this.bgmGain = bgm
    this.noise = buf
    // 장치가 바뀌거나 잠들어 멈추면 바로 되살린다 (한 번이라도 누른 페이지는 몸짓 없이도 resume 된다)
    ctx.onstatechange = () => {
      if (ctx.state === 'running' || ctx.state === 'closed' || this.ctx !== ctx) return
      this.stalls++
      console.info(`[소리] AudioContext ${ctx.state} — 다시 켭니다`)
      void ctx.resume().catch(() => {})
    }
    if (this.bgmOn) this.startBgmScheduler()
    return true
  }

  private ready(): boolean {
    return this.ensure() && this.ctx !== null && this.ctx.state === 'running' && !this.mutedFlag
  }

  /**
   * 발소리. sim 에는 발소리 이벤트가 없으므로(틱마다 생기면 패킷·해시가 무거워진다)
   * 여기서 이동 상태를 보고 걸음 위상을 직접 굴린다. 소리만 내므로 sim 과 무관하다.
   * 대시(구르기) 중에는 발소리 대신 구르는 소리가 이미 나므로 건너뛴다.
   */
  updateSteps(state: GameState, localPlayer: number, dt: number): void {
    if (!this.ready() || state.phase !== 'playing') return
    const n = state.players.length
    if (this.stepPhase.length !== n) {
      this.stepPhase = new Array(n).fill(0)
      this.stepFlip = new Array(n).fill(false)
    }
    let lx = 0
    let ly = 0
    const me = localPlayer >= 0 ? state.players[localPlayer] : null
    if (me) {
      lx = me.x
      ly = me.y
    }
    for (let i = 0; i < n; i++) {
      const p = state.players[i]
      if (!p.alive || p.left || !p.moving || p.dashTimer > 0 || WEAPONS[p.weapon].suppressed) {
        // 소음기 무기(권총)를 든 사람은 발소리가 안 난다 — 소리로 위치가 안 새는 은신형 (2026-09-05)
        this.stepPhase[i] = 0.55 // 멈췄다 다시 걸으면 곧바로 한 걸음
        continue
      }
      // 캐릭터 속도에 맞춰 보폭을 조절한다 (빠를수록 자주)
      const c = CHARACTERS[p.char]
      const w = WEAPONS[p.weapon]
      let speed = c.speed * w.moveMul
      if (p.sprinting) speed *= SPRINT_MUL // 달리면 발소리도 빨라진다
      if (p.ads) speed *= 0.6
      if (p.legInjury > 0) speed *= 0.7
      this.stepPhase[i] += dt * (speed * 0.78)
      if (this.stepPhase[i] < 1) continue
      this.stepPhase[i] -= 1
      // 내 발소리는 항상 가운데에서 작게, 남의 발소리는 방향·거리대로
      const sp: Spatial = i === localPlayer ? { gain: 0.5, pan: 0, far: 0 } : spatial(p.x - lx, p.y - ly)
      if (sp.gain < 0.14) continue // 너무 멀면 생략 (소리 폭주 방지)
      this.stepFlip[i] = !this.stepFlip[i]
      this.foot(sp, this.stepFlip[i], i === localPlayer)
    }
  }

  /**
   * 한 걸음: 낮은 "툭" 하나. 좌우 발을 조금 다르게 해서 기계적이지 않게.
   *
   * 2026-09-20 사용자: "걸을 때 약간 지지직거리는 소리가 들려 — 이런 소리는 안 나오게".
   * 그 지지직은 발소리에 얹었던 **고음 노이즈 스침**(bandpass 2100→700Hz)이었다. 걸음마다 나니 치찰음처럼 들린다.
   * 노이즈를 빼고 낮은 소리만 남긴다. 어택도 2ms → 6ms 로 늘려 시작의 딸깍(클릭)을 없앤다.
   */
  private foot(s: Spatial, right: boolean, mine: boolean): void {
    const { node, t0 } = this.bus(s, mine ? 0.26 : 0.55)
    const f = right ? 126 : 112
    this.tone(node, t0, 0.07, 'sine', f, f * 0.5, 0.42, 0.006)
  }

  // ---------- 이벤트 ----------
  onEvents(events: SimEvent[], state: GameState, localPlayer: number): void {
    // 카운트다운 초 알림은 이벤트가 아니라 상태에서
    if (state.phase === 'countdown') {
      const sec = Math.ceil(state.phaseTimer / 60)
      if (sec !== this.lastCountdownSec) {
        this.lastCountdownSec = sec
        if (sec > 0 && sec <= 3 && this.ready()) this.tick(sec)
      }
    } else {
      this.lastCountdownSec = -1
    }
    // 보스전: 보는 지역에 깨어 있는 막 보스(우두머리는 빼고)가 있으면 배경음을 보스 곡으로. 쓰러뜨리면 승리음
    if (state.mode === 'dungeon') {
      let b = 0
      for (const m of state.monsters) {
        if (m.hp > 0 && m.st !== 0 && MONSTER_LIST[m.kind].boss) {
          b = m.hp < m.maxHp * 0.3 ? 2 : 1
          // 깬 보스의 대사 소리를 미리 받는다 (즉사기는 깬 뒤 20초 — 넉넉하다)
          this.loadLine(m.kind)
          break
        }
      }
      if (b === 0 && this.boss > 0 && this.ready() && events.some((e) => e.type === 'mdeath' && MONSTER_LIST[e.kind]?.boss)) this.bossWin()
      this.boss = b
    }
    // 곁의 괴물 옆 소리 (좀비의 그르릉 · 늑대의 으르렁 …) — 1초에 하나 안팎
    if (state.mode === 'dungeon' && !this.mutedFlag && this.ready()) this.ambientVoice(state, localPlayer)
    if (events.length === 0) return
    // 멈춰 있으면 되살린다 (onstatechange 를 놓친 경우)
    if (this.ctx && this.ctx.state === 'suspended' && !this.mutedFlag) void this.ctx.resume().catch(() => {})
    if (!this.ready()) return
    let budget = FRAME_BUDGET
    // 듣는 위치: 나, 관전이면 산 사람들의 중심
    let lx = 0
    let ly = 0
    if (localPlayer >= 0 && state.players[localPlayer]) {
      lx = state.players[localPlayer].x
      ly = state.players[localPlayer].y
    } else {
      let n = 0
      for (const p of state.players) {
        if (!p.alive) continue
        lx += p.x
        ly += p.y
        n++
      }
      if (n > 0) {
        lx /= n
        ly /= n
      }
    }
    const sp = (x: number, y: number): Spatial => spatial(x - lx, y - ly)
    const at = (p: number) => {
      const q = state.players[p]
      return sp(q.x, q.y)
    }
    // 토큰 채우기
    const tnow = performance.now()
    if (this.tokenAt > 0) this.tokens = Math.min(OTHER_PER_SEC, this.tokens + ((tnow - this.tokenAt) / 1000) * OTHER_PER_SEC)
    this.tokenAt = tnow
    for (const e of events) {
      // 남의 소리는 한 프레임 6개 · 초당 36개 · 동시에 56개까지 (내 소리와 드문 중요한 소리는 늘 낸다)
      const mineEv = 'p' in e && e.p === localPlayer
      if (!mineEv && !KEEP.has(e.type)) {
        const ex = (e as { x?: number }).x
        const ey = (e as { y?: number }).y
        const far = typeof ex === 'number' && typeof ey === 'number' && Number.isFinite(ex) && Number.isFinite(ey) && Math.hypot(ex - lx, ey - ly) > FAR_CULL
        if (far || this.live > MAX_LIVE || budget <= 0 || this.tokens < 1) {
          this.dropped++
          continue
        }
        budget--
        this.tokens -= 1
      }
      switch (e.type) {
        case 'fire':
          this.gun(e.weapon, sp(e.x, e.y), e.p === localPlayer)
          this.intensity = Math.min(1, this.intensity + 0.06)
          break
        case 'bash':
          this.gun('pan', sp(e.x, e.y), e.p === localPlayer) // 개머리판 휘두르기 = 후라이팬 소리
          break
        case 'pickup': {
          if (e.p !== localPlayer) break
          const b = this.bus({ gain: 1, pan: 0, far: 0 }, 0.5 + e.rarity * 0.15)
          // 등급이 높을수록 높고 긴 음 — 전설은 세 음 화음
          const f = [520, 660, 880, 990, 1175][e.rarity] ?? 990
          this.tone(b.node, b.t0, 0.12, 'triangle', f, f * 1.02, 0.35, 0.004)
          if (e.rarity >= 2) this.tone(b.node, b.t0 + 0.08, 0.2, 'sine', f * 1.5, f * 1.5, 0.3, 0.004)
          if (e.rarity >= 3) this.tone(b.node, b.t0 + 0.16, 0.4, 'sine', f * 2, f * 2, 0.3, 0.004)
          break
        }
        case 'loot': {
          // 전설이 떨어지면 따로 공들인 소리 (PLAN 6장)
          if (e.rarity < 3 || (e.owner !== localPlayer && e.owner !== -1)) break
          const b = this.bus(sp(e.x, e.y), 1)
          for (const [i, f] of [392, 523, 659, 784, 1047].entries()) this.tone(b.node, b.t0 + i * 0.07, 0.6, 'sine', f, f, 0.25, 0.01)
          break
        }
        case 'forge': {
          // 벼리기 (2026-09-20): 성공은 모루를 때리고 종이 울리듯 올라가는 음 · 실패는 둔탁하게 떨어진다
          if (e.p !== localPlayer) break
          const b = this.bus({ gain: 1, pan: 0, far: 0 }, 0.85)
          // 모루 소리 (둘 다 같다 — 벼리는 동작은 똑같으니)
          this.tone(b.node, b.t0, 0.09, 'triangle', 1400, 900, 0.22, 0.002)
          if (e.up) {
            const up = e.rarity >= 4 ? [784, 1047, 1319, 1568] : [659, 880, 1109]
            for (const [i, f] of up.entries()) this.tone(b.node, b.t0 + 0.12 + i * 0.1, 0.55, 'triangle', f, f, 0.26, 0.01)
          } else {
            for (const [i, f] of [330, 262].entries()) this.tone(b.node, b.t0 + 0.12 + i * 0.13, 0.4, 'sine', f, f * 0.85, 0.2, 0.01)
          }
          break
        }
        case 'levelup': {
          if (e.p !== localPlayer) break
          const b = this.bus({ gain: 1, pan: 0, far: 0 }, 0.9)
          for (const [i, f] of [523, 659, 784, 1047, 1319].entries()) this.tone(b.node, b.t0 + i * 0.09, 0.5, 'triangle', f, f, 0.3, 0.01)
          break
        }
        case 'equip':
          if (e.p === localPlayer) this.blip()
          break
        case 'hit':
          // 투기장: 플레이어가 플레이어를 맞힘 (덕 그대로)
          this.hit(sp(e.x, e.y), e.part === 0)
          break
        case 'skill': {
          // 스킬: 휙 + 높은 음. 궁극기는 세 음 화음을 더한다
          const b = this.bus(e.p === localPlayer ? { gain: 1, pan: 0, far: 0 } : sp(e.x, e.y), e.slot === 2 ? 1 : 0.7)
          this.noiseBurst(b.node, b.t0, 0.22, 'bandpass', 600, 3200, 0.45, 1.5)
          this.tone(b.node, b.t0, 0.18, 'triangle', 520, 880, 0.25, 0.004)
          if (e.slot === 2) for (const [i, f] of [330, 415, 494, 660].entries()) this.tone(b.node, b.t0 + 0.05 + i * 0.05, 0.5, 'sawtooth', f, f, 0.12, 0.01)
          break
        }
        case 'aoe': {
          const b = this.bus(sp(e.x, e.y), e.id === 'grenade' || e.id === 'roar' ? 1.1 : 0.7)
          if (e.id === 'flame') this.noiseBurst(b.node, b.t0, 0.45, 'bandpass', 900, 400, 0.6, 0.8)
          else if (e.id === 'oil') this.noiseBurst(b.node, b.t0, 0.3, 'highpass', 2600, 1800, 0.5)
          else {
            this.noiseBurst(b.node, b.t0, 0.55, 'lowpass', 1600, 110, 0.9)
            this.tone(b.node, b.t0, 0.4, 'sine', 110, 40, 0.6, 0.004)
          }
          break
        }
        case 'mhit': {
          const now = performance.now()
          // 근접(바이올린 · 검 · 후라이팬)은 무기에 맞는 타격음 — 한 번 휘둘러 여럿을 쳐도 한 번만 (2026-09-19 손맛)
          const by = e.by >= 0 ? state.players[e.by] : undefined
          const mw = by ? WEAPONS[by.weapon] : undefined
          if (mw?.melee) {
            if (now - this.lastMelee > 90) {
              this.lastMelee = now
              this.meleeHit(sp(e.x, e.y), e.crit, mw.family)
            }
            break
          }
          // 치명타는 늘 들리게, 보통 명중은 35ms 에 한 번
          if (e.crit || now - this.lastMHit > 35) {
            this.lastMHit = now
            this.hit(sp(e.x, e.y), e.crit)
          }
          break
        }
        case 'mdeath': {
          const now = performance.now()
          if (now - this.lastMDeath > 30) {
            this.lastMDeath = now
            this.squelch(sp(e.x, e.y))
          }
          // 쓰러지는 소리 (종류마다 — 짧게)
          this.voice(e.kind, 'death', sp(e.x, e.y), 0.55)
          // 손맛: 내가 잡았으면 묵직한 "퍽" (40ms 에 한 번)
          if (e.by === localPlayer && now - this.lastKill > 40) {
            this.lastKill = now
            this.killThump()
          }
          this.intensity = Math.min(1, this.intensity + 0.05)
          break
        }
        case 'wake':
        case 'windup': {
          // 괴물마다 제 소리 (2026-09-24 사용자: "좀비면 그르릉 · 늑대면 울음소리"): 깨어날 때 · 공격을 준비할 때
          const kind = e.type === 'wake' ? (e.kind ?? 0) : e.kind
          this.voice(kind, e.type === 'wake' ? 'wake' : 'attack', sp(e.x, e.y), e.type === 'wake' ? 0.9 : 0.6)
          if (e.type === 'wake') this.intensity = Math.min(1, this.intensity + 0.3)
          break
        }
        case 'swipe': {
          if (tnow - this.lastSwipe < 70) break
          this.lastSwipe = tnow
          const b = this.bus(sp(e.x, e.y), 0.55)
          this.noiseBurst(b.node, b.t0, 0.12, 'bandpass', 900, 2600, 0.5, 1.2)
          break
        }
        case 'mshot': {
          if (tnow - this.lastMShot < 60) break
          this.lastMShot = tnow
          const b = this.bus(sp(e.x, e.y), 0.6)
          this.tone(b.node, b.t0, 0.14, 'triangle', 760, 380, 0.35, 0.002)
          this.noiseBurst(b.node, b.t0, 0.06, 'highpass', 3000, 1500, 0.2)
          break
        }
        case 'shotEnd': {
          if (tnow - this.lastShotEnd < 60) break
          this.lastShotEnd = tnow
          const b = this.bus(sp(e.x, e.y), 0.4)
          this.noiseBurst(b.node, b.t0, 0.05, 'bandpass', 1400, 600, 0.3)
          break
        }
        case 'bossUlt': {
          // 보스의 포효 + 대사를 목소리로 (브라우저 음성 합성 — 설정 "보스 목소리") — 2026-09-24 사용자: "즉사기 대사에 TTS 나 특수한 소리"
          this.voice(e.kind, 'ult', sp(e.x, e.y), 1.1)
          // 가공한 대사 소리(울림 · 낮은 음) — 아직 못 받았으면 브라우저 음성 합성으로 (가공 없이)
          if (!this.bossLine(e.kind)) this.speak(BOSS_PATS[e.pat]?.line, e.kind)
          // 막 보스 즉사기 경보: 낮은 뿔피리 둘(어긋난 음) + 떨어지는 종 — 화면 경고와 같이 (2026-09-24)
          const b = this.bus({ gain: 1, pan: 0, far: 0 }, 1.0)
          this.tone(b.node, b.t0, 1.4, 'sawtooth', 98, 92, 0.32, 0.05)
          this.tone(b.node, b.t0, 1.4, 'sawtooth', 104, 97, 0.26, 0.05)
          this.tone(b.node, b.t0 + 0.05, 1.8, 'sine', 660, 330, 0.35, 0.004)
          this.tone(b.node, b.t0 + 0.7, 1.2, 'sine', 494, 247, 0.3, 0.004)
          this.intensity = 1
          break
        }
        case 'boom':
        case 'bzone': {
          // 부푼 시체 여럿이 한꺼번에 터지면 한 번의 큰 소리로 충분하다 (보스 광선 여러 갈래도 한 번)
          if (tnow - this.lastBoom < 90) {
            this.intensity = 1
            break
          }
          this.lastBoom = tnow
          const b = this.bus(sp(e.x, e.y), 1.1)
          this.noiseBurst(b.node, b.t0, 0.7, 'lowpass', 1400, 90, 1.0)
          this.tone(b.node, b.t0, 0.5, 'sine', 90, 32, 0.8, 0.004)
          this.intensity = 1
          break
        }
        case 'hurt': {
          if (e.p === localPlayer) {
            const b = this.bus({ gain: 1, pan: 0, far: 0 }, 0.7)
            this.tone(b.node, b.t0, 0.12, 'square', 220, 140, 0.18, 0.002)
            this.noiseBurst(b.node, b.t0, 0.08, 'lowpass', 900, 300, 0.4)
          }
          break
        }
        case 'down': {
          // 내려가는 세 음 — 누가 쓰러졌다
          const b = this.bus(e.p === localPlayer ? { gain: 1, pan: 0, far: 0 } : sp(e.x, e.y), 0.9)
          ;[520, 390, 260].forEach((f, i) => this.tone(b.node, b.t0 + i * 0.12, 0.2, 'triangle', f, f * 0.97, 0.36, 0.004))
          this.intensity = 1
          break
        }
        case 'revive': {
          const b = this.bus(sp(e.x, e.y), 0.9)
          ;[440, 554, 660, 880].forEach((f, i) => this.tone(b.node, b.t0 + i * 0.07, 0.2, 'sine', f, f * 1.01, 0.3, 0.004))
          break
        }
        case 'death':
          this.death(sp(e.x, e.y))
          this.intensity = 1
          break
        case 'respawn':
          this.respawn(sp(e.x, e.y))
          break
        case 'dash':
          this.dash(at(e.p))
          break
        case 'reload':
          this.reload(at(e.p))
          break
        case 'wall': {
          const now = performance.now()
          if (now - this.lastWall > 40) {
            this.lastWall = now
            this.wall(sp(e.x, e.y))
          }
          break
        }
        case 'drop': {
          const b = this.bus(sp(e.x, e.y), 0.5)
          this.tone(b.node, b.t0, 0.12, 'sine', 420, 300, 0.3, 0.004)
          break
        }
        case 'heal': {
          const b = this.bus(e.p === localPlayer ? { gain: 1, pan: 0, far: 0 } : sp(e.x, e.y), 0.8)
          // 올라가는 두 음 — 좋은 일이 생겼다는 신호
          this.tone(b.node, b.t0, 0.12, 'sine', 660, 680, 0.34, 0.004)
          this.tone(b.node, b.t0 + 0.09, 0.16, 'sine', 990, 1010, 0.3, 0.004)
          break
        }
        case 'block': {
          const b = this.bus(sp(e.x, e.y), 0.9)
          for (const f of [900, 1350, 1800]) this.tone(b.node, b.t0, 0.35, 'sine', f, f * 0.94, 0.24, 0.002)
          this.noiseBurst(b.node, b.t0, 0.05, 'highpass', 5000, 3000, 0.45)
          break
        }
        case 'break': {
          const b = this.bus(sp((e.tx + 0.5) * 32, (e.ty + 0.5) * 32), 0.9)
          this.noiseBurst(b.node, b.t0, 0.4, 'lowpass', 900, 200, 0.8)
          this.tone(b.node, b.t0, 0.3, 'triangle', 150, 50, 0.4)
          break
        }
        case 'start':
          this.start()
          break
        case 'over':
          this.over()
          break
        default:
          break
      }
    }
  }

  // ---------- 기본 부품 ----------
  /** 소리 한 묶음(bus)의 노드와, 그 묶음에 붙어 아직 울리는 음원 수 */
  private busRef = new WeakMap<AudioNode, { n: number; parts: AudioNode[] }>()

  /**
   * 음원이 끝나면 그 줄을 끊는다 (2026-09-23 — 소리 끊김). 전에는 소리 하나마다 만든 음량 · 좌우 · 필터 노드와
   * 배경음 음표 노드를 끝난 뒤에도 연결해 둔 채였다 — 오디오 스레드가 매 순간 훑는 그래프가 계속 커져,
   * 괴물이 몰리거나 오래 할수록 끊기기 쉬웠다. 묶음(bus)은 거기 붙은 음원이 모두 끝나면 끊는다.
   */
  private finish(src: AudioScheduledSourceNode, chain: AudioNode[], bus: AudioNode | null, counted: boolean): void {
    const ref = bus ? this.busRef.get(bus) : undefined
    if (ref) ref.n++
    if (counted) this.live++
    src.onended = () => {
      if (counted) this.live--
      src.disconnect()
      for (const n of chain) n.disconnect()
      if (ref && --ref.n <= 0) for (const n of ref.parts) n.disconnect()
    }
  }

  private bus(s: Spatial, vol: number): { node: GainNode; t0: number } {
    const ctx = this.ctx!
    const g = ctx.createGain()
    g.gain.value = vol * s.gain
    const pan = ctx.createStereoPanner()
    pan.pan.value = s.pan
    g.connect(pan)
    // 멀수록 고음을 깎는다. 좌우(패닝)만으로는 거리가 안 느껴지기 때문 — 공기 흡수 흉내.
    if (s.far > 0.15) {
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 16000 - 13000 * s.far
      pan.connect(lp)
      lp.connect(this.master!)
      this.busRef.set(g, { n: 0, parts: [g, pan, lp] })
    } else {
      pan.connect(this.master!)
      this.busRef.set(g, { n: 0, parts: [g, pan] })
    }
    return { node: g, t0: ctx.currentTime }
  }

  private env(g: GainNode, t0: number, peak: number, attack: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.linearRampToValueAtTime(peak, t0 + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay)
  }

  private noiseBurst(bus: AudioNode, t0: number, dur: number, type: BiquadFilterType, f0: number, f1: number, peak: number, q = 1): void {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    const flt = ctx.createBiquadFilter()
    flt.type = type
    flt.Q.value = q
    flt.frequency.setValueAtTime(f0, t0)
    flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur)
    const g = ctx.createGain()
    this.env(g, t0, peak, 0.003, dur)
    src.connect(flt)
    flt.connect(g)
    g.connect(bus)
    this.finish(src, [flt, g], bus, true)
    src.start(t0)
    src.stop(t0 + dur + 0.05)
  }

  private tone(bus: AudioNode, t0: number, dur: number, type: OscillatorType, f0: number, f1: number, peak: number, attack = 0.003): void {
    const ctx = this.ctx!
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(f0, t0)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur)
    const g = ctx.createGain()
    this.env(g, t0, peak, attack, dur)
    osc.connect(g)
    g.connect(bus)
    this.finish(osc, [g], bus, true)
    osc.start(t0)
    osc.stop(t0 + attack + dur + 0.05)
  }

  /** 진단: AudioContext 상태 · 지금 울리는 음원 · 버린 소리 · 멈췄던 횟수 */
  stats(): { state: string; live: number; dropped: number; stalls: number; muted: boolean } {
    return { state: this.ctx?.state ?? 'none', live: this.live, dropped: this.dropped, stalls: this.stalls, muted: this.mutedFlag }
  }

  // ---------- 소리들 ----------
  private gun(w: WeaponId, s: Spatial, mine: boolean): void {
    // 소음기(권총): 아주 작게 — 남에게는 거의 안 들린다. 내 것도 작게 내되 쐈다는 건 알게
    const quiet = WEAPONS[w].suppressed === true
    const { node, t0 } = this.bus(s, (mine ? 1 : 0.85) * (quiet ? (mine ? 0.3 : 0.12) : 1))
    switch (w) {
      case 'pistol':
        // 소음기: 둔탁한 '툭'. 고음 파열음 없이 저음만
        this.noiseBurst(node, t0, 0.06, 'lowpass', 900, 300, 0.6)
        this.tone(node, t0, 0.06, 'sine', 180, 60, 0.6)
        break
      case 'smg':
        this.noiseBurst(node, t0, 0.06, 'highpass', 1200, 800, 0.6)
        this.tone(node, t0, 0.05, 'square', 420, 120, 0.22)
        break
      case 'rifle':
        this.noiseBurst(node, t0, 0.1, 'bandpass', 1400, 400, 0.8, 0.7)
        this.tone(node, t0, 0.09, 'sine', 240, 60, 0.8)
        break
      case 'shotgun':
        this.noiseBurst(node, t0, 0.24, 'lowpass', 1600, 300, 1.0)
        this.tone(node, t0, 0.18, 'sine', 140, 40, 1.0)
        this.noiseBurst(node, t0, 0.05, 'highpass', 3000, 2000, 0.5)
        break
      case 'mg':
        this.noiseBurst(node, t0, 0.07, 'bandpass', 1100, 500, 0.75, 0.7)
        this.tone(node, t0, 0.06, 'square', 200, 70, 0.5)
        break
      case 'pan':
        // 후라이팬: 금속 울림 (여러 배음 + 짧은 노이즈)
        for (const f of [520, 780, 1170, 1560]) this.tone(node, t0, 0.5, 'sine', f, f * 0.96, 0.2, 0.002)
        this.noiseBurst(node, t0, 0.05, 'highpass', 4000, 2500, 0.5)
        break
      case 'revolver':
        // 소음기 없는 한 발: 크고 굵게
        this.noiseBurst(node, t0, 0.12, 'bandpass', 1200, 350, 1.0, 0.7)
        this.tone(node, t0, 0.14, 'sine', 160, 45, 1.0)
        break
      case 'flamer':
        // 불길: 쉬익 하는 잡음
        this.noiseBurst(node, t0, 0.09, 'bandpass', 700, 900, 0.35, 0.4)
        break
      case 'crossbow':
        // 시위: 퉁 + 짧은 윙
        this.tone(node, t0, 0.08, 'triangle', 320, 140, 0.6)
        this.noiseBurst(node, t0, 0.04, 'highpass', 2500, 1500, 0.35)
        break
      case 'doublebarrel':
        this.noiseBurst(node, t0, 0.32, 'lowpass', 1400, 250, 1.2)
        this.tone(node, t0, 0.24, 'sine', 110, 32, 1.2)
        this.noiseBurst(node, t0 + 0.03, 0.2, 'lowpass', 1000, 200, 0.8)
        break
      case 'railgun':
        // 전기: 올라가는 윙 + 크랙
        this.tone(node, t0, 0.18, 'sawtooth', 300, 2400, 0.35)
        this.noiseBurst(node, t0 + 0.05, 0.1, 'highpass', 3500, 2200, 1.0)
        this.tone(node, t0 + 0.05, 0.4, 'sine', 90, 30, 1.0)
        break
      case 'launcher':
        // 퐁 (유탄이 나가는 소리 — 터지는 소리는 aoe 가 낸다)
        this.tone(node, t0, 0.12, 'sine', 220, 90, 0.9)
        this.noiseBurst(node, t0, 0.08, 'lowpass', 800, 300, 0.6)
        break
      case 'wok':
        for (const f of [330, 495, 740, 990]) this.tone(node, t0, 0.6, 'sine', f, f * 0.95, 0.22, 0.002)
        this.noiseBurst(node, t0, 0.06, 'highpass', 3000, 2000, 0.5)
        break
      case 'violin':
      case 'cello':
        // 고기 바이올린 · 첼로: 휘두를 때마다 현악기 소리 다섯 가지 중 하나 (stringSwing)
        this.stringSwing(node, t0, w === 'cello' ? 0.5 : 1)
        break
      case 'rapier':
      case 'katana':
        // 검: 날카로운 바람 가르는 소리 + 짧은 쇳소리
        this.noiseBurst(node, t0, 0.1, 'highpass', 2600, 5200, 0.45, 0.5)
        this.tone(node, t0 + 0.03, 0.18, 'sine', w === 'katana' ? 2100 : 2600, 2500, 0.1, 0.002)
        break
      case 'sniper':
        // 크랙(날카롭고 길게) + 몸을 치는 저음 + 메아리 꼬리 + 0.25초 뒤 노리쇠 — 조준경 안에서도 "쐈다" 가 들리게
        this.noiseBurst(node, t0, 0.09, 'highpass', 3200, 1800, 1.2)
        this.tone(node, t0, 0.05, 'square', 1400, 400, 0.35)
        this.tone(node, t0, 0.45, 'sine', 80, 22, 1.3)
        this.noiseBurst(node, t0 + 0.02, 0.42, 'lowpass', 900, 120, 0.8)
        this.noiseBurst(node, t0 + 0.14, 0.35, 'bandpass', 600, 300, 0.35)
        this.tone(node, t0 + 0.26, 0.03, 'square', 2600, 1800, 0.22)
        this.tone(node, t0 + 0.33, 0.04, 'square', 1900, 1200, 0.25)
        break
      default:
        break
    }
  }

  /**
   * 현악기 휘두름 (2026-09-24 사용자: "철면수심 공격 소리가 너무 단조롭고 귀에 거슬린다 — 바이올린 · 첼로 소리에 맞게 몇 가지가 랜덤으로").
   * 예전에는 같은 높이(솔)의 날것 톱니파 한 음이라 귀를 긁었다 → 누그러뜨린 활 소리(stringNote) · 음은 D 단조 5음 중에서,
   * 휘두를 때마다 다섯 가지 중 하나: 짧은 활 · 피치카토 · 겹음(5도) · 미끄러져 오르기 · 트레몰로. 바람 소리는 아주 작게.
   * low = 0.5 면 첼로(한 옥타브 아래)
   */
  private stringSwing(node: AudioNode, t0: number, low: number): void {
    const scale = [293.7, 349.2, 392, 440, 523.3, 587.3]
    const pick = () => scale[Math.floor(Math.random() * scale.length)] * low
    const f = pick()
    // 전체 크기 (2026-09-24 사용자: "철면란 공격 효과음이 너무 크다" → 0.7 → "0.5 배 정도가 더 적당") — 1 → 0.5
    const V = 0.5
    this.noiseBurst(node, t0, 0.1, 'bandpass', 700 * low, 1100 * low, 0.16 * V, 0.7)
    const kind = Math.floor(Math.random() * 5)
    if (kind === 0) {
      // 짧은 활 (데타셰)
      this.stringNote(node, t0 + 0.01, 0.26, f, f, 0.2 * V, 0.025)
    } else if (kind === 1) {
      // 피치카토: 현을 퉁긴다
      this.pluck(node, t0 + 0.005, f, 0.34 * V)
      this.pluck(node, t0 + 0.07, f * 1.5, 0.18 * V)
    } else if (kind === 2) {
      // 겹음: 5도 두 줄을 함께 긋는다
      this.stringNote(node, t0 + 0.01, 0.3, f, f, 0.14 * V, 0.03)
      this.stringNote(node, t0 + 0.01, 0.3, f * 1.5, f * 1.5, 0.1 * V, 0.035)
    } else if (kind === 3) {
      // 미끄러져 오르기 (글리산도)
      this.stringNote(node, t0 + 0.01, 0.32, f * 0.84, f, 0.18 * V, 0.02)
    } else {
      // 트레몰로: 짧게 세 번
      for (let k = 0; k < 3; k++) this.stringNote(node, t0 + 0.01 + k * 0.06, 0.09, f, f, 0.15 * V, 0.012, 0)
    }
  }

  /** 현 한 음: 톱니파를 저역 통과로 누그러뜨리고 · 나무 몸통 울림(피킹) · 비브라토 · 활을 긋는 어택 */
  private stringNote(bus: AudioNode, t0: number, dur: number, f0: number, f1: number, peak: number, attack: number, vib = 0.006): void {
    const ctx = this.ctx!
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(f0, t0)
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur * 0.55)
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 5 + Math.random() * 1.2
    const depth = ctx.createGain()
    depth.gain.value = f1 * vib
    lfo.connect(depth)
    depth.connect(osc.frequency)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = Math.min(3400, f1 * 5.5)
    lp.Q.value = 0.7
    const body = ctx.createBiquadFilter()
    body.type = 'peaking'
    body.frequency.value = 480
    body.Q.value = 1.1
    body.gain.value = 5
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.linearRampToValueAtTime(peak, t0 + attack)
    g.gain.exponentialRampToValueAtTime(peak * 0.55, t0 + attack + dur * 0.45)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + dur)
    osc.connect(lp)
    lp.connect(body)
    body.connect(g)
    g.connect(bus)
    this.finish(osc, [lp, body, g, depth, lfo], bus, true)
    const end = t0 + attack + dur + 0.05
    osc.start(t0)
    osc.stop(end)
    lfo.start(t0)
    lfo.stop(end)
  }

  /** 피치카토: 세모파의 빠른 어택 · 짧은 울림 + 손끝이 줄을 튕기는 딸깍 */
  private pluck(bus: AudioNode, t0: number, f: number, peak: number): void {
    this.tone(bus, t0, 0.32, 'triangle', f, f * 0.995, peak, 0.002)
    this.tone(bus, t0, 0.18, 'sine', f * 2, f * 2, peak * 0.3, 0.002)
    this.noiseBurst(bus, t0, 0.02, 'bandpass', 2400, 1800, 0.12, 2)
  }

  private hit(s: Spatial, head: boolean): void {
    const { node, t0 } = this.bus(s, 0.9)
    this.tone(node, t0, 0.06, 'triangle', 900, 300, 0.7)
    this.noiseBurst(node, t0, 0.04, 'bandpass', 2200, 1200, 0.4, 1.5)
    if (head) {
      // 헤드샷: 높은 '팅' 두 겹 — 몸통 명중과 확실히 구분되게
      this.tone(node, t0 + 0.01, 0.14, 'sine', 1500, 1100, 0.6)
      this.tone(node, t0 + 0.02, 0.2, 'triangle', 2400, 1900, 0.45)
    }
  }

  /** 근접 타격음: 바이올린 = 살을 치는 묵직한 퍽 · 검 = 베는 쉭 · 후라이팬 = 쇠 울림 (+ 치명타 팅) */
  private meleeHit(s: Spatial, crit: boolean, fam: string): void {
    // 바이올린은 휘두를 때마다 치므로 조금 작게 (2026-09-24 — 공격 소리가 너무 크다)
    const { node, t0 } = this.bus(s, fam === 'violin' ? 0.65 : 0.95)
    if (fam === 'violin') {
      // 살을 치는 퍽 — 높이를 조금씩 바꿔 같은 소리가 되풀이되지 않게
      const k = 0.88 + Math.random() * 0.24
      this.tone(node, t0, 0.13, 'sine', 170 * k, 55 * k, 0.8, 0.002)
      this.noiseBurst(node, t0, 0.09, 'lowpass', 1100 * k, 220, 0.6, 1)
    } else if (fam === 'rapier') {
      this.noiseBurst(node, t0, 0.06, 'highpass', 3200, 6400, 0.45, 0.8)
      this.tone(node, t0, 0.09, 'triangle', 1900, 900, 0.3, 0.002)
      this.noiseBurst(node, t0 + 0.02, 0.05, 'lowpass', 900, 300, 0.35, 1)
    } else {
      this.tone(node, t0, 0.22, 'sine', 640, 560, 0.3, 0.002)
      this.noiseBurst(node, t0, 0.07, 'bandpass', 1600, 700, 0.5, 1.2)
    }
    if (crit) this.tone(node, t0 + 0.01, 0.16, 'triangle', 2300, 1800, 0.4)
  }

  /** 내가 잡았다: 낮게 울리는 "퍽" + 짧은 파열 (손맛 — 2026-09-19) */
  private killThump(): void {
    const b = this.bus({ gain: 1, pan: 0, far: 0 }, 0.8)
    this.tone(b.node, b.t0, 0.14, 'sine', 120, 42, 0.9, 0.002)
    this.noiseBurst(b.node, b.t0, 0.07, 'lowpass', 1400, 300, 0.5, 1)
  }

  // ---------- 괴물 목소리 (2026-09-24 — 종류마다 · 모두 즉석 합성, 파일 없음) ----------

  /**
   * 곁(13칸 안)의 깬 괴물 하나가 가끔 제 소리를 낸다. 많이 몰려 있을수록 조금 자주(최소 0.65초 간격) — 소리 노드가 늘지 않게
   * 한 번에 하나만. 뽑기는 저수지 뽑기(한 번 훑기)
   */
  private ambientVoice(state: GameState, localPlayer: number): void {
    const now = performance.now()
    if (now < this.nextIdle) return
    const me = localPlayer >= 0 ? state.players[localPlayer] : undefined
    if (!me || !state.monsters) {
      this.nextIdle = now + 1000
      return
    }
    const R = 13 * 32
    let pick: { kind: number; x: number; y: number } | null = null
    let n = 0
    for (const m of state.monsters) {
      if (m.hp <= 0 || m.st === 0 || m.x === undefined) continue
      const dx = m.x - me.x
      const dy = m.y - me.y
      if (dx * dx + dy * dy > R * R) continue
      n++
      if (Math.random() * n < 1) pick = m
    }
    this.nextIdle = now + (n === 0 ? 800 : Math.max(650, 1900 / Math.sqrt(n)) * (0.7 + Math.random() * 0.6))
    if (pick) this.voice(pick.kind, 'idle', spatial(pick.x - me.x, pick.y - me.y), 0.42)
  }

  /**
   * 괴물 소리 하나. 되풀이 제한: 아무 괴물 90ms · 같은 종류 350ms(옆 소리 700ms) · 보스 2.2초(즉사기 · 쓰러짐은 늘).
   * 너무 멀면(거리 감쇠) 아예 만들지 않는다
   */
  private voice(kind: number, act: 'wake' | 'attack' | 'death' | 'idle' | 'ult', s: Spatial, vol: number): void {
    if (s.gain < 0.06) return
    const now = performance.now()
    const def = MONSTER_LIST[kind]
    if (!def) return
    if (def.boss) {
      if (act !== 'ult' && act !== 'death' && now - this.lastBossRoar < 2200) return
      this.lastBossRoar = now
    } else {
      if (now - this.lastVoice < 90) return
      if (now - (this.kindVoice.get(kind) ?? -1e9) < (act === 'idle' ? 700 : 350)) return
      this.lastVoice = now
      this.kindVoice.set(kind, now)
    }
    const { node, t0 } = this.bus(s, vol)
    const r = (a: number, b: number) => a + Math.random() * (b - a)
    const big = act === 'wake' || act === 'ult'
    switch (def.id) {
      case 'ghoul':
        // 좀비: 목구멍으로 그르릉 — 낮은 톱니 + "우어" 모음이 천천히 바뀐다
        this.vox(node, t0, act === 'death' ? 0.45 : r(0.55, 0.95), r(80, 115), r(70, 95), 420, 650, big ? 0.5 : 0.36, 0.05, 6)
        this.noiseBurst(node, t0, 0.35, 'lowpass', 700, 260, 0.12, 0.8)
        break
      case 'archer':
        // 해골: 뼈가 달그락 (쓰러지면 와르르)
        this.clatter(node, t0, act === 'death' ? 9 : act === 'attack' ? 3 : 4, 0.3)
        break
      case 'bloater':
        // 부푼 시체: 뱃속이 꾸르륵
        this.gurgle(node, t0, act === 'death' ? 0.7 : 0.45, 0.32)
        break
      case 'goblin':
        // 보물 고블린: 킥킥 (높은 소리가 내려간다)
        for (let i = 0; i < 4; i++) this.tone(node, t0 + i * 0.075, 0.07, 'triangle', r(900, 1150) - i * 90, r(700, 850) - i * 60, 0.22, 0.004)
        break
      case 'wolf':
        if (act === 'wake') {
          // 늑대: 우우— 길게 오르내리는 울음
          this.vox(node, t0, 1.35, r(360, 420), r(470, 540), 900, 1100, 0.34, 0.012, 3, 0.35)
          this.tone(node, t0 + 0.1, 1.2, 'sine', r(720, 840), 900, 0.1, 0.2)
        } else if (act === 'death') {
          // 깨갱
          this.tone(node, t0, 0.14, 'triangle', 980, 620, 0.3, 0.003)
          this.tone(node, t0 + 0.16, 0.12, 'triangle', 820, 520, 0.2, 0.003)
        } else {
          // 으르렁 (이를 드러낸 떨림)
          this.vox(node, t0, act === 'idle' ? 0.35 : 0.45, r(120, 150), r(105, 125), 800, 600, 0.34, 0.12, 5)
          this.noiseBurst(node, t0, 0.3, 'bandpass', 1100, 700, 0.18, 1.5)
        }
        break
      case 'spider':
      case 'queen':
        // 거미: 쉬익 + 딸깍 · 여왕은 날카롭게 비명
        if (def.id === 'queen' && (act === 'ult' || act === 'wake' || act === 'attack' || act === 'death')) {
          this.vox(node, t0, act === 'ult' ? 1.3 : 0.8, 900, act === 'death' ? 400 : 1400, 1800, 2600, act === 'ult' ? 0.4 : 0.3, 0.04, 3)
          this.noiseBurst(node, t0, 0.9, 'highpass', 4200, 3000, 0.25, 0.8)
        } else {
          this.noiseBurst(node, t0, act === 'death' ? 0.4 : 0.28, 'highpass', 4500, 3200, 0.2, 0.7)
          for (let i = 0; i < 3; i++) this.tone(node, t0 + 0.05 + i * 0.05, 0.02, 'square', 2600, 2200, 0.06, 0.001)
        }
        break
      case 'shaman':
        // 버섯 주술사: 쌕쌕거리는 주문 (어긋난 두 음)
        this.vox(node, t0, 0.6, 220, 200, 700, 900, 0.2, 0.03, 5)
        this.vox(node, t0, 0.6, 233, 210, 900, 700, 0.14, 0.03, 5)
        this.noiseBurst(node, t0, 0.5, 'bandpass', 2400, 1600, 0.1, 2)
        break
      case 'shield':
        // 방패병: 쇠가 부딪는 챙 + 짧은 끙
        this.tone(node, t0, 0.35, 'triangle', 1750, 1650, 0.16, 0.002)
        this.tone(node, t0, 0.3, 'sine', 2630, 2500, 0.08, 0.002)
        this.vox(node, t0 + 0.02, 0.25, 120, 100, 500, 450, 0.26, 0.02, 6)
        break
      case 'necro':
      case 'shade':
        // 강령술사: 속삭임 + 낮은 웅얼 · 그림자: 길게 흐느끼는 울음
        if (def.id === 'shade') this.vox(node, t0, act === 'death' ? 0.7 : 1.0, r(480, 560), r(280, 330), 900, 700, 0.22, 0.02, 4, 0.25)
        else this.vox(node, t0, 0.55, 150, 135, 500, 600, 0.18, 0.02, 5)
        this.noiseBurst(node, t0, def.id === 'shade' ? 0.9 : 0.55, 'bandpass', 2600, 1800, 0.16, 2.5)
        break
      case 'spitter':
        // 산성 토사꾼: 우웩 (내려가는 음 + 꾸르륵)
        this.vox(node, t0, 0.4, 190, 95, 650, 450, 0.3, 0.05, 5)
        this.gurgle(node, t0 + 0.1, 0.3, 0.2)
        break
      case 'demon':
        // 포격 악마: 불길이 치솟는 포효 (낮은 톱니 + 타닥 불똥)
        this.vox(node, t0, big ? 0.9 : 0.55, r(75, 95), r(60, 70), 500, 350, 0.32, 0.04, 4)
        this.noiseBurst(node, t0, 0.6, 'lowpass', 900, 250, 0.3, 0.7)
        for (let i = 0; i < 4; i++) this.noiseBurst(node, t0 + r(0.05, 0.5), 0.02, 'highpass', 3000, 2500, 0.12, 1)
        break
      case 'butcher':
        // 도살자: 돼지 같은 꽥 — 거칠게 올랐다 떨어지는 포효
        this.vox(node, t0, act === 'ult' ? 1.4 : act === 'idle' ? 0.5 : 0.95, act === 'idle' ? 110 : 190, 85, 750, 450, act === 'idle' ? 0.26 : 0.46, 0.06, 5, 0.12)
        this.vox(node, t0, act === 'ult' ? 1.4 : 0.9, 95, 60, 350, 300, act === 'idle' ? 0.16 : 0.3, 0.05, 4)
        this.noiseBurst(node, t0, 0.8, 'lowpass', 1200, 300, act === 'idle' ? 0.12 : 0.28, 0.8)
        break
      case 'warden':
        // 관리인: 쇠가 울리는 듯한 낮은 호통
        this.vox(node, t0, act === 'ult' ? 1.5 : act === 'idle' ? 0.5 : 1.0, 70, 58, 420, 360, act === 'idle' ? 0.22 : 0.42, 0.03, 5)
        this.tone(node, t0, act === 'ult' ? 1.6 : 0.9, 'triangle', 1100, 1040, act === 'idle' ? 0.05 : 0.12, 0.01)
        this.tone(node, t0, act === 'ult' ? 1.6 : 0.9, 'sine', 1650, 1600, 0.06, 0.01)
        this.noiseBurst(node, t0, 0.5, 'lowpass', 800, 200, 0.2, 0.8)
        break
      case 'lord':
        // 심연의 군주: 땅이 울리는 악마의 포효 (어긋난 두 톱니 + 낮은 사인)
        this.vox(node, t0, act === 'ult' ? 1.8 : act === 'idle' ? 0.6 : 1.2, 58, 44, 380, 260, act === 'idle' ? 0.24 : 0.46, 0.04, 4)
        this.vox(node, t0, act === 'ult' ? 1.8 : 1.1, 61, 46, 300, 220, act === 'idle' ? 0.16 : 0.34, 0.05, 4)
        this.tone(node, t0, act === 'ult' ? 1.8 : 1.0, 'sine', 42, 32, act === 'idle' ? 0.25 : 0.5, 0.08)
        this.noiseBurst(node, t0, 1.0, 'lowpass', 700, 150, 0.3, 0.7)
        break
      default:
        this.growl(s, vol)
        break
    }
  }

  /**
   * 목소리 한 줄: 톱니파(f0 → f1)를 모음 필터(formant0 → formant1)로 거르고 떨림(vib — 음높이 비율)을 준다. attack = 서서히 커지는 초
   */
  private vox(bus: AudioNode, t0: number, dur: number, f0: number, f1: number, form0: number, form1: number, peak: number, vib: number, vibHz: number, attack = 0.04): void {
    const ctx = this.ctx!
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(f0, t0)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur)
    const lfo = ctx.createOscillator()
    lfo.frequency.value = vibHz
    const depth = ctx.createGain()
    depth.gain.value = f0 * vib
    lfo.connect(depth)
    depth.connect(osc.frequency)
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 1.6
    bp.frequency.setValueAtTime(form0, t0)
    bp.frequency.linearRampToValueAtTime(form1, t0 + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.linearRampToValueAtTime(peak, t0 + Math.min(attack, dur * 0.5))
    g.gain.setValueAtTime(peak, t0 + dur * 0.6)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(bp)
    bp.connect(g)
    g.connect(bus)
    this.finish(osc, [bp, g, depth, lfo], bus, true)
    const end = t0 + dur + 0.05
    osc.start(t0)
    osc.stop(end)
    lfo.start(t0)
    lfo.stop(end)
  }

  /** 뼈 달그락: 짧은 딸깍 여럿 (간격 · 높이를 조금씩) */
  private clatter(bus: AudioNode, t0: number, n: number, peak: number): void {
    let t = t0
    for (let i = 0; i < n; i++) {
      // 좁은 대역 · 짧은 딸깍은 에너지가 작다 — 크게 (오프라인 계측: 0.3 이면 -58dB 로 거의 안 들렸다)
      this.noiseBurst(bus, t, 0.03, 'bandpass', 1800 + Math.random() * 1600, 1400, peak * 4, 3)
      t += 0.03 + Math.random() * 0.05
    }
  }

  /** 꾸르륵: 낮은 음이 이리저리 튀는 거품 몇 개 */
  private gurgle(bus: AudioNode, t0: number, dur: number, peak: number): void {
    const n = Math.max(3, Math.round(dur / 0.08))
    for (let i = 0; i < n; i++) {
      const f = 70 + Math.random() * 60
      this.tone(bus, t0 + (i * dur) / n, 0.07, 'sine', f, f * (0.6 + Math.random() * 0.8), peak, 0.004)
    }
    this.noiseBurst(bus, t0, dur, 'lowpass', 500, 180, peak * 0.4, 0.8)
  }

  /** 설정 "보스 목소리" (ui/settings.ts — 저장한 값이 없으면 켬) */
  private bossVoiceOn(): boolean {
    try {
      return localStorage.getItem('brpg.bossvoice') !== '0'
    } catch {
      return true
    }
  }

  /** 보스 대사 소리를 받아 둔다 (한 번만 · 실패하면 다시 받지 않는다 — 그때는 음성 합성으로) */
  private loadLine(kind: number): void {
    if (!this.ctx || this.lineBufs.has(kind) || this.lineLoading.has(kind)) return
    this.lineLoading.add(kind)
    const ctx = this.ctx
    void fetch(`${import.meta.env.BASE_URL}voice/boss_${kind}.wav`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((a) => ctx.decodeAudioData(a))
      .then((b) => this.lineBufs.set(kind, b))
      .catch(() => this.lineBufs.set(kind, null))
      .finally(() => this.lineLoading.delete(kind))
  }

  /**
   * 보스 대사 — 웅장하게 가공해서 (2026-09-24 사용자: "여자 음성에 너무 단조로워 임팩트가 없다 — 에코를 많이 넣거나 음을 내려
   * 울리면서 웅장하게"). 브라우저 음성 합성은 가공할 수 없어 대사 넷을 소리 파일로 싣는다(tools/bossvoice.ps1).
   *   재생을 늦춰 음을 내린다(군주 0.66배 …) → 살짝 어긋난 둘째 목소리로 두껍게 → 거친 맛(tanh) → 저음 올리고 고음 깎기 →
   *   마른 소리 + 메아리(되먹임 딜레이 · 되먹일수록 어두워진다) + 긴 잔향(3.2초) · 군주 · 관리인은 낮은 울렁임(링 변조)과
   *   한 옥타브 아래 목소리를 더 깐다. 영상(tools/trailer.js)도 이 함수를 그대로 쓴다.
   * 소리 파일이 아직 없으면 false (부른 쪽이 음성 합성으로 대신한다)
   */
  bossLine(kind: number): boolean {
    if (this.mutedFlag || !this.bossVoiceOn() || !this.ctx) return false
    const buf = this.lineBufs.get(kind)
    if (!buf) return false
    const ctx = this.ctx
    const id = MONSTER_LIST[kind]?.id
    const P =
      id === 'lord' ? { rate: 0.66, echo: 0.38, fb: 0.5, ring: 32, sub: true, low: 9, vol: 0.5 }
      : id === 'warden' ? { rate: 0.74, echo: 0.3, fb: 0.45, ring: 38, sub: true, low: 8, vol: 0.55 }
      : id === 'queen' ? { rate: 0.92, echo: 0.34, fb: 0.5, ring: 0, sub: false, low: 3, vol: 0.75 }
      : { rate: 0.8, echo: 0.26, fb: 0.42, ring: 0, sub: false, low: 7, vol: 0.6 }
    const t0 = ctx.currentTime + 0.05
    const len = buf.duration / P.rate
    const parts: AudioNode[] = []
    const mk = <T extends AudioNode>(n: T): T => (parts.push(n), n)
    const input = mk(ctx.createGain())
    const lowS = mk(ctx.createBiquadFilter())
    lowS.type = 'lowshelf'
    lowS.frequency.value = 220
    lowS.gain.value = P.low
    const highS = mk(ctx.createBiquadFilter())
    highS.type = 'highshelf'
    highS.frequency.value = 3800
    highS.gain.value = -6
    const shaper = mk(ctx.createWaveShaper())
    const curve = new Float32Array(1024)
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(2.4 * ((i / (curve.length - 1)) * 2 - 1))
    shaper.curve = curve
    shaper.oversample = '2x'
    const out = mk(ctx.createGain())
    out.gain.value = P.vol // 넷의 크기를 맞춘다 (낮은 목소리를 깐 군주 · 관리인이 더 크다 — 꼭짓점 0.9 안팎)
    out.connect(this.master!)
    input.connect(lowS)
    lowS.connect(highS)
    highS.connect(shaper)
    // 마른 소리
    const dry = mk(ctx.createGain())
    dry.gain.value = 0.8
    shaper.connect(dry)
    dry.connect(out)
    // 메아리: 되먹임 딜레이 (고리 안의 저역 통과 — 되먹일수록 어두워진다)
    const dl = mk(ctx.createDelay(1.5))
    dl.delayTime.value = P.echo
    const fbLp = mk(ctx.createBiquadFilter())
    fbLp.type = 'lowpass'
    fbLp.frequency.value = 2200
    const fb = mk(ctx.createGain())
    fb.gain.value = P.fb
    const echo = mk(ctx.createGain())
    echo.gain.value = 0.55
    shaper.connect(dl)
    dl.connect(fbLp)
    fbLp.connect(fb)
    fb.connect(dl)
    fbLp.connect(echo)
    echo.connect(out)
    // 긴 잔향
    const conv = mk(ctx.createConvolver())
    conv.buffer = this.reverbIr()
    const wet = mk(ctx.createGain())
    wet.gain.value = 0.8
    shaper.connect(conv)
    conv.connect(wet)
    wet.connect(out)
    // 목소리들: 본 목소리 · 살짝 어긋난 둘째(두껍게) · (군주 · 관리인) 한 옥타브 아래
    const src = (rate: number, gain: number, delay: number, dest: AudioNode) => {
      const s = ctx.createBufferSource()
      s.buffer = buf
      s.playbackRate.value = rate
      const g = ctx.createGain()
      g.gain.value = gain
      s.connect(g)
      g.connect(dest)
      parts.push(s, g)
      s.start(t0 + delay)
      return s
    }
    src(P.rate, 1, 0, input)
    src(P.rate * 1.013, 0.5, 0.022, input)
    if (P.sub) src(P.rate * 0.5, 0.32, 0, input)
    // 낮은 울렁임 (링 변조): 목소리에 낮은 사인을 곱한 것을 조금 섞는다
    let osc: OscillatorNode | null = null
    if (P.ring > 0) {
      const rm = mk(ctx.createGain())
      rm.gain.value = 0
      osc = ctx.createOscillator()
      osc.frequency.value = P.ring
      osc.connect(rm.gain)
      parts.push(osc)
      const rmOut = mk(ctx.createGain())
      rmOut.gain.value = 0.45
      input.connect(rm)
      rm.connect(rmOut)
      rmOut.connect(highS)
      osc.start(t0)
      osc.stop(t0 + len * (P.sub ? 2 : 1) + 4)
    }
    // 메아리 · 잔향 꼬리까지 끝나면 끊는다 (실시간만 — 영상은 한 번 그리고 끝)
    const offline = typeof (ctx as unknown as { startRendering?: unknown }).startRendering === 'function'
    if (!offline) window.setTimeout(() => parts.forEach((n) => n.disconnect()), (len * (P.sub ? 2 : 1) + 5) * 1000)
    this.intensity = 1
    return true
  }

  /** 잔향 임펄스 3.2초 (좌우 따로 흩어지는 잡음이 점점 잦아든다 — 한 번 만들어 둔다) */
  private reverbIr(): AudioBuffer {
    const ctx = this.ctx!
    if (this.verbIr && this.verbIr.sampleRate === ctx.sampleRate) return this.verbIr
    const n = Math.floor(ctx.sampleRate * 3.2)
    const ir = ctx.createBuffer(2, n, ctx.sampleRate)
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c)
      for (let i = 0; i < n; i++) {
        const t = i / ctx.sampleRate
        d[i] = (Math.random() * 2 - 1) * Math.exp(-t / 0.85) * (t < 0.012 ? t / 0.012 : 1)
      }
    }
    this.verbIr = ir
    return ir
  }

  /**
   * 보스 대사를 목소리로 (브라우저 음성 합성 — 무료 · 기기 안에서, 서버 없음). 한국어 목소리가 없으면 소리 효과만.
   * 보스마다 높낮이 · 빠르기 (군주 · 관리인은 아주 낮게, 여왕은 높게). 소리 끔 · 설정 "보스 목소리" 끔 · 영상(오프라인)에서는 없다
   */
  private speak(text: string | undefined, kind: number): void {
    if (!text || this.mutedFlag || typeof speechSynthesis === 'undefined') return
    try {
      if (localStorage.getItem('brpg.bossvoice') === '0') return
    } catch {
      /* 저장소 없음 — 켠 것으로 */
    }
    if (typeof (this.ctx as unknown as { startRendering?: unknown } | null)?.startRendering === 'function') return
    const ko = speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith('ko'))
    if (!ko) return
    const u = new SpeechSynthesisUtterance(text.replace(/…/g, '...'))
    u.voice = ko
    u.lang = ko.lang
    const id = MONSTER_LIST[kind]?.id
    const [pitch, rate] = id === 'lord' ? [0.1, 0.72] : id === 'warden' ? [0.25, 0.78] : id === 'butcher' ? [0.35, 0.85] : id === 'queen' ? [1.5, 0.85] : [0.5, 0.8]
    u.pitch = pitch
    u.rate = rate
    u.volume = 1
    speechSynthesis.cancel()
    speechSynthesis.speak(u)
  }

  /** 몬스터가 쓰러지는 소리: 질척한 저음 */
  private squelch(s: Spatial): void {
    const b = this.bus(s, 0.7)
    this.noiseBurst(b.node, b.t0, 0.24, 'lowpass', 700, 140, 0.55, 2)
    this.tone(b.node, b.t0, 0.22, 'sawtooth', 130, 55, 0.22, 0.004)
  }

  /** 으르렁: 톱니파 두 겹을 살짝 어긋나게 + 흔들림 */
  private growl(s: Spatial, vol: number): void {
    const b = this.bus(s, vol * 0.5)
    this.tone(b.node, b.t0, 0.45, 'sawtooth', 78, 62, 0.35, 0.05)
    this.tone(b.node, b.t0, 0.45, 'sawtooth', 83, 60, 0.3, 0.05)
    this.noiseBurst(b.node, b.t0, 0.4, 'bandpass', 420, 260, 0.25, 3)
  }

  private death(s: Spatial): void {
    const { node, t0 } = this.bus(s, 1)
    this.tone(node, t0, 0.45, 'sawtooth', 500, 70, 0.45)
    this.noiseBurst(node, t0, 0.3, 'lowpass', 1200, 200, 0.7)
    this.tone(node, t0 + 0.05, 0.4, 'square', 250, 50, 0.18)
  }

  private respawn(s: Spatial): void {
    const { node, t0 } = this.bus(s, 0.6)
    this.tone(node, t0, 0.18, 'sine', 520, 520, 0.5, 0.01)
    this.tone(node, t0 + 0.12, 0.25, 'sine', 780, 780, 0.5, 0.01)
  }

  private dash(s: Spatial): void {
    const { node, t0 } = this.bus(s, 0.7)
    this.noiseBurst(node, t0, 0.2, 'bandpass', 500, 2400, 0.5, 0.6)
  }

  /** 재장전: 탄창 빼기 → 끼우기(딸깍) → 노리쇠. 세 박자가 있어야 재장전으로 들린다 */
  private reload(s: Spatial): void {
    const { node, t0 } = this.bus(s, 0.85)
    // 탄창 빼기 (금속 스침)
    this.noiseBurst(node, t0, 0.07, 'bandpass', 2600, 1500, 0.3, 2)
    this.tone(node, t0, 0.05, 'square', 900, 520, 0.18)
    // 새 탄창 끼우기 (묵직한 딸깍)
    this.tone(node, t0 + 0.16, 0.05, 'square', 1500, 700, 0.32)
    this.noiseBurst(node, t0 + 0.16, 0.05, 'lowpass', 1200, 400, 0.3)
    // 노리쇠 (챠락)
    this.noiseBurst(node, t0 + 0.34, 0.06, 'highpass', 3200, 2200, 0.34, 1.2)
    this.tone(node, t0 + 0.34, 0.04, 'square', 2100, 1100, 0.22)
  }

  private wall(s: Spatial): void {
    const { node, t0 } = this.bus(s, 0.5)
    this.noiseBurst(node, t0, 0.03, 'highpass', 3000, 2000, 0.35)
  }

  /** 팀 신호: 짧고 맑은 두 음 (총소리와 헷갈리지 않게) */
  mark(): void {
    if (!this.ready()) return
    const { node, t0 } = this.bus({ gain: 1, pan: 0, far: 0 }, 0.5)
    this.tone(node, t0, 0.09, 'sine', 1180, 1180, 0.3, 0.003)
    this.tone(node, t0 + 0.07, 0.12, 'sine', 1560, 1560, 0.26, 0.003)
  }

  /** 후원 알림 (2026-09-23 — 치지직): 동전 세 번 · 큰 후원(보스급)이면 낮은 징과 울림을 더한다 */
  donate(big: boolean): void {
    if (!this.ready()) return
    const { node, t0 } = this.bus({ gain: 1, pan: 0, far: 0 }, 0.6)
    ;[1568, 2093, 2637].forEach((f, i) => this.tone(node, t0 + i * 0.07, 0.25, 'triangle', f, f, 0.28, 0.003))
    if (big) {
      this.tone(node, t0, 1.6, 'sine', 82, 66, 0.6, 0.01)
      this.noiseBurst(node, t0, 0.7, 'lowpass', 500, 120, 0.3)
    }
  }

  /** 짧은 알림음 (창 열기·줍기 등 UI) */
  blip(): void {
    if (!this.ready()) return
    const { node, t0 } = this.bus({ gain: 1, pan: 0, far: 0 }, 0.5)
    this.tone(node, t0, 0.08, 'sine', 880, 1320, 0.4, 0.005)
  }

  private tick(sec: number): void {
    const { node, t0 } = this.bus({ gain: 1, pan: 0, far: 0 }, 0.5)
    this.tone(node, t0, 0.12, 'sine', sec === 1 ? 880 : 660, sec === 1 ? 880 : 660, 0.5, 0.005)
  }

  private start(): void {
    const { node, t0 } = this.bus({ gain: 1, pan: 0, far: 0 }, 0.6)
    for (const f of [440, 554, 659, 880]) this.tone(node, t0, 0.35, 'triangle', f, f, 0.3, 0.005)
  }

  private over(): void {
    const { node, t0 } = this.bus({ gain: 1, pan: 0, far: 0 }, 0.7)
    for (const f of [392, 494, 587, 784]) this.tone(node, t0, 0.9, 'triangle', f, f, 0.28, 0.02)
    this.tone(node, t0, 0.8, 'sine', 98, 98, 0.35, 0.02)
  }

  // ---------- 배경음 (절차 생성, 저작권 없음) ----------
  // 132 BPM 단조 추격 루프: 16분 베이스 + 킥/스네어/하이햇 + 아르페지오 + 리드 모티프.
  // 교전이 있으면 intensity 가 올라 레이어가 두꺼워진다.

  /** 4마디 진행 (Am - F - G - Em): [근음, 3화음] */
  private static readonly PROG = [
    { root: 55.0, notes: [220.0, 261.6, 329.6] }, // Am
    { root: 43.65, notes: [174.6, 220.0, 261.6] }, // F
    { root: 49.0, notes: [196.0, 246.9, 293.7] }, // G
    { root: 41.2, notes: [164.8, 196.0, 246.9] }, // Em
  ]
  /** 리드 모티프 (16분 위치 → 음). 0 은 쉼표 */
  private static readonly LEAD = [
    880, 0, 0, 987.8, 0, 830.6, 0, 0, 659.3, 0, 739.99, 0, 880, 0, 0, 0,
  ]

  /** 배경음 결: 'chase' = 덕의 132BPM 추격(투기장) · 'dark' = 느리고 어두운 던전 */
  private bgmStyle: 'chase' | 'dark' = 'chase'

  setBgmStyle(style: 'chase' | 'dark'): void {
    this.bgmStyle = style
  }

  startBgm(): void {
    this.bgmOn = true
    if (this.ctx) this.startBgmScheduler()
  }

  stopBgm(): void {
    this.bgmOn = false
    if (this.bgmTimer) {
      clearInterval(this.bgmTimer)
      this.bgmTimer = 0
    }
  }

  private startBgmScheduler(): void {
    if (this.bgmTimer || !this.ctx) return
    this.bgmNextBeat = this.ctx.currentTime + 0.12
    this.bgmBeatIndex = 0
    this.bgmTimer = window.setInterval(() => this.scheduleBgm(), 80)
  }

  // ---------- 던전 배경음 (2026-09-24 사용자: "어둡고 무서운 느낌의 배경음 — 어울리면 게임 안에도") ----------
  // 박자로 쫓는 음악이 아니라 **스며드는 공포**: 낮게 우는 지속음(두 음이 살짝 어긋나 울렁인다) · 반음으로 부딪는 현악 덩어리가
  // 천천히 부풀었다 가라앉고 · 먼 합창 · 배음이 어긋난 쇠 종 · 심장 박동 · 숨 같은 바람 · 잔향. 교전이 붙으면 낮은 맥박과 북.
  // 한 마디 ≈ 4.3초(56 BPM), 네 마디(약 17초)가 한 바퀴. D 단조 — 보스 곡과 같은 조라 넘어갈 때 튀지 않는다.
  private static readonly HORROR = [
    { root: 36.71, pad: [146.8, 155.6, 220.0], bell: 587.3 }, // Dm + E♭ (반음 부딪힘)
    { root: 29.14, pad: [116.5, 146.8, 164.8], bell: 0 }, // B♭ + E (셋온음)
    { root: 49.0, pad: [196.0, 207.7, 233.1], bell: 554.4 }, // Gm + A♭
    { root: 55.0, pad: [220.0, 233.1, 277.2], bell: 0 }, // A + B♭ (화성 단조의 C#)
  ]

  private scheduleDark(ctx: AudioContext): void {
    const bar = (60 / 56) * 4
    const step16 = bar / 16
    this.intensity = Math.max(0, this.intensity - 0.0012)
    while (this.bgmNextBeat < ctx.currentTime + 0.4) {
      const t = this.bgmNextBeat
      const step = this.bgmBeatIndex % 64
      const b = (step / 16) | 0
      const s16 = step % 16
      const ch = Sfx.HORROR[b]
      const hot = this.intensity > 0.3
      if (s16 === 0) {
        // 낮게 우는 지속음: 두 음 맥놀이 · 필터가 마디 가운데까지 열렸다 닫힌다 (다음 마디와 겹쳐 끊기지 않게 길게)
        this.bgmPad(t, [ch.root * 2, ch.root * 2 * 1.007], bar + 1.6, 0.2, 170, { attack: 1.4, release: 1.6, sweep: 2.2 })
        // 반음으로 부딪는 현악 덩어리 (두 줄씩 조금 어긋나게)
        this.bgmPad(t + 0.3, ch.pad, bar + 1.8, 0.028, 950, { attack: 2.2, release: 2, detune: 9 })
        // 먼 합창 "아—" (둘째 · 넷째 마디): 입 모양 대역 + 떨림
        if (b % 2 === 1) this.bgmPad(t + 0.6, [ch.pad[0] * 2, ch.pad[2] * 2], bar, 0.035, 900, { type: 'triangle', band: 760, attack: 1.6, release: 1.8, vib: 5 })
        // 쇠 종 (첫 · 셋째 마디 — 교전 중엔 작게)
        if (ch.bell) this.bgmBell(t + step16 * 2, ch.bell, hot ? 0.03 : 0.055)
        // 숨 같은 바람 (넷째 마디)
        if (b === 3) this.bgmWind(t, bar, 0.05)
      }
      // 심장 박동: 쿵-쿵 (교전 중엔 마디에 두 번)
      if (s16 === 0 || s16 === 1 || (hot && (s16 === 8 || s16 === 9))) this.bgmHeart(t, s16 % 8 === 0 ? 0.55 : 0.34)
      // 교전: 8분 낮은 맥박 + 먼 북
      if (hot && s16 % 2 === 0) this.bgmNote(t, ch.root * 4, 'sawtooth', step16 * 1.2, 0.1, 380)
      if (hot && (s16 === 6 || s16 === 14)) this.bgmTom(t, 0.35)
      this.bgmNextBeat += step16
      this.bgmBeatIndex++
    }
  }

  /** 잔향 (배경음만): 소음을 줄여 가며 만든 응답 · 컨텍스트마다 하나 (영상 녹화는 다른 컨텍스트 — 녹화 도구의 가짜 컨텍스트와도 맞춘다) */
  private verbFor: unknown = null
  private verbIn: AudioNode | null = null
  private verbSend(node: AudioNode, ctx: BaseAudioContext): void {
    if (this.verbFor !== ctx || !this.verbIn) {
      const len = Math.round(ctx.sampleRate * 2.6)
      const ir = ctx.createBuffer(2, len, ctx.sampleRate)
      for (let c = 0; c < 2; c++) {
        const d = ir.getChannelData(c)
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2)
      }
      const conv = ctx.createConvolver()
      conv.buffer = ir
      const wet = ctx.createGain()
      wet.gain.value = 0.45
      conv.connect(wet)
      wet.connect(this.bgmGain!)
      this.verbIn = conv
      this.verbFor = ctx
    }
    node.connect(this.verbIn)
  }

  /** 길게 부풀었다 가라앉는 화음 (현악 · 지속음 · 합창) */
  private bgmPad(t0: number, freqs: number[], dur: number, peak: number, cutoff: number, o: { type?: OscillatorType; attack?: number; release?: number; detune?: number; sweep?: number; band?: number; vib?: number } = {}): void {
    const ctx = this.ctx!
    const a = o.attack ?? 1.5
    const r = o.release ?? 1.5
    const flt = ctx.createBiquadFilter()
    flt.type = o.band ? 'bandpass' : 'lowpass'
    flt.frequency.setValueAtTime(o.band ?? cutoff, t0)
    if (o.band) flt.Q.value = 3.5
    if (o.sweep) {
      flt.frequency.linearRampToValueAtTime(cutoff * o.sweep, t0 + dur * 0.5)
      flt.frequency.linearRampToValueAtTime(cutoff, t0 + dur)
    }
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.linearRampToValueAtTime(peak, t0 + a)
    g.gain.setValueAtTime(peak, t0 + Math.max(a, dur - r))
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur)
    flt.connect(g)
    g.connect(this.bgmGain!)
    this.verbSend(g, ctx)
    const oscs: OscillatorNode[] = []
    const extra: AudioNode[] = []
    for (const f of freqs) {
      for (const dt of o.detune ? [-o.detune, o.detune] : [0]) {
        const osc = ctx.createOscillator()
        osc.type = o.type ?? 'sawtooth'
        osc.frequency.value = f
        osc.detune.value = dt
        if (o.vib) {
          const lfo = ctx.createOscillator()
          lfo.frequency.value = o.vib
          const lg = ctx.createGain()
          lg.gain.value = 7
          lfo.connect(lg)
          lg.connect(osc.detune)
          lfo.start(t0)
          lfo.stop(t0 + dur + 0.05)
          this.finish(lfo, [lg], null, false)
        }
        osc.connect(flt)
        osc.start(t0)
        osc.stop(t0 + dur + 0.05)
        oscs.push(osc)
      }
    }
    void extra
    oscs.forEach((osc, i) => this.finish(osc, i === oscs.length - 1 ? [flt, g] : [], null, false))
  }

  /** 쇠 종: 배음이 어긋난 넷 (종답게 금속성) · 길게 울린다 */
  private bgmBell(t0: number, f: number, peak: number): void {
    const ctx = this.ctx!
    for (const [k, m] of [[1, 1], [2.76, 0.5], [5.4, 0.28], [8.93, 0.14]]) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = f * k
      const g = ctx.createGain()
      const d = 4.5 / Math.sqrt(k)
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.linearRampToValueAtTime(peak * m, t0 + 0.006)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d)
      osc.connect(g)
      g.connect(this.bgmGain!)
      this.verbSend(g, ctx)
      this.finish(osc, [g], null, false)
      osc.start(t0)
      osc.stop(t0 + d + 0.05)
    }
  }

  /** 숨 같은 바람: 소음을 좁은 대역으로 훑는다 */
  private bgmWind(t0: number, dur: number, peak: number): void {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    const flt = ctx.createBiquadFilter()
    flt.type = 'bandpass'
    flt.Q.value = 5
    flt.frequency.setValueAtTime(320, t0)
    flt.frequency.linearRampToValueAtTime(1150, t0 + dur * 0.45)
    flt.frequency.linearRampToValueAtTime(420, t0 + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.linearRampToValueAtTime(peak, t0 + dur * 0.4)
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur)
    src.connect(flt)
    flt.connect(g)
    g.connect(this.bgmGain!)
    this.verbSend(g, ctx)
    this.finish(src, [flt, g], null, false)
    src.start(t0)
    src.stop(t0 + dur + 0.05)
  }

  /** 심장 박동: 낮고 둔한 쿵 */
  private bgmHeart(t0: number, peak: number): void {
    const ctx = this.ctx!
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(86, t0)
    osc.frequency.exponentialRampToValueAtTime(38, t0 + 0.16)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.linearRampToValueAtTime(peak, t0 + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34)
    osc.connect(g)
    g.connect(this.bgmGain!)
    this.finish(osc, [g], null, false)
    osc.start(t0)
    osc.stop(t0 + 0.38)
  }

  // ---------- 보스 배경음: 84 BPM 단조 (Dm - Dm - B♭ - A) ----------
  // 전투 북(낮은 톰) · 금관처럼 굵은 화음 찌르기 · 8분 현악 반복 · 합창 두 음.
  // 성나면(체력 30% 아래) 북이 잦아지고 16분 높은 반복이 더해진다. 던전 곡과 같은 조라 넘어갈 때 튀지 않는다.
  private static readonly BOSS = [
    { root: 36.71, chord: [146.8, 174.6, 220.0] }, // Dm
    { root: 36.71, chord: [146.8, 174.6, 220.0] }, // Dm
    { root: 29.14, chord: [116.5, 146.8, 174.6] }, // B♭
    { root: 27.5, chord: [110.0, 138.6, 164.8] }, // A (화성 단조의 C#)
  ]

  private scheduleBoss(ctx: AudioContext): void {
    const step16 = 60 / 84 / 4
    const rage = this.boss === 2
    while (this.bgmNextBeat < ctx.currentTime + 0.4) {
      const t = this.bgmNextBeat
      const step = this.bgmBeatIndex % 64
      const bar = (step / 16) | 0
      const s16 = step % 16
      const ch = Sfx.BOSS[bar]
      // 합창 두 음 (마디 내내)
      if (s16 === 0) {
        this.bgmNote(t, ch.chord[0] * 2, 'sine', step16 * 16, 0.07, 1400)
        this.bgmNote(t, ch.chord[2] * 2 * 1.004, 'sine', step16 * 16, 0.05, 1400)
      }
      // 금관 찌르기: 1박 · 2박 뒤 엇박
      if (s16 === 0 || s16 === 6) for (const f of ch.chord) this.bgmNote(t, f, 'sawtooth', step16 * (s16 === 0 ? 3 : 2), 0.08, 760)
      // 8분 현악 반복 (근음 옥타브 · 5도)
      if (s16 % 2 === 0) this.bgmNote(t, ch.root * (s16 % 4 === 0 ? 2 : 3), 'sawtooth', step16 * 1.6, 0.15, 520)
      // 전투 북: 쿵 · 쿵 · 쿵, 넷째 마디(성나면 매 마디) 끝에 굴림
      const roll = s16 >= 13 && (bar === 3 || rage)
      if (s16 === 0 || s16 === 3 || s16 === 8 || (rage && s16 % 4 === 2) || roll) this.bgmTom(t, roll ? 0.45 : 0.8)
      if (s16 === 4 || s16 === 12) this.bgmSnare(t, rage ? 0.15 : 0.09)
      // 성남: 16분 높은 반복
      if (rage) this.bgmNote(t, ch.chord[(s16 >> 1) % 3] * 4, 'triangle', step16 * 0.9, 0.045, 3000)
      this.bgmNextBeat += step16
      this.bgmBeatIndex++
    }
  }

  /** 전투 북: 낮게 떨어지는 톰 + 가죽 치는 잡음 */
  private bgmTom(t0: number, peak: number): void {
    const ctx = this.ctx!
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(120, t0)
    osc.frequency.exponentialRampToValueAtTime(46, t0 + 0.3)
    const g = ctx.createGain()
    g.gain.setValueAtTime(peak, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.42)
    osc.connect(g)
    g.connect(this.bgmGain!)
    this.finish(osc, [g], null, false)
    osc.start(t0)
    osc.stop(t0 + 0.46)
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const flt = ctx.createBiquadFilter()
    flt.type = 'lowpass'
    flt.frequency.value = 520
    const gn = ctx.createGain()
    gn.gain.setValueAtTime(peak * 0.35, t0)
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12)
    src.connect(flt)
    flt.connect(gn)
    gn.connect(this.bgmGain!)
    this.finish(src, [flt, gn], null, false)
    src.start(t0)
    src.stop(t0 + 0.14)
  }

  /** 보스를 쓰러뜨렸다: 장조로 올라가는 금관 넷 + 심벌 */
  private bossWin(): void {
    const b = this.bus({ gain: 1, pan: 0, far: 0 }, 1)
    ;[293.7, 370.0, 440.0, 587.3].forEach((f, i) => {
      this.tone(b.node, b.t0 + i * 0.13, 0.9 - i * 0.1, 'sawtooth', f, f, 0.16, 0.01)
      this.tone(b.node, b.t0 + i * 0.13, 0.9 - i * 0.1, 'sine', f * 2, f * 2, 0.12, 0.01)
    })
    this.noiseBurst(b.node, b.t0 + 0.39, 1.2, 'highpass', 5200, 3800, 0.22)
  }

  private scheduleBgm(): void {
    const ctx = this.ctx
    if (!ctx || !this.bgmGain || ctx.state !== 'running') return
    if (this.bgmStyle === 'dark') {
      if (this.boss > 0) this.scheduleBoss(ctx)
      else this.scheduleDark(ctx)
      return
    }
    const step16 = 60 / 132 / 4 // 16분음표 길이
    this.intensity = Math.max(0, this.intensity - 0.0016)
    while (this.bgmNextBeat < ctx.currentTime + 0.3) {
      const t = this.bgmNextBeat
      const i = this.bgmBeatIndex
      const step = i % 64
      const bar = (step / 16) | 0
      const s16 = step % 16
      const ch = Sfx.PROG[bar]
      const hot = this.intensity > 0.35

      // 킥 (심장 박동처럼)
      if (s16 === 0 || s16 === 6 || s16 === 8 || (hot && s16 === 14)) this.bgmKick(t)
      // 스네어
      if (s16 === 4 || s16 === 12) this.bgmSnare(t, 0.22)
      if (hot && s16 === 15) this.bgmSnare(t, 0.12)
      // 하이햇
      if (s16 % 2 === 0) this.bgmHat(t, s16 % 4 === 0 ? 0.05 : 0.03)
      else if (hot) this.bgmHat(t, 0.022)
      // 16분 베이스 (8번째마다 옥타브 위로 튄다)
      const bassF = ch.root * (s16 % 8 === 7 ? 2 : 1)
      this.bgmNote(t, bassF, 'sawtooth', step16 * 0.85, 0.4, 220)
      // 아르페지오 (엇박)
      if (s16 % 2 === 1) {
        const n = ch.notes[((s16 / 2) | 0) % 3]
        this.bgmNote(t, n, 'triangle', step16 * 1.6, 0.16, 2600)
      }
      // 리드 모티프: 2·4마디에, 교전 중이면 항상
      if (bar % 2 === 1 || hot) {
        const lf = Sfx.LEAD[s16]
        if (lf) this.bgmNote(t, lf, 'square', step16 * 2.2, hot ? 0.13 : 0.09, 3200)
      }
      // 8마디마다 긴장 상승음
      if (step === 48 && this.intensity > 0.15) this.bgmRiser(t, step16 * 16)

      this.bgmNextBeat += step16
      this.bgmBeatIndex++
    }
  }

  private bgmNote(t0: number, f: number, type: OscillatorType, dur: number, peak: number, cutoff: number): void {
    const ctx = this.ctx!
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.value = f
    const flt = ctx.createBiquadFilter()
    flt.type = 'lowpass'
    flt.frequency.value = cutoff
    flt.Q.value = 1.2
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.linearRampToValueAtTime(peak, t0 + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(flt)
    flt.connect(g)
    g.connect(this.bgmGain!)
    this.finish(osc, [flt, g], null, false)
    osc.start(t0)
    osc.stop(t0 + dur + 0.05)
  }

  private bgmKick(t0: number): void {
    const ctx = this.ctx!
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(150, t0)
    osc.frequency.exponentialRampToValueAtTime(42, t0 + 0.12)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.9, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22)
    osc.connect(g)
    g.connect(this.bgmGain!)
    this.finish(osc, [g], null, false)
    osc.start(t0)
    osc.stop(t0 + 0.26)
  }

  private bgmSnare(t0: number, peak: number): void {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const flt = ctx.createBiquadFilter()
    flt.type = 'bandpass'
    flt.frequency.value = 1900
    flt.Q.value = 0.8
    const g = ctx.createGain()
    g.gain.setValueAtTime(peak, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16)
    src.connect(flt)
    flt.connect(g)
    g.connect(this.bgmGain!)
    this.finish(src, [flt, g], null, false)
    src.start(t0)
    src.stop(t0 + 0.18)
  }

  private bgmHat(t0: number, peak: number): void {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const flt = ctx.createBiquadFilter()
    flt.type = 'highpass'
    flt.frequency.value = 7000
    const g = ctx.createGain()
    g.gain.setValueAtTime(peak, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.045)
    src.connect(flt)
    flt.connect(g)
    g.connect(this.bgmGain!)
    this.finish(src, [flt, g], null, false)
    src.start(t0)
    src.stop(t0 + 0.06)
  }

  /** 서서히 차오르는 긴장음 */
  private bgmRiser(t0: number, dur: number): void {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    const flt = ctx.createBiquadFilter()
    flt.type = 'bandpass'
    flt.Q.value = 6
    flt.frequency.setValueAtTime(400, t0)
    flt.frequency.exponentialRampToValueAtTime(5200, t0 + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.linearRampToValueAtTime(0.16, t0 + dur * 0.85)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(flt)
    flt.connect(g)
    g.connect(this.bgmGain!)
    this.finish(src, [flt, g], null, false)
    src.start(t0)
    src.stop(t0 + dur + 0.1)
  }

  dispose(): void {
    this.stopBgm()
    this.unlockOff?.()
    this.unlockOff = null
    if (this.ctx) {
      void this.ctx.close()
      this.ctx = null
    }
  }
}
