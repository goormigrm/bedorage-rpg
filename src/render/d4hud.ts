// 디아블로 4 풍 HUD (2026-09-18 사용자 요청: "UI 도 디아블로4 와 비슷하게, 대신 RPG 와 슈팅이 섞인 장르").
//
//  - 아래 가운데: 왼쪽 **체력 오브**(붉은 물) · 가운데 **스킬 바**(Q·E·X·구르기·무기) · 오른쪽 **탄약 오브**(놋쇠빛 물)
//    디아블로의 오른쪽 오브는 직업 자원이다. 슈터에서 그 자리는 탄창이 맞다 — 재장전하면 오브가 차오른다.
//    기력(구르기·달리기)은 스킬 바 위 가는 막대, 경험치는 스킬 바 아래 가는 막대(레벨은 M3).
//  - 오른쪽 위: 미니맵(렌더러) 아래 **목표 추적**(던전: 층·남은 괴물 · 투기장: 점수판)
//  - 왼쪽 위: **파티**(초상 · 체력 · 상태)
//  - 체력이 낮으면 화면 가장자리가 붉게 맥박친다.
// 모양은 어두운 쇠 바탕 + 바랜 금테 + 명조체 제목. 수치는 읽기 쉬운 고딕.

import { CHARACTERS, CharacterDef } from '../core/characters'
import { CHAR_SKILLS, FX_CRIT, FX_FREEAMMO, FX_GUARD, FX_PARTYDR, FX_SNIPE, FX_WHIRL, SKILLS, SKILL_KEYS, SkillId } from '../core/skills'
import { DEATH_RULE_LABEL, GameState, PlayerState, isTeamMatch, teamKills } from '../core/state'
import { EA_UNIQUE, MONSTER_LIST, isBossLike } from '../core/monsters'
import { ACTS, stageDef } from '../core/campaign'
import { WEAPONS } from '../core/weapons'
import { xpNeed } from '../core/items'
import { drawPortrait } from './character'
import { drawDashIcon, drawSkillIcon } from './skillIcons'
import type { RenderOptions } from './hud'

const SERIF = '"Nanum Myeongjo", "Batang", serif'
const SANS = '"IBM Plex Sans KR", "Malgun Gothic", sans-serif'
const GOLD = '#c9a24a'
const GOLD_HI = '#f1d58a'

/** 미니맵 한 변 (renderer3d 와 같아야 한다 — 추적 패널이 그 아래에 붙는다) */
export const MINIMAP_SIZE = 190

export interface HudCtx {
  ctx: CanvasRenderingContext2D
  W: number
  H: number
  t: number
}

function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, w / 2, h / 2)
  c.beginPath()
  c.moveTo(x + k, y)
  c.lineTo(x + w - k, y)
  c.quadraticCurveTo(x + w, y, x + w, y + k)
  c.lineTo(x + w, y + h - k)
  c.quadraticCurveTo(x + w, y + h, x + w - k, y + h)
  c.lineTo(x + k, y + h)
  c.quadraticCurveTo(x, y + h, x, y + h - k)
  c.lineTo(x, y + k)
  c.quadraticCurveTo(x, y, x + k, y)
  c.closePath()
}

/** 쇠 패널: 어두운 바탕 + 금테 두 줄 + 모서리 마름모 장식 */
export function ironPanel(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, ornate = true): void {
  c.save()
  const g = c.createLinearGradient(0, y, 0, y + h)
  g.addColorStop(0, 'rgba(28,24,21,0.94)')
  g.addColorStop(1, 'rgba(10,9,8,0.94)')
  c.fillStyle = g
  rr(c, x, y, w, h, 4)
  c.fill()
  c.strokeStyle = 'rgba(201,162,74,0.55)'
  c.lineWidth = 1.5
  rr(c, x + 0.75, y + 0.75, w - 1.5, h - 1.5, 4)
  c.stroke()
  c.strokeStyle = 'rgba(201,162,74,0.18)'
  c.lineWidth = 1
  rr(c, x + 4, y + 4, w - 8, h - 8, 2)
  c.stroke()
  if (ornate) {
    c.fillStyle = GOLD
    for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
      c.beginPath()
      c.moveTo(px, py - 5)
      c.lineTo(px + 5, py)
      c.lineTo(px, py + 5)
      c.lineTo(px - 5, py)
      c.closePath()
      c.fill()
    }
  }
  c.restore()
}

