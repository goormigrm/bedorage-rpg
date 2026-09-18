// 이모지풍 캐리커처 캐릭터 드로잉. canvas.ts(게임)와 로비 초상화가 공유한다.
// 원점 = 발 아래 충돌원 중심. 머리는 위로 솟아 있다.

import { CharacterDef, Look } from '../core/characters'

const OUTLINE = '#2b2412'

export interface CharDrawOpts {
  /** 조준/바라보는 방향 (라디안) */
  facing: number
  /** 말랑 스케일 */
  sx: number
  sy: number
  /** 걷기 위상 (0 = 정지) */
  walk: number
  moving: boolean
  /** 0..1 피격 플래시 */
  flash: number
  /** 시간 (초) — 미세 애니메이션용 */
  t: number
  /** true 면 정면 고정 (3D 얼굴 텍스처용). facing 무시 */
  frontal?: boolean
  /** true 면 이목구비만 (피부·귀·머리카락·모자는 3D 메쉬가 맡는다). 둥근 3D 머리 텍스처용 */
  featuresOnly?: boolean
}

export function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0')
}

function shade(c: number, k: number): string {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * k))
  const g = Math.min(255, Math.round(((c >> 8) & 255) * k))
  const b = Math.min(255, Math.round((c & 255) * k))
  return hex((r << 16) | (g << 8) | b)
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath()
  ctx.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2)
  ctx.closePath()
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = 0): void {
  ctx.beginPath()
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, Math.PI * 2)
  ctx.closePath()
}

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
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

/** 몸통(셔츠·가운)만. 머리 아래 레이어. */
export function drawBody(ctx: CanvasRenderingContext2D, def: CharacterDef, o: CharDrawOpts): void {
  const L = def.look
  const bw = 11 * L.bodyScale
  const bh = 13
  const fo = o.moving ? Math.sin(o.walk) * 3.5 : 0

  // 신발
  ctx.fillStyle = '#2a2622'
  ctx.strokeStyle = OUTLINE
  ctx.lineWidth = 1.2
  ellipse(ctx, -5, 12 + fo * 0.4, 4.5, 2.6)
  ctx.fill()
  ctx.stroke()
  ellipse(ctx, 5, 12 - fo * 0.4, 4.5, 2.6)
  ctx.fill()
  ctx.stroke()
  // 바지(짧게)
  ctx.fillStyle = '#34405a'
  rrect(ctx, -bw * 0.75, 4, bw * 1.5, 7, 3)
  ctx.fill()
  ctx.stroke()
  // 셔츠
  ctx.fillStyle = hex(L.shirt)
  ctx.lineWidth = 1.6
  rrect(ctx, -bw, -6, bw * 2, bh, 6)
  ctx.fill()
  ctx.stroke()
  // 가운 / 재킷
  if (L.coat !== undefined) {
    const panel = (dir: 1 | -1) => {
      ctx.beginPath()
      ctx.moveTo(dir * bw, -4)
      ctx.lineTo(dir * bw * 0.35, -6)
      ctx.lineTo(dir * bw * 0.3, 7)
      ctx.lineTo(dir * bw, 7)
      ctx.closePath()
    }
    ctx.fillStyle = hex(L.coat)
    for (const d of [-1, 1] as const) {
      panel(d)
      ctx.fill()
      ctx.stroke()
      if (L.coatDots !== undefined) {
        ctx.save()
        panel(d)
        ctx.clip()
        ctx.fillStyle = hex(L.coatDots)
        for (let yy = -5; yy <= 7; yy += 3.2) {
          for (let xx = 0; xx <= bw; xx += 3.2) {
            const off = ((yy + 5) / 3.2) % 2 === 1 ? 1.6 : 0
            circle(ctx, d * (bw * 0.3 + xx + off), yy, 0.8)
            ctx.fill()
          }
        }
        ctx.restore()
      }
    }
  }
  // 나비넥타이
  if (L.bowTie !== undefined) {
    ctx.fillStyle = hex(L.bowTie)
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(-5, -7)
    ctx.lineTo(0, -4.5)
    ctx.lineTo(-5, -2)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(5, -7)
    ctx.lineTo(0, -4.5)
    ctx.lineTo(5, -2)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    circle(ctx, 0, -4.5, 1.4)
    ctx.fill()
  }
  // 넥타이
  if (L.tie !== undefined) {
    ctx.fillStyle = hex(L.tie)
    ctx.beginPath()
    ctx.moveTo(-2, -5)
    ctx.lineTo(2, -5)
    ctx.lineTo(1.5, 4)
    ctx.lineTo(0, 6)
    ctx.lineTo(-1.5, 4)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }
  // 목
  ctx.fillStyle = shade(L.skin, 0.9)
  rrect(ctx, -3.5, -9, 7, 5, 2)
  ctx.fill()
}

