// 바닥 핏자국 (2026-09-24 사용자: "몬스터 시체의 핏자국을 동그라미가 아니라 몇 가지 핏자국 모양으로 미리 만들어 놓고 — 동그라미는 너무 어색해").
// 처음 한 번 캔버스에 핏자국 여덟 모양(4×2 칸)을 그려 두고, 인스턴스마다 칸 번호(aTile)로 골라 바닥에 붙인다 — 그리기 호출 하나.
//   0~2 쓰러진 자리: 고르지 않은 웅덩이 + 둘레에 튄 방울
//   3~5 튄 자국: 웅덩이가 한쪽(-x)에 있고 +x 쪽으로 가늘게 뻗은 줄기 · 방울 (맞은 방향 뒤로 눕힌다)
//   6~7 작은 방울 무리 (명중)
// 모양은 고정 시드로 그린다 — 늘 같은 여덟 개. 색은 인스턴스 색(검붉게)이 곱해진다.

import * as THREE from 'three'

const COLS = 4
const ROWS = 2
const CELL = 128
/** 한 판에 남는 수 (오래된 것부터 덮어쓴다) */
export const BLOOD_MAX = 160
/** 남는 시간(초) — 끝 3초 동안 줄어들며 사라진다 */
export const BLOOD_LIFE = 30

export const SPLAT_POOL = [0, 1, 2]
export const SPLAT_SPRAY = [3, 4, 5]
export const SPLAT_DROPS = [6, 7]

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 고르지 않은 웅덩이: 반지름에 사인 몇 겹을 얹는다 */
function blob(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, rnd: () => number, squash = 1): void {
  const ph = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28, rnd() * 6.28]
  const amp = [0.14 + rnd() * 0.1, 0.08 + rnd() * 0.06, 0.04 + rnd() * 0.04, 0.02 + rnd() * 0.03]
  const n = 64
  g.beginPath()
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2
    const k = 1 + amp[0] * Math.sin(2 * a + ph[0]) + amp[1] * Math.sin(5 * a + ph[1]) + amp[2] * Math.sin(9 * a + ph[2]) + amp[3] * Math.sin(17 * a + ph[3])
    const x = cx + Math.cos(a) * r * k
    const y = cy + Math.sin(a) * r * k * squash
    if (i === 0) g.moveTo(x, y)
    else g.lineTo(x, y)
  }
  g.closePath()
  g.fill()
}

function dot(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath()
  g.arc(x, y, r, 0, Math.PI * 2)
  g.fill()
}

/** 가늘어지는 줄기: (x0, y0) 에서 각 a 로 길이 len · 끝에 방울 */
function streak(g: CanvasRenderingContext2D, x0: number, y0: number, a: number, len: number, w: number): void {
  const c = Math.cos(a)
  const s = Math.sin(a)
  const nx = -s
  const ny = c
  g.beginPath()
  g.moveTo(x0 + nx * w, y0 + ny * w)
  g.quadraticCurveTo(x0 + c * len * 0.6 + nx * w * 0.5, y0 + s * len * 0.6 + ny * w * 0.5, x0 + c * len, y0 + s * len)
  g.quadraticCurveTo(x0 + c * len * 0.6 - nx * w * 0.5, y0 + s * len * 0.6 - ny * w * 0.5, x0 - nx * w, y0 - ny * w)
  g.closePath()
  g.fill()
  dot(g, x0 + c * (len + w * 0.9), y0 + s * (len + w * 0.9), w * 0.75)
}

/** 칸 하나: 밝기가 조금씩 다른 두 겹(가장자리 어둡게 · 가운데 밝게)으로 그려 평평한 물감처럼 보이지 않게 */
function drawCell(g: CanvasRenderingContext2D, kind: number, rnd: () => number): void {
  const c = CELL / 2
  const layer = (fill: string, shrink: number, blur: number) => {
    g.fillStyle = fill
    g.shadowColor = fill
    g.shadowBlur = blur
    if (kind <= 2) {
      // 웅덩이 + 튄 방울
      const r = CELL * (0.24 + rnd() * 0.04) * shrink
      blob(g, c, c, r, rnd, 0.8 + rnd() * 0.2)
      // 웅덩이 가장자리에 붙은 작은 혹
      for (let i = 0; i < 3; i++) {
        const a = rnd() * Math.PI * 2
        blob(g, c + Math.cos(a) * r * 0.85, c + Math.sin(a) * r * 0.75, r * (0.25 + rnd() * 0.2), rnd)
      }
      const n = 6 + Math.floor(rnd() * 6)
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2
        const d = r * (1.2 + rnd() * 0.75)
        dot(g, c + Math.cos(a) * d, c + Math.sin(a) * d * 0.9, CELL * (0.008 + rnd() * 0.022) * shrink)
      }
    } else if (kind <= 5) {
      // 튄 자국: 웅덩이는 왼쪽, 줄기는 오른쪽(+x)으로 부채꼴
      const r = CELL * (0.15 + rnd() * 0.04) * shrink
      const bx = c - CELL * 0.16
      blob(g, bx, c, r, rnd, 0.75)
      const n = 5 + Math.floor(rnd() * 4)
      for (let i = 0; i < n; i++) {
        const a = (rnd() - 0.5) * 1.1
        const len = CELL * (0.18 + rnd() * 0.24)
        streak(g, bx + Math.cos(a) * r * 0.6, c + Math.sin(a) * r * 0.6, a, len, CELL * (0.012 + rnd() * 0.02) * shrink)
      }
      for (let i = 0; i < 8; i++) {
        const a = (rnd() - 0.5) * 1.4
        const d = r + CELL * (0.12 + rnd() * 0.3)
        dot(g, bx + Math.cos(a) * d, c + Math.sin(a) * d, CELL * (0.006 + rnd() * 0.016) * shrink)
      }
    } else {
      // 방울 무리 (명중)
      const n = 7 + Math.floor(rnd() * 6)
      blob(g, c, c, CELL * 0.08 * shrink, rnd)
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2
        const d = CELL * (0.05 + rnd() * 0.26)
        dot(g, c + Math.cos(a) * d, c + Math.sin(a) * d, CELL * (0.01 + rnd() * 0.03) * shrink)
      }
    }
  }
  // 같은 시드로 두 번 그려 겹이 어긋나지 않게
  const seed = Math.floor(rnd() * 1e9)
  const again = rng(seed)
  const keep = rnd
  rnd = rng(seed)
  layer('rgba(170,170,170,0.85)', 1, 1.5)
  rnd = again
  layer('rgba(255,255,255,0.9)', 0.78, 3)
  rnd = keep
}