/**
 * 오브: 둥근 유리 안에 물이 차 있다. k = 0..1 채움. 수면은 천천히 출렁이고, 위쪽엔 유리 반사.
 * 둘레는 쇠 고리 + 금테.
 */
function orb(h: HudCtx, cx: number, cy: number, r: number, k: number, liquid: [string, string], label: string, sub: string, pulse = 0): void {
  const c = h.ctx
  c.save()
  // 바깥 쇠 고리
  const ring = c.createRadialGradient(cx, cy, r * 0.9, cx, cy, r * 1.22)
  ring.addColorStop(0, '#1a1614')
  ring.addColorStop(0.55, '#4a3f33')
  ring.addColorStop(1, '#0c0a09')
  c.fillStyle = ring
  c.beginPath()
  c.arc(cx, cy, r * 1.2, 0, Math.PI * 2)
  c.fill()
  c.strokeStyle = 'rgba(201,162,74,0.75)'
  c.lineWidth = 2
  c.beginPath()
  c.arc(cx, cy, r * 1.2, 0, Math.PI * 2)
  c.stroke()
  // 안쪽 어두운 유리
  c.fillStyle = '#070606'
  c.beginPath()
  c.arc(cx, cy, r, 0, Math.PI * 2)
  c.fill()
  // 물
  c.beginPath()
  c.arc(cx, cy, r - 1, 0, Math.PI * 2)
  c.clip()
  const top = cy + r - 2 * r * Math.max(0, Math.min(1, k))
  const lg = c.createLinearGradient(0, cy - r, 0, cy + r)
  lg.addColorStop(0, liquid[0])
  lg.addColorStop(1, liquid[1])
  c.fillStyle = lg
  c.beginPath()
  c.moveTo(cx - r, cy + r)
  for (let x = -r; x <= r; x += 4) {
    const y = top + Math.sin(h.t * 2.4 + x * 0.09) * 2.2 + Math.sin(h.t * 1.3 + x * 0.05) * 1.4
    c.lineTo(cx + x, y)
  }
  c.lineTo(cx + r, cy + r)
  c.closePath()
  c.fill()
  // 수면 밝은 선
  c.strokeStyle = 'rgba(255,255,255,0.25)'
  c.lineWidth = 1.5
  c.beginPath()
  for (let x = -r; x <= r; x += 4) {
    const y = top + Math.sin(h.t * 2.4 + x * 0.09) * 2.2 + Math.sin(h.t * 1.3 + x * 0.05) * 1.4
    if (x === -r) c.moveTo(cx + x, y)
    else c.lineTo(cx + x, y)
  }
  c.stroke()
  if (pulse > 0) {
    c.fillStyle = `rgba(255,60,40,${(0.18 * pulse).toFixed(3)})`
    c.fillRect(cx - r, cy - r, r * 2, r * 2)
  }
  c.restore()
  // 유리 반사
  c.save()
  const gl = c.createRadialGradient(cx - r * 0.35, cy - r * 0.45, 1, cx - r * 0.35, cy - r * 0.45, r * 0.7)
  gl.addColorStop(0, 'rgba(255,255,255,0.28)')
  gl.addColorStop(1, 'rgba(255,255,255,0)')
  c.fillStyle = gl
  c.beginPath()
  c.arc(cx, cy, r, 0, Math.PI * 2)
  c.fill()
  // 글자
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.font = `700 ${Math.round(r * 0.42)}px ${SANS}`
  c.lineWidth = 4
  c.strokeStyle = 'rgba(0,0,0,0.75)'
  c.strokeText(label, cx, cy - 2)
  c.fillStyle = '#f4ece0'
  c.fillText(label, cx, cy - 2)
  if (sub) {
    c.font = `600 ${Math.round(r * 0.2)}px ${SANS}`
    c.lineWidth = 3
    c.strokeText(sub, cx, cy + r * 0.38)
    c.fillStyle = '#d8ccb8'
    c.fillText(sub, cx, cy + r * 0.38)
  }
  c.restore()
}

