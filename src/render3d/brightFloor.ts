// ☀ 철면수심전용 맵별 바닥 (2026-10-17 그래픽 개편 B — docs/철면수심-그래픽-개편-계획.md 4장).
// 전에는 24 맵이 거의 같은 바닥(누런 얼룩 + 동그란 점 · 같은 체크무늬)이라 운동장 · 체육관 · 수영장 같은 주제가 안 읽혔다.
// 바닥 그림(world3d paintFloorSteps — 타일당 24px 한 장)의 바탕 무늬를 맵마다 다르게 그린다.
// 마을에서 나눠 그리므로(yield) 타일 몇 줄짜리 띠마다 그린다 — 무늬는 칸 좌표 해시로 정해 띠 사이 이음매가 없고, 같은 맵이면 모두 같다.
// 타일당 24px 은 가까이서 흐려서, 작은 반복 결 텍스처(grainTexture)를 바닥 재질에 곱한다(applyGrain).

import * as THREE from 'three'
import { GameMap, TILE_FLOOR, TILE_WALL } from '../core/map'
import { MAPS } from '../core/maps'

/** 타일 좌표 해시 (0..1) — 같은 맵이면 같은 모습 */
export function hash(tx: number, ty: number, salt = 0): number {
  let h = (Math.imul(tx, 73856093) ^ Math.imul(ty, 19349663) ^ Math.imul(salt + 1, 83492791)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

/** 테마 색 (sRGB 0..1 — 캔버스에 그대로 쓴다) */
export interface FloorPal {
  floor: THREE.Color
  alt: THREE.Color
  line: THREE.Color
}

/** 띠 하나: 타일 줄 ty0 ~ ty1 - 1 (잘라 그리기는 부르는 쪽) */
interface Band {
  g: CanvasRenderingContext2D
  map: GameMap
  px: number
  ty0: number
  ty1: number
  W: number
  H: number
  pal: FloorPal
}

type Grain = 'wood' | 'sand' | 'rubber' | 'grass' | 'glaze' | 'cloth'

export interface FloorDef {
  /** 결 텍스처 · 세기 */
  grain: Grain
  grainK: number
  /** 분필 금 · 기호를 얹는다 (모래 · 흙 바닥) */
  chalk: boolean
  /** 바깥 — 풀 · 꽃을 심는다 */
  outdoor: boolean
  paint: (b: Band) => void
}

const rgb = (c: THREE.Color, k = 1, a = 1) =>
  `rgba(${Math.round(Math.min(1, c.r * k) * 255)},${Math.round(Math.min(1, c.g * k) * 255)},${Math.round(Math.min(1, c.b * k) * 255)},${a})`
const tint = (c: THREE.Color, hex: number, k: number) => c.clone().lerp(new THREE.Color().setRGB(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255), k)

function fill(b: Band, c: THREE.Color): void {
  b.g.fillStyle = rgb(c)
  b.g.fillRect(0, b.ty0 * b.px, b.W, (b.ty1 - b.ty0) * b.px)
}

/** 아주 옅은 큰 얼룩 (cell 칸마다 하나 — 띠 밖으로 걸친 것도 그려야 이음매가 없다) */
function blotches(b: Band, c: THREE.Color, a: number, cell: number, salt: number): void {
  const { g, px } = b
  for (let cy = Math.floor((b.ty0 - 4) / cell); cy <= Math.ceil((b.ty1 + 4) / cell); cy++) {
    for (let cx = 0; cx <= Math.ceil(b.map.w / cell); cx++) {
      const x = (cx + hash(cx, cy, salt)) * cell * px
      const y = (cy + hash(cx, cy, salt + 1)) * cell * px
      const r = (1.4 + hash(cx, cy, salt + 2) * 2) * px
      const grd = g.createRadialGradient(x, y, 0, x, y, r)
      grd.addColorStop(0, rgb(c, 1, a))
      grd.addColorStop(1, rgb(c, 1, 0))
      g.fillStyle = grd
      g.fillRect(x - r, y - r, r * 2, r * 2)
    }
  }
}

function ellipse(g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number): void {
  g.beginPath()
  g.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2)
}

/** 널판 (가로 줄 · 줄마다 이음 자리가 다르다) — 대기실 마루 · 체육관 */
function planks(b: Band, perTile: number, len0: number, len1: number, salt: number): void {
  const { g, px, W, pal } = b
  const ph = px / perTile
  for (let r = b.ty0 * perTile; r < b.ty1 * perTile; r++) {
    const y = r * ph
    let x = -Math.floor(hash(r, 0, salt) * len1) * px
    for (let i = 0; x < W; i++) {
      const len = (len0 + Math.floor(hash(r, i, salt + 1) * (len1 - len0 + 1))) * px
      g.fillStyle = rgb(pal.floor, 0.94 + 0.1 * hash(r, i, salt + 2))
      g.fillRect(x, y, len, ph)
      g.fillStyle = 'rgba(255,255,255,0.16)'
      g.fillRect(x, y, len, 1)
      g.fillStyle = rgb(pal.line, 0.85, 0.6)
      g.fillRect(x, y + ph - 1, len, 1)
      g.fillRect(x + len - 1, y, 1, ph)
      x += len
    }
  }
}

/** 모닥불 둘레 둥근 러그 (물결 가장자리 · 고리 · 바느질 점선) */
function rug(g: CanvasRenderingContext2D, cx: number, cy: number, R: number): void {
  g.fillStyle = '#ffb3cf'
  g.beginPath()
  for (let k = 0; k <= 72; k++) {
    const a = (k / 72) * Math.PI * 2
    const rr = R * (1 + 0.035 * Math.cos(a * 18))
    if (k === 0) g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
    else g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
  }
  g.fill()
  ;['#fff3e6', '#9fe0cf', '#fff3e6', '#ffe08a'].forEach((c, i) => {
    g.fillStyle = c
    ellipse(g, cx, cy, R * (0.86 - i * 0.17), R * (0.86 - i * 0.17))
    g.fill()
  })
  g.setLineDash([5, 4])
  g.strokeStyle = 'rgba(255,255,255,0.85)'
  g.lineWidth = 1.6
  for (const k of [0.93, 0.6]) {
    ellipse(g, cx, cy, R * k, R * k)
    g.stroke()
  }
  g.setLineDash([])
}

const isFloorAt = (m: GameMap, tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < m.w && ty < m.h && m.tiles[ty * m.w + tx] === TILE_FLOOR
const isWallAt = (m: GameMap, tx: number, ty: number) => tx < 0 || ty < 0 || tx >= m.w || ty >= m.h || m.tiles[ty * m.w + tx] === TILE_WALL

/** 벽에 닿은 바닥 가장자리를 잔디 띠로 (운동장) */
function edgeGrass(b: Band): void {
  const { g, px, map } = b
  for (let ty = b.ty0; ty < b.ty1; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      if (!isFloorAt(map, tx, ty)) continue
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        if (!isWallAt(map, tx + dx, ty + dy)) continue
        const x0 = dx > 0 ? (tx + 1) * px : tx * px
        const y0 = dy > 0 ? (ty + 1) * px : ty * px
        const d = px * 0.8
        const grd = g.createLinearGradient(x0, y0, x0 - dx * d, y0 - dy * d)
        grd.addColorStop(0, 'rgba(140,208,112,0.75)')
        grd.addColorStop(1, 'rgba(140,208,112,0)')
        g.fillStyle = grd
        g.fillRect(tx * px, ty * px, px, px)
      }
    }
  }
}

