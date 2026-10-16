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

type Grain = 'wood' | 'sand' | 'rubber' | 'grass'

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

/** 맵 id → 바닥 (없는 맵은 예전 바닥 — 2 ~ 4막은 B 다음 판에) */
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
