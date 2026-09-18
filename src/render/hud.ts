// HUD 오버레이 (2D 캔버스). 3D 씬 위에 투명하게 겹친다. sim 을 바꾸지 않는다.
// 2명이면 좌우 카드, 3~4명이면 내 카드 + 오른쪽 아래 상대 목록. 팀전은 위 점수판이 A팀 : B팀.

import { CHARACTERS, CharacterDef } from '../core/characters'
import { GameState, PlayerState, isTeamMatch, teamKills } from '../core/state'
import { WEAPONS, WeaponId } from '../core/weapons'

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

interface Banner {
  /** 죽인 사람 · 죽은 사람. 사이에는 화살표 대신 **무기 그림**을 그린다 (2026-09-05 요청) */
  left: string
  right: string
  weapon: WeaponId
  /** "복수!" 같은 꼬리표 (없으면 생략) */
  tag?: string
  life: number
  max: number
  color: string
}

/** 나간 자리 표시. 한 번도 사람이 앉지 않은 자리는 "나감" 이 아니라 "빈 자리" */
function leftLabel(p: PlayerState): string {
  return p.vacant ? '빈 자리' : '나감'
}

/** 점수판 이름: 닉네임(캐릭터). 닉네임이 없어 캐릭터 이름을 그대로 쓰는 사람은 캐릭터 이름만 */
function nameTag(nick: string, p: PlayerState): string {
  const c = CHARACTERS[p.char].name
  return nick === c || nick.startsWith(c + ' ') ? nick : `${nick}(${c})`
}

/** 글자가 maxW 를 넘으면 크기를 줄여 맞춘다 (닉네임 8자 + 캐릭터 이름이 판 밖으로 나가지 않게). 최소 9px */
function fitFont(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number, weight: number): void {
  let px = size
  for (;;) {
    ctx.font = `${weight} ${px}px "IBM Plex Sans KR", "Malgun Gothic", sans-serif`
    if (ctx.measureText(text).width <= maxW || px <= 9) return
    px -= 0.5
  }
}

export class Hud {
  readonly ctx: CanvasRenderingContext2D
  /** 킬 배너. 여러 킬이 겹치면 최대 3개를 위아래로 쌓는다 (전에는 하나뿐이라 앞 것이 사라졌다 — 2026-09-05) */
  private banners: Banner[] = []
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

  showKill(state: GameState, killer: number, victim: number, names: string[], revenge = false): void {
    const kp = state.players[killer]
    const k = CHARACTERS[kp.char]
    this.banners.push({
      left: names[killer] ?? k.name,
      right: names[victim] ?? CHARACTERS[state.players[victim].char].name,
      weapon: kp.weapon,
      tag: revenge ? '복수!' : undefined,
      life: revenge ? 2.2 : 1.6,
      max: revenge ? 2.2 : 1.6,
      color: hex(k.bodyColor),
    })
    if (this.banners.length > 3) this.banners.shift()
  }

  showOver(): void {
    this.overT = 0
  }

  /** 프레임 시작: 변환 초기화 + 지우기 */
  begin(dt: number): void {
    if (this.hitMarkT > 0) this.hitMarkT = Math.max(0, this.hitMarkT - dt)
    const ctx = this.ctx
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, VIEW_W, VIEW_H)
    for (const b of this.banners) b.life -= dt
    this.banners = this.banners.filter((b) => b.life > 0)
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
    const n = s.players.length
    const teams = isTeamMatch(s)

    if (teams) this.drawTeamScore(s, opts)
    else this.drawFfaScore(s, opts)