/** 분필 무궁화 (꽃잎 다섯 동그라미 + 가운데) */
function chalkFlower(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.strokeStyle = 'rgba(255,255,255,0.75)'
  g.lineWidth = 1.5
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + (k * Math.PI * 2) / 5
    ellipse(g, cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62, r * 0.42, r * 0.42)
    g.stroke()
  }
  ellipse(g, cx, cy, r * 0.22, r * 0.22)
  g.stroke()
}

// ---------------------------------------------------------------- 바닥 종류

/** 대기실: 밝은 나무 마루 + 모닥불 둘레 러그 */
const wood: FloorDef = {
  grain: 'wood', grainK: 0.32, chalk: false, outdoor: false,
  paint(b) {
    planks(b, 2, 3, 5, 200)
    const fire = MAPS[b.map.id]?.fire
    if (fire) rug(b.g, (fire[0] + 1) * b.px, (fire[1] + 1) * b.px, 3.6 * b.px)
  },
}

/** 운동장: 고운 모래 + 흰 분필 트랙(세 줄 · 출발선) + 가장자리 잔디 띠 */
const sandTrack: FloorDef = {
  grain: 'sand', grainK: 0.4, chalk: true, outdoor: true,
  paint(b) {
    const { g, W, H, px, pal } = b
    fill(b, pal.floor)
    blotches(b, pal.alt, 0.55, 3, 210)
    blotches(b, pal.floor.clone().multiplyScalar(1.08), 0.4, 4, 214)
    edgeGrass(b)
    g.strokeStyle = 'rgba(255,255,255,0.78)'
    g.lineWidth = 2.5
    for (let k = 0; k < 3; k++) {
      ellipse(g, W / 2, H / 2, W * 0.36 - k * 1.3 * px, H * 0.34 - k * 1.3 * px)
      g.stroke()
    }
    // 출발선: 트랙 아래쪽을 가로지르는 굵은 줄
    g.fillStyle = 'rgba(255,255,255,0.8)'
    g.fillRect(W / 2 - 2, H / 2 + H * 0.34 - 2.6 * px - 4, 4, 2.6 * px + 8)
  },
}

/** 모래 놀이터: 모래 + 갈퀴 물결 자국(묶음마다 방향이 다르다) + 작은 둔덕 */
const sandRake: FloorDef = {
  grain: 'sand', grainK: 0.42, chalk: true, outdoor: false,
  paint(b) {
    const { g, px, pal } = b
    fill(b, pal.floor)
    blotches(b, pal.alt, 0.5, 3, 220)
    const C = 5
    const S = C * px
    for (let cy = Math.floor(b.ty0 / C); cy * C < b.ty1; cy++) {
      for (let cx = 0; cx * C < b.map.w; cx++) {
        const k = hash(cx, cy, 221)
        if (k < 0.3) {
          // 둔덕: 위는 밝게 · 아래는 그늘
          const x = (cx + 0.3 + hash(cx, cy, 223) * 0.4) * S
          const y = (cy + 0.3 + hash(cx, cy, 224) * 0.4) * S
          const r = (0.9 + hash(cx, cy, 225) * 0.8) * px
          const grd = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r)
          grd.addColorStop(0, 'rgba(255,255,255,0.35)')
          grd.addColorStop(0.7, 'rgba(255,255,255,0.08)')
          grd.addColorStop(1, rgb(pal.line, 1, 0.25))
          g.fillStyle = grd
          ellipse(g, x, y, r, r)
          g.fill()
          continue
        }
        const horiz = hash(cx, cy, 222) < 0.5
        const ph = hash(cx, cy, 226) * 6
        g.save()
        g.beginPath()
        g.rect(cx * S + 6, cy * S + 6, S - 12, S - 12)
        g.clip()
        for (let i = 0; i * 6 < S; i++) {
          for (const [off, style] of [[0, rgb(pal.line, 1, 0.4)], [1.5, 'rgba(255,255,255,0.35)']] as const) {
            g.strokeStyle = style
            g.lineWidth = 1.3
            g.beginPath()
            for (let s = 0; s <= S; s += 6) {
              const w = Math.sin(s * 0.07 + ph) * 2
              const a = (horiz ? cx * S + s : cx * S + i * 6 + w + off)
              const c = (horiz ? cy * S + i * 6 + w + off : cy * S + s)
              if (s === 0) g.moveTo(a, c)
              else g.lineTo(a, c)
            }
            g.stroke()
          }
        }
        g.restore()
      }
    }
  },
}

