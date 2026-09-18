// HUD 오버레이 (2D 캔버스). 3D 씬 위에 투명하게 겹친다. sim 을 바꾸지 않는다.
// 협동: 위 가운데 층 목표(남은 몬스터), 왼쪽 아래 내 카드, 오른쪽 아래 파티(동료 체력은 늘 보인다), 가운데 알림.

import { WEAPONS } from '../core/weapons'
import { CHARACTERS } from '../core/characters'
import { GameState, PlayerState } from '../core/state'
import { WeaponId } from '../core/weapons'
import { D4Hud, HudCtx, setWeaponIconPainter } from './d4hud'

/** 기준 논리 해상도. 카메라 시야 보정의 기준점이기도 하다 */
export const BASE_W = 1280
export const BASE_H = 720

/**
 * 실제로 그리는 논리 해상도. **높이는 720 고정, 폭만 화면 비율에 맞춰 늘린다.**
 * 폰 가로(20:9 등)에서 1280×720 을 그대로 쓰면 좌우에 검은 여백이 크게 남기 때문이다.
 * 폭이 늘어난 만큼 좌우로 더 보이면 넓은 화면이 유리해지므로,
 * 렌더러가 세로 시야(fov)를 줄여 **보이는 월드 면적을 일정하게** 유지한다(renderer3d.resize).
 * `let` 이라 import 한 쪽에서도 갱신된 값을 본다(ES 모듈 live binding).
 */
export let VIEW_W = BASE_W
export let VIEW_H = BASE_H

/**
 * 화면 비율(가로/세로)에 맞춰 논리 폭을 정한다. 바뀌었으면 true (캔버스·카메라 갱신 필요).
 * 하한은 기준 비율(16:9) — 더 좁히면 가운데 점수판과 오른쪽 위 버튼이 겹친다.
 */
export function setViewAspect(aspect: number): boolean {
  const a = Math.min(2.4, Math.max(BASE_W / BASE_H, aspect || BASE_W / BASE_H))
  const w = Math.round((BASE_H * a) / 2) * 2 // 짝수로 맞춰 흐릿함 방지
  if (w === VIEW_W) return false
  VIEW_W = w
  VIEW_H = BASE_H
  return true
}

export const TEAM_NAMES = ['A팀', 'B팀']
export const TEAM_COLORS = ['#5aa9ff', '#ff6a5a']

export interface RenderOptions {
  showHud: boolean
  /** -1 이면 관전(시네마틱) */
  localPlayer: number
  /**
   * 카메라·시야의 기준이 되는 사람. 생략하면 localPlayer.
   * 죽어서 기다리는 동안 **나를 죽인 사람 시점**을 보여 줄 때 쓴다(HUD 의 내 카드는 그대로 나를 가리킨다).
   */
  viewer?: number
  /** 관전 중이라는 안내 문구 (있으면 화면 아래에 띄운다) */
  spectateLabel?: string
  cameraMode: 'follow' | 'both'
  names: string[]
  subLabels: string[]
  ping?: number
  message?: string
  /** 화면 좌표 커서 (로컬 플레이어용 조준선) */
  cursor?: { x: number; y: number }
  /** 커서가 적 위에 올라가 있다 (헤드샷이 날 수 있는 상태) → 조준선이 금색 */
  cursorOn?: boolean
  timeScale?: number
  /** 시야 제한 (기본 true, 관전이면 무시) */
  fog?: boolean
  /** 터치 조작 중. 오른쪽 아래는 버튼이 차지하므로 패널을 옮긴다 */
  touch?: boolean
  /** 층 이름 (위 가운데 목표 패널) */
  floorName?: string
  /** 자리별로 지금 말하고 있나 (음성 대화) */
  speaking?: boolean[]
}

export interface ScreenText {
  x: number
  y: number
  text: string
  k: number
  color: string
  big: boolean
  /** 글자 크기 배율 (막 뜰 때 튀어 오르는 느낌) */
  scale?: number
}

/** 피격 방향 표시: 화면 기준 각도(라디안, 0 = 오른쪽)와 남은 시간 */
interface HitDir {
  angle: number
  life: number
  max: number
  /** 큰 피해였나 (호가 굵어진다) */
  big: boolean
}

/** 가운데 알림 (쓰러짐 · 부활 · 사망). 여러 개가 겹치면 위아래로 쌓는다 */
interface Notice {
  text: string
  color: string
  life: number
  max: number
}


