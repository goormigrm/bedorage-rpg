// 효과음·배경음. 파일 없이 Web Audio 로 절차 생성한다 (오실레이터 + 노이즈 + 필터).
// sim 을 바꾸지 않는다: SimEvent 를 받아 소리만 낸다. 나중에 public/sfx/ 에 파일이 생기면 여기서 교체하면 된다.
// 브라우저 자동재생 정책: 첫 클릭/키 입력 전에는 소리가 나지 않는다 (그 전 이벤트는 버린다).

import { GameState, SPRINT_MUL, SimEvent } from '../core/state'
import { CHARACTERS } from '../core/characters'
import { WEAPONS, WeaponId } from '../core/weapons'
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
const MAX_LIVE = 140
const FRAME_BUDGET = 16
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
  /** 몬스터 소리 되풀이 제한 (무리 전투에서 같은 소리가 수십 번 겹치면 귀가 아프다) */
  private lastMHit = 0
  private lastMDeath = 0
  private lastMelee = 0
  private lastKill = 0
  private lastGrowl = 0
  private lastCountdownSec = -1
  private unlockOff: (() => void) | null = null
  private bgmTimer = 0
  private bgmNextBeat = 0
  private bgmBeatIndex = 0
  private bgmOn = false
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
    const ctx = new AudioContext()
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

  /** 한 걸음: 낮은 툭 + 짧은 스침. 좌우 발을 조금 다르게 해서 기계적이지 않게 */
  private foot(s: Spatial, right: boolean, mine: boolean): void {
    const { node, t0 } = this.bus(s, mine ? 0.3 : 0.62)
    const f = right ? 132 : 118
    this.tone(node, t0, 0.055, 'sine', f, f * 0.55, 0.5, 0.002)
    this.noiseBurst(node, t0, 0.045, 'bandpass', right ? 2100 : 1750, 700, 0.16, 1.4)
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
    for (const e of events) {
      // 남의 소리는 한 프레임 16개 · 동시에 140개까지 (내 소리와 드문 중요한 소리는 늘 낸다)
      const mineEv = 'p' in e && e.p === localPlayer
      if (!mineEv && !KEEP.has(e.type) && (this.live > MAX_LIVE || budget-- <= 0)) {
        this.dropped++
        continue
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
          // 으르렁: 깨어날 때, 그리고 가까이서 공격을 준비할 때 (거리 감쇠가 알아서 멀리 것을 줄인다)
          const now = performance.now()
          if (now - this.lastGrowl > (e.type === 'wake' ? 250 : 400)) {
            this.lastGrowl = now
            this.growl(sp(e.x, e.y), e.type === 'wake' ? 1 : 0.55)
          }
          if (e.type === 'wake') this.intensity = Math.min(1, this.intensity + 0.3)
          break
        }
        case 'swipe': {
          const b = this.bus(sp(e.x, e.y), 0.55)
          this.noiseBurst(b.node, b.t0, 0.12, 'bandpass', 900, 2600, 0.5, 1.2)
          break
        }
        case 'mshot': {
          const b = this.bus(sp(e.x, e.y), 0.6)
          this.tone(b.node, b.t0, 0.14, 'triangle', 760, 380, 0.35, 0.002)
          this.noiseBurst(b.node, b.t0, 0.06, 'highpass', 3000, 1500, 0.2)
          break
        }
        case 'shotEnd': {
          const b = this.bus(sp(e.x, e.y), 0.4)
          this.noiseBurst(b.node, b.t0, 0.05, 'bandpass', 1400, 600, 0.3)
          break
        }
        case 'boom': {
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
    } else {
      pan.connect(this.master!)
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
    this.live++
    src.onended = () => this.live--
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
    this.live++
    osc.onended = () => this.live--
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
      case 'cello': {
        // 고기 바이올린: 묵직한 휘두름(바람) + 현이 튕기는 소리 한 번 (첼로는 한 옥타브 낮게)
        const low = w === 'cello' ? 0.5 : 1
        this.noiseBurst(node, t0, 0.14, 'bandpass', 500 * low, 900 * low, 0.5, 0.6)
        this.tone(node, t0 + 0.02, 0.35, 'sawtooth', 392 * low, 386 * low, 0.18, 0.004)
        this.tone(node, t0 + 0.02, 0.3, 'triangle', 196 * low, 194 * low, 0.22, 0.004)
        break
      }
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
    const { node, t0 } = this.bus(s, 0.95)
    if (fam === 'violin') {
      this.tone(node, t0, 0.13, 'sine', 170, 55, 0.85, 0.002)
      this.noiseBurst(node, t0, 0.09, 'lowpass', 1100, 220, 0.65, 1)
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

  // ---------- 던전 배경음: 72 BPM 단조 (Dm - B♭ - Gm - A) ----------
  // 지하 묘지는 쫓기는 음악이 아니라 **스며드는** 음악이어야 한다(디아블로 1 의 트리스트럼·던전처럼).
  // 낮은 지속음 · 심장 박동 킥 · 드문 종소리 · 합창 같은 두 음. 교전이 붙으면 8분 맥박과 북이 더해진다.
  private static readonly DARK = [
    { root: 36.71, pad: [146.8, 174.6, 220.0] }, // Dm
    { root: 29.14, pad: [116.5, 146.8, 174.6] }, // B♭
    { root: 49.0, pad: [196.0, 233.1, 293.7] }, // Gm
    { root: 55.0, pad: [220.0, 277.2, 329.6] }, // A (화성 단조의 C#)
  ]
  private static readonly BELL = [0, 0, 587.3, 0, 0, 0, 698.5, 0, 0, 0, 880.0, 0, 0, 0, 659.3, 0]

  private scheduleDark(ctx: AudioContext): void {
    const step16 = 60 / 72 / 4
    this.intensity = Math.max(0, this.intensity - 0.0012)
    while (this.bgmNextBeat < ctx.currentTime + 0.4) {
      const t = this.bgmNextBeat
      const step = this.bgmBeatIndex % 64
      const bar = (step / 16) | 0
      const s16 = step % 16
      const ch = Sfx.DARK[bar]
      const hot = this.intensity > 0.3
      // 마디 시작: 낮은 지속음 + 합창 두 음 (길게)
      if (s16 === 0) {
        this.bgmNote(t, ch.root * 2, 'sawtooth', step16 * 16, 0.28, 320)
        this.bgmNote(t, ch.pad[0], 'sine', step16 * 15, 0.07, 900)
        this.bgmNote(t, ch.pad[2] * 1.003, 'sine', step16 * 15, 0.05, 900)
      }
      // 심장 박동: 쿵-쿵 (교전 중엔 두 배)
      if (s16 === 0 || s16 === 2 || (hot && (s16 === 8 || s16 === 10))) this.bgmKick(t)
      // 교전: 8분 낮은 맥박 + 먼 북
      if (hot && s16 % 2 === 0) this.bgmNote(t, ch.root * 4, 'sawtooth', step16 * 1.4, 0.12, 420)
      if (hot && s16 === 12) this.bgmSnare(t, 0.08)
      // 드문 종소리 (2·4마디, 조용할 때 더 또렷하게)
      const bell = Sfx.BELL[s16]
      if (bell && bar % 2 === 1) this.bgmNote(t, bell * (bar === 3 ? 0.944 : 1), 'triangle', step16 * 7, hot ? 0.05 : 0.08, 2400)
      this.bgmNextBeat += step16
      this.bgmBeatIndex++
    }
  }

  private scheduleBgm(): void {
    const ctx = this.ctx
    if (!ctx || !this.bgmGain || ctx.state !== 'running') return
    if (this.bgmStyle === 'dark') {
      this.scheduleDark(ctx)
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