/** 체육관: 긴 널판 마루 + 코트 선(경계 · 가운데 선 · 원 · 양 끝 자유투 구역) — 흰 선 · 하늘색 칠 (빨강은 범위 예고 색이라 쓰지 않는다) */
const gym: FloorDef = {
  grain: 'wood', grainK: 0.28, chalk: false, outdoor: false,
  paint(b) {
    const { g, W, H, px } = b
    planks(b, 3, 4, 8, 230)
    const m = 3 * px
    const blue = 'rgba(120,175,255,0.28)'
    g.strokeStyle = 'rgba(255,255,255,0.88)'
    g.lineWidth = 3
    g.strokeRect(m, m, W - 2 * m, H - 2 * m)
    g.beginPath()
    g.moveTo(W / 2, m)
    g.lineTo(W / 2, H - m)
    g.stroke()
    ellipse(g, W / 2, H / 2, 2.6 * px, 2.6 * px)
    g.fillStyle = blue
    g.fill()
    g.stroke()
    for (const side of [-1, 1]) {
      const x0 = side < 0 ? m : W - m
      const kx = x0 + side * 5.5 * px
      g.fillStyle = blue
      g.fillRect(Math.min(x0, kx), H / 2 - 2.2 * px, 5.5 * px, 4.4 * px)
      g.strokeRect(Math.min(x0, kx), H / 2 - 2.2 * px, 5.5 * px, 4.4 * px)
      g.beginPath()
      g.arc(kx, H / 2, 2.2 * px, side < 0 ? -Math.PI / 2 : Math.PI / 2, side < 0 ? Math.PI / 2 : Math.PI * 1.5)
      g.stroke()
      // 3점 선
      g.beginPath()
      g.arc(x0 + side * 1.5 * px, H / 2, 9 * px, side < 0 ? -Math.PI / 2 : Math.PI / 2, side < 0 ? Math.PI / 2 : Math.PI * 1.5)
      g.stroke()
    }
  },
}

/** 공 창고: 체육 매트 큰 칸(2 × 2 타일 · 하늘 · 노랑 번갈아) + 도톰한 모서리 */
const mat: FloorDef = {
  grain: 'rubber', grainK: 0.3, chalk: false, outdoor: false,
  paint(b) {
    const { g, px, pal } = b
    const A = tint(pal.floor, 0x9fc8ff, 0.5)
    const B = tint(pal.floor, 0xffe08a, 0.5)
    const S = 2 * px
    for (let cy = Math.floor(b.ty0 / 2); cy * 2 < b.ty1; cy++) {
      for (let cx = 0; cx * 2 < b.map.w; cx++) {
        const x = cx * S
        const y = cy * S
        g.fillStyle = rgb((cx + cy) % 2 ? A : B, 0.97 + 0.06 * hash(cx, cy, 240))
        g.fillRect(x, y, S, S)
        g.fillStyle = 'rgba(255,255,255,0.38)'
        g.fillRect(x + 3, y + 3, S - 6, 3)
        g.fillRect(x + 3, y + 3, 3, S - 6)
        g.fillStyle = 'rgba(0,0,0,0.12)'
        g.fillRect(x + 3, y + S - 6, S - 6, 3)
        g.fillRect(x + S - 6, y + 3, 3, S - 6)
        g.strokeStyle = rgb(pal.line, 0.8, 0.85)
        g.lineWidth = 2
        g.strokeRect(x + 1, y + 1, S - 2, S - 2)
      }
    }
  },
}

/** 장난감 주차장 (투기장): 옅은 보라 바닥 + 흰 주차 칸 줄(8 줄마다 세 줄 깊이 · 2 칸 폭) + 노란 가운데 점선 */
const parking: FloorDef = {
  grain: 'rubber', grainK: 0.25, chalk: false, outdoor: false,
  paint(b) {
    const { g, px, pal, map } = b
    fill(b, pal.floor)
    blotches(b, pal.alt, 0.5, 4, 250)
    for (let ty = b.ty0; ty < b.ty1; ty++) {
      const r = ty % 8
      for (let tx = 0; tx < map.w; tx++) {
        if (r <= 2 && tx % 2 === 0) {
          g.fillStyle = 'rgba(255,255,255,0.85)'
          g.fillRect(tx * px - 1.5, ty * px, 3, px)
          if (r === 0) g.fillRect(tx * px, ty * px, 2 * px, 3)
        } else if (r === 5 && tx % 2 === 0) {
          g.fillStyle = 'rgba(255,205,60,0.9)'
          g.fillRect(tx * px + px * 0.2, ty * px + px / 2 - 2, px * 1.2, 4)
        }
      }
    }
  },
}

/** 술래의 마당: 다진 흙 + 가운데 큰 분필 원 · 바깥 점선 원 + 분필 무궁화 */
const yard: FloorDef = {
  grain: 'sand', grainK: 0.38, chalk: true, outdoor: false,
  paint(b) {
    const { g, W, H, px, pal, map } = b
    fill(b, pal.floor)
    blotches(b, pal.alt, 0.55, 3, 250)
    blotches(b, pal.floor.clone().multiplyScalar(1.07), 0.4, 4, 254)
    const R = Math.min(W, H) * 0.28
    g.strokeStyle = 'rgba(255,255,255,0.75)'
    g.lineWidth = 3
    ellipse(g, W / 2, H / 2, R, R)
    g.stroke()
    g.setLineDash([10, 8])
    g.lineWidth = 2
    ellipse(g, W / 2, H / 2, R * 1.4, R * 1.4)
    g.stroke()
    g.setLineDash([])
    for (let ty = b.ty0; ty < b.ty1; ty++) {
      for (let tx = 0; tx < map.w; tx++) if (hash(tx, ty, 255) < 0.014) chalkFlower(g, (tx + 0.5) * px, (ty + 0.5) * px, 8 + hash(tx, ty, 256) * 4)
    }
  },
}

// ---- 2 ~ 4막 (B2)

const PETAL = ['#ffffff', '#ffc2da', '#dccbff', '#fff1a8']
const TOY_CSS = ['#ff9fc0', '#8fe0c8', '#ffe07a', '#9cc8ff', '#d2b4ff', '#ffb894']

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath()
  g.roundRect(x, y, w, h, r)
}

/** 잔디: 깎은 줄무늬(stripe 칸 폭 세로 띠 — 0 이면 없음) + 옅은 얼룩 */
function lawn(b: Band, stripe: number, salt: number): void {
  const { g, px, W, pal } = b
  fill(b, pal.floor)
  if (stripe > 0) {
    for (let x = 0, i = 0; x < W; x += stripe * px, i++) {
      g.fillStyle = i % 2 ? 'rgba(255,255,255,0.11)' : 'rgba(0,0,0,0.045)'
      g.fillRect(x, b.ty0 * px, stripe * px, (b.ty1 - b.ty0) * px)
    }
  }
  blotches(b, pal.alt, 0.4, 4, salt)
}

/** 칸마다 하나씩 (타일 가운데 둘레 — 반 칸을 넘지 않게 그려 띠 경계를 넘지 않는다) */
function eachTile(b: Band, f: (tx: number, ty: number, x: number, y: number) => void): void {
  for (let ty = b.ty0; ty < b.ty1; ty++) for (let tx = 0; tx < b.map.w; tx++) f(tx, ty, (tx + 0.5) * b.px, (ty + 0.5) * b.px)
}