/** 스킬 칸 하나. cdK = 남은 대기 비율(0 이면 준비), secs = 남은 초 */
function slot(h: HudCtx, x: number, y: number, s: number, key: string, cdK: number, secs: number, draw: (dim: boolean) => void, gold = false, active = 0): void {
  const c = h.ctx
  c.save()
  c.fillStyle = '#0b0a09'
  rr(c, x, y, s, s, 5)
  c.fill()
  const ready = cdK <= 0
  // 준비된 궁극기는 금빛으로 숨쉰다
  c.strokeStyle = gold ? (ready ? `rgba(241,213,138,${(0.75 + 0.25 * Math.sin(h.t * 4)).toFixed(3)})` : 'rgba(201,162,74,0.5)') : ready ? 'rgba(201,162,74,0.8)' : 'rgba(120,100,70,0.5)'
  c.lineWidth = gold ? 2.5 : 1.5
  rr(c, x + 0.5, y + 0.5, s - 1, s - 1, 5)
  c.stroke()
  if (gold && ready) {
    c.shadowColor = GOLD_HI
    c.shadowBlur = 14
    rr(c, x + 0.5, y + 0.5, s - 1, s - 1, 5)
    c.stroke()
    c.shadowBlur = 0
  }
  c.restore()
  draw(!ready)
  // 대기: 시계 방향으로 걷히는 어둠 + 남은 초
  if (!ready) {
    c.save()
    rr(c, x + 1, y + 1, s - 2, s - 2, 4)
    c.clip()
    c.fillStyle = 'rgba(0,0,0,0.62)'
    c.beginPath()
    c.moveTo(x + s / 2, y + s / 2)
    c.arc(x + s / 2, y + s / 2, s, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * cdK)
    c.closePath()
    c.fill()
    c.restore()
    c.save()
    c.font = `700 ${Math.round(s * 0.34)}px ${SANS}`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.lineWidth = 3
    c.strokeStyle = 'rgba(0,0,0,0.8)'
    const txt = secs >= 10 ? `${Math.ceil(secs)}` : secs.toFixed(1)
    c.strokeText(txt, x + s / 2, y + s / 2)
    c.fillStyle = '#ffffff'
    c.fillText(txt, x + s / 2, y + s / 2)
    c.restore()
  }
  // 버프 지속 중: 아래쪽 금색 막대
  if (active > 0) {
    c.fillStyle = GOLD_HI
    c.fillRect(x + 4, y + s - 5, (s - 8) * Math.min(1, active), 2.5)
  }
  // 키 표시
  c.save()
  c.font = `700 11px ${SANS}`
  const kw = Math.max(15, c.measureText(key).width + 8)
  c.fillStyle = 'rgba(0,0,0,0.85)'
  rr(c, x - 3, y + s - 13, kw, 16, 3)
  c.fill()
  c.strokeStyle = 'rgba(201,162,74,0.7)'
  c.lineWidth = 1
  rr(c, x - 3, y + s - 13, kw, 16, 3)
  c.stroke()
  c.fillStyle = GOLD_HI
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillText(key, x - 3 + kw / 2, y + s - 5)
  c.restore()
}

export class D4Hud {
  private portraits = new Map<string, HTMLCanvasElement>()
  /** 마우스를 올린 스킬 칸 (툴팁) 과 올려 둔 시간 */
  private hoverSlot = -1
  private hoverT = 0

  /** 파티 초상 (한 번 그려 둔다 — drawPortrait 는 무겁다) */
  private portrait(def: CharacterDef): HTMLCanvasElement {
    let cv = this.portraits.get(def.id)
    if (!cv) {
      cv = document.createElement('canvas')
      cv.width = 64
      cv.height = 64
      cv.style.width = '64px'
      cv.style.height = '64px'
      try {
        drawPortrait(cv, def)
      } catch {
        /* 그림이 실패해도 판은 돈다 */
      }
      this.portraits.set(def.id, cv)
    }
    return cv
  }