    // 아래: 내 카드(체력·기력·탄약) + 다른 사람 목록 (상대 체력은 숨김, 관전·아군만 표시)
    const lp = opts.localPlayer
    if (lp !== -1) this.drawPlayerCard(s.players[lp], CHARACTERS[s.players[lp].char], opts.names[lp], 24, VIEW_H - 46, 'left', true)
    this.drawOthersList(s, opts)
    void n

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
    } else if (s.phase === 'playing' && s.tick < 240) {
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

  /** 개인전 점수판: 2명은 "0 : 0", 3~4명은 이름·킬 한 줄 */
  private drawFfaScore(s: GameState, opts: RenderOptions): void {
    const ctx = this.ctx
    const n = s.players.length
    // 닉네임(캐릭터) 를 쓰므로 폭을 넉넉히 (닉네임 8자 + 캐릭터 3자가 들어가야 한다)
    const colW = 170
    const pw = n === 2 ? 540 : colW * n + 40
    const px = VIEW_W / 2 - pw / 2
    this.panel(px, 14, pw, 62)
    ctx.textBaseline = 'middle'
    if (n === 2) {
      const c0 = CHARACTERS[s.players[0].char]
      const c1 = CHARACTERS[s.players[1].char]
      ctx.font = '400 40px "Black Han Sans", "IBM Plex Sans KR", "Malgun Gothic", sans-serif'
      ctx.textAlign = 'center'
      ctx.fillStyle = '#e6edf3'
      ctx.fillText(`${s.players[0].kills}`, VIEW_W / 2 - 60, 44)
      ctx.fillText(`${s.players[1].kills}`, VIEW_W / 2 + 60, 44)
      ctx.fillStyle = '#6b7683'
      ctx.font = '400 26px "Black Han Sans", "IBM Plex Sans KR", sans-serif'
      ctx.fillText(':', VIEW_W / 2, 43)
      // 닉네임(캐릭터): 누가 무슨 캐릭터인지 한눈에. 이름이 길면 글자를 줄여 판 안에 들어가게 한다
      ctx.textAlign = 'right'
      ctx.fillStyle = hex(c0.bodyColor)
      fitFont(ctx, nameTag(opts.names[0], s.players[0]), pw / 2 - 108, 15, 600)
      ctx.fillText(nameTag(opts.names[0], s.players[0]), VIEW_W / 2 - 100, 38)
      ctx.textAlign = 'left'
      ctx.fillStyle = hex(c1.bodyColor)
      fitFont(ctx, nameTag(opts.names[1], s.players[1]), pw / 2 - 108, 15, 600)
      ctx.fillText(nameTag(opts.names[1], s.players[1]), VIEW_W / 2 + 100, 38)
      ctx.font = '400 11px "IBM Plex Sans KR", sans-serif'
      ctx.fillStyle = '#7d8896'
      ctx.textAlign = 'right'
      ctx.fillText(opts.subLabels[0], VIEW_W / 2 - 100, 58)
      ctx.textAlign = 'left'
      ctx.fillText(opts.subLabels[1], VIEW_W / 2 + 100, 58)
    } else {
      for (let i = 0; i < n; i++) {
        const p = s.players[i]
        const c = CHARACTERS[p.char]
        const cx = px + 20 + colW * i + colW / 2
        ctx.textAlign = 'center'
        ctx.fillStyle = p.left ? '#666' : hex(c.bodyColor)
        const label = p.vacant ? opts.names[i] : nameTag(opts.names[i], p) + (i === opts.localPlayer ? ' (나)' : '')
        fitFont(ctx, label, colW - 12, 13, 600)
        ctx.fillText(label, cx, 30)
        ctx.font = '400 30px "Black Han Sans", "IBM Plex Sans KR", sans-serif'
        ctx.fillStyle = p.left ? '#666' : '#e6edf3'
        ctx.fillText(p.left ? leftLabel(p) : `${p.kills}`, cx, 54)
        if (i > 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.1)'
          ctx.fillRect(px + 20 + colW * i, 24, 1, 42)
        }
      }
    }
    ctx.font = '500 11px "IBM Plex Mono", "IBM Plex Sans KR", monospace'
    ctx.fillStyle = '#a9b4c0'
    ctx.textAlign = 'center'
    ctx.fillText(`목표 ${s.targetKills} 킬`, VIEW_W / 2, 66)
  }

  /** 팀전 점수판: A팀 킬 : B팀 킬 + 팀원 이름 */
  private drawTeamScore(s: GameState, opts: RenderOptions): void {
    const ctx = this.ctx
    const pw = 660
    const px = VIEW_W / 2 - pw / 2
    this.panel(px, 14, pw, 62)
    ctx.textBaseline = 'middle'
    ctx.font = '400 40px "Black Han Sans", "IBM Plex Sans KR", sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = '#e6edf3'
    ctx.fillText(`${teamKills(s, 0)}`, VIEW_W / 2 - 60, 44)
    ctx.fillText(`${teamKills(s, 1)}`, VIEW_W / 2 + 60, 44)
    ctx.fillStyle = '#6b7683'
    ctx.font = '400 26px "Black Han Sans", "IBM Plex Sans KR", sans-serif'
    ctx.fillText(':', VIEW_W / 2, 43)
    for (const team of [0, 1]) {
      const side = team === 0 ? -1 : 1
      const x = VIEW_W / 2 + side * 100
      ctx.textAlign = team === 0 ? 'right' : 'left'
      ctx.font = '600 15px "IBM Plex Sans KR", sans-serif'
      ctx.fillStyle = TEAM_COLORS[team]
      ctx.fillText(TEAM_NAMES[team], x, 32)
      const members = s.players.map((p, i) => ({ p, i })).filter((m) => m.p.team === team && !m.p.vacant)
      ctx.fillStyle = '#a9b4c0'
      const line = members.map((m) => `${nameTag(opts.names[m.i], m.p)}${m.i === opts.localPlayer ? '(나)' : ''} ${m.p.kills}`).join(' · ')
      fitFont(ctx, line, pw / 2 - 108, 11, 400)
      ctx.fillText(line, x, 52)
    }
    ctx.font = '500 11px "IBM Plex Mono", "IBM Plex Sans KR", monospace'
    ctx.fillStyle = '#a9b4c0'
    ctx.textAlign = 'center'
    ctx.fillText(`목표 ${s.targetKills} 킬`, VIEW_W / 2, 66)
  }

  private panel(x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx
    ctx.fillStyle = 'rgba(13,17,23,0.8)'
    roundRect(ctx, x, y, w, h, 8)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'
    ctx.lineWidth = 1
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 8)
    ctx.stroke()
  }

  /** 3~4명: 오른쪽 아래에 나 이외 사람들의 간단 상태 */
  private drawOthersList(s: GameState, opts: RenderOptions): void {
    const ctx = this.ctx
    const teams = isTeamMatch(s)
    const others = s.players.map((p, i) => ({ p, i })).filter((m) => m.i !== opts.localPlayer)
    const rowH = 30
    const w = 280
    const h = others.length * rowH + 14
    // 터치 조작이면 오른쪽 아래가 버튼 자리라 미니맵 밑으로 내린다
    const x = opts.touch ? 24 : VIEW_W - 24 - w
    const y = opts.touch ? 224 : VIEW_H - 46 - h // 미니맵(190 + 여백) 아래
    this.panel(x, y, w, h)
    others.forEach((m, r) => {
      const c = CHARACTERS[m.p.char]
      const ry = y + 8 + r * rowH
      ctx.fillStyle = m.p.left ? '#555' : hex(c.bodyColor)
      roundRect(ctx, x + 10, ry + 4, 4, rowH - 10, 2)
      ctx.fill()
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      ctx.font = '600 13px "IBM Plex Sans KR", "Malgun Gothic", sans-serif'
      ctx.fillStyle = m.p.left ? '#777' : '#e6edf3'
      ctx.fillText(opts.names[m.i], x + 22, ry + rowH / 2 - 1)
      if (teams) {
        ctx.font = '500 10px "IBM Plex Mono", monospace'
        ctx.fillStyle = TEAM_COLORS[m.p.team] ?? '#999'
        ctx.fillText(TEAM_NAMES[m.p.team] ?? '', x + 22 + ctx.measureText(opts.names[m.i]).width + 30, ry + rowH / 2 - 1)
      }
      // 체력 바는 관전자와 아군에게만. 상대 정보는 숨긴다
      const reveal = opts.localPlayer === -1 || (teams && opts.localPlayer >= 0 && s.players[opts.localPlayer].team === m.p.team)
      if (reveal) {
        const hpK = m.p.left ? 0 : Math.max(0, m.p.hp / m.p.maxHp)
        ctx.fillStyle = 'rgba(255,255,255,0.1)'
        roundRect(ctx, x + 150, ry + rowH / 2 - 4, 70, 8, 3)
        ctx.fill()
        ctx.fillStyle = !m.p.alive ? '#555' : hpK > 0.5 ? '#6fd66a' : hpK > 0.25 ? '#f2c94c' : '#f25c4c'
        roundRect(ctx, x + 150, ry + rowH / 2 - 4, 70 * hpK, 8, 3)
        ctx.fill()
      }
      ctx.font = '600 12px "IBM Plex Mono", monospace'
      ctx.textAlign = 'right'
      ctx.fillStyle = '#a9b4c0'
      const status = m.p.left ? leftLabel(m.p) : m.p.choosing ? '캐릭터 선택 중' : !m.p.alive ? `리스폰 ${Math.ceil(m.p.respawnTimer / 60)}` : `${m.p.kills}킬`
      ctx.fillText(status, x + w - 12, ry + rowH / 2 - 1)
    })
  }

  private drawPlayerCard(p: PlayerState, c: CharacterDef, name: string, x: number, y: number, side: 'left' | 'right', isLocal: boolean): void {
    const ctx = this.ctx
    const w = WEAPONS[p.weapon]
    const cw = 300
    const ch = 92
    const bx = side === 'left' ? x : x - cw
    const by = y - ch
    ctx.fillStyle = 'rgba(13,17,23,0.8)'
    roundRect(ctx, bx, by, cw, ch, 8)
    ctx.fill()
    if (isLocal) {
      ctx.strokeStyle = 'rgba(227,179,65,0.7)'
      ctx.lineWidth = 1.5
      roundRect(ctx, bx + 0.5, by + 0.5, cw - 1, ch - 1, 8)
      ctx.stroke()
    }
    ctx.fillStyle = hex(c.bodyColor)
    roundRect(ctx, side === 'left' ? bx : bx + cw - 6, by, 6, ch, 3)
    ctx.fill()
    const ix = bx + 18
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
    ctx.font = '600 16px "IBM Plex Sans KR", "Malgun Gothic", sans-serif'
    ctx.fillStyle = '#e6edf3'
    ctx.fillText(name, ix, by + 24)
    ctx.font = '400 11px "IBM Plex Sans KR", sans-serif'
    ctx.fillStyle = '#7d8896'
    ctx.fillText(`${c.passiveName} · ${c.basedOn}`, ix + ctx.measureText(name).width + 60, by + 24)
    const hpK = Math.max(0, p.hp / p.maxHp)
    ctx.fillStyle = 'rgba(255,255,255,0.1)'
    roundRect(ctx, ix, by + 34, 200, 12, 4)
    ctx.fill()
    ctx.fillStyle = !p.alive ? '#555' : hpK > 0.5 ? '#6fd66a' : hpK > 0.25 ? '#f2c94c' : '#f25c4c'
    roundRect(ctx, ix, by + 34, 200 * hpK, 12, 4)
    ctx.fill()
    ctx.font = '600 12px "IBM Plex Mono", monospace'
    ctx.fillStyle = '#e6edf3'
    ctx.fillText(p.alive ? `${Math.ceil(p.hp)} / ${p.maxHp}` : p.left ? leftLabel(p) : p.choosing ? '선택 중' : `리스폰 ${Math.ceil(p.respawnTimer / 60)}`, ix + 208, by + 45)
    ctx.font = '500 12px "IBM Plex Sans KR", sans-serif'
    ctx.fillStyle = '#a9b4c0'
    ctx.fillText(w.name, ix, by + 70)
    const infinite = w.magSize === 0
    // 탄 부족: 탄창의 20% 이하면 숫자가 빨갛게 깜빡인다 (재장전이 시작돼야 알던 것을 미리 — 2026-09-05)
    const low = lowAmmo(p, w)
    ctx.font = '400 30px "Black Han Sans", "IBM Plex Sans KR", sans-serif'
    ctx.fillStyle = p.reloadTimer > 0 ? '#f2c94c' : low ? (Math.floor(performance.now() / 260) % 2 === 0 ? '#f25c4c' : '#ffb3a8') : '#e6edf3'
    ctx.fillText(infinite ? '∞' : p.reloadTimer > 0 ? '재장전' : `${p.ammo}`, ix + 60, by + 78)
    if (infinite) {
      ctx.font = '500 12px "IBM Plex Sans KR", sans-serif'
      ctx.fillStyle = '#7d8896'
      ctx.fillText('근접', ix + 88, by + 76)
    } else if (p.reloadTimer === 0) {
      ctx.font = '500 13px "IBM Plex Mono", monospace'
      ctx.fillStyle = '#7d8896'
      ctx.fillText(`/ ${w.magSize}`, ix + 60 + ctx.measureText(`${p.ammo}`).width + 26, by + 76)
    } else {
      const k = 1 - p.reloadTimer / w.reloadTicks
      ctx.fillStyle = 'rgba(255,255,255,0.1)'
      roundRect(ctx, ix + 140, by + 66, 100, 6, 3)
      ctx.fill()
      ctx.fillStyle = '#f2c94c'
      roundRect(ctx, ix + 140, by + 66, 100 * k, 6, 3)
      ctx.fill()
    }
    const sk = Math.max(0, Math.min(1, p.stamina / p.staminaMax))
    ctx.fillStyle = 'rgba(255,255,255,0.1)'
    roundRect(ctx, ix + 208, by + 58, 60, 6, 3)
    ctx.fill()
    ctx.fillStyle = sk > 0.34 ? '#9fe0ff' : '#e08a5a'
    roundRect(ctx, ix + 208, by + 58, 60 * sk, 6, 3)
    ctx.fill()
    ctx.font = '400 10px "IBM Plex Sans KR", sans-serif'
    ctx.fillStyle = '#7d8896'
    ctx.fillText('기력', ix + 208, by + 78)
    if (p.legInjury > 0) {
      ctx.fillStyle = '#f2c94c'
      ctx.fillText('다리 부상', ix + 236, by + 78)
    }
  }

  private drawBanner(s: GameState, opts: RenderOptions): void {
    const ctx = this.ctx
    // 최근 것이 맨 위, 먼저 난 것은 아래로 밀린다
    for (let n = 0; n < this.banners.length && s.phase !== 'over'; n++) {
      const b = this.banners[this.banners.length - 1 - n]
      const k = b.life / b.max
      const inK = Math.min(1, (b.max - b.life) * 6)
      ctx.globalAlpha = Math.min(1, k * 4) * inK
      const y = 120 + n * 58
      ctx.font = '400 34px "Black Han Sans", "IBM Plex Sans KR", sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      // 이름 · [무기 그림] · 이름. 그림 자리는 무기와 상관없이 같은 폭이라 배너가 들썩이지 않는다
      const ICON_W = 72
      const lw = ctx.measureText(b.left).width
      const rw = ctx.measureText(b.right).width
      const tw = lw + ICON_W + rw + 64
      const x0 = VIEW_W / 2 - tw / 2
      ctx.fillStyle = 'rgba(13,17,23,0.82)'
      roundRect(ctx, x0, y - 26, tw, 52, 6)
      ctx.fill()
      ctx.fillStyle = b.color
      roundRect(ctx, x0, y - 26, 6, 52, 3)
      ctx.fill()
      ctx.fillStyle = '#e6edf3'
      ctx.fillText(b.left, x0 + 32, y)
      drawWeaponIcon(ctx, x0 + 32 + lw + ICON_W / 2, y, b.weapon)
      ctx.fillText(b.right, x0 + 32 + lw + ICON_W, y)
      if (b.tag) {
        // 꼬리표(복수!): 배너 왼쪽 위에 금색 알약
        ctx.font = '700 15px "IBM Plex Sans KR", sans-serif'
        const tw2 = ctx.measureText(b.tag).width + 22
        ctx.fillStyle = '#f2c94c'
        roundRect(ctx, x0 - 10, y - 44, tw2, 26, 13)
        ctx.fill()
        ctx.fillStyle = '#1a1406'
        ctx.textAlign = 'center'
        ctx.fillText(b.tag, x0 - 10 + tw2 / 2, y - 31)
        ctx.textAlign = 'left'
        ctx.font = '400 34px "Black Han Sans", "IBM Plex Sans KR", sans-serif'
      }
      ctx.globalAlpha = 1
    }
    const wi = s.winner
    if (s.phase === 'over' && wi !== -1) {
      const teams = isTeamMatch(s)
      const title = teams ? `${TEAM_NAMES[wi] ?? '?'} 승리` : `${opts.names[wi] ?? CHARACTERS[s.players[wi].char].name} 승리`
      const color = teams ? TEAM_COLORS[wi] ?? '#fff' : hex(CHARACTERS[s.players[wi].char].bodyColor)
      const k = Math.min(1, this.overT * 1.5)
      ctx.fillStyle = `rgba(10,12,8,${0.55 * k})`
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
      ctx.font = '400 40px "Black Han Sans", "IBM Plex Sans KR", sans-serif'
      ctx.fillStyle = '#e6edf3'
      ctx.textAlign = 'center'
      const score = teams
        ? `${teamKills(s, 0)}  :  ${teamKills(s, 1)}`
        : s.players.length === 2
          ? `${s.players[0].kills}  :  ${s.players[1].kills}`
          : s.players.map((p, i) => `${opts.names[i]} ${p.kills}`).join('  ·  ')
      ctx.fillText(score, VIEW_W / 2, VIEW_H / 2 + 44)
      ctx.font = '500 14px "IBM Plex Sans KR", sans-serif'
      ctx.fillStyle = '#a9b4c0'
      ctx.fillText(`목표 ${s.targetKills}킬 달성`, VIEW_W / 2, VIEW_H / 2 + 84)
      ctx.globalAlpha = 1
    }
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
 * 킬 배너용 무기 그림. (cx, cy) 가운데, 폭 약 50px, 총구는 오른쪽(죽은 사람 쪽).
 * 화살표 "▶" 대신 무엇으로 죽였는지 보여 준다 (2026-09-05 요청). 선 몇 개로 그린 실루엣이라 폰트가 없어도 같다.
 */
function drawWeaponIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: WeaponId): void {
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