function makeAtlas(): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = CELL * COLS
  cv.height = CELL * ROWS
  const g = cv.getContext('2d')!
  const rnd = rng(0xb100d)
  for (let k = 0; k < COLS * ROWS; k++) {
    g.save()
    g.translate((k % COLS) * CELL, Math.floor(k / COLS) * CELL)
    // 칸 밖으로 번지지 않게 (밉맵에서 옆 칸이 섞인다)
    g.beginPath()
    g.rect(4, 4, CELL - 8, CELL - 8)
    g.clip()
    drawCell(g, k, rng(Math.floor(rnd() * 1e9)))
    g.restore()
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

interface Splat {
  x: number
  z: number
  /** 한 변 (월드) */
  s: number
  r: number
  life: number
  age: number
}

/** 바닥 핏자국 묶음 (renderer3d 가 들고 있다) */
export class BloodDecals {
  readonly mesh: THREE.InstancedMesh
  private data: (Splat | undefined)[] = []
  private next = 0
  private tile: THREE.InstancedBufferAttribute
  private o = new THREE.Object3D()
  private col = new THREE.Color()

  constructor() {
    const geo = new THREE.PlaneGeometry(1, 1)
    geo.rotateX(-Math.PI / 2)
    this.tile = new THREE.InstancedBufferAttribute(new Float32Array(BLOOD_MAX), 1)
    geo.setAttribute('aTile', this.tile)
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, map: makeAtlas(), transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
    // 인스턴스마다 아틀라스 칸을 고른다
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aTile;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>\n  vMapUv = vMapUv * vec2(${1 / COLS}, ${1 / ROWS}) + vec2(mod(aTile, ${COLS}.0) * ${1 / COLS}, (${ROWS - 1}.0 - floor(aTile / ${COLS}.0)) * ${1 / ROWS});`)
    }
    this.mesh = new THREE.InstancedMesh(geo, mat, BLOOD_MAX)
    this.mesh.count = 0
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 1
  }

  /**
   * 핏자국 하나. size = 대략의 크기(월드 — 예전 원의 반지름 감), kinds = 고를 모양들, ang = 튄 방향(라디안, x→z 평면 — 없으면 아무렇게나).
   * 조명을 받지 않는 재질이라 어두운 던전에서 튀지 않게 검붉게.
   */
  add(x: number, z: number, size: number, kinds: number[], ang?: number): void {
    const i = this.next
    this.next = (this.next + 1) % BLOOD_MAX
    const r = ang === undefined ? Math.random() * Math.PI * 2 : -ang + (Math.random() - 0.5) * 0.5
    this.data[i] = { x, z, s: size * 2.6 * (0.85 + Math.random() * 0.35), r, life: BLOOD_LIFE, age: 0 }
    this.tile.setX(i, kinds[Math.floor(Math.random() * kinds.length)])
    this.tile.needsUpdate = true
    // 검붉게 (등불 아래서도 물감처럼 튀지 않게 — 2026-09-24 브라우저 확인: 0.16~0.26 은 마을 등불 곁에서 새빨갰다)
    const shade = 0.11 + Math.random() * 0.07
    this.mesh.setColorAt(i, this.col.setRGB(shade * 1.2, shade * 0.07, shade * 0.06))
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    this.mesh.count = Math.max(this.mesh.count, i + 1)
  }

  update(dt: number): void {
    const o = this.o
    for (let i = 0; i < this.mesh.count; i++) {
      const d = this.data[i]
      if (!d) continue
      d.life -= dt
      d.age += dt
      // 번지며 생긴다(0.25초) · 끝 3초 동안 줄어들며 사라진다
      const grow = Math.min(1, 0.55 + d.age * 1.8)
      const k = d.life <= 0 ? 0 : Math.min(1, d.life / 3) * grow
      o.position.set(d.x, 0.02, d.z)
      o.rotation.set(0, d.r, 0)
      o.scale.set(d.s * k, 1, d.s * k)
      o.updateMatrix()
      this.mesh.setMatrixAt(i, o.matrix)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }

  clear(): void {
    this.data = []
    this.next = 0
    this.mesh.count = 0
  }
}