/** 큰 칸(C × C 타일)마다 — 띠에 걸친 칸만 */
function eachCell(b: Band, C: number, f: (cx: number, cy: number, x: number, y: number, S: number) => void): void {
  for (let cy = Math.floor(b.ty0 / C); cy * C < b.ty1; cy++) for (let cx = 0; cx * C < b.map.w; cx++) f(cx, cy, cx * C * b.px, cy * C * b.px, C * b.px)
}

function star(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.beginPath()
  for (let k = 0; k <= 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5
    const rr = k % 2 === 0 ? r : r * 0.45
    if (k === 0) g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
    else g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
  }
  g.fill()
}

/** 네 갈래 반짝 */
function sparkle(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath()
  g.moveTo(x, y - r)
  g.quadraticCurveTo(x, y, x + r, y)
  g.quadraticCurveTo(x, y, x, y + r)
  g.quadraticCurveTo(x, y, x - r, y)
  g.quadraticCurveTo(x, y, x, y - r)
  g.fill()
}

function diamond(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath()
  g.moveTo(x, y - r)
  g.lineTo(x + r, y)
  g.lineTo(x, y + r)
  g.lineTo(x - r, y)
  g.closePath()
  g.fill()
}

/** 솜사탕 숲: 깎은 잔디 줄무늬 + 꽃무리 + 돌판 징검 길 */
const meadow: FloorDef = {
  grain: 'grass', grainK: 0.4, chalk: false, outdoor: true,
  paint(b) {
    const { g, px, W, H, map } = b
    lawn(b, 3, 260)
    for (let cy = Math.floor((b.ty0 - 2) / 4); cy * 4 < b.ty1 + 2; cy++) {
      for (let cx = 0; cx * 4 < map.w; cx++) {
        if (hash(cx, cy, 261) > 0.3) continue
        const x0 = (cx * 4 + 1 + hash(cx, cy, 262) * 2) * px
        const y0 = (cy * 4 + 1 + hash(cx, cy, 263) * 2) * px
        for (let k = 0; k < 9; k++) {
          const x = x0 + (hash(cx * 16 + k, cy, 264) - 0.5) * 2.2 * px
          const y = y0 + (hash(cx * 16 + k, cy, 265) - 0.5) * 2.2 * px
          g.fillStyle = PETAL[Math.floor(hash(cx * 16 + k, cy, 266) * PETAL.length)]
          ellipse(g, x, y, 2.6, 2.6)
          g.fill()
          g.fillStyle = '#ffd34a'
          ellipse(g, x, y, 1, 1)
          g.fill()
        }
      }
    }
    // 돌판 징검 길: 맵을 가로지르는 굽은 길 (바닥 칸에만)
    for (let i = 0, x = px * 0.6; x < W; i++, x += px * 1.15) {
      const y = H * (0.5 + 0.22 * Math.sin((x / W) * Math.PI * 2 * 1.3 + 0.7)) + (hash(i, 0, 270) - 0.5) * px * 0.4
      if (y < (b.ty0 - 1) * px || y > (b.ty1 + 1) * px || !isFloorAt(map, Math.floor(x / px), Math.floor(y / px))) continue
      const rx = px * (0.42 + hash(i, 1, 270) * 0.12)
      const ry = rx * 0.78
      g.fillStyle = 'rgba(0,0,0,0.12)'
      ellipse(g, x + 1.5, y + 2, rx, ry)
      g.fill()
      g.fillStyle = '#efe9df'
      ellipse(g, x, y, rx, ry)
      g.fill()
      g.fillStyle = 'rgba(255,255,255,0.5)'
      ellipse(g, x - rx * 0.25, y - ry * 0.3, rx * 0.45, ry * 0.3)
      g.fill()
    }
  },
}

/** 젤리 늪: 반짝이는 보라 젤리 + 거품 + 빛 반사 줄 */
const jelly: FloorDef = {
  grain: 'glaze', grainK: 0.18, chalk: false, outdoor: false,
  paint(b) {
    const { g, pal } = b
    fill(b, pal.floor)
    blotches(b, pal.alt, 0.6, 3, 280)
    blotches(b, pal.floor.clone().multiplyScalar(1.1), 0.5, 4, 284)
    eachTile(b, (tx, ty, x, y) => {
      const h = hash(tx, ty, 281)
      if (h < 0.035) {
        const r = 3 + hash(tx, ty, 282) * 4
        g.strokeStyle = 'rgba(255,255,255,0.55)'
        g.lineWidth = 1.3
        ellipse(g, x, y, r, r)
        g.stroke()
        g.fillStyle = 'rgba(255,255,255,0.7)'
        ellipse(g, x - r * 0.35, y - r * 0.35, r * 0.25, r * 0.25)
        g.fill()
      } else if (h < 0.06) {
        g.strokeStyle = 'rgba(255,255,255,0.35)'
        g.lineWidth = 2
        g.beginPath()
        g.moveTo(x - 7, y + 4)
        g.lineTo(x + 4, y - 7)
        g.moveTo(x - 2, y + 7)
        g.lineTo(x + 7, y - 2)
        g.stroke()
      }
    })
  },
}

/** 공룡 굴 · 버섯 과자 동굴: 큰 비스킷 판(3 × 3 타일) · 구운 테두리 · 구멍 점 · 초코칩 */
const biscuit: FloorDef = {
  grain: 'sand', grainK: 0.3, chalk: false, outdoor: false,
  paint(b) {
    const { g, pal } = b
    fill(b, pal.line)
    eachCell(b, 3, (cx, cy, x, y, S) => {
      g.fillStyle = rgb(pal.floor, 0.96 + 0.08 * hash(cx, cy, 290))
      roundRect(g, x + 3, y + 3, S - 6, S - 6, 8)
      g.fill()
      g.strokeStyle = rgb(pal.alt, 0.9, 0.7)
      g.lineWidth = 4
      roundRect(g, x + 6, y + 6, S - 12, S - 12, 6)
      g.stroke()
      g.fillStyle = rgb(pal.line, 0.8, 0.75)
      for (let i = 1; i <= 3; i++) {
        for (let j = 1; j <= 3; j++) {
          ellipse(g, x + (i * S) / 4, y + (j * S) / 4, 1.7, 1.7)
          g.fill()
        }
      }
      if (hash(cx, cy, 291) < 0.4) {
        g.fillStyle = '#6b4330'
        for (let k = 0; k < 1 + Math.floor(hash(cx, cy, 292) * 2); k++) {
          ellipse(g, x + (0.22 + hash(cx * 4 + k, cy, 293) * 0.56) * S, y + (0.22 + hash(cx * 4 + k, cy, 294) * 0.56) * S, 3.6, 2.8)
          g.fill()
        }
      }
    })
  },
}