  /** 아래 가운데 묶음: 체력 오브 · 스킬 바 · 탄약 오브 · 기력 · 경험치 */
  drawBottom(h: HudCtx, me: PlayerState, cursor?: { x: number; y: number }, dt = 0.016): void {
    const c = h.ctx
    const cx = h.W / 2
    const R = 54
    const baseY = h.H - 70
    const w = WEAPONS[me.weapon]
    // ---- 스킬 바
    const S = 50
    const GAP = 9
    const ids = CHAR_SKILLS[me.char]
    const n = 5
    const barW = n * S + (n - 1) * GAP + 40
    const bx = cx - barW / 2
    const by = baseY - S / 2 - 12
    ironPanel(c, bx, by - 14, barW, S + 44)
    // 기력 (위 가는 막대)
    const stK = Math.max(0, Math.min(1, me.stamina / me.staminaMax))
    c.fillStyle = 'rgba(255,255,255,0.08)'
    c.fillRect(bx + 20, by - 6, barW - 40, 4)
    c.fillStyle = stK > 0.34 ? '#7fd0f0' : '#e08a5a'
    c.fillRect(bx + 20, by - 6, (barW - 40) * stK, 4)
    // 칸들: Q · E · X · 구르기 · 무기(좌클릭)
    const x0 = bx + 20
    const slotX = (i: number) => x0 + i * (S + GAP)
    const rects: { x: number; y: number; id?: SkillId; i: number }[] = []
    for (let k = 0; k < 3; k++) {
      const id = ids[k]
      const def = SKILLS[id]
      const cdK = me.cd[k] / def.cd
      const active = this.activeFor(id, me)
      slot(h, slotX(k), by, S, SKILL_KEYS[k], cdK, me.cd[k] / 60, (dim) => drawSkillIcon(c, id, slotX(k) + S / 2, by + S / 2, S * 0.62, dim), def.ult === true, active)
      rects.push({ x: slotX(k), y: by, id, i: k })
    }
    // 구르기: 대기(dashCooldown) 또는 기력 부족이면 어둡다
    const dashCd = me.dashCooldown / Math.max(1, CHARACTERS[me.char].dashCooldown)
    slot(h, slotX(3), by, S, 'Space', me.stamina < 34 ? 1 : dashCd, me.dashCooldown / 60, (dim) => drawDashIcon(c, slotX(3) + S / 2, by + S / 2, S * 0.62, dim))
    // 무기: 재장전 중이면 그 진행
    const relK = me.reloadTimer > 0 && w.reloadTicks > 0 ? me.reloadTimer / w.reloadTicks : 0
    slot(h, slotX(4), by, S, '좌클릭', relK, me.reloadTimer / 60, (dim) => {
      c.save()
      c.globalAlpha = dim ? 0.4 : 1
      drawWeaponGlyph(c, slotX(4) + S / 2, by + S / 2, me.weapon)
      c.restore()
    })
    // 경험치 (아래 가는 막대)
    const xpK = Math.min(1, me.xp / xpNeed(me.level))
    c.fillStyle = 'rgba(255,255,255,0.06)'
    c.fillRect(bx + 20, by + S + 16, barW - 40, 3)
    c.fillStyle = '#c9a24a'
    c.fillRect(bx + 20, by + S + 16, (barW - 40) * xpK, 3)
    c.font = `700 11px ${SERIF}`
    c.fillStyle = GOLD
    c.textAlign = 'left'
    c.textBaseline = 'middle'
    c.fillText(`Lv ${me.level}`, bx + 20, by + S + 26)
    c.textAlign = 'right'
    c.font = `600 10px ${SANS}`
    c.fillStyle = '#8d8170'
    c.fillText(`◈ ${me.gold}  ·  가방 ${me.bag.length} (I)`, bx + barW - 20, by + S + 26)

    // ---- 체력 오브 (왼쪽)
    const hpK = me.maxHp > 0 ? me.hp / me.maxHp : 0
    const lowPulse = me.alive && !me.downed && hpK < 0.3 ? 0.5 + 0.5 * Math.sin(h.t * 6) : 0
    const hpLabel = me.downed ? '쓰러짐' : !me.alive ? (me.out ? '탈락' : '사망') : `${Math.ceil(me.hp)}`
    orb(h, bx - R - 26, baseY - 6, R, me.alive ? hpK : 0, me.downed ? ['#5a5050', '#2a2424'] : ['#d8382a', '#5a0a0a'], hpLabel, me.alive && !me.downed ? `/ ${me.maxHp}` : '', lowPulse)
    // ---- 탄약 오브 (오른쪽): 탄창이 곧 자원. 재장전하면 차오른다
    let ammoK: number
    let ammoLabel: string
    let ammoSub: string
    if (w.magSize === 0) {
      ammoK = stK
      ammoLabel = '∞'
      ammoSub = '근접'
    } else if (me.reloadTimer > 0) {
      ammoK = 1 - me.reloadTimer / w.reloadTicks
      ammoLabel = '재장전'
      ammoSub = w.name
    } else {
      ammoK = me.ammo / w.magSize
      ammoLabel = me.fx[FX_FREEAMMO] > 0 ? '∞' : `${me.ammo}`
      ammoSub = `/ ${w.magSize} · ${w.name}`
    }
    const lowAmmo = w.magSize > 0 && me.reloadTimer === 0 && me.ammo <= Math.max(1, Math.ceil(w.magSize * 0.2)) ? 0.5 + 0.5 * Math.sin(h.t * 8) : 0
    orb(h, bx + barW + R + 26, baseY - 6, R, ammoK, ['#e2b24a', '#5a3a0c'], ammoLabel, ammoSub, lowAmmo)

    // ---- 툴팁: 스킬 칸에 커서를 잠시 올리면 이름·설명 (디아블로처럼)
    let over = -1
    if (cursor) for (const r of rects) if (cursor.x >= r.x && cursor.x <= r.x + S && cursor.y >= r.y && cursor.y <= r.y + S) over = r.i
    if (over !== this.hoverSlot) {
      this.hoverSlot = over
      this.hoverT = 0
    } else if (over >= 0) this.hoverT += dt
    if (over >= 0 && this.hoverT > 0.35) {
      const r = rects[over]
      this.tooltip(h, SKILLS[r.id!], r.x + S / 2, r.y - 22, SKILL_KEYS[over])
    }
  }