export class Hud {
  readonly ctx: CanvasRenderingContext2D
  /** 가운데 알림. 최대 3개 */
  private notices: Notice[] = []
  /** 디아블로 4 풍 패널 (오브·스킬 바·추적·파티) */
  private d4 = new D4Hud()
  private t = 0
  private lastDt = 0.016
  private hitDirs: HitDir[] = []
  /** 조준점 히트마커: 내 탄이 맞으면 조준점 네 귀퉁이가 잠깐 벌어진다 (헤드샷은 금색) */
  private hitMarkT = 0
  private hitMarkMax = 0.22
  private hitMarkHead = false
  private overT = 0
  private countdownPulse = 0
  private lastCountdownSec = -1
  private dpr = 1

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('HUD 캔버스를 만들 수 없습니다')
    this.ctx = ctx
    this.resize()
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    this.canvas.width = Math.round(VIEW_W * this.dpr)
    this.canvas.height = Math.round(VIEW_H * this.dpr)
  }

  /**
   * 어디서 맞았는지 화면 가장자리에 호로 알린다.
   * 시야가 좁은 게임이라 "어느 쪽에서 쐈는지" 를 모르면 대응할 수가 없다.
   * 각도는 **화면 기준**이라 호가 가리키는 쪽을 그대로 보면 된다.
   */
  hitMark(head: boolean): void {
    this.hitMarkMax = head ? 0.45 : 0.24
    this.hitMarkT = this.hitMarkMax
    this.hitMarkHead = head
  }

  addHitDir(angle: number, big: boolean): void {
    // 비슷한 방향이면 새로 만들지 말고 수명만 되살린다 (연사에 화면이 지저분해지지 않게)
    for (const h of this.hitDirs) {
      let d = Math.abs(h.angle - angle) % (Math.PI * 2)
      if (d > Math.PI) d = Math.PI * 2 - d
      if (d < 0.35) {
        h.life = h.max
        h.big = h.big || big
        return
      }
    }
    this.hitDirs.push({ angle, life: 1.1, max: 1.1, big })
  }

  /** 관전 중 안내 (누구 시점인지 · 바꾸는 법) */
  private drawSpectate(label: string): void {
    const ctx = this.ctx
    ctx.font = '600 15px "IBM Plex Sans KR", "Malgun Gothic", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const w = ctx.measureText(label).width + 34
    const y = VIEW_H - 112
    ctx.fillStyle = 'rgba(13,17,23,.78)'
    roundRect(ctx, VIEW_W / 2 - w / 2, y - 17, w, 34, 8)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,216,74,.35)'
    ctx.lineWidth = 1
    roundRect(ctx, VIEW_W / 2 - w / 2 + 0.5, y - 16.5, w - 1, 33, 8)
    ctx.stroke()
    ctx.fillStyle = '#ffd84a'
    ctx.fillText(label, VIEW_W / 2, y)
  }

  private drawHitDirs(): void {
    if (this.hitDirs.length === 0) return
    const ctx = this.ctx
    const cx = VIEW_W / 2
    const cy = VIEW_H / 2
    const r = Math.min(VIEW_W, VIEW_H) * 0.32
    ctx.save()
    ctx.lineCap = 'round'
    for (const h of this.hitDirs) {
      const k = h.life / h.max
      ctx.globalAlpha = Math.min(1, k * 1.6) * 0.85
      ctx.strokeStyle = h.big ? '#ff6a5a' : '#ffb0a4'
      ctx.lineWidth = h.big ? 9 : 6
      const half = h.big ? 0.34 : 0.26
      ctx.beginPath()
      ctx.arc(cx, cy, r + (1 - k) * 22, h.angle - half, h.angle + half)
      ctx.stroke()
    }
    ctx.restore()
    ctx.globalAlpha = 1
  }

  /** 가운데 알림 한 줄 (쓰러짐·부활·사망) */
  /** 새 지역: 지난 알림을 지운다 (새 지역 배너 위에 남지 않게) */
  clearNotices(): void {
    this.notices = []
  }

  /** 화면 위쪽의 큰 배너 (지역 이름 · 막을 끝냄). 4.5초 동안 떠 있다가 사라진다 */
  banner(title: string, sub: string, color = '#f1d58a'): void {
    this.d4.banner = { title, sub, color, t0: performance.now() }
  }

  notice(text: string, color: string): void {
    this.notices.push({ text, color, life: 2.2, max: 2.2 })
    if (this.notices.length > 3) this.notices.shift()
  }

  showOver(): void {
    this.overT = 0
  }

  /** 프레임 시작: 변환 초기화 + 지우기 */
  begin(dt: number): void {
    this.t += dt
    this.lastDt = dt
    if (this.hitMarkT > 0) this.hitMarkT = Math.max(0, this.hitMarkT - dt)
    const ctx = this.ctx
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, VIEW_W, VIEW_H)
    for (const b of this.notices) b.life -= dt
    this.notices = this.notices.filter((b) => b.life > 0)
    for (let i = this.hitDirs.length - 1; i >= 0; i--) {
      this.hitDirs[i].life -= dt
      if (this.hitDirs[i].life <= 0) this.hitDirs.splice(i, 1)
    }
    this.overT += dt
  }

  drawTexts(texts: ScreenText[]): void {
    const ctx = this.ctx
    for (const t of texts) {
      ctx.globalAlpha = Math.min(1, t.k * 2)
      ctx.font = `${t.big ? 800 : 700} ${Math.round((t.big ? 20 : 15) * (t.scale ?? 1))}px "IBM Plex Sans KR", "Malgun Gothic", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(0,0,0,0.7)'
      ctx.strokeText(t.text, t.x, t.y)
      ctx.fillStyle = t.color
      ctx.fillText(t.text, t.x, t.y)
    }
    ctx.globalAlpha = 1
  }

  drawVignette(): void {
    const ctx = this.ctx
    const g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.5, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.78)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, 'rgba(0,0,0,0.35)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, VIEW_W, VIEW_H)
  }

  drawMain(s: GameState, opts: RenderOptions): void {
    if (opts.showHud) this.drawPanels(s, opts)
    this.drawHitDirs()
    if (opts.spectateLabel) this.drawSpectate(opts.spectateLabel)
    this.drawBanner(s, opts)
    const lp = opts.localPlayer
    if (opts.cursor && lp !== -1) this.drawCursor(opts.cursor, s.players[lp], opts.cursorOn === true)
  }

  private drawPanels(s: GameState, opts: RenderOptions): void {
    const ctx = this.ctx
    const h: HudCtx = { ctx, W: VIEW_W, H: VIEW_H, t: this.t }
    const lp = opts.localPlayer
    if (lp !== -1) this.d4.drawLowHealth(h, s.players[lp])
    this.d4.dungeon = s.mode === 'dungeon'
    this.d4.drawTracker(h, s, opts)
    if (s.mode === 'dungeon') {
      this.d4.drawBoss(h, s)
      this.d4.drawBanner(h)
    }
    this.d4.drawParty(h, s, opts)
    if (lp !== -1) this.d4.drawBottom(h, s.players[lp], opts.cursor, this.lastDt)
    if (lp !== -1) this.drawMyStatus(s.players[lp], s)

    if (s.phase === 'countdown') {
      const sec = Math.ceil(s.phaseTimer / 60)
      if (sec !== this.lastCountdownSec) {
        this.lastCountdownSec = sec
        this.countdownPulse = 1
      }
      this.countdownPulse = Math.max(0, this.countdownPulse - 0.03)
      const scale = 1 + this.countdownPulse * 0.5
      ctx.save()
      ctx.translate(VIEW_W / 2, VIEW_H / 2 - 20)
      ctx.scale(scale, scale)
      ctx.font = '400 120px "Black Han Sans", "IBM Plex Sans KR", sans-serif'
      ctx.textAlign = 'center'
      ctx.lineWidth = 8
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'
      ctx.strokeText(`${sec}`, 0, 0)
      ctx.fillStyle = '#ffd84a'
      ctx.fillText(`${sec}`, 0, 0)
      ctx.restore()
      ctx.font = '500 18px "IBM Plex Sans KR", sans-serif'
      ctx.fillStyle = '#e6edf3'
      ctx.textAlign = 'center'
      ctx.fillText('준비', VIEW_W / 2, VIEW_H / 2 + 70)
    } else if (s.phase === 'playing' && s.tick < 240 && s.mode === 'arena') {
      // 대전 게임의 "시작!" 은 투기장에만 (던전은 마을에 서 있을 뿐 — GUIDE 15장 3)
      const k = 1 - (s.tick - 180) / 60
      ctx.globalAlpha = Math.max(0, k)
      ctx.font = '400 96px "Black Han Sans", "IBM Plex Sans KR", sans-serif'
      ctx.textAlign = 'center'
      ctx.lineWidth = 8
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'
      ctx.strokeText('시작!', VIEW_W / 2, VIEW_H / 2 - 20)
      ctx.fillStyle = '#ffd84a'
      ctx.fillText('시작!', VIEW_W / 2, VIEW_H / 2 - 20)
      ctx.globalAlpha = 1
    }

    if (opts.ping !== undefined) {
      ctx.font = '500 12px "IBM Plex Mono", monospace'
      ctx.textAlign = 'right'
      ctx.fillStyle = opts.ping < 80 ? '#8fd18a' : opts.ping < 150 ? '#f2c94c' : '#f25c4c'
      ctx.fillText(`${opts.ping} ms`, VIEW_W - 16, 22)
    }
    if (opts.message) {
      ctx.font = '500 16px "IBM Plex Sans KR", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = 'rgba(13,17,23,0.82)'
      const tw = ctx.measureText(opts.message).width + 32
      roundRect(ctx, VIEW_W / 2 - tw / 2, VIEW_H / 2 + 100, tw, 34, 6)
      ctx.fill()
      ctx.fillStyle = '#e6edf3'
      ctx.fillText(opts.message, VIEW_W / 2, VIEW_H / 2 + 117)
    }
  }

  /** 가운데: 내가 쓰러졌거나 죽었을 때 무엇을 기다리는지 */
  private drawMyStatus(me: PlayerState, s: GameState): void {
    if (me.left || s.phase !== 'playing') return
    let title = ''
    let sub = ''
    if (me.alive && me.downed) {
      const others = s.players.some((p) => p.id !== me.id && p.alive && !p.downed && !p.left)
      title = '쓰러졌습니다'
      sub = others ? `동료가 곁에서 F 를 누르고 있으면 일어납니다 · ${Math.ceil(me.downTimer / 60)}초` : `${Math.ceil(me.downTimer / 60)}초 뒤 숨이 끊깁니다`
    } else if (!me.alive && me.out) {
      title = '탈락'
      sub = '하드코어 — 이번 원정은 관전만 할 수 있습니다'
    } else if (!me.alive) {
      title = '사망'
      sub = s.mode === 'arena' ? `${Math.ceil(me.respawnTimer / 60)}초 뒤 다시 나갑니다` : `${Math.ceil(me.respawnTimer / 60)}초 뒤 층 입구에서 다시 일어납니다`
    } else return
    const ctx = this.ctx
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '400 44px "Black Han Sans", "IBM Plex Sans KR", sans-serif'
    ctx.lineWidth = 6
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'
    ctx.strokeText(title, VIEW_W / 2, VIEW_H / 2 - 110)
    ctx.fillStyle = title === '탈락' ? '#ff5a4a' : '#ff8a7a'
    ctx.fillText(title, VIEW_W / 2, VIEW_H / 2 - 110)
    ctx.font = '500 15px "IBM Plex Sans KR", sans-serif'
    ctx.lineWidth = 3
    ctx.strokeText(sub, VIEW_W / 2, VIEW_H / 2 - 74)
    ctx.fillStyle = '#e6edf3'
    ctx.fillText(sub, VIEW_W / 2, VIEW_H / 2 - 74)
    ctx.restore()
  }

  private drawBanner(s: GameState, opts: RenderOptions): void {
    const ctx = this.ctx
    // 알림: 최근 것이 맨 위
    for (let n = 0; n < this.notices.length && s.phase !== 'over'; n++) {
      const b = this.notices[this.notices.length - 1 - n]
      const k = b.life / b.max
      const inK = Math.min(1, (b.max - b.life) * 6)
      ctx.globalAlpha = Math.min(1, k * 4) * inK
      const y = 110 + n * 44
      ctx.font = '400 24px "Black Han Sans", "IBM Plex Sans KR", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const tw = ctx.measureText(b.text).width + 48
      ctx.fillStyle = 'rgba(13,17,23,0.82)'
      roundRect(ctx, VIEW_W / 2 - tw / 2, y - 19, tw, 38, 6)
      ctx.fill()
      ctx.fillStyle = b.color
      roundRect(ctx, VIEW_W / 2 - tw / 2, y - 19, 5, 38, 3)
      ctx.fill()
      ctx.fillText(b.text, VIEW_W / 2, y + 1)
      ctx.globalAlpha = 1
    }
    if (s.phase === 'over' && s.winner !== -1) {
      const arena = s.mode === 'arena'
      const cleared = arena ? opts.localPlayer >= 0 && s.players[opts.localPlayer].team === s.winner : s.winner === 0
      const winName = arena ? (s.players.some((p, i) => p.team === s.winner && i !== s.winner) ? (s.winner === 0 ? 'A팀' : 'B팀') : opts.names[s.winner] ?? CHARACTERS[s.players[s.winner].char].name) : ''
      const title = arena ? `${winName} 승리` : cleared ? '원정 완료!' : '전멸'
      const color = cleared ? '#e8c46a' : '#ff5a4a'
      const k = Math.min(1, this.overT * 1.5)
      ctx.fillStyle = `rgba(6,6,8,${0.6 * k})`
      ctx.fillRect(0, 0, VIEW_W, VIEW_H)
      ctx.save()
      ctx.translate(VIEW_W / 2, VIEW_H / 2 - 30)
      const sc = 1 + (1 - k) * 0.6
      ctx.scale(sc, sc)
      ctx.globalAlpha = k
      ctx.font = '400 84px "Black Han Sans", "IBM Plex Sans KR", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineWidth = 10
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'
      ctx.strokeText(title, 0, 0)
      ctx.fillStyle = color
      ctx.fillText(title, 0, 0)
      ctx.restore()
      ctx.globalAlpha = k
      ctx.font = '500 18px "IBM Plex Sans KR", sans-serif'
      ctx.fillStyle = '#e6edf3'
      ctx.textAlign = 'center'
      const kills = s.players.reduce((a, p) => a + p.kills, 0)
      ctx.fillText(arena ? `목표 ${s.targetKills}킬 달성` : cleared ? `도살자를 쓰러뜨렸습니다 · 괴물 ${kills}마리` : '모두 쓰러졌습니다', VIEW_W / 2, VIEW_H / 2 + 44)
      ctx.globalAlpha = 1
    }
    void opts
  }

  private drawCursor(cur: { x: number; y: number }, me: PlayerState, on: boolean): void {
    const ctx = this.ctx
    const r = me.ads ? 6 : 12 + me.recoil * 0.4
    // 상대 위에 올라가 있으면 금색 — 지금 쏘면 헤드샷이 날 수 있다는 신호
    ctx.strokeStyle = on ? 'rgba(255,216,74,0.95)' : 'rgba(255,255,255,0.9)'
    ctx.lineWidth = on ? 2.5 : 2
    ctx.beginPath()
    ctx.moveTo(cur.x - r - 6, cur.y)
    ctx.lineTo(cur.x - r, cur.y)
    ctx.moveTo(cur.x + r, cur.y)
    ctx.lineTo(cur.x + r + 6, cur.y)
    ctx.moveTo(cur.x, cur.y - r - 6)
    ctx.lineTo(cur.x, cur.y - r)
    ctx.moveTo(cur.x, cur.y + r)
    ctx.lineTo(cur.x, cur.y + r + 6)
    ctx.stroke()
    ctx.fillStyle = on ? 'rgba(255,216,74,0.95)' : 'rgba(255,255,255,0.9)'
    ctx.beginPath()
    ctx.arc(cur.x, cur.y, on ? 2.2 : 1.5, 0, Math.PI * 2)
    ctx.fill()
    // 히트마커: 네 귀퉁이 사선이 바깥으로 벌어지며 사라진다. 몸통은 **빨강**, 머리는 **금색**으로 더 크고 오래 + 링
    if (this.hitMarkT > 0) {
      const k = this.hitMarkT / this.hitMarkMax
      const head = this.hitMarkHead
      const d0 = r + 6 + (1 - k) * (head ? 9 : 5)
      const d1 = d0 + (head ? 16 : 10)
      ctx.strokeStyle = head ? `rgba(255,216,74,${k.toFixed(3)})` : `rgba(255,70,58,${k.toFixed(3)})`
      ctx.lineWidth = head ? 4 : 3
      ctx.beginPath()
      for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
        ctx.moveTo(cur.x + sx * d0 * 0.7071, cur.y + sy * d0 * 0.7071)
        ctx.lineTo(cur.x + sx * d1 * 0.7071, cur.y + sy * d1 * 0.7071)
      }
      ctx.stroke()
      if (head) {
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(cur.x, cur.y, d1 + 4 + (1 - k) * 10, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
  }
}

/**
 * 무기 그림 (덕의 킬 배너에서 가져옴 — 아이템 아이콘·캐릭터 창에 다시 쓴다). (cx, cy) 가운데, 폭 약 50px, 총구는 오른쪽(죽은 사람 쪽).
 * 화살표 "▶" 대신 무엇으로 죽였는지 보여 준다 (2026-09-05 요청). 선 몇 개로 그린 실루엣이라 폰트가 없어도 같다.
 */
export function drawWeaponIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, w0: WeaponId): void {
  // 변형 무기는 계열의 실루엣으로 그리고 오른쪽 위에 작은 별을 단다 (리볼버 → 권총 모양 ★)
  const w = WEAPONS[w0]?.family ?? w0
  ctx.save()
  ctx.translate(cx, cy + 1)
  ctx.scale(1.25, 1.25) // 34px 글자 옆에서 눈에 들어오는 크기
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#e6edf3'
  ctx.fillStyle = '#e6edf3'
  const line = (x0: number, y0: number, x1: number, y1: number, t: number) => {
    ctx.lineWidth = t
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
  }
  const body = (x0: number, x1: number, t = 6) => line(x0, -3, x1, -3, t) // 몸통·총열 (y=-3 선상)
  const grip = (x: number) => line(x, 0, x - 3, 10, 4) // 손잡이
  const mag = (x: number, len = 9) => line(x, 0, x - 1, len, 3.5) // 탄창
  const stock = (x: number) => line(x, -3, x - 11, 3, 5) // 개머리판
  switch (w) {
    case 'pistol':
      body(-9, 11, 7)
      line(-3, 0, -6, 11, 5) // 손잡이(권총은 크게)
      line(2, 1, 2, 5, 2) // 방아쇠
      break
    case 'smg':
      body(-14, 8)
      body(8, 18, 3.5)
      grip(-8)
      mag(1)
      break
    case 'rifle':
      stock(-14)
      body(-14, 8)
      body(8, 25, 3.5)
      grip(-6)
      mag(3)
      break
    case 'shotgun':
      stock(-14)
      body(-14, 4)
      body(4, 26, 4)
      line(2, 2, 12, 2, 3.5) // 펌프
      grip(-8)
      break
    case 'sniper':
      stock(-16)
      body(-16, 4, 5.5)
      body(4, 28, 3)
      line(-8, -9, 6, -9, 3) // 조준경
      ctx.strokeStyle = '#f2c94c'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(7, -9, 2.6, 0, Math.PI * 2)
      ctx.stroke()
      ctx.strokeStyle = '#e6edf3'
      grip(-8)
      mag(0, 6)
      break
    case 'mg':
      stock(-16)
      body(-16, 6, 8)
      body(6, 26, 4)
      line(14, 0, 10, 9, 2.5) // 양각대
      line(14, 0, 18, 9, 2.5)
      grip(-9)
      ctx.fillRect(-5, 0, 9, 9) // 탄통
      break
    case 'pan':
      // 옆에서 본 후라이팬: 손잡이 + 납작한 팬, 위에 계란후라이
      line(-23, 0, -7, 0, 4)
      ctx.beginPath()
      ctx.ellipse(8, 1, 14, 5, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.ellipse(8, -3, 8, 3.2, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#f2c94c'
      ctx.beginPath()
      ctx.arc(8, -3.5, 2.6, 0, Math.PI * 2)
      ctx.fill()
      break
  }
  if (w !== w0) {
    ctx.fillStyle = '#ffd86a'
    ctx.font = '700 9px sans-serif'
    ctx.fillText('★', 10, -8)
  }
  ctx.restore()
}

/** 탄창의 20% 이하 (재장전 중·무한 탄약 제외). 카드 숫자와 캐릭터 옆 표시가 같은 기준을 쓴다 */
export function lowAmmo(p: PlayerState, w: { magSize: number }): boolean {
  return w.magSize > 0 && p.alive && p.reloadTimer === 0 && p.ammo <= Math.max(1, Math.ceil(w.magSize * 0.2))
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
  ctx.lineTo(x + rr, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr)
  ctx.lineTo(x, y + rr)
  ctx.quadraticCurveTo(x, y, x + rr, y)
  ctx.closePath()
}

export function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0')
}

// 스킬 바의 무기 칸이 덕의 무기 그림을 쓴다 (d4hud 가 hud 를 import 하면 순환이라 주입한다)
setWeaponIconPainter(drawWeaponIcon)
