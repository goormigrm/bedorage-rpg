// 디아블로 4 풍 HUD (2026-09-18 사용자 요청: "UI 도 디아블로4 와 비슷하게, 대신 RPG 와 슈팅이 섞인 장르").
//
//  - 아래 가운데: 왼쪽 **체력 오브**(붉은 물) · 가운데 **스킬 바**(Q·E·R·구르기·무기) · 오른쪽 **탄약 오브**(놋쇠빛 물)
//    디아블로의 오른쪽 오브는 직업 자원이다. 슈터에서 그 자리는 탄창이 맞다 — 재장전하면 오브가 차오른다.
//    기력(구르기·달리기)은 스킬 바 위 가는 막대, 경험치는 스킬 바 아래 가는 막대(레벨은 M3).
//  - 오른쪽 위: 미니맵(렌더러) 아래 **목표 추적**(던전: 층·남은 괴물 · 투기장: 점수판)
//  - 왼쪽 위: **파티**(초상 · 체력 · 상태)
//  - 체력이 낮으면 화면 가장자리가 붉게 맥박친다.
// 모양은 어두운 쇠 바탕 + 바랜 금테 + 명조체 제목. 수치는 읽기 쉬운 고딕.

import { CHARACTERS, CharacterDef, ROLE_INFO } from '../core/characters'
import { focusCost, nodeCd, nodeSkill, slotNode } from '../core/skills'
import { FX_CRIT, FX_FREEAMMO, FX_GUARD, FX_PARTYDR, FX_SNIPE, FX_WHIRL, SKILLS, SkillId } from '../core/skills'
import { keyLabel, skillKeyLabel } from '../game/keymap'
import { DEATH_RULE_LABEL, GameState, PlayerState, isTeamMatch, teamKills } from '../core/state'
import { EA_UNIQUE, MONSTER_LIST, TIER_LABEL, isBossLike, tierOf } from '../core/monsters'
import { AREAS, QUESTS, areaDef, isTown } from '../core/world'
import { WEAPONS } from '../core/weapons'
import { myGoldText, xpNeed } from '../core/items'
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

/**
 * 가는 막대 (기력 · 경험치). 홈을 파고 그 안에 그라데이션 물을 채운 느낌 —
 * 납작한 단색 사각형은 싸구려로 보인다 (2026-09-20 "퀄리티가 낮아 보인다").
 */
function thinBar(c: CanvasRenderingContext2D, x: number, y: number, w: number, hgt: number, k: number, col: [string, string]): void {
  c.save()
  // 홈
  c.fillStyle = 'rgba(0,0,0,0.55)'
  rr(c, x, y, w, hgt, hgt / 2)
  c.fill()
  c.strokeStyle = 'rgba(0,0,0,0.6)'
  c.lineWidth = 1
  rr(c, x + 0.5, y + 0.5, w - 1, hgt - 1, hgt / 2)
  c.stroke()
  const fw = Math.max(0, Math.min(1, k)) * (w - 2)
  if (fw > 1) {
    const g = c.createLinearGradient(0, y, 0, y + hgt)
    g.addColorStop(0, col[0])
    g.addColorStop(1, col[1])
    c.fillStyle = g
    rr(c, x + 1, y + 1, fw, hgt - 2, (hgt - 2) / 2)
    c.fill()
    // 윗면 광택
    c.fillStyle = 'rgba(255,255,255,0.22)'
    rr(c, x + 1, y + 1, fw, Math.max(1, (hgt - 2) / 2.6), 1)
    c.fill()
  }
  c.restore()
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
  c.strokeStyle = 'rgba(201,162,74,0.8)'
  c.lineWidth = 2
  c.beginPath()
  c.arc(cx, cy, r * 1.2, 0, Math.PI * 2)
  c.stroke()
  // 고리 안쪽에 얇은 금선 하나 더 (두 겹이라야 쇠테처럼 보인다)
  c.strokeStyle = 'rgba(241,213,138,0.35)'
  c.lineWidth = 1
  c.beginPath()
  c.arc(cx, cy, r * 1.07, 0, Math.PI * 2)
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
  // 안쪽 그림자 (유리 두께)
  const sh = c.createRadialGradient(cx, cy, r * 0.72, cx, cy, r)
  sh.addColorStop(0, 'rgba(0,0,0,0)')
  sh.addColorStop(1, 'rgba(0,0,0,0.55)')
  c.fillStyle = sh
  c.beginPath()
  c.arc(cx, cy, r, 0, Math.PI * 2)
  c.fill()
  // 글자: 수치는 가운데, **딸린 말(/ 최대 · 집중)은 고리 밖 아래**로 — 물 위에 겹쳐 쓰면 읽기 어렵다 (2026-09-20)
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.font = `800 ${Math.round(r * 0.46)}px ${SANS}`
  c.lineWidth = 5
  c.strokeStyle = 'rgba(0,0,0,0.8)'
  c.strokeText(label, cx, cy - 1)
  c.fillStyle = '#f7f1e6'
  c.fillText(label, cx, cy - 1)
  if (sub) {
    c.font = `700 ${Math.round(r * 0.21)}px ${SANS}`
    const w = c.measureText(sub).width + 12
    const by2 = cy + r * 1.2 - 8
    c.fillStyle = 'rgba(10,9,8,0.9)'
    rr(c, cx - w / 2, by2, w, 15, 4)
    c.fill()
    c.strokeStyle = 'rgba(201,162,74,0.4)'
    c.lineWidth = 1
    rr(c, cx - w / 2 + 0.5, by2 + 0.5, w - 1, 14, 4)
    c.stroke()
    c.fillStyle = '#d8c79a'
    c.fillText(sub, cx, by2 + 8)
  }
  c.restore()
}