/** 머리 + 얼굴. 원점은 몸 원점과 같고 머리 중심은 (0, -19*headScale 부근). */
export function drawHead(ctx: CanvasRenderingContext2D, def: CharacterDef, o: CharDrawOpts): void {
  const L = def.look
  const R = 12.5 * L.headScale
  const hy = -8 - R // 머리 중심 y
  const cs = o.frontal ? 0 : Math.cos(o.facing)
  const sn = o.frontal ? 0 : Math.sin(o.facing)
  // 얼굴 중심은 바라보는 쪽으로 살짝 이동 (3/4 시점)
  const fx = cs * R * 0.28
  const fy = hy + sn * R * 0.12 + R * 0.05
  const skin = hex(L.skin)
  const fo = o.featuresOnly === true

  ctx.save()
  ctx.lineJoin = 'round'

  // 귀 (넓은 볼 얼굴은 볼 높이에 앞쪽으로 그린다)
  const es = L.earScale ?? 1
  const jowl = L.faceShape === 'jowl'
  const earX = jowl ? R * 1.12 : R * 0.98
  const earY = jowl ? hy + R * 0.2 : hy + R * 0.05
  const drawEars = () => {
    ctx.fillStyle = skin
    ctx.strokeStyle = OUTLINE
    ctx.lineWidth = 1.6
    ellipse(ctx, -earX, earY, R * 0.2 * es, R * 0.26 * es)
    ctx.fill()
    ctx.stroke()
    ellipse(ctx, earX, earY, R * 0.2 * es, R * 0.26 * es)
    ctx.fill()
    ctx.stroke()
    if (es > 1.2) {
      ctx.strokeStyle = shade(L.skin, 0.62)
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(-earX, earY, R * 0.11 * es, -0.6, 2.2)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(earX, earY, R * 0.11 * es, Math.PI - 2.2, Math.PI + 0.6)
      ctx.stroke()
    }
  }
  const drawCatEars = () => {
    const fur = hex(L.furColor ?? L.skin)
    ctx.strokeStyle = OUTLINE
    ctx.lineWidth = 1.6
    for (const s of [-1, 1]) {
      ctx.fillStyle = fur
      ctx.beginPath()
      ctx.moveTo(s * R * 0.22, hy - R * 0.84)
      ctx.lineTo(s * R * 0.98, hy - R * 1.78)
      ctx.lineTo(s * R * 1.02, hy - R * 0.42)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = 'rgba(255,214,196,0.9)'
      ctx.beginPath()
      ctx.moveTo(s * R * 0.4, hy - R * 0.8)
      ctx.lineTo(s * R * 0.86, hy - R * 1.5)
      ctx.lineTo(s * R * 0.88, hy - R * 0.56)
      ctx.closePath()
      ctx.fill()
    }
  }
  const cat = L.animal === 'cat'
  if (cat) {
    if (!fo) drawCatEars()
  } else if (!jowl && !fo) drawEars()

  // 머리(얼굴) 바탕
  ctx.fillStyle = skin
  ctx.lineWidth = 2
  if (L.faceShape === 'jowl') {
    if (!fo) {
      facePathJowl(ctx, R, hy)
      ctx.fill()
      ctx.stroke()
    }
    // 턱살 주름 (양쪽)
    ctx.strokeStyle = shade(L.skin, 0.62)
    ctx.lineWidth = 1.3
    for (const s of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(s * R * 0.92, hy + R * 0.55)
      ctx.quadraticCurveTo(s * R * 0.78, hy + R * 0.85, s * R * 0.5, hy + R * 1.02)
      ctx.stroke()
    }
    // 팔자 주름 (코 옆 → 입 옆)
    for (const s of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(fx + s * R * 0.26, fy + R * 0.22)
      ctx.quadraticCurveTo(fx + s * R * 0.42, fy + R * 0.5, fx + s * R * 0.34, fy + R * 0.72)
      ctx.stroke()
    }
    // 턱 주름
    ctx.beginPath()
    ctx.moveTo(fx - R * 0.22, fy + R * 0.9)
    ctx.quadraticCurveTo(fx, fy + R * 1.0, fx + R * 0.22, fy + R * 0.9)
    ctx.stroke()
    ctx.strokeStyle = OUTLINE
    if (!fo) drawEars()
  } else if (!fo) {
    circle(ctx, 0, hy, R)
    ctx.fill()
    ctx.stroke()
  }
  if (cat) {
    // 고양이: 얼굴 앞을 덮는 흰 무늬 (눈 위까지 올라오고 가운데가 살짝 내려온다)
    ctx.fillStyle = '#fdf7ef'
    ctx.beginPath()
    ctx.moveTo(fx - R * 0.8, fy + R * 0.02)
    ctx.quadraticCurveTo(fx - R * 0.84, fy - R * 0.56, fx - R * 0.36, fy - R * 0.58)
    ctx.quadraticCurveTo(fx - R * 0.14, fy - R * 0.58, fx, fy - R * 0.34)
    ctx.quadraticCurveTo(fx + R * 0.14, fy - R * 0.58, fx + R * 0.36, fy - R * 0.58)
    ctx.quadraticCurveTo(fx + R * 0.84, fy - R * 0.56, fx + R * 0.8, fy + R * 0.02)
    ctx.quadraticCurveTo(fx + R * 0.72, fy + R * 0.86, fx, fy + R * 0.9)
    ctx.quadraticCurveTo(fx - R * 0.72, fy + R * 0.86, fx - R * 0.8, fy + R * 0.02)
    ctx.closePath()
    ctx.fill()
  } else {
    // 볼 홍조
    ctx.fillStyle = 'rgba(232,120,110,0.22)'
    ellipse(ctx, fx - R * 0.5, fy + R * 0.28, R * 0.2, R * 0.12)
    ctx.fill()
    ellipse(ctx, fx + R * 0.5, fy + R * 0.28, R * 0.2, R * 0.12)
    ctx.fill()
  }

  // 수염 (얼굴 위, 머리카락 아래)
  drawBeard(ctx, L, R, fx, fy, hy)

  // 머리카락 (모자를 쓰면 옆머리만 보이도록 짧은 머리는 그대로 두고 모자가 덮는다)
  if (!fo) drawHair(ctx, L, R, hy, cs)

  // 눈썹
  const eyeY = fy - R * 0.12
  const eyeDx = R * 0.36
  if (L.brows === 'arched') {
    // 높이 치켜든 굵은 아치 눈썹 (바라보는 쪽이 조금 더 높다)
    ctx.strokeStyle = hex(L.hairColor)
    ctx.lineWidth = 3.2
    ctx.lineCap = 'round'
    for (const s of [-1, 1]) {
      const lift = s * cs > 0 ? R * 0.1 : 0
      const by = eyeY - R * 0.5 - lift
      ctx.beginPath()
      ctx.moveTo(fx + s * eyeDx - s * R * 0.3, by + R * 0.14)
      ctx.quadraticCurveTo(fx + s * eyeDx - s * R * 0.02, by - R * 0.14, fx + s * eyeDx + s * R * 0.3, by + R * 0.04)
      ctx.stroke()
    }
  } else if (L.brows !== 'none') {
    ctx.strokeStyle = shade(L.hairColor === 0x2a2320 ? 0x2a2320 : L.hairColor, 1)
    ctx.lineWidth = L.brows === 'thick' ? 2.6 : 1.6
    ctx.lineCap = 'round'
    const by = eyeY - R * 0.3
    const angry = L.eyes === 'angry' ? R * 0.1 : 0
    ctx.beginPath()
    ctx.moveTo(fx - eyeDx - R * 0.18, by - angry * 0.4)
    ctx.lineTo(fx - eyeDx + R * 0.18, by + angry)
    ctx.moveTo(fx + eyeDx + R * 0.18, by - angry * 0.4)
    ctx.lineTo(fx + eyeDx - R * 0.18, by + angry)
    ctx.stroke()
  }

  // 눈
  drawEyes(ctx, L, R, fx, eyeY, eyeDx, cs, sn)

  // 코
  if (cat) {
    const ny = fy + R * 0.2
    ctx.fillStyle = '#e8794f'
    ctx.strokeStyle = OUTLINE
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(fx - R * 0.13, ny - R * 0.05)
    ctx.lineTo(fx + R * 0.13, ny - R * 0.05)
    ctx.lineTo(fx, ny + R * 0.12)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    // 수염 (양쪽 3줄)
    ctx.strokeStyle = 'rgba(70,50,40,0.5)'
    ctx.lineWidth = 1.1
    for (const sd of [-1, 1]) {
      for (const [dy0, dy1] of [[-0.06, -0.22], [0.08, 0.06], [0.2, 0.34]]) {
        ctx.beginPath()
        ctx.moveTo(fx + sd * R * 0.34, ny + R * dy0)
        ctx.quadraticCurveTo(fx + sd * R * 0.68, ny + R * ((dy0 + dy1) / 2), fx + sd * R * 0.98, ny + R * dy1)
        ctx.stroke()
      }
    }
  } else if (L.nose === 'wide') {
    // 넓적한 코: 콧등 + 양쪽 콧방울 + 콧구멍
    const nx = fx + cs * R * 0.08
    const ny = fy + R * 0.3
    ctx.strokeStyle = OUTLINE
    ctx.lineWidth = 1.5
    ctx.fillStyle = shade(L.skin, 0.93)
    ctx.beginPath()
    ctx.moveTo(nx - R * 0.08, fy - R * 0.02)
    ctx.quadraticCurveTo(nx - R * 0.34, ny - R * 0.02, nx - R * 0.3, ny + R * 0.08)
    ctx.quadraticCurveTo(nx - R * 0.18, ny + R * 0.16, nx, ny + R * 0.1)
    ctx.quadraticCurveTo(nx + R * 0.18, ny + R * 0.16, nx + R * 0.3, ny + R * 0.08)
    ctx.quadraticCurveTo(nx + R * 0.34, ny - R * 0.02, nx + R * 0.08, fy - R * 0.02)
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(nx - R * 0.3, ny + R * 0.08)
    ctx.quadraticCurveTo(nx - R * 0.18, ny + R * 0.16, nx - R * 0.06, ny + R * 0.1)
    ctx.moveTo(nx + R * 0.3, ny + R * 0.08)
    ctx.quadraticCurveTo(nx + R * 0.18, ny + R * 0.16, nx + R * 0.06, ny + R * 0.1)
    ctx.stroke()
    // 콧구멍
    ctx.fillStyle = shade(L.skin, 0.45)
    ellipse(ctx, nx - R * 0.15, ny + R * 0.06, R * 0.06, R * 0.04)
    ctx.fill()
    ellipse(ctx, nx + R * 0.15, ny + R * 0.06, R * 0.06, R * 0.04)
    ctx.fill()
  } else {
    ctx.strokeStyle = shade(L.skin, 0.72)
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(fx + cs * R * 0.06, fy + R * 0.05)
    ctx.quadraticCurveTo(fx + cs * R * 0.16 + R * 0.08, fy + R * 0.28, fx + cs * R * 0.06 - R * 0.04, fy + R * 0.3)
    ctx.stroke()
  }

  // 입
  drawMouth(ctx, L, R, fx, fy)

  // 안경
  if (L.glasses === 'sunglasses') {
    const lens = hex(L.lensColor ?? 0x223a8a)
    ctx.strokeStyle = '#151515'
    ctx.lineWidth = 1.6
    for (const s of [-1, 1]) {
      ctx.fillStyle = lens
      circle(ctx, fx + s * eyeDx, eyeY, R * 0.3)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      ellipse(ctx, fx + s * eyeDx - R * 0.08, eyeY - R * 0.1, R * 0.1, R * 0.06, -0.6)
      ctx.fill()
    }
    ctx.beginPath()
    ctx.moveTo(fx - eyeDx + R * 0.3, eyeY)
    ctx.lineTo(fx + eyeDx - R * 0.3, eyeY)
    ctx.moveTo(fx - eyeDx - R * 0.3, eyeY)
    ctx.lineTo(-R * 0.98, eyeY - R * 0.05)
    ctx.moveTo(fx + eyeDx + R * 0.3, eyeY)
    ctx.lineTo(R * 0.98, eyeY - R * 0.05)
    ctx.stroke()
  } else if (L.glasses !== 'none') {
    ctx.strokeStyle = '#1d1d1d'
    ctx.lineWidth = 1.5
    if (L.glasses === 'rect') {
      rrect(ctx, fx - eyeDx - R * 0.27, eyeY - R * 0.2, R * 0.54, R * 0.4, 2)
      ctx.stroke()
      rrect(ctx, fx + eyeDx - R * 0.27, eyeY - R * 0.2, R * 0.54, R * 0.4, 2)
      ctx.stroke()
    } else {
      circle(ctx, fx - eyeDx, eyeY, R * 0.27)
      ctx.stroke()
      circle(ctx, fx + eyeDx, eyeY, R * 0.27)
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.moveTo(fx - eyeDx + R * 0.27, eyeY)
    ctx.lineTo(fx + eyeDx - R * 0.27, eyeY)
    ctx.stroke()
    // 렌즈 반사
    ctx.fillStyle = 'rgba(255,255,255,0.18)'
    rrect(ctx, fx - eyeDx - R * 0.2, eyeY - R * 0.15, R * 0.4, R * 0.3, 2)
    ctx.fill()
    rrect(ctx, fx + eyeDx - R * 0.2, eyeY - R * 0.15, R * 0.4, R * 0.3, 2)
    ctx.fill()
  }

  // 모자/머리띠 (이목구비 전용이면 3D 메쉬가 그린다)
  if (fo) {
    // 없음
  } else if (L.extra === 'cap') {
    const band = hex(L.capBand ?? 0xf4f4f0)
    ctx.strokeStyle = OUTLINE
    ctx.lineWidth = 1.5
    // 챙 (바라보는 쪽으로)
    ctx.fillStyle = band
    ellipse(ctx, cs * R * 0.75, hy - R * 0.28, R * 0.62, R * 0.17)
    ctx.fill()
    ctx.stroke()
    // 돔
    ctx.fillStyle = hex(def.accentColor)
    ctx.beginPath()
    ctx.moveTo(-R * 1.02, hy - R * 0.25)
    ctx.quadraticCurveTo(-R * 0.95, hy - R * 1.25, 0, hy - R * 1.22)
    ctx.quadraticCurveTo(R * 0.95, hy - R * 1.25, R * 1.02, hy - R * 0.25)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    // 라벨
    if (L.capText) {
      ctx.fillStyle = band
      const lx = cs * R * 0.28
      rrect(ctx, lx - R * 0.36, hy - R * 1.0, R * 0.72, R * 0.4, R * 0.08)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = hex(def.accentColor)
      ctx.font = `700 ${Math.max(3, R * 0.3)}px "IBM Plex Sans KR", "Malgun Gothic", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(L.capText, lx, hy - R * 0.79)
    }
    if (L.capPin !== undefined) {
      ctx.fillStyle = hex(L.capPin)
      ctx.strokeStyle = OUTLINE
      ctx.lineWidth = 1
      circle(ctx, -R * 0.52, hy - R * 0.92, R * 0.14)
      ctx.fill()
      ctx.stroke()
    }
  } else if (L.extra === 'headband') {
    ctx.fillStyle = hex(def.accentColor)
    ctx.strokeStyle = OUTLINE
    ctx.lineWidth = 1.5
    rrect(ctx, -R, hy - R * 0.55, R * 2, R * 0.28, 2)
    ctx.fill()
    ctx.stroke()
  } else if (L.extra === 'mic') {
    // 입 앞에 든 마이크 (바라보는 쪽)
    const mx = fx + cs * R * 0.55
    const my = fy + R * 0.62
    ctx.strokeStyle = OUTLINE
    ctx.lineWidth = 1.4
    ctx.fillStyle = '#2b2b2b'
    ctx.beginPath()
    ctx.moveTo(mx, my)
    ctx.lineTo(mx + cs * R * 0.25, my + R * 0.55)
    ctx.lineWidth = 3
    ctx.strokeStyle = '#2b2b2b'
    ctx.stroke()
    ctx.strokeStyle = OUTLINE
    ctx.lineWidth = 1.2
    ctx.fillStyle = '#8f8f8f'
    circle(ctx, mx, my, R * 0.19)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    circle(ctx, mx - R * 0.06, my - R * 0.06, R * 0.06)
    ctx.fill()
  }

  // 피격 플래시
  if (o.flash > 0 && !fo) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(1, o.flash * 8)})`
    circle(ctx, 0, hy, R + 1)
    ctx.fill()
  }
  ctx.restore()
}

function drawHair(ctx: CanvasRenderingContext2D, L: Look, R: number, hy: number, cs: number): void {
  ctx.strokeStyle = OUTLINE
  ctx.lineWidth = 1.6
  switch (L.hair) {
    case 'none': {
      // 삭발: 정수리 하이라이트 + 옆머리 흔적
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      ellipse(ctx, -R * 0.25, hy - R * 0.55, R * 0.32, R * 0.16, -0.5)
      ctx.fill()
      ctx.fillStyle = shade(L.skin, 0.86)
      ctx.beginPath()
      ctx.arc(0, hy, R * 0.98, Math.PI * 1.05, Math.PI * 1.35)
      ctx.arc(0, hy, R * 0.72, Math.PI * 1.35, Math.PI * 1.05, true)
      ctx.closePath()
      ctx.fill()
      ctx.beginPath()
      ctx.arc(0, hy, R * 0.98, Math.PI * 1.65, Math.PI * 1.95)
      ctx.arc(0, hy, R * 0.72, Math.PI * 1.95, Math.PI * 1.65, true)
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'buzz': {
      // 스포츠머리: 반투명 짙은 캡
      ctx.fillStyle = shade(L.hairColor, 1)
      ctx.globalAlpha = 0.85
      ctx.beginPath()
      ctx.arc(0, hy + R * 0.05, R * 0.99, Math.PI * 1.0, Math.PI * 2.0)
      ctx.quadraticCurveTo(R * 0.5, hy - R * 0.25, 0, hy - R * 0.28)
      ctx.quadraticCurveTo(-R * 0.5, hy - R * 0.25, -R * 0.99, hy + R * 0.05)
      ctx.closePath()
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.stroke()
      break
    }
    case 'spiky': {
      // 1) 회색 옆머리: 관자놀이에서 관자놀이까지 머리 윗부분을 감싸는 띠, 아래 가장자리는 물결
      if (L.sideColor !== undefined) {
        ctx.fillStyle = hex(L.sideColor)
        ctx.beginPath()
        ctx.moveTo(-R * 1.02, hy + R * 0.12)
        ctx.lineTo(-R * 1.02, hy - R * 0.35)
        ctx.quadraticCurveTo(-R * 0.9, hy - R * 1.02, 0, hy - R * 1.02)
        ctx.quadraticCurveTo(R * 0.9, hy - R * 1.02, R * 1.02, hy - R * 0.35)
        ctx.lineTo(R * 1.02, hy + R * 0.12)
        // 물결 아래 가장자리 (이마 위)
        ctx.quadraticCurveTo(R * 0.9, hy - R * 0.25, R * 0.72, hy - R * 0.2)
        ctx.quadraticCurveTo(R * 0.55, hy - R * 0.5, R * 0.36, hy - R * 0.3)
        ctx.quadraticCurveTo(R * 0.18, hy - R * 0.55, 0, hy - R * 0.32)
        ctx.quadraticCurveTo(-R * 0.18, hy - R * 0.55, -R * 0.36, hy - R * 0.3)
        ctx.quadraticCurveTo(-R * 0.55, hy - R * 0.5, -R * 0.72, hy - R * 0.2)
        ctx.quadraticCurveTo(-R * 0.9, hy - R * 0.25, -R * 1.02, hy + R * 0.12)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      }
      // 2) 검은 윗머리 덩어리: 회색 띠 위쪽만 덮고, 아래 가장자리는 물결선 (회색이 넓게 보이도록)
      ctx.fillStyle = hex(L.hairColor)
      ctx.beginPath()
      ctx.moveTo(-R * 1.0, hy - R * 0.55)
      ctx.quadraticCurveTo(-R * 0.9, hy - R * 1.05, 0, hy - R * 1.05)
      ctx.quadraticCurveTo(R * 0.9, hy - R * 1.05, R * 1.0, hy - R * 0.55)
      ctx.quadraticCurveTo(R * 0.92, hy - R * 0.72, R * 0.72, hy - R * 0.66)
      ctx.quadraticCurveTo(R * 0.55, hy - R * 0.9, R * 0.36, hy - R * 0.72)
      ctx.quadraticCurveTo(R * 0.18, hy - R * 0.94, 0, hy - R * 0.74)
      ctx.quadraticCurveTo(-R * 0.18, hy - R * 0.94, -R * 0.36, hy - R * 0.72)
      ctx.quadraticCurveTo(-R * 0.55, hy - R * 0.9, -R * 0.72, hy - R * 0.66)
      ctx.quadraticCurveTo(-R * 0.92, hy - R * 0.72, -R * 1.0, hy - R * 0.55)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      // 3) 삐죽삐죽 뻗은 머리카락 (위쪽 반원에서 방사)
      const spikes: [number, number, number][] = [
        // [각도(도), 길이 배율, 폭]
        [200, 1.35, 0.13], [212, 1.2, 0.1], [226, 1.55, 0.14], [240, 1.3, 0.11], [254, 1.7, 0.15],
        [268, 1.45, 0.12], [282, 1.75, 0.15], [296, 1.35, 0.11], [310, 1.6, 0.14], [324, 1.25, 0.1],
        [338, 1.4, 0.13], [350, 1.15, 0.1],
      ]
      for (const [deg, len, w] of spikes) {
        const a = (deg / 180) * Math.PI
        const bx = Math.cos(a) * R * 0.78
        const by = hy + Math.sin(a) * R * 0.9
        const tx = Math.cos(a - 0.08) * R * len
        const ty = hy + Math.sin(a - 0.08) * R * len
        const px = -Math.sin(a) * R * w
        const py = Math.cos(a) * R * w
        ctx.beginPath()
        ctx.moveTo(bx - px, by - py)
        ctx.lineTo(tx, ty)
        ctx.lineTo(bx + px, by + py)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      }
      // 스파이크 밑동을 덮어 이음새 정리 (검은 윗머리 덩어리 다시)
      ctx.beginPath()
      ctx.moveTo(-R * 1.0, hy - R * 0.55)
      ctx.quadraticCurveTo(-R * 0.9, hy - R * 1.05, 0, hy - R * 1.05)
      ctx.quadraticCurveTo(R * 0.9, hy - R * 1.05, R * 1.0, hy - R * 0.55)
      ctx.quadraticCurveTo(R * 0.5, hy - R * 0.85, 0, hy - R * 0.8)
      ctx.quadraticCurveTo(-R * 0.5, hy - R * 0.85, -R * 1.0, hy - R * 0.55)
      ctx.closePath()
      ctx.fill()
      // 4) 정수리 흰 별
      if (L.crown === 'star') {
        ctx.fillStyle = '#ffffff'
        ctx.strokeStyle = OUTLINE
        ctx.lineWidth = 1
        ctx.beginPath()
        const cxs = 0
        const cys = hy - R * 0.84
        for (let i = 0; i < 8; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 4
          const r = i % 2 === 0 ? R * 0.3 : R * 0.09
          ctx.lineTo(cxs + Math.cos(a) * r, cys + Math.sin(a) * r)
        }
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      }
      break
    }
    case 'bob': {
      // 단발: 정수리에서 볼 아래까지 내려오는 머리 + 이마를 덮는 앞머리
      ctx.fillStyle = hex(L.hairColor)
      ctx.beginPath()
      ctx.moveTo(-R * 1.14, hy + R * 0.8)
      ctx.lineTo(-R * 1.14, hy - R * 0.2)
      ctx.quadraticCurveTo(-R * 0.98, hy - R * 1.22, 0, hy - R * 1.2)
      ctx.quadraticCurveTo(R * 0.98, hy - R * 1.22, R * 1.14, hy - R * 0.2)
      ctx.lineTo(R * 1.14, hy + R * 0.8)
      ctx.lineTo(R * 0.84, hy + R * 0.72)
      ctx.lineTo(R * 0.88, hy - R * 0.16)
      ctx.quadraticCurveTo(R * 0.62, hy - R * 0.56, R * 0.18, hy - R * 0.46)
      ctx.quadraticCurveTo(-R * 0.34, hy - R * 0.36, -R * 0.88, hy - R * 0.16)
      ctx.lineTo(-R * 0.84, hy + R * 0.72)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = 'rgba(255,255,255,0.13)'
      ellipse(ctx, -R * 0.3, hy - R * 0.85, R * 0.34, R * 0.1, -0.4)
      ctx.fill()
      break
    }
    case 'bowl': {
      // 이마를 덮는 풍성한 머리 (앞머리 내림)
      ctx.fillStyle = hex(L.hairColor)
      ctx.beginPath()
      ctx.moveTo(-R * 1.08, hy + R * 0.25)
      ctx.lineTo(-R * 1.08, hy - R * 0.3)
      ctx.quadraticCurveTo(-R * 0.9, hy - R * 1.2, R * 0.05, hy - R * 1.18)
      ctx.quadraticCurveTo(R * 1.0, hy - R * 1.15, R * 1.08, hy - R * 0.3)
      ctx.lineTo(R * 1.08, hy + R * 0.25)
      // 앞머리: 비스듬히 내려온 뱅
      ctx.lineTo(R * 0.95, hy + R * 0.1)
      ctx.quadraticCurveTo(R * 0.7, hy - R * 0.2, R * 0.45, hy - R * 0.28)
      ctx.quadraticCurveTo(R * 0.1, hy - R * 0.4, -R * 0.2, hy - R * 0.22 + cs * R * 0.05)
      ctx.quadraticCurveTo(-R * 0.6, hy - R * 0.05, -R * 0.95, hy + R * 0.12)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      // 광택
      ctx.fillStyle = 'rgba(255,255,255,0.14)'
      ellipse(ctx, -R * 0.3, hy - R * 0.85, R * 0.35, R * 0.1, -0.4)
      ctx.fill()
      break
    }
    case 'side':
    case 'fringe': {
      // 옆으로 넘긴 짧은 머리 (가르마 / 앞머리)
      ctx.fillStyle = hex(L.hairColor)
      ctx.beginPath()
      ctx.moveTo(-R * 1.0, hy + R * 0.05)
      ctx.lineTo(-R * 1.0, hy - R * 0.35)
      ctx.quadraticCurveTo(-R * 0.75, hy - R * 1.12, R * 0.2, hy - R * 1.08)
      ctx.quadraticCurveTo(R * 0.95, hy - R * 1.0, R * 1.0, hy - R * 0.35)
      ctx.lineTo(R * 1.0, hy - R * 0.1)
      // 앞머리: 한쪽으로 쓸어넘긴 사선
      ctx.quadraticCurveTo(R * 0.7, hy - R * 0.55, R * 0.15, hy - R * 0.72)
      ctx.quadraticCurveTo(-R * 0.35, hy - R * 0.4, -R * 0.7, hy - R * 0.55)
      ctx.quadraticCurveTo(-R * 0.95, hy - R * 0.4, -R * 1.0, hy + R * 0.05)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      break
    }
    case 'short':
    case 'flat': {
      const flat = L.hair === 'flat'
      ctx.fillStyle = hex(L.hairColor)
      ctx.beginPath()
      // 옆머리 → 정수리
      ctx.moveTo(-R * 1.0, hy + R * 0.1)
      ctx.lineTo(-R * 1.0, hy - R * 0.3)
      if (flat) {
        ctx.quadraticCurveTo(-R * 0.9, hy - R * 1.05, -R * 0.2, hy - R * 1.08)
        ctx.lineTo(R * 0.35, hy - R * 1.08)
        ctx.quadraticCurveTo(R * 0.95, hy - R * 1.0, R * 1.0, hy - R * 0.3)
      } else {
        ctx.quadraticCurveTo(-R * 0.8, hy - R * 1.15, R * 0.1, hy - R * 1.1)
        ctx.quadraticCurveTo(R * 0.9, hy - R * 1.05, R * 1.0, hy - R * 0.3)
      }
      ctx.lineTo(R * 1.0, hy + R * 0.1)
      // 앞머리 라인 (이마)
      ctx.quadraticCurveTo(R * 0.85, hy - R * 0.45, R * 0.4, hy - R * 0.5 + cs * R * 0.05)
      ctx.quadraticCurveTo(0, hy - R * 0.62, -R * 0.4, hy - R * 0.5 - cs * R * 0.05)
      ctx.quadraticCurveTo(-R * 0.85, hy - R * 0.45, -R * 1.0, hy + R * 0.1)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      break
    }
  }
}

function drawEyes(
  ctx: CanvasRenderingContext2D,
  L: Look,
  R: number,
  fx: number,
  eyeY: number,
  eyeDx: number,
  cs: number,
  sn: number,
): void {
  const pupilDx = cs * R * 0.07
  const pupilDy = sn * R * 0.05
  ctx.lineCap = 'round'
  switch (L.eyes) {
    case 'normal':
    case 'angry': {
      for (const s of [-1, 1]) {
        ctx.fillStyle = '#fff'
        ctx.strokeStyle = OUTLINE
        ctx.lineWidth = 1.2
        ellipse(ctx, fx + s * eyeDx, eyeY, R * 0.2, R * 0.22)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = '#1a1a1a'
        circle(ctx, fx + s * eyeDx + pupilDx, eyeY + pupilDy, R * 0.11)
        ctx.fill()
      }
      break
    }
    case 'lidded': {
      // 가늘게 뜬 눈 + 두꺼운 윗눈꺼풀 선 + 옆을 흘기는 눈동자 (철면수심 마스코트)
      for (const s of [-1, 1]) {
        const ex = fx + s * eyeDx
        ctx.fillStyle = '#fff'
        ctx.strokeStyle = OUTLINE
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.moveTo(ex - R * 0.27, eyeY + R * 0.02)
        ctx.quadraticCurveTo(ex, eyeY - R * 0.12, ex + R * 0.27, eyeY + R * 0.02)
        ctx.quadraticCurveTo(ex, eyeY + R * 0.14, ex - R * 0.27, eyeY + R * 0.02)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        // 눈동자: 바라보는 쪽으로 치우침
        ctx.fillStyle = '#1a1a1a'
        const px = ex + (cs >= 0 ? 1 : -1) * R * 0.12 + pupilDx
        ellipse(ctx, px, eyeY + R * 0.02 + pupilDy * 0.4, R * 0.07, R * 0.06)
        ctx.fill()
        // 두꺼운 윗눈꺼풀
        ctx.strokeStyle = OUTLINE
        ctx.lineWidth = 2.4
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(ex - R * 0.29, eyeY + R * 0.01)
        ctx.quadraticCurveTo(ex, eyeY - R * 0.13, ex + R * 0.29, eyeY + R * 0.01)
        ctx.stroke()
        // 눈 밑 주름
        ctx.strokeStyle = shade(L.skin, 0.62)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(ex - R * 0.2, eyeY + R * 0.2)
        ctx.quadraticCurveTo(ex, eyeY + R * 0.27, ex + R * 0.2, eyeY + R * 0.2)
        ctx.stroke()
      }
      break
    }
    case 'calm': {
      // 반쯤 감긴 무표정 눈: 위쪽 직선 눈꺼풀 + 아래 작은 눈동자
      for (const s of [-1, 1]) {
        ctx.fillStyle = '#fff'
        ctx.strokeStyle = OUTLINE
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.moveTo(fx + s * eyeDx - R * 0.2, eyeY - R * 0.02)
        ctx.lineTo(fx + s * eyeDx + R * 0.2, eyeY - R * 0.02)
        ctx.quadraticCurveTo(fx + s * eyeDx, eyeY + R * 0.28, fx + s * eyeDx - R * 0.2, eyeY - R * 0.02)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = '#1a1a1a'
        circle(ctx, fx + s * eyeDx + pupilDx, eyeY + R * 0.08 + pupilDy * 0.5, R * 0.09)
        ctx.fill()
        ctx.strokeStyle = OUTLINE
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.moveTo(fx + s * eyeDx - R * 0.22, eyeY - R * 0.03)
        ctx.lineTo(fx + s * eyeDx + R * 0.22, eyeY - R * 0.03)
        ctx.stroke()
      }
      break
    }
    case 'sharp': {
      // 매서운 눈: 위 눈꺼풀이 바깥→안쪽으로 내려오는 좁은 눈 + 작은 눈동자
      for (const s of [-1, 1]) {
        ctx.fillStyle = '#fff'
        ctx.strokeStyle = OUTLINE
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.moveTo(fx + s * eyeDx - s * R * 0.22, eyeY + R * 0.02)
        ctx.lineTo(fx + s * eyeDx + s * R * 0.2, eyeY - R * 0.1)
        ctx.quadraticCurveTo(fx + s * eyeDx, eyeY + R * 0.22, fx + s * eyeDx - s * R * 0.22, eyeY + R * 0.02)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = '#1a1a1a'
        circle(ctx, fx + s * eyeDx + pupilDx, eyeY + R * 0.04 + pupilDy * 0.5, R * 0.08)
        ctx.fill()
      }
      break
    }
    case 'squint': {
      ctx.strokeStyle = OUTLINE
      ctx.lineWidth = 2
      for (const s of [-1, 1]) {
        ctx.beginPath()
        ctx.moveTo(fx + s * eyeDx - R * 0.2, eyeY + R * 0.02)
        ctx.quadraticCurveTo(fx + s * eyeDx + pupilDx, eyeY - R * 0.1, fx + s * eyeDx + R * 0.2, eyeY + R * 0.02)
        ctx.stroke()
      }
      break
    }
    case 'happy': {
      ctx.strokeStyle = OUTLINE
      ctx.lineWidth = 2
      for (const s of [-1, 1]) {
        ctx.beginPath()
        ctx.moveTo(fx + s * eyeDx - R * 0.2, eyeY + R * 0.08)
        ctx.quadraticCurveTo(fx + s * eyeDx + pupilDx, eyeY - R * 0.2, fx + s * eyeDx + R * 0.2, eyeY + R * 0.08)
        ctx.stroke()
      }
      break
    }
  }
}

function drawMouth(ctx: CanvasRenderingContext2D, L: Look, R: number, fx: number, fy: number): void {
  const my = fy + R * 0.5
  ctx.strokeStyle = OUTLINE
  ctx.lineCap = 'round'
  switch (L.mouth) {
    case 'flat':
      ctx.lineWidth = 1.8
      ctx.beginPath()
      ctx.moveTo(fx - R * 0.2, my)
      ctx.lineTo(fx + R * 0.2, my)
      ctx.stroke()
      break
    case 'frown':
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(fx - R * 0.24, my + R * 0.06)
      ctx.quadraticCurveTo(fx, my - R * 0.1, fx + R * 0.24, my + R * 0.06)
      ctx.stroke()
      break
    case 'smile':
      ctx.lineWidth = 1.8
      ctx.beginPath()
      ctx.moveTo(fx - R * 0.22, my - R * 0.04)
      ctx.quadraticCurveTo(fx, my + R * 0.18, fx + R * 0.22, my - R * 0.04)
      ctx.stroke()
      break
    case 'thick': {
      ctx.fillStyle = hex(L.lipColor ?? 0xc9695a)
      ctx.lineWidth = 1.3
      ellipse(ctx, fx, my, R * 0.26, R * 0.13)
      ctx.fill()
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(fx - R * 0.24, my)
      ctx.lineTo(fx + R * 0.24, my)
      ctx.stroke()
      break
    }
    case 'pout': {
      // 오므려 쭉 내민 입술: 위·아래 입술 두 덩어리 (오리 입), 작고 도톰하게
      const py = my + R * 0.12
      const lip = L.lipColor ?? 0xb9382a
      ctx.lineWidth = 1.5
      // 아랫입술 (진하게)
      ctx.fillStyle = shade(lip, 0.8)
      ctx.beginPath()
      ctx.moveTo(fx - R * 0.22, py + R * 0.02)
      ctx.quadraticCurveTo(fx, py + R * 0.3, fx + R * 0.22, py + R * 0.02)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      // 윗입술 (밝게, 가운데가 살짝 뾰족)
      ctx.fillStyle = hex(lip)
      ctx.beginPath()
      ctx.moveTo(fx - R * 0.24, py + R * 0.02)
      ctx.quadraticCurveTo(fx - R * 0.12, py - R * 0.2, fx - R * 0.02, py - R * 0.12)
      ctx.quadraticCurveTo(fx, py - R * 0.14, fx + R * 0.02, py - R * 0.12)
      ctx.quadraticCurveTo(fx + R * 0.12, py - R * 0.2, fx + R * 0.24, py + R * 0.02)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      // 입 가운데 선
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.moveTo(fx - R * 0.24, py + R * 0.02)
      ctx.quadraticCurveTo(fx, py + R * 0.07, fx + R * 0.24, py + R * 0.02)
      ctx.stroke()
      // 입술 하이라이트
      ctx.fillStyle = 'rgba(255,255,255,0.25)'
      ellipse(ctx, fx - R * 0.06, py - R * 0.08, R * 0.06, R * 0.025)
      ctx.fill()
      break
    }
    case 'sing': {
      // 노래하듯 크게 벌린 입 (세로 타원)
      ctx.fillStyle = '#6b2424'
      ctx.lineWidth = 1.4
      ellipse(ctx, fx, my + R * 0.08, R * 0.16, R * 0.22)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.ellipse(fx, my - R * 0.1, R * 0.13, R * 0.05, 0, 0, Math.PI)
      ctx.fill()
      break
    }
    case 'grin': {
      const catMouth = L.animal === 'cat'
      ctx.fillStyle = catMouth ? '#8f3a44' : '#7a2e2e'
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.moveTo(fx - R * 0.3, my - R * 0.06)
      ctx.quadraticCurveTo(fx, my + R * 0.42, fx + R * 0.3, my - R * 0.06)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      if (catMouth) {
        ctx.fillStyle = '#f2909f'
        ctx.beginPath()
        ctx.moveTo(fx - R * 0.15, my + R * 0.08)
        ctx.quadraticCurveTo(fx, my + R * 0.46, fx + R * 0.15, my + R * 0.08)
        ctx.closePath()
        ctx.fill()
      } else {
        ctx.fillStyle = '#fff'
        ctx.beginPath()
        ctx.moveTo(fx - R * 0.26, my - R * 0.04)
        ctx.lineTo(fx + R * 0.26, my - R * 0.04)
        ctx.lineTo(fx + R * 0.2, my + R * 0.08)
        ctx.lineTo(fx - R * 0.2, my + R * 0.08)
        ctx.closePath()
        ctx.fill()
      }
      break
    }
    case 'shout': {
      // 크게 벌린 외침: 둥근 입 + 윗니 + 혀
      ctx.fillStyle = '#5e1f1f'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(fx - R * 0.3, my - R * 0.16)
      ctx.quadraticCurveTo(fx, my - R * 0.3, fx + R * 0.3, my - R * 0.16)
      ctx.quadraticCurveTo(fx + R * 0.42, my + R * 0.46, fx, my + R * 0.52)
      ctx.quadraticCurveTo(fx - R * 0.42, my + R * 0.46, fx - R * 0.3, my - R * 0.16)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.moveTo(fx - R * 0.26, my - R * 0.15)
      ctx.lineTo(fx + R * 0.26, my - R * 0.15)
      ctx.lineTo(fx + R * 0.21, my - R * 0.02)
      ctx.lineTo(fx - R * 0.21, my - R * 0.02)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#d9636b'
      ellipse(ctx, fx, my + R * 0.34, R * 0.17, R * 0.11)
      ctx.fill()
      break
    }
  }
}

function drawBeard(ctx: CanvasRenderingContext2D, L: Look, R: number, fx: number, fy: number, hy: number): void {
  const col = shade(L.hairColor === 0x2a2320 ? 0x2a2320 : L.hairColor, 1)
  switch (L.beard) {
    case 'none':
      return
    case 'mustache': {
      // 콧수염 + 턱 둘레 점박이 수염 (침착맨 아바타)
      ctx.fillStyle = col
      ctx.globalAlpha = 0.95
      ctx.beginPath()
      ctx.moveTo(fx - R * 0.34, fy + R * 0.42)
      ctx.quadraticCurveTo(fx - R * 0.12, fy + R * 0.28, fx, fy + R * 0.38)
      ctx.quadraticCurveTo(fx + R * 0.12, fy + R * 0.28, fx + R * 0.34, fy + R * 0.42)
      ctx.quadraticCurveTo(fx + R * 0.12, fy + R * 0.44, fx, fy + R * 0.44)
      ctx.quadraticCurveTo(fx - R * 0.12, fy + R * 0.44, fx - R * 0.34, fy + R * 0.42)
      ctx.closePath()
      ctx.fill()
      // 점박이
      ctx.globalAlpha = 0.85
      for (let i = 0; i < 14; i++) {
        const a = Math.PI * 0.18 + (i / 13) * Math.PI * 0.64
        const rr = R * (0.8 + ((i * 5) % 3) * 0.05)
        circle(ctx, fx * 0.5 + Math.cos(a) * rr, hy + R * 0.12 + Math.sin(a) * rr * 0.85, R * 0.04)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      break
    }
    case 'stubble': {
      ctx.fillStyle = col
      ctx.globalAlpha = 0.28
      ctx.beginPath()
      ctx.arc(fx * 0.6, hy + R * 0.2, R * 0.86, Math.PI * 0.2, Math.PI * 0.8)
      ctx.quadraticCurveTo(fx * 0.6, hy + R * 0.55, fx * 0.6 + R * 0.7, hy + R * 0.55)
      ctx.closePath()
      ctx.fill()
      ctx.globalAlpha = 1
      break
    }
    case 'goatee': {
      ctx.fillStyle = col
      ctx.globalAlpha = 0.75
      // 콧수염
      ellipse(ctx, fx, fy + R * 0.42, R * 0.3, R * 0.07)
      ctx.fill()
      // 턱수염
      ellipse(ctx, fx, fy + R * 0.78, R * 0.22, R * 0.16)
      ctx.fill()
      ctx.globalAlpha = 0.28
      ctx.beginPath()
      ctx.arc(fx * 0.6, hy + R * 0.2, R * 0.86, Math.PI * 0.15, Math.PI * 0.85)
      ctx.closePath()
      ctx.fill()
      ctx.globalAlpha = 1
      break
    }
    case 'full': {
      ctx.fillStyle = col
      ctx.globalAlpha = 0.85
      ctx.beginPath()
      ctx.arc(0, hy, R * 0.99, Math.PI * 0.12, Math.PI * 0.88)
      ctx.arc(0, hy + R * 0.05, R * 0.66, Math.PI * 0.88, Math.PI * 0.12, true)
      ctx.closePath()
      ctx.fill()
      // 콧수염
      ellipse(ctx, fx, fy + R * 0.4, R * 0.32, R * 0.08)
      ctx.fill()
      ctx.globalAlpha = 1
      break
    }
  }
}

/** 넓은 볼과 턱살이 있는 얼굴 윤곽 (철면수심 마스코트). 중심 (0, hy), 기준 반지름 R. */
function facePathJowl(ctx: CanvasRenderingContext2D, R: number, hy: number): void {
  ctx.beginPath()
  ctx.moveTo(0, hy - R * 0.98)
  ctx.quadraticCurveTo(R * 0.94, hy - R * 0.98, R * 1.02, hy - R * 0.2) // 오른쪽 이마→관자놀이
  ctx.quadraticCurveTo(R * 1.2, hy + R * 0.32, R * 1.06, hy + R * 0.66) // 볼 볼록
  ctx.quadraticCurveTo(R * 0.96, hy + R * 1.08, R * 0.44, hy + R * 1.16) // 턱살 → 턱
  ctx.quadraticCurveTo(0, hy + R * 1.26, -R * 0.44, hy + R * 1.16)
  ctx.quadraticCurveTo(-R * 0.96, hy + R * 1.08, -R * 1.06, hy + R * 0.66)
  ctx.quadraticCurveTo(-R * 1.2, hy + R * 0.32, -R * 1.02, hy - R * 0.2)
  ctx.quadraticCurveTo(-R * 0.94, hy - R * 0.98, 0, hy - R * 0.98)
  ctx.closePath()
}

/** 게임 화면용: 몸 → 머리 순서로 그린다. 스케일은 호출측에서 적용. */
export function drawCharacter(ctx: CanvasRenderingContext2D, def: CharacterDef, o: CharDrawOpts): void {
  drawBody(ctx, def, o)
  drawHead(ctx, def, o)
}

/** 로비 초상화: 3D 와 같은 달걀형 일체 몸통(정면). 머리 원이 달걀 윗부분이 되고 아래로 옷·바지·작은 다리가 이어진다 */
export function drawPortrait(canvas: HTMLCanvasElement, def: CharacterDef, facing = -Math.PI / 2 + 0.6): void {
  void facing
  const ctx = canvas.getContext('2d')!
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const size = canvas.clientWidth || 64
  canvas.width = size * dpr
  canvas.height = size * dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, size, size)
  const L = def.look
  const R = 12.5 * L.headScale
  const hy = -8 - R
  const jowl = L.faceShape === 'jowl'
  const chin = jowl ? R * 1.26 : R
  // 달걀: 머리 원 아래로 이어지는 몸통. 바닥은 hy + chin + R*0.95
  const bottom = hy + chin + R * 0.95
  const bw = R * (0.9 + 0.12 * L.bodyScale) * (L.slim ?? 1)
  const pantsC = hex(L.pants ?? 0x34405a)
  const eggH = bottom - (hy - R) + 6
  const s = (size * 0.9) / eggH
  ctx.save()
  ctx.translate(size / 2, size / 2 - ((hy - R) + bottom) / 2 * s)
  ctx.scale(s, s)
  ctx.lineJoin = 'round'
  const egg = () => {
    ctx.beginPath()
    ctx.moveTo(-R, hy)
    ctx.quadraticCurveTo(-bw * 1.02, hy + chin * 0.7, -bw * 0.9, hy + chin + R * 0.45)
    ctx.quadraticCurveTo(-bw * 0.7, bottom, 0, bottom)
    ctx.quadraticCurveTo(bw * 0.7, bottom, bw * 0.9, hy + chin + R * 0.45)
    ctx.quadraticCurveTo(bw * 1.02, hy + chin * 0.7, R, hy)
    ctx.closePath()
  }
  // 다리·신발
  ctx.fillStyle = pantsC
  ctx.strokeStyle = OUTLINE
  ctx.lineWidth = 1.4
  for (const d of [-1, 1]) {
    rrect(ctx, d * bw * 0.36 - 2.2, bottom - 3, 4.4, 6, 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#2a2622'
    ellipse(ctx, d * bw * 0.36, bottom + 3.2, 4, 2.2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = pantsC
  }
  // 몸통(피부) → 옷
  egg()
  ctx.fillStyle = hex(L.skin)
  ctx.fill()
  ctx.save()
  egg()
  ctx.clip()
  const collar = hy + chin
  const cloth = L.coat !== undefined ? L.coat : L.shirt
  ctx.fillStyle = hex(cloth)
  ctx.beginPath()
  if (L.neck === 'v') {
    ctx.moveTo(-bw * 1.2, collar - R * 0.05)
    ctx.lineTo(-R * 0.32, collar - R * 0.05)
    ctx.lineTo(0, collar + R * 0.35)
    ctx.lineTo(R * 0.32, collar - R * 0.05)
    ctx.lineTo(bw * 1.2, collar - R * 0.05)
  } else {
    ctx.moveTo(-bw * 1.2, collar)
    ctx.quadraticCurveTo(0, collar + R * 0.18, bw * 1.2, collar)
  }
  ctx.lineTo(bw * 1.2, bottom + 5)
  ctx.lineTo(-bw * 1.2, bottom + 5)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  if (L.stripe !== undefined) {
    ctx.fillStyle = hex(L.stripe)
    let band = 0
    for (let yy = collar + R * 0.1; yy < bottom + 5; yy += R * 0.34) {
      if (band++ % 2 === 0) ctx.fillRect(-bw * 1.2, yy, bw * 2.4, R * 0.17)
    }
  }
  if (L.apron !== undefined) {
    ctx.fillStyle = hex(L.apron)
    ctx.beginPath()
    ctx.moveTo(-R * 0.34, collar + R * 0.1)
    ctx.lineTo(R * 0.34, collar + R * 0.1)
    ctx.lineTo(R * 0.62, collar + R * 0.55)
    ctx.lineTo(R * 0.62, bottom + 5)
    ctx.lineTo(-R * 0.62, bottom + 5)
    ctx.lineTo(-R * 0.62, collar + R * 0.55)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    // 목끈
    ctx.lineWidth = 1.2
    for (const d of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(d * R * 0.3, collar + R * 0.12)
      ctx.lineTo(d * R * 0.5, collar - R * 0.12)
      ctx.stroke()
    }
    ctx.lineWidth = 1.4
  }
  if (L.neck === 'v' && L.undershirt !== undefined) {
    ctx.fillStyle = hex(L.undershirt)
    ctx.beginPath()
    ctx.moveTo(-R * 0.3, collar - R * 0.04)
    ctx.lineTo(R * 0.3, collar - R * 0.04)
    ctx.lineTo(0, collar + R * 0.32)
    ctx.closePath()
    ctx.fill()
  }
  if (L.coat !== undefined) {
    ctx.fillStyle = hex(L.shirt)
    rrect(ctx, -R * 0.22, collar - R * 0.02, R * 0.44, bottom - collar + 5, 1)
    ctx.fill()
    ctx.stroke()
    if (L.coatDots !== undefined) {
      ctx.fillStyle = hex(L.coatDots)
      for (let yy = collar + 3; yy < bottom; yy += 3.4) {
        for (let xx = -bw; xx <= bw; xx += 3.4) {
          if (Math.abs(xx) < R * 0.3) continue
          circle(ctx, xx, yy, 0.8)
          ctx.fill()
        }
      }
    }
  }
  if (L.badge !== undefined) {
    ctx.fillStyle = hex(L.badge)
    rrect(ctx, R * 0.35, collar + R * 0.42, R * 0.5, R * 0.2, 0.5)
    ctx.fill()
    ctx.stroke()
  }
  if (L.tie !== undefined) {
    ctx.fillStyle = hex(L.tie)
    ctx.beginPath()
    ctx.moveTo(-1.6, collar + 0.5)
    ctx.lineTo(1.6, collar + 0.5)
    ctx.lineTo(1.2, collar + 7)
    ctx.lineTo(0, collar + 8.5)
    ctx.lineTo(-1.2, collar + 7)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }
  if (L.bowTie !== undefined) {
    ctx.fillStyle = hex(L.bowTie)
    for (const d of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(d * 4.5, collar - 1.5)
      ctx.lineTo(0, collar + 1)
      ctx.lineTo(d * 4.5, collar + 3.5)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
  }
  // 바지 띠
  ctx.fillStyle = pantsC
  ctx.fillRect(-bw * 1.2, bottom - R * 0.28, bw * 2.4, R * 0.4)
  ctx.restore()
  // 달걀 외곽선
  egg()
  ctx.lineWidth = 2
  ctx.stroke()
  // 얼굴·머리카락·모자 (머리 원이 달걀 위쪽과 일치)
  drawHead(ctx, def, { facing: 0, frontal: true, sx: 1, sy: 1, walk: 0, moving: false, flash: 0, t: 0 })
  ctx.restore()
}

/** 죽었을 때 납작하게 */
export function drawFlat(ctx: CanvasRenderingContext2D, def: CharacterDef, alpha: number): void {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.scale(1.4, 0.32)
  ctx.fillStyle = hex(def.look.skin)
  ctx.strokeStyle = OUTLINE
  ctx.lineWidth = 2
  circle(ctx, 0, -14, 12.5 * def.look.headScale)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = hex(def.look.shirt)
  rrect(ctx, -11 * def.look.bodyScale, -8, 22 * def.look.bodyScale, 14, 5)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}