  /** 스킬에 딸린 버프가 남은 비율 (칸 아래 금색 막대) */
  private activeFor(id: SkillId, me: PlayerState): number {
    const f = me.fx
    switch (id) {
      case 'ironwall': return f[FX_GUARD] / 240
      case 'barrage': return f[FX_FREEAMMO] / 240
      case 'roar': return f[FX_PARTYDR] / 360
      case 'composure': return f[FX_CRIT] / 360
      case 'kitchen': return f[FX_WHIRL] / 300
      case 'ninelives': return f[FX_SNIPE] / 480
      case 'pierce': return me.pierceShots / 6
      case 'catstep': return me.empowerShots
      default: return 0
    }
  }

  private tooltip(h: HudCtx, def: (typeof SKILLS)[SkillId], cx: number, bottom: number, key: string): void {
    const c = h.ctx
    const W = 300
    c.save()
    c.font = `500 13px ${SANS}`
    const lines = wrap(c, def.desc, W - 28)
    const H = 58 + lines.length * 18
    const x = Math.max(8, Math.min(h.W - W - 8, cx - W / 2))
    const y = bottom - H
    ironPanel(c, x, y, W, H)
    c.textAlign = 'left'
    c.textBaseline = 'alphabetic'
    c.font = `800 17px ${SERIF}`
    c.fillStyle = def.ult ? GOLD_HI : '#efe4cf'
    c.fillText(def.name, x + 14, y + 26)
    c.font = `600 11px ${SANS}`
    c.fillStyle = '#9d8f78'
    c.fillText(`${def.ult ? '궁극기' : '스킬'} · ${key} · 재사용 ${Math.round(def.cd / 60)}초`, x + 14, y + 44)
    c.font = `500 13px ${SANS}`
    c.fillStyle = '#d8cfbf'
    lines.forEach((l, i) => c.fillText(l, x + 14, y + 64 + i * 18))
    c.restore()
  }