/** 벌집 궁전: 육각 벌집 타일 + 꿀이 찬 칸 */
const honey: FloorDef = {
  grain: 'glaze', grainK: 0.16, chalk: false, outdoor: false,
  paint(b) {
    const { g, px, W, pal } = b
    fill(b, pal.line)
    const r = px * 0.72
    const hw = Math.sqrt(3) * r
    const hex = (cx: number, cy: number, rr: number) => {
      g.beginPath()
      for (let k = 0; k < 6; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 3
        if (k === 0) g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
        else g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
      }
      g.closePath()
    }
    for (let j = Math.floor((b.ty0 * px - r) / (1.5 * r)); j * 1.5 * r < b.ty1 * px + r; j++) {
      for (let i = -1; i * hw < W + hw; i++) {
        const cx = i * hw + (j & 1 ? hw / 2 : 0)
        const cy = j * 1.5 * r
        const full = hash(i, j, 300) < 0.12
        hex(cx, cy, r - 1.5)
        g.fillStyle = full ? '#ffc93c' : rgb(pal.floor, 0.95 + 0.1 * hash(i, j, 301))
        g.fill()
        g.strokeStyle = 'rgba(255,255,255,0.35)'
        g.lineWidth = 1.5
        hex(cx, cy - 1, r * 0.66)
        g.stroke()
        if (full) {
          g.fillStyle = 'rgba(255,255,255,0.6)'
          ellipse(g, cx - r * 0.3, cy - r * 0.3, r * 0.18, r * 0.1)
          g.fill()
        }
      }
    }
  },
}

/** 미끄럼틀 수로 · 분수 광장: 수영장 타일(반 칸 · 흰 줄눈) + 물길 띠 + 가끔 색 타일 */
const pool: FloorDef = {
  grain: 'glaze', grainK: 0.12, chalk: false, outdoor: false,
  paint(b) {
    const { g, px, pal, map } = b
    g.fillStyle = '#ffffff'
    g.fillRect(0, b.ty0 * px, b.W, (b.ty1 - b.ty0) * px)
    const s = px / 2
    const lane = tint(pal.floor, 0x5aa8e8, 0.55)
    const acc = [0xffd36e, 0xff9fc0, 0x8fe0c8].map((c) => tint(pal.floor, c, 0.45))
    for (let r = b.ty0 * 2; r < b.ty1 * 2; r++) {
      for (let c = 0; c < map.w * 2; c++) {
        const h = hash(c, r, 310)
        const col = r % 16 === 7 || r % 16 === 8 ? lane : h < 0.03 ? acc[Math.floor(h * 100) % 3] : pal.floor
        g.fillStyle = rgb(col, 0.97 + 0.05 * hash(c, r, 311))
        g.fillRect(c * s + 1, r * s + 1, s - 2, s - 2)
        g.fillStyle = 'rgba(255,255,255,0.35)'
        g.fillRect(c * s + 1, r * s + 1, s - 2, 2)
      }
    }
  },
}

/** 파도 풀: 물 — 바닥 타일 비침 + 물결 빛무늬(흔들린 점을 굽은 선으로 이은 그물) + 레인 부표 줄 */
const water: FloorDef = {
  grain: 'glaze', grainK: 0.15, chalk: false, outdoor: false,
  paint(b) {
    const { g, px, W, pal, map } = b
    fill(b, pal.floor)
    blotches(b, pal.alt, 0.5, 3, 320)
    blotches(b, pal.floor.clone().multiplyScalar(1.12), 0.4, 4, 324)
    g.strokeStyle = 'rgba(255,255,255,0.14)'
    g.lineWidth = 1
    g.beginPath()
    for (let ty = b.ty0; ty <= b.ty1; ty++) {
      g.moveTo(0, ty * px)
      g.lineTo(W, ty * px)
    }
    for (let tx = 0; tx <= map.w; tx++) {
      g.moveTo(tx * px, b.ty0 * px)
      g.lineTo(tx * px, b.ty1 * px)
    }
    g.stroke()
    const C = 1.5 * px
    const pt = (i: number, j: number): [number, number] => [(i + 0.2 + hash(i, j, 321) * 0.6) * C, (j + 0.2 + hash(i, j, 322) * 0.6) * C]
    g.strokeStyle = 'rgba(255,255,255,0.45)'
    g.lineWidth = 1.6
    for (let j = Math.floor((b.ty0 * px) / C) - 1; j * C < b.ty1 * px + C; j++) {
      for (let i = -1; i * C < W + C; i++) {
        const [x, y] = pt(i, j)
        for (const [di, dj] of [[1, 0], [0, 1]] as const) {
          const [x2, y2] = pt(i + di, j + dj)
          const mx = (x + x2) / 2 + (hash(i * 2 + di, j * 2 + dj, 323) - 0.5) * C * 0.5
          const my = (y + y2) / 2 + (hash(i * 2 + di, j * 2 + dj, 324) - 0.5) * C * 0.5
          g.beginPath()
          g.moveTo(x, y)
          g.quadraticCurveTo(mx, my, x2, y2)
          g.stroke()
        }
      }
    }
    for (let ty = 6; ty < map.h; ty += 6) {
      const y = ty * px
      if (y < b.ty0 * px - 4 || y > b.ty1 * px + 4) continue
      for (let x = px / 2, k = 0; x < W; x += px * 0.5, k++) {
        g.fillStyle = ['#ffffff', '#ffe066', '#6fb4ff'][k % 3]
        ellipse(g, x, y, 4, 3)
        g.fill()
      }
    }
  },
}