/** 스킬 칸 하나. cdK = 남은 대기 비율(0 이면 준비), secs = 남은 초 */
function slot(h: HudCtx, x: number, y: number, s: number, key: string, cdK: number, secs: number, draw: (dim: boolean) => void, gold = false, active = 0): void {
  const c = h.ctx
  c.save()
  // 칸 바탕: 위가 조금 밝은 돌 — 평평한 검정보다 깊이가 산다
  const bg = c.createLinearGradient(0, y, 0, y + s)
  bg.addColorStop(0, '#191512')
  bg.addColorStop(0.5, '#0d0b09')
  bg.addColorStop(1, '#141110')
  c.fillStyle = bg
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
    c.fillStyle = 'rgba(0,0,0,0.72)'
    c.beginPath()
    c.moveTo(x + s / 2, y + s / 2)
    c.arc(x + s / 2, y + s / 2, s, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * cdK)
    c.closePath()
    c.fill()
    c.restore()
    c.save()
    c.font = `800 ${Math.round(s * 0.36)}px ${SANS}`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    const txt = secs >= 10 ? `${Math.ceil(secs)}` : secs.toFixed(1)
    // 숫자가 그림에 묻히지 않게: 어두운 알약 위에 흰 글씨
    const tw = c.measureText(txt).width + 12
    c.fillStyle = 'rgba(6,5,4,0.72)'
    rr(c, x + s / 2 - tw / 2, y + s / 2 - 11, tw, 22, 11)
    c.fill()
    c.lineWidth = 3
    c.strokeStyle = 'rgba(0,0,0,0.85)'
    c.strokeText(txt, x + s / 2, y + s / 2)
    c.fillStyle = '#f4ece0'
    c.fillText(txt, x + s / 2, y + s / 2)
    c.restore()
  }
  // 버프 지속 중: 아래쪽 금색 막대
  if (active > 0) {
    c.fillStyle = GOLD_HI
    c.fillRect(x + 4, y + s - 5, (s - 8) * Math.min(1, active), 2.5)
  }
  // 키 표시: **칸 밖 아래**에 명패로 (2026-09-20 사용자 "글씨가 아이콘과 겹친다" — 전에는 칸 안쪽이라 그림을 가렸다)
  c.save()
  c.font = `700 10.5px ${SANS}`
  const kw = Math.min(s + 10, Math.max(18, c.measureText(key).width + 12))
  const kx = x + s / 2 - kw / 2
  const ky = y + s + 3
  const kg = c.createLinearGradient(0, ky, 0, ky + 14)
  kg.addColorStop(0, 'rgba(38,31,22,0.96)')
  kg.addColorStop(1, 'rgba(14,12,9,0.96)')
  c.fillStyle = kg
  rr(c, kx, ky, kw, 14, 3)
  c.fill()
  c.strokeStyle = ready ? 'rgba(201,162,74,0.55)' : 'rgba(120,100,70,0.35)'
  c.lineWidth = 1
  rr(c, kx + 0.5, ky + 0.5, kw - 1, 13, 3)
  c.stroke()
  c.fillStyle = ready ? GOLD_HI : '#8d8170'
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillText(key, x + s / 2, ky + 7.5)
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
    const S = 52
    const GAP = 10
    const n = 7
    const barW = n * S + (n - 1) * GAP + 40
    const bx = cx - barW / 2
    const by = baseY - S / 2 - 16
    // 위: 기력 바 · 무기 이름 / 아래: 키 명패 · 경험치 줄
    ironPanel(c, bx, by - 30, barW, S + 76)
    // 물약(3)은 없앴다 — 회복은 체력 구슬 하나로 (2026-09-19)
    // 기력 (위 가는 막대): 형광 하늘색이 화면에서 튀어 **놋쇠빛**으로 (2026-09-20)
    const stK = Math.max(0, Math.min(1, me.stamina / me.staminaMax))
    thinBar(c, bx + 20, by - 22, barW - 40, 5, stK, stK > 0.34 ? ['#e8c46a', '#8a6a28'] : ['#ff9a5a', '#7a3a18'])
    // 칸들: Q · E · R · 구르기 · 무기(좌클릭)
    const x0 = bx + 20
    const slotX = (i: number) => x0 + i * (S + GAP)
    const rects: { x: number; y: number; id?: SkillId; i: number }[] = []
    // 칸 순서: Q · E · 1 · 2 · R (스킬 칸 번호 0 · 1 · 3 · 4 · 2) — 궁극기는 오른쪽 끝
    const order = [0, 1, 3, 4, 2]
    order.forEach((k, pos) => {
      const node = slotNode(me, k)
      if (node < 0) {
        // 빈 칸: 점선 네모 + 옅은 '+' (전에는 'K' 글자만 덩그러니 놓여 뜻이 통하지 않았다 — 2026-09-20)
        slot(h, slotX(pos), by, S, skillKeyLabel(k), 0, 0, () => {
          const mx = slotX(pos) + S / 2
          const my = by + S / 2
          c.save()
          c.strokeStyle = 'rgba(201,162,74,0.22)'
          c.setLineDash([3, 3])
          c.lineWidth = 1
          rr(c, slotX(pos) + 9, by + 9, S - 18, S - 18, 3)
          c.stroke()
          c.setLineDash([])
          c.strokeStyle = 'rgba(201,162,74,0.3)'
          c.lineWidth = 1.5
          c.beginPath()
          c.moveTo(mx - 5, my)
          c.lineTo(mx + 5, my)
          c.moveTo(mx, my - 5)
          c.lineTo(mx, my + 5)
          c.stroke()
          c.restore()
        })
        return
      }
      const id = nodeSkill(me, node)
      const def = SKILLS[id]
      const cdTotal = def.cd * nodeCd(me.build, node)
      const cdK = (me.cd[k] ?? 0) / cdTotal
      const cost = focusCost(def, me.build, node)
      const poor = !def.ult && me.focus < cost
      const active = this.activeFor(id, me)
      slot(h, slotX(pos), by, S, skillKeyLabel(k), poor && cdK <= 0 ? 1 : cdK, (me.cd[k] ?? 0) / 60, (dim) => drawSkillIcon(c, id, slotX(pos) + S / 2, by + S / 2, S * 0.62, dim || poor), def.ult === true, active)
      rects.push({ x: slotX(pos), y: by, id, i: k })
    })
    // 구르기: 던전은 충전 2 (작은 점), 투기장은 기력
    const dashCd = me.dashCooldown / Math.max(1, CHARACTERS[me.char].dashCooldown * 1.6)
    const dungeon = me.dashCharges !== undefined && this.dungeon
    slot(h, slotX(5), by, S, keyLabel('dash'), dungeon ? (me.dashCharges > 0 ? 0 : dashCd) : me.stamina < 34 ? 1 : dashCd, me.dashCooldown / 60, (dim) => drawDashIcon(c, slotX(5) + S / 2, by + S / 2, S * 0.62, dim))
    if (dungeon) {
      for (let q = 0; q < 2; q++) {
        c.fillStyle = q < me.dashCharges ? '#7fd0f0' : 'rgba(255,255,255,0.15)'
        c.beginPath()
        c.arc(slotX(5) + S / 2 - 6 + q * 12, by + S - 6, 3, 0, Math.PI * 2)
        c.fill()
      }
    }
    // 무기 (재장전이 없다 — 2026-09-19): 그림과 이름만
    // 무기 이름은 칸 안에 겹쳐 쓰지 않고 **칸 위**에 적는다 (2026-09-20 — 전에는 그림 위에 글자가 얹혔다)
    slot(h, slotX(6), by, S, '좌클릭', 0, 0, (dim) => {
      c.save()
      c.globalAlpha = dim ? 0.4 : 1
      drawWeaponGlyph(c, slotX(6) + S / 2, by + S / 2, me.weapon)
      c.restore()
    })
    c.save()
    c.font = `700 9.5px ${SANS}`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    const nw = c.measureText(w.name).width + 10
    c.fillStyle = 'rgba(10,9,8,0.9)'
    rr(c, slotX(6) + S / 2 - nw / 2, by - 13, nw, 13, 3)
    c.fill()
    c.fillStyle = '#d8c79a'
    c.fillText(w.name, slotX(6) + S / 2, by - 6)
    c.restore()
    // 경험치 (아래 가는 막대) — 키 명패 아래
    const xpY = by + S + 24
    const xpK = Math.min(1, me.xp / xpNeed(me.level))
    thinBar(c, bx + 20, xpY, barW - 40, 4, xpK, ['#f1d58a', '#8a6a28'])
    c.save()
    c.font = `800 11.5px ${SERIF}`
    c.fillStyle = GOLD_HI
    c.textAlign = 'left'
    c.textBaseline = 'middle'
    c.fillText(`Lv ${me.level}`, bx + 20, xpY + 14)
    c.textAlign = 'right'
    c.font = `600 10px ${SANS}`
    c.fillStyle = '#9a8a70'
    c.fillText(`${myGoldText(me.gold)}  ·  가방 ${me.bag.length}/${me.bagMax} (I)`, bx + barW - 20, xpY + 14)
    c.restore()

    // ---- 체력 오브 (왼쪽)
    const hpK = me.maxHp > 0 ? me.hp / me.maxHp : 0
    const lowPulse = me.alive && !me.downed && hpK < 0.3 ? 0.5 + 0.5 * Math.sin(h.t * 6) : 0
    const hpLabel = me.downed ? '쓰러짐' : !me.alive ? (me.out ? '탈락' : '사망') : `${Math.ceil(me.hp)}`
    orb(h, bx - R - 26, baseY - 6, R, me.alive ? hpK : 0, me.downed ? ['#5a5050', '#2a2424'] : ['#d8382a', '#5a0a0a'], hpLabel, me.alive && !me.downed ? `/ ${me.maxHp}` : '', lowPulse)
    // ---- 집중 오브 (오른쪽, D4): 총이 맞으면 차고 스킬이 쓴다 (던전). 투기장은 예전처럼 탄약
    if (this.dungeon) {
      orb(h, bx + barW + R + 26, baseY - 6, R, me.focus / 100, ['#4a8aff', '#0a1a5a'], `${Math.floor(me.focus)}`, '집중', 0)
    } else {
    // 투기장: 탄약이 없어졌으니 오른쪽 오브는 기력(구르기·달리기)
    orb(h, bx + barW + R + 26, baseY - 6, R, stK, ['#e2b24a', '#5a3a0c'], `${Math.floor(me.stamina)}`, `기력 · ${w.name}`, 0)
    }

    // ---- 툴팁: 스킬 칸에 커서를 잠시 올리면 이름·설명 (디아블로처럼)
    let over = -1
    if (cursor) for (const r of rects) if (cursor.x >= r.x && cursor.x <= r.x + S && cursor.y >= r.y && cursor.y <= r.y + S) over = r.i
    if (over !== this.hoverSlot) {
      this.hoverSlot = over
      this.hoverT = 0
    } else if (over >= 0) this.hoverT += dt
    if (over >= 0 && this.hoverT > 0.35) {
      const r = rects[over]
      this.tooltip(h, SKILLS[r.id!], r.x + S / 2, r.y - 22, skillKeyLabel(over))
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

  /**
   * 추적 칸 아래: 이 막의 퀘스트와 진행 — ○ 아직(촌장) · ▸ 진행 중(여기면 남은 괴물 / 아니면 지역) · ◆ 이룸(촌장에게 보고) · ✓ 끝.
   * 자세한 글은 J(퀘스트 기록).
   */
  private drawQuestList(c: CanvasRenderingContext2D, s: GameState, q: number[], list: { d: (typeof QUESTS)[number]; i: number }[], x: number, y: number, W: number): void {
    c.fillStyle = 'rgba(201,162,74,0.25)'
    c.fillRect(x + 12, y + 2, W - 24, 1)
    c.font = `700 11px ${SANS}`
    c.fillStyle = '#b8a67e'
    c.textAlign = 'left'
    c.fillText(`${areaDef(s.curArea).act + 1}막 퀘스트 · J`, x + 12, y + 17)
    list.forEach(({ d, i }, k) => {
      const st = q[i] ?? 0
      const ly = y + 36 + k * 18
      const here = d.area === s.curArea
      const left = s.monsters.filter((m) => MONSTER_LIST[m.kind].attack !== 'flee').length
      const [mark, color, right, rc] =
        st >= 3
          ? ['✓', '#7f9a78', '끝', '#6a8a64']
          : st === 2
            ? ['◆', GOLD_HI, '촌장에게 보고', GOLD_HI]
            : st === 1
              ? ['▸', '#e8dcc4', here ? (d.goal === 'clear' ? `남은 ${left}` : '여기') : AREAS[d.area].name, here ? '#ffd88a' : '#9d8f78']
              : ['○', '#7e7260', '촌장', '#6a5e4c']
      // 오른쪽(상태)을 먼저 재고, 이름은 남은 폭에 맞춰 줄인다 — 둘이 겹치거나 칸을 넘지 않게
      c.font = `500 11px ${SANS}`
      const rightT = fitText(c, right, (W - 24) * 0.55)
      const rw = c.measureText(rightT).width
      c.textAlign = 'right'
      c.fillStyle = rc
      c.fillText(rightT, x + W - 12, ly)
      c.textAlign = 'left'
      c.font = `600 12px ${SANS}`
      c.fillStyle = color
      const other = d.act !== areaDef(s.curArea).act ? `${d.act + 1}막 ` : ''
      c.fillText(fitText(c, `${mark} ${other}${d.name}`, W - 24 - rw - 8), x + 12, ly)
    })
    c.textAlign = 'left'
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
      // 남은 괴물: 보물 고블린은 세지 않는다 (퀘스트 "비워라" 와 같게)
      const left = s.monsters.filter((m) => m.hp > 0 && MONSTER_LIST[m.kind].attack !== 'flee').length
      const total = Math.max(1, s.monstersTotal)
      const inner = W - 24
      const me = opts.localPlayer >= 0 ? s.players[opts.localPlayer] : null
      const q = me?.quests ?? []
      // 이 막의 퀘스트 넷을 아래에 늘어놓는다 (2026-09-19 요청 "퀘스트 진행 사항을 맵 아래에서 확인").
      // 다른 막에서 **보고할 것**도 끝에 붙인다 — 어느 야영지 촌장에게든 받을 수 있다 (2026-09-25)
      const actQuests = QUESTS.map((d, i) => ({ d, i })).filter((o) => o.d.act === areaDef(s.curArea).act || q[o.i] === 2)
      const a = areaDef(s.curArea)
      const town = isTown(s.curArea)
      const bossHere = s.monsters.some((m) => m.hp > 0 && isBossLike(m))
      // 퀘스트가 먼저 (GUIDE 10장 — "퀘스트가 길을 이끈다")
      const report = QUESTS.findIndex((_, i) => q[i] === 2)
      const here = QUESTS.findIndex((d, i) => (q[i] ?? 0) < 2 && d.area === s.curArea)
      const next = QUESTS.findIndex((_, i) => (q[i] ?? 0) < 2)
      const questLine = report >= 0 ? `◆ 촌장에게 보고 — ${QUESTS[report].name}` : here >= 0 ? `◆ ${QUESTS[here].task}` : town && next >= 0 ? `◆ ${QUESTS[next].task}` : ''
      const goal = questLine
        ? questLine
        : town
        ? '◆ 안전지대 · 성문은 동쪽'
        : bossHere
          ? a.boss !== undefined
            ? `◆ ${MONSTER_LIST[a.boss].name}을(를) 쓰러뜨려라`
            : `◆ 우두머리 ${a.unique?.name ?? ''}`
          : `◆ ${s.tier > 0 ? TIER_LABEL[s.tier] + ' · ' : ''}지역 레벨 ${a.level + tierOf(s.tier).lvl} · T 타운 포털`
      // 글이 칸을 넘지 않게 (2026-09-24 사용자): 목표는 낱말 단위로 세 줄까지 접고, 나머지는 줄여서 맞춘다
      c.font = `600 12px ${SANS}`
      const goalLines = wrapWords(c, goal, inner, 3)
      const ex = (goalLines.length - 1) * 16
      ironPanel(c, x, y, W, 84 + ex + (actQuests.length > 0 ? 22 + actQuests.length * 18 : 0), false)
      c.font = `800 16px ${SERIF}`
      c.fillStyle = GOLD_HI
      c.fillText(fitText(c, opts.floorName ?? '던전', inner), x + 12, y + 24)
      c.font = `600 12px ${SANS}`
      c.fillStyle = '#d8cfbf'
      goalLines.forEach((l, i) => c.fillText(l, x + 12, y + 46 + i * 16))
      c.fillStyle = 'rgba(255,255,255,0.08)'
      c.fillRect(x + 12, y + 53 + ex, inner, 4)
      c.fillStyle = GOLD
      c.fillRect(x + 12, y + 53 + ex, inner * Math.max(0, 1 - left / total), 4)
      // 남은 괴물은 늘 (2026-09-24 사용자: "적을 때만 보여 주는 게 아니라 항상") — 마을은 빼고
      let used = 0
      if (!town) {
        c.font = `700 12px ${SANS}`
        c.fillStyle = left === 0 ? '#9fd08a' : '#e8dcc4'
        const t = `남은 괴물 ${left}`
        c.fillText(t, x + 12, y + 74 + ex)
        used = c.measureText(t).width + 10
      }
      c.font = `600 11px ${SANS}`
      c.fillStyle = s.deathRule === 2 ? '#ff7a6a' : '#8d8170'
      c.textAlign = town ? 'left' : 'right'
      c.fillText(fitText(c, `죽음 규칙 · ${DEATH_RULE_LABEL[s.deathRule]}`, inner - used), town ? x + 12 : x + W - 12, y + 74 + ex)
      c.textAlign = 'left'
      if (actQuests.length > 0) this.drawQuestList(c, s, q, actQuests, x, y + 84 + ex, W)
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

  /** 후원 소환 이름표 (renderer3d 가 넣어 준다) */
  summonLabel: ((by: number, seq: number) => string | undefined) | null = null

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
    const who = boss.sum !== undefined ? this.summonLabel?.(boss.sumBy ?? -1, boss.sum - 1) : undefined
    const name = who ? `${who} ${MONSTER_LIST[boss.kind].name}${unique ? ' · 중간보스' : ''}` : unique ? `${areaDef(s.curArea).unique?.name ?? ''} · 우두머리` : MONSTER_LIST[boss.kind].name
    c.fillText(name, h.W / 2, y + 8)
  }

  /** 지금 판이 던전인가 (집중 구슬 · 구르기 충전) — hud 가 매 프레임 넣는다 */
  dungeon = true

  /** 배너 (hud.banner 가 넣는다) */
  banner: { title: string; sub: string; color: string; t0: number } | null = null

  /** 지역 이름 배너 (디아블로 — 들어설 때 화면 위에 크게, 천천히 사라진다) */
  drawBanner(h: HudCtx): void {
    const b = this.banner
    if (!b) return
    const t = (performance.now() - b.t0) / 1000
    if (t > 4.5) {
      this.banner = null
      return
    }
    const k = t < 0.4 ? t / 0.4 : t > 3.2 ? Math.max(0, (4.5 - t) / 1.3) : 1
    const c = h.ctx
    c.save()
    c.globalAlpha = k
    const cy = h.H * 0.2
    const g = c.createLinearGradient(0, cy - 50, 0, cy + 50)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(0.35, 'rgba(0,0,0,0.55)')
    g.addColorStop(0.65, 'rgba(0,0,0,0.55)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = g
    c.fillRect(0, cy - 50, h.W, 100)
    c.textAlign = 'center'
    c.textBaseline = 'alphabetic'
    c.font = `800 32px ${SERIF}`
    c.fillStyle = b.color
    c.fillText(b.title, h.W / 2, cy + 6)
    c.font = `500 13px ${SERIF}`
    c.fillStyle = '#d8cfbf'
    c.fillText(b.sub, h.W / 2, cy + 30)
    c.restore()
  }

  /** 왼쪽 위: 파티 (던전은 모두, 투기장은 같은 팀만 — 상대 정보는 숨긴다) */
  drawParty(h: HudCtx, s: GameState, opts: RenderOptions): void {
    const lp = opts.localPlayer
    const me = lp >= 0 ? s.players[lp] : null
    const mates = s.players.filter((p) => p.id !== lp && !p.vacant && !p.cameo && (s.mode === 'dungeon' || (me && p.team === me.team && isTeamMatch(s))))
    if (mates.length === 0) return
    const c = h.ctx
    const x = 16
    // 왼쪽 위 단추 줄(치지직 · 음성 · 소리 · 로비로 — 위 16 · 높이 약 32) 아래로 띄운다 (2026-09-23 겹침)
    let y = 70
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
      // 초상 테두리: 던전에서는 역할 색 (탱커 파랑 · 딜러 주황 · 힐러 초록 — 2026-09-19)
      const role = s.mode === 'dungeon' ? ROLE_INFO[def.role] : null
      c.strokeStyle = role ? role.color : 'rgba(201,162,74,0.7)'
      c.lineWidth = role ? 2.2 : 1.5
      c.beginPath()
      c.arc(x + 26, y + 25, 19, 0, Math.PI * 2)
      c.stroke()
      if (role) {
        c.font = `700 10px ${SANS}`
        c.textAlign = 'right'
        c.textBaseline = 'alphabetic'
        c.fillStyle = role.color
        c.fillText(role.name, x + W - 10, y + 20)
      }
      // 이름 · 체력
      c.font = `700 12px ${SANS}`
      c.textAlign = 'left'
      c.textBaseline = 'alphabetic'
      c.fillStyle = '#efe4cf'
      c.fillText(opts.names[p.id] ?? def.name, x + 52, y + 20)
      // 말하는 중: 이름 옆 초록 소리 표시 (음성 대화)
      if (opts.speaking?.[p.id]) {
        const nx = x + 58 + c.measureText(opts.names[p.id] ?? def.name).width
        c.fillStyle = '#6aff8a'
        c.beginPath()
        c.moveTo(nx, y + 11)
        c.lineTo(nx + 5, y + 11)
        c.lineTo(nx + 10, y + 7)
        c.lineTo(nx + 10, y + 21)
        c.lineTo(nx + 5, y + 17)
        c.lineTo(nx, y + 17)
        c.fill()
      }
      // 다른 지역에 있으면 그 지역 이름
      if (p.away) {
        c.font = `600 10px ${SANS}`
        c.fillStyle = '#8d8170'
        c.fillText(areaDef(p.area).name, x + 52, y + 8)
        c.font = `700 12px ${SANS}`
      }
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

/** 폭에 맞춰 줄인다 (넘으면 끝을 …) — 지금 글꼴로 잰다 */
function fitText(c: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (c.measureText(text).width <= maxW) return text
  let t = text
  while (t.length > 1 && c.measureText(t + '…').width > maxW) t = t.slice(0, -1)
  return t.trimEnd() + '…'
}

/** 낱말(띄어쓰기) 단위로 접는다 — 한 낱말이 폭보다 길면 글자로. max 줄을 넘으면 마지막 줄을 줄인다 */
function wrapWords(c: CanvasRenderingContext2D, text: string, maxW: number, max: number): string[] {
  const out: string[] = []
  let cur = ''
  for (const w of text.split(' ')) {
    const next = cur ? `${cur} ${w}` : w
    if (c.measureText(next).width <= maxW) {
      cur = next
      continue
    }
    if (cur) out.push(cur)
    if (c.measureText(w).width <= maxW) cur = w
    else {
      const parts = wrap(c, w, maxW)
      cur = parts.pop() ?? ''
      out.push(...parts)
    }
  }
  if (cur) out.push(cur)
  if (out.length > max) {
    const keep = out.slice(0, max)
    keep[max - 1] = fitText(c, `${keep[max - 1]} ${out.slice(max).join(' ')}`, maxW)
    return keep
  }
  return out
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