  /** 오른쪽 위, 미니맵 아래: 목표 추적 (던전) · 점수판 (투기장) */
  drawTracker(h: HudCtx, s: GameState, opts: RenderOptions): void {
    const c = h.ctx
    const W = MINIMAP_SIZE + 12
    const x = h.W - 16 - MINIMAP_SIZE - 6
    const y = 16 + MINIMAP_SIZE + 14
    c.save()
    c.textAlign = 'left'
    c.textBaseline = 'alphabetic'
    if (s.mode === 'dungeon') {
      const left = s.monsters.length
      const total = Math.max(1, s.monstersTotal)
      ironPanel(c, x, y, W, 84, false)
      c.font = `800 16px ${SERIF}`
      c.fillStyle = GOLD_HI
      c.fillText(opts.floorName ?? '던전', x + 12, y + 24)
      c.font = `600 12px ${SANS}`
      c.fillStyle = '#d8cfbf'
      const last = s.floor >= s.floorMax
      const sd = stageDef(s.stage)
      const goal = sd.boss !== undefined ? `◆ ${MONSTER_LIST[sd.boss].name}을(를) 쓰러뜨려라` : `◆ 우두머리 ${sd.unique?.name ?? ''} 처치`
      c.fillText(last ? goal : s.descend > 0 ? `◆ 내려가는 중… ${Math.ceil(s.descend / 60)}` : '◆ 계단(지도의 파란 원)에서 F', x + 12, y + 46)
      c.fillStyle = 'rgba(255,255,255,0.08)'
      c.fillRect(x + 12, y + 53, W - 24, 4)
      c.fillStyle = GOLD
      c.fillRect(x + 12, y + 53, (W - 24) * (1 - left / total), 4)
      c.font = `600 11px ${SANS}`
      c.fillStyle = s.deathRule === 2 ? '#ff7a6a' : '#8d8170'
      c.fillText(`죽음 규칙 · ${DEATH_RULE_LABEL[s.deathRule]}`, x + 12, y + 74)
    } else {
      const teams = isTeamMatch(s)
      const rows = teams
        ? [0, 1].map((t) => ({ name: t === 0 ? 'A팀' : 'B팀', kills: teamKills(s, t), me: opts.localPlayer >= 0 && s.players[opts.localPlayer].team === t, color: t === 0 ? '#5aa9ff' : '#ff6a5a' }))
        : s.players
            .map((p, i) => ({ name: opts.names[i] ?? CHARACTERS[p.char].name, kills: p.kills, me: i === opts.localPlayer, color: '#' + CHARACTERS[p.char].bodyColor.toString(16).padStart(6, '0'), gone: p.left }))
            .filter((r) => !('gone' in r) || !r.gone)
            .sort((a, b) => b.kills - a.kills)
      const H = 44 + rows.length * 20
      ironPanel(c, x, y, W, H, false)
      c.font = `800 16px ${SERIF}`
      c.fillStyle = GOLD_HI
      c.fillText(opts.floorName ?? '투기장', x + 12, y + 24)
      c.font = `600 11px ${SANS}`
      c.fillStyle = '#8d8170'
      c.textAlign = 'right'
      c.fillText(`목표 ${s.targetKills}킬`, x + W - 12, y + 24)
      rows.forEach((r, i) => {
        const ry = y + 44 + i * 20
        c.textAlign = 'left'
        c.fillStyle = r.color
        c.fillRect(x + 12, ry - 9, 4, 12)
        c.font = `${r.me ? 700 : 500} 12px ${SANS}`
        c.fillStyle = r.me ? '#ffe680' : '#d8cfbf'
        c.fillText(r.name + (r.me ? ' (나)' : ''), x + 22, ry + 1)
        c.textAlign = 'right'
        c.font = `700 13px ${SANS}`
        c.fillText(`${r.kills}`, x + W - 12, ry + 1)
      })
    }
    c.restore()
  }