/** 구슬치기 골목: 벽돌 길(바구니 엮음 — 칸마다 가로 둘 · 세로 둘 번갈아) + 구슬 구멍 + 분필 동그라미 */
const brick: FloorDef = {
  grain: 'sand', grainK: 0.3, chalk: true, outdoor: false,
  paint(b) {
    const { g, px, pal } = b
    fill(b, pal.line)
    const accent = tint(pal.floor, 0xffb3a0, 0.35)
    eachTile(b, (tx, ty) => {
      const horiz = (tx + ty) % 2 === 0
      for (let k = 0; k < 2; k++) {
        const x = tx * px + (horiz ? 0 : (k * px) / 2)
        const y = ty * px + (horiz ? (k * px) / 2 : 0)
        const w = horiz ? px : px / 2
        const h = horiz ? px / 2 : px
        g.fillStyle = rgb(hash(tx * 2 + k, ty, 331) < 0.08 ? accent : pal.floor, 0.92 + 0.12 * hash(tx * 2 + k, ty, 330))
        g.fillRect(x + 1, y + 1, w - 2, h - 2)
        g.fillStyle = 'rgba(255,255,255,0.2)'
        g.fillRect(x + 1, y + 1, w - 2, 1.5)
      }
    })
    eachTile(b, (tx, ty, x, y) => {
      if (hash(tx, ty, 332) >= 0.02) return
      g.fillStyle = rgb(pal.line, 0.6, 0.9)
      ellipse(g, x, y, 3.2, 2.6)
      g.fill()
      g.fillStyle = 'rgba(255,255,255,0.5)'
      ellipse(g, x + 1, y + 1.6, 2.2, 0.8)
      g.fill()
    })
    g.strokeStyle = 'rgba(255,255,255,0.7)'
    g.lineWidth = 2
    for (let cy = Math.floor((b.ty0 - 3) / 6); cy * 6 < b.ty1 + 3; cy++) {
      for (let cx = 0; cx * 6 < b.map.w; cx++) {
        if (hash(cx, cy, 333) > 0.35) continue
        const r = (1 + hash(cx, cy, 334) * 0.7) * px
        ellipse(g, (cx * 6 + 3) * px, (cy * 6 + 3) * px, r, r)
        g.stroke()
      }
    }
  },
}

/** 유리 징검다리: 큰 유리판(3 × 3 타일) + 밝은 테 + 빗금 반사 */
const glass: FloorDef = {
  grain: 'glaze', grainK: 0.1, chalk: false, outdoor: false,
  paint(b) {
    const { g, pal } = b
    fill(b, pal.line)
    eachCell(b, 3, (cx, cy, x, y, S) => {
      g.fillStyle = rgb(pal.floor, 0.97 + 0.07 * hash(cx, cy, 340))
      g.fillRect(x + 3, y + 3, S - 6, S - 6)
      g.strokeStyle = 'rgba(255,255,255,0.7)'
      g.lineWidth = 2.5
      g.strokeRect(x + 6, y + 6, S - 12, S - 12)
      g.save()
      g.beginPath()
      g.rect(x + 3, y + 3, S - 6, S - 6)
      g.clip()
      g.strokeStyle = 'rgba(255,255,255,0.32)'
      g.lineWidth = 6
      g.beginPath()
      g.moveTo(x + S * 0.12, y + S * 0.72)
      g.lineTo(x + S * 0.72, y + S * 0.12)
      g.stroke()
      g.lineWidth = 2
      g.beginPath()
      g.moveTo(x + S * 0.3, y + S * 0.86)
      g.lineTo(x + S * 0.86, y + S * 0.3)
      g.stroke()
      g.restore()
    })
  },
}

/** 카펫 테두리 띠: 짙은 띠 + 금빛 줄 둘 + 마름모 무늬 */
function carpetBorder(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, bw: number, pal: FloorPal): void {
  g.fillStyle = rgb(pal.line, 0.92)
  g.fillRect(x, y, w, bw)
  g.fillRect(x, y + h - bw, w, bw)
  g.fillRect(x, y, bw, h)
  g.fillRect(x + w - bw, y, bw, h)
  g.strokeStyle = 'rgba(255,240,200,0.9)'
  g.lineWidth = 1.5
  g.strokeRect(x + 3, y + 3, w - 6, h - 6)
  g.strokeRect(x + bw - 3, y + bw - 3, w - 2 * bw + 6, h - 2 * bw + 6)
  g.fillStyle = 'rgba(255,255,255,0.75)'
  for (let t = x + bw; t < x + w - bw; t += bw) {
    diamond(g, t, y + bw / 2, 4)
    diamond(g, t, y + h - bw / 2, 4)
  }
  for (let t = y + bw; t < y + h - bw; t += bw) {
    diamond(g, x + bw / 2, t, 4)
    diamond(g, x + w - bw / 2, t, 4)
  }
}

/** 반장실: 분홍 카펫 + 옅은 마름모 격자 + 테두리 띠 */
const carpet: FloorDef = {
  grain: 'cloth', grainK: 0.3, chalk: false, outdoor: false,
  paint(b) {
    const { g, px, W, H, pal } = b
    fill(b, pal.floor)
    g.strokeStyle = 'rgba(255,255,255,0.18)'
    g.lineWidth = 1.5
    g.beginPath()
    for (let k = -H; k < W + H; k += 2 * px) {
      g.moveTo(k, 0)
      g.lineTo(k + H, H)
      g.moveTo(k, H)
      g.lineTo(k + H, 0)
    }
    g.stroke()
    carpetBorder(g, 2 * px, 2 * px, W - 4 * px, H - 4 * px, px, pal)
  },
}

/** 불꽃놀이 언덕: 해 질 녘 복숭아빛 잔디 + 드문 별 무늬 */
const sunset: FloorDef = {
  grain: 'grass', grainK: 0.38, chalk: false, outdoor: true,
  paint(b) {
    const { g } = b
    lawn(b, 4, 340)
    eachTile(b, (tx, ty, x, y) => {
      if (hash(tx, ty, 341) >= 0.012) return
      g.fillStyle = hash(tx, ty, 342) < 0.5 ? 'rgba(255,255,255,0.7)' : 'rgba(255,224,110,0.8)'
      star(g, x, y, 5 + hash(tx, ty, 343) * 3)
    })
  },
}