  /** 위 가운데: 보스 체력 (깨어 있을 때만) — 디아블로식 긴 막대 */
  drawBoss(h: HudCtx, s: GameState): void {
    const boss = s.monsters.find((m) => m.hp > 0 && isBossLike(m) && m.st !== 0)
    if (!boss) return
    const unique = (boss.elite & EA_UNIQUE) !== 0
    const c = h.ctx
    const W = Math.min(560, h.W - 480)
    const x = h.W / 2 - W / 2
    const y = 22
    ironPanel(c, x - 10, y - 8, W + 20, 42)
    c.fillStyle = 'rgba(255,255,255,0.06)'
    c.fillRect(x, y + 14, W, 10)
    const k = Math.max(0, boss.hp / boss.maxHp)
    const g = c.createLinearGradient(x, 0, x + W, 0)
    g.addColorStop(0, '#6a0a0a')
    g.addColorStop(1, '#d8382a')
    c.fillStyle = g
    c.fillRect(x, y + 14, W * k, 10)
    c.font = `800 15px ${SERIF}`
    c.textAlign = 'center'
    c.textBaseline = 'alphabetic'
    c.fillStyle = unique ? '#ffb46a' : '#f1d58a'
    c.fillText(unique ? `${stageDef(s.stage).unique?.name ?? ''} · 우두머리` : MONSTER_LIST[boss.kind].name, h.W / 2, y + 8)
  }