/** 폭죽 들판: 노란 잔디 + 터진 폭죽 자국(색 줄이 뻗은 별 · 색종이) */
const festival: FloorDef = {
  grain: 'grass', grainK: 0.38, chalk: false, outdoor: true,
  paint(b) {
    const { g } = b
    lawn(b, 3, 350)
    eachTile(b, (tx, ty, x, y) => {
      if (hash(tx, ty, 351) >= 0.018) return
      g.strokeStyle = TOY_CSS[Math.floor(hash(tx, ty, 352) * TOY_CSS.length)]
      g.globalAlpha = 0.6
      g.lineWidth = 2
      g.beginPath()
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4 + hash(tx, ty, 353)
        const l = 6 + hash(tx * 8 + k, ty, 354) * 4
        g.moveTo(x + Math.cos(a) * 2, y + Math.sin(a) * 2)
        g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l)
      }
      g.stroke()
      g.globalAlpha = 1
      for (let k = 0; k < 4; k++) {
        g.fillStyle = TOY_CSS[Math.floor(hash(tx * 4 + k, ty, 355) * TOY_CSS.length)]
        g.fillRect(x + (hash(tx * 4 + k, ty, 356) - 0.5) * 18, y + (hash(tx * 4 + k, ty, 357) - 0.5) * 18, 3, 2)
      }
    })
  },
}

/** 볼풀 구덩이: 장난감 색 공을 촘촘히 겹쳐 (반 칸 격자 · 반짝점) */
const balls: FloorDef = {
  grain: 'glaze', grainK: 0.1, chalk: false, outdoor: false,
  paint(b) {
    const { g, px, pal, map } = b
    fill(b, pal.line)
    const s = px / 2
    // 바닥색 쪽으로 섞어 덜 진하게 — 캐릭터 · 범위 예고보다 눈에 띄지 않게
    const cols = [0xff9fc0, 0x8fe0c8, 0xffe07a, 0x9cc8ff, 0xd2b4ff, 0xffb894].map((h) => rgb(tint(pal.floor, h, 0.55)))
    for (let r = b.ty0 * 2 - 1; r < b.ty1 * 2 + 1; r++) {
      for (let c = -1; c < map.w * 2 + 1; c++) {
        const x = (c + 0.5 + (hash(c, r, 360) - 0.5) * 0.5) * s
        const y = (r + 0.5 + (hash(c, r, 361) - 0.5) * 0.5) * s
        const rad = s * (0.62 + hash(c, r, 362) * 0.14)
        g.fillStyle = cols[Math.floor(hash(c, r, 363) * cols.length)]
        ellipse(g, x, y, rad, rad)
        g.fill()
        g.fillStyle = 'rgba(255,255,255,0.45)'
        ellipse(g, x - rad * 0.35, y - rad * 0.38, rad * 0.28, rad * 0.2)
        g.fill()
      }
    }
  },
}

/** 2 × 2 타일 체크 (도톰한 윗 · 왼 모서리 빛) */
function checker(b: Band, A: THREE.Color, B: THREE.Color, salt: number): void {
  const { g } = b
  eachCell(b, 2, (cx, cy, x, y, S) => {
    g.fillStyle = rgb((cx + cy) % 2 ? A : B, 0.98 + 0.04 * hash(cx, cy, salt))
    g.fillRect(x, y, S, S)
    g.fillStyle = 'rgba(255,255,255,0.3)'
    g.fillRect(x, y, S, 2)
    g.fillRect(x, y, 2, S)
  })
}

/** 거울 미로: 연보라 큰 체크 + 거울 반짝 · 빗금 */
const mirror: FloorDef = {
  grain: 'glaze', grainK: 0.12, chalk: false, outdoor: false,
  paint(b) {
    const { g, pal } = b
    checker(b, pal.floor, tint(pal.alt, 0xc8b8ff, 0.3), 370)
    g.strokeStyle = 'rgba(255,255,255,0.25)'
    g.lineWidth = 3
    eachCell(b, 2, (cx, cy, x, y, S) => {
      if (hash(cx, cy, 371) > 0.25) return
      g.beginPath()
      g.moveTo(x + S * 0.2, y + S * 0.8)
      g.lineTo(x + S * 0.8, y + S * 0.2)
      g.stroke()
    })
    g.fillStyle = 'rgba(255,255,255,0.85)'
    eachTile(b, (tx, ty, x, y) => {
      if (hash(tx, ty, 372) < 0.035) sparkle(g, x, y, 4 + hash(tx, ty, 373) * 4)
    })
  },
}

/** 파스텔 계단: 큰 파스텔 체크 + 2 칸마다 계단 턱(흰 줄 + 아래로 옅은 그늘) */
const steps: FloorDef = {
  grain: 'glaze', grainK: 0.12, chalk: false, outdoor: false,
  paint(b) {
    const { g, px, W, pal } = b
    checker(b, pal.floor, tint(pal.floor, 0xbfeedd, 0.45), 380)
    for (let ty = Math.ceil(b.ty0 / 2) * 2; ty <= b.ty1; ty += 2) {
      const y = ty * px
      g.fillStyle = 'rgba(255,255,255,0.55)'
      g.fillRect(0, y - 2, W, 2)
      const grd = g.createLinearGradient(0, y, 0, y + 8)
      grd.addColorStop(0, 'rgba(0,0,0,0.14)')
      grd.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = grd
      g.fillRect(0, y, W, 8)
    }
  },
}

/** 결승 마당: 다진 흙 + 가운데 분홍 카펫 길(금빛 테) + 결승선 체커 띠 + 색종이 */
const finish: FloorDef = {
  grain: 'sand', grainK: 0.3, chalk: false, outdoor: false,
  paint(b) {
    const { g, px, W, pal, map } = b
    fill(b, pal.floor)
    blotches(b, pal.alt, 0.5, 3, 390)
    const cw = 4 * px
    const x0 = W / 2 - cw / 2
    g.fillStyle = '#ff9fc2'
    g.fillRect(x0, b.ty0 * px, cw, (b.ty1 - b.ty0) * px)
    g.fillStyle = '#ffd86e'
    g.fillRect(x0, b.ty0 * px, 3, (b.ty1 - b.ty0) * px)
    g.fillRect(x0 + cw - 3, b.ty0 * px, 3, (b.ty1 - b.ty0) * px)
    const fy = Math.round(map.h * 0.22) * px
    const s = px / 2
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c * s < W; c++) {
        g.fillStyle = (r + c) % 2 ? '#ffffff' : '#4a4a78'
        g.fillRect(c * s, fy + r * s, s, s)
      }
    }
    eachTile(b, (tx, ty, x, y) => {
      if (hash(tx, ty, 391) >= 0.05) return
      g.save()
      g.translate(x + (hash(tx, ty, 392) - 0.5) * 12, y + (hash(tx, ty, 393) - 0.5) * 12)
      g.rotate(hash(tx, ty, 394) * Math.PI)
      g.fillStyle = TOY_CSS[Math.floor(hash(tx, ty, 395) * TOY_CSS.length)]
      g.fillRect(-3.5, -1.5, 7, 3)
      g.restore()
    })
  },
}