  /**
   * 원정 시작 화면: 막 이름 · 원정 이름 · 소개 두 줄. 첫 층 카운트다운부터 약 6초 동안 떠 있다가 사라진다.
   * (판 안의 tick 만 보므로 난입·리싱크해도 같은 때 사라진다)
   */
  drawIntro(h: HudCtx, s: GameState): void {
    if (s.mode !== 'dungeon' || s.floor !== 1 || s.tick > 420) return
    const sd = stageDef(s.stage)
    const k = s.tick < 30 ? s.tick / 30 : s.tick > 330 ? Math.max(0, (420 - s.tick) / 90) : 1
    const c = h.ctx
    c.save()
    c.globalAlpha = k
    const cy = h.H * 0.19
    const g = c.createLinearGradient(0, cy - 70, 0, cy + 80)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(0.3, 'rgba(0,0,0,0.62)')
    g.addColorStop(0.7, 'rgba(0,0,0,0.62)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = g
    c.fillRect(0, cy - 70, h.W, 150)
    c.textAlign = 'center'
    c.textBaseline = 'alphabetic'
    c.font = `700 13px ${SERIF}`
    c.fillStyle = '#b8a67e'
    c.fillText(`${sd.act + 1}막 · ${ACTS[sd.act].name}`, h.W / 2, cy - 30)
    c.font = `800 30px ${SERIF}`
    c.fillStyle = GOLD_HI
    c.fillText(`${sd.act + 1}-${sd.n + 1}  ${sd.name}`, h.W / 2, cy + 6)
    c.font = `500 13px ${SERIF}`
    c.fillStyle = '#d8cfbf'
    sd.intro.split('\n').forEach((line, i) => c.fillText(line, h.W / 2, cy + 32 + i * 19))
    c.font = `600 11px ${SANS}`
    c.fillStyle = '#8d8170'
    c.fillText(`지역 레벨 ${sd.level} · ${sd.floors}층`, h.W / 2, cy + 32 + sd.intro.split('\n').length * 19 + 4)
    c.restore()
  }

  /** 왼쪽 위: 파티 (던전은 모두, 투기장은 같은 팀만 — 상대 정보는 숨긴다) */
  drawParty(h: HudCtx, s: GameState, opts: RenderOptions): void {
    const lp = opts.localPlayer
    const me = lp >= 0 ? s.players[lp] : null
    const mates = s.players.filter((p) => p.id !== lp && !p.vacant && (s.mode === 'dungeon' || (me && p.team === me.team && isTeamMatch(s))))
    if (mates.length === 0) return
    const c = h.ctx
    const x = 16
    let y = 64
    for (const p of mates) {
      const def = CHARACTERS[p.char]
      const W = 210
      ironPanel(c, x, y, W, 50, false)
      // 초상 (둥근 창)
      c.save()
      c.beginPath()
      c.arc(x + 26, y + 25, 19, 0, Math.PI * 2)
      c.clip()
      c.fillStyle = '#1a1614'
      c.fillRect(x + 7, y + 6, 38, 38)
      c.drawImage(this.portrait(def), x + 5, y + 4, 42, 42)
      if (!p.alive || p.downed || p.left) {
        c.fillStyle = 'rgba(120,0,0,0.45)'
        c.fillRect(x + 7, y + 6, 38, 38)
      }
      c.restore()
      c.strokeStyle = 'rgba(201,162,74,0.7)'
      c.lineWidth = 1.5
      c.beginPath()
      c.arc(x + 26, y + 25, 19, 0, Math.PI * 2)
      c.stroke()
      // 이름 · 체력
      c.font = `700 12px ${SANS}`
      c.textAlign = 'left'
      c.textBaseline = 'alphabetic'
      c.fillStyle = '#efe4cf'
      c.fillText(opts.names[p.id] ?? def.name, x + 52, y + 20)
      const hpK = p.alive && !p.downed && !p.left ? Math.max(0, p.hp / p.maxHp) : 0
      c.fillStyle = 'rgba(255,255,255,0.08)'
      c.fillRect(x + 52, y + 27, W - 64, 7)
      c.fillStyle = hpK > 0.5 ? '#b83a2a' : hpK > 0.25 ? '#d8782a' : '#ff3a2a'
      c.fillRect(x + 52, y + 27, (W - 64) * hpK, 7)
      c.font = `600 10px ${SANS}`
      c.fillStyle = p.downed ? '#ff8a7a' : '#8d8170'
      const st = p.left ? '나감' : p.downed ? `쓰러짐 ${Math.ceil(p.downTimer / 60)}초 — F 로 일으키기` : p.out ? '탈락' : !p.alive ? `사망 · ${Math.ceil(p.respawnTimer / 60)}초` : `${def.name} · ${WEAPONS[p.weapon].name}`
      c.fillText(st, x + 52, y + 45)
      y += 58
    }
  }

  /** 체력이 낮으면 화면 가장자리가 붉게 맥박친다 */
  drawLowHealth(h: HudCtx, me: PlayerState): void {
    if (!me.alive || me.downed) return
    const k = me.hp / me.maxHp
    if (k >= 0.35) return
    const c = h.ctx
    const a = (0.35 - k) / 0.35
    const pulse = 0.55 + 0.45 * Math.sin(h.t * 5)
    const g = c.createRadialGradient(h.W / 2, h.H / 2, h.H * 0.35, h.W / 2, h.H / 2, h.W * 0.7)
    g.addColorStop(0, 'rgba(120,0,0,0)')
    g.addColorStop(1, `rgba(150,0,0,${(0.55 * a * pulse).toFixed(3)})`)
    c.fillStyle = g
    c.fillRect(0, 0, h.W, h.H)
  }
}

function wrap(c: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = []
  let cur = ''
  for (const ch of text) {
    const next = cur + ch
    if (c.measureText(next).width > maxW && cur) {
      out.push(cur)
      cur = ch === ' ' ? '' : ch
    } else cur = next
  }
  if (cur) out.push(cur)
  return out
}

/** 무기 칸 그림: 덕의 무기 실루엣을 칸 크기에 맞춰 */
function drawWeaponGlyph(c: CanvasRenderingContext2D, cx: number, cy: number, w: PlayerState['weapon']): void {
  c.save()
  c.translate(cx, cy)
  c.scale(0.62, 0.62)
  drawWeaponIconRef?.(c, 0, 0, w)
  c.restore()
}

/** hud.ts 의 drawWeaponIcon (순환 import 를 피하려고 주입받는다) */
let drawWeaponIconRef: ((c: CanvasRenderingContext2D, x: number, y: number, w: PlayerState['weapon']) => void) | null = null
export function setWeaponIconPainter(f: (c: CanvasRenderingContext2D, x: number, y: number, w: PlayerState['weapon']) => void): void {
  drawWeaponIconRef = f
}