/** 맵 id → 바닥 (투기장 맵은 없다 — 예전 바닥) */
export const BRIGHT_FLOOR: Record<string, FloorDef> = {
  town1: wood,
  town2: wood,
  town3: wood,
  town4: wood,
  fields: sandTrack,
  cave: sandRake,
  cathedral: gym,
  crypt: mat,
  archive: mat,
  butchery: yard,
  forest: meadow,
  swamp: jelly,
  hollow: biscuit,
  nest: honey,
  sewer: pool,
  cistern: water,
  ruins: brick,
  rite: glass,
  wardroom: carpet,
  rift: sunset,
  ashen: festival,
  pit: balls,
  maze: mirror,
  stair: steps,
  throne: finish,
  // 투기장
  studio: mat,
  yard: meadow,
  garage: parking,
}

/** 띠 하나를 그린다 (그 띠 밖으로 번지지 않게 잘라서) */
export function paintBrightBand(def: FloorDef, g: CanvasRenderingContext2D, map: GameMap, px: number, ty0: number, ty1: number, pal: FloorPal): void {
  g.save()
  g.beginPath()
  g.rect(0, ty0 * px, map.w * px, (ty1 - ty0) * px)
  g.clip()
  def.paint({ g, map, px, ty0, ty1, W: map.w * px, H: map.h * px, pal })
  g.restore()
}

// ---------------------------------------------------------------- 결 텍스처

/** 128px 반복 결 (회색 0.5 둘레 — 바닥색에 곱한다). 가장자리를 넘는 것은 맞은편에도 그려 이음매가 없다 */
function grainTexture(kind: Grain): THREE.CanvasTexture {
  const N = 128
  const c = document.createElement('canvas')
  c.width = N
  c.height = N
  const g = c.getContext('2d')!
  const grey = (v: number) => {
    const n = Math.round(Math.max(0, Math.min(1, v)) * 255)
    return `rgb(${n},${n},${n})`
  }
  g.fillStyle = grey(0.5)
  g.fillRect(0, 0, N, N)
  const wrapped = (x: number, y: number, w: number, h: number) => {
    for (const ox of [0, -N]) for (const oy of [0, -N]) g.fillRect(x + ox, y + oy, w, h)
  }
  if (kind === 'wood') {
    for (let y = 0; y < N; y++) {
      g.fillStyle = grey(0.5 + 0.09 * Math.sin((y / N) * Math.PI * 2 * 9 + Math.sin((y / N) * Math.PI * 2 * 2) * 2))
      g.fillRect(0, y, N, 1)
    }
    for (let i = 0; i < 90; i++) {
      g.fillStyle = grey(hash(i, 0, 400) < 0.5 ? 0.32 : 0.66)
      wrapped(hash(i, 1, 400) * N, Math.floor(hash(i, 2, 400) * N), 8 + hash(i, 3, 400) * 30, 1)
    }
  } else if (kind === 'sand') {
    for (let i = 0; i < 1500; i++) {
      g.fillStyle = grey(0.5 + (hash(i, 0, 410) - 0.5) * 0.8)
      const s = hash(i, 3, 410) < 0.15 ? 2 : 1
      wrapped(Math.floor(hash(i, 1, 410) * N), Math.floor(hash(i, 2, 410) * N), s, s)
    }
  } else if (kind === 'rubber') {
    for (let y = 4; y < N; y += 8) {
      for (let x = 4; x < N; x += 8) {
        g.fillStyle = grey(0.36)
        g.fillRect(x, y, 2, 2)
        g.fillStyle = grey(0.64)
        g.fillRect(x - 1, y - 1, 1, 1)
      }
    }
  } else if (kind === 'glaze') {
    // 매끈한 유약: 옅은 빛 얼룩 몇 개뿐
    for (let i = 0; i < 10; i++) {
      const x = hash(i, 0, 430) * N
      const y = hash(i, 1, 430) * N
      const r = 10 + hash(i, 2, 430) * 18
      for (const ox of [0, -N, N]) {
        for (const oy of [0, -N, N]) {
          const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r)
          grd.addColorStop(0, 'rgba(255,255,255,0.3)')
          grd.addColorStop(1, 'rgba(255,255,255,0)')
          g.fillStyle = grd
          g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2)
        }
      }
    }
  } else if (kind === 'cloth') {
    // 천: 2px 엮음 + 보풀
    for (let y = 0; y < N; y += 2) {
      for (let x = 0; x < N; x += 2) {
        g.fillStyle = grey(((x + y) >> 1) % 2 ? 0.44 : 0.56)
        g.fillRect(x, y, 2, 2)
      }
    }
    for (let i = 0; i < 300; i++) {
      g.fillStyle = grey(0.5 + (hash(i, 0, 440) - 0.5) * 0.5)
      g.fillRect(Math.floor(hash(i, 1, 440) * N), Math.floor(hash(i, 2, 440) * N), 1, 1)
    }
  } else {
    for (let i = 0; i < 700; i++) {
      g.fillStyle = grey(0.5 + (hash(i, 0, 420) - 0.5) * 0.6)
      wrapped(Math.floor(hash(i, 1, 420) * N), Math.floor(hash(i, 2, 420) * N), 1, 3 + Math.floor(hash(i, 3, 420) * 3))
    }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 4
  return tex
}

/** 바닥 재질에 결을 곱한다 (결 하나가 2 × 2 타일). 셰이더는 모든 결 바닥이 하나를 같이 쓴다 — 돌려준 텍스처는 세계와 함께 버린다 */
export function applyGrain(mat: THREE.MeshLambertMaterial, map: GameMap, def: FloorDef): THREE.Texture {
  const tex = grainTexture(def.grain)
  const rep = new THREE.Vector2(map.w / 2, map.h / 2)
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGrain = { value: tex }
    sh.uniforms.uGrainRep = { value: rep }
    sh.uniforms.uGrainK = { value: def.grainK }
    sh.fragmentShader = 'uniform sampler2D uGrain;\nuniform vec2 uGrainRep;\nuniform float uGrainK;\n' + sh.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      diffuseColor.rgb *= 1.0 + ( texture2D( uGrain, vMapUv * uGrainRep ).r - 0.5 ) * uGrainK;`,
    )
  }
  mat.customProgramCacheKey = () => 'floor-grain'
  return tex
}
