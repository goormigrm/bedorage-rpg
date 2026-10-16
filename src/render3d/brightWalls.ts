// ☀ 철면수심전용 맵별 벽 (2026-10-17 그래픽 개편 C — docs/철면수심-그래픽-개편-계획.md 5.1).
// 전에는 실내는 색만 다른 파스텔 상자, 바깥은 각진 바위 덩어리(감자 · 구슬 꿰미)가 줄지어 맵마다 주제가 없었다.
// 실내 = 레고식 블록 쌓기(사용자 결정 2026-10-17) · 수영장 타일 벽 · 거울 판 / 바깥 = 생울타리 · 모래성 · 쿠키 · 벌집 기둥 · 쿠션 · 솜사탕 나무 · 젤리 버섯.
// 화면만 — 벽 높이 · 자리는 타일 그대로(충돌과 겉모습이 맞게). 종류마다 InstancedMesh 하나(그리기 한 번) · 작은 조각(돌기 · 꽃 · 깃발)은 그림자를 넣지 않는다.

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { GameMap } from '../core/map'
import type { MapTheme } from '../core/maps'
import { hash } from './brightFloor'

/** world3d buildDark 이 넘겨주는 것 (그 함수의 도우미를 그대로 쓴다) */
export interface WallCtx {
  map: GameMap
  /** 바닥과 닿은(보이는) 벽 칸 */
  vis: [number, number][]
  t: MapTheme
  wallH: [number, number]
  inst: (geo: THREE.BufferGeometry, mat: THREE.Material, n: number, shadow?: boolean) => THREE.InstancedMesh
  put: (m: THREE.InstancedMesh, x: number, y: number, z: number, sx: number, sy: number, sz: number, rotY?: number, color?: THREE.Color) => void
  isWall: (tx: number, ty: number) => boolean
  isFloor: (tx: number, ty: number) => boolean
  /** 바닥 쪽을 어둡게 하는 정점 색 (world3d groundShade) */
  shade: (geo: THREE.BufferGeometry, from: number, to: number, dark: number) => THREE.BufferGeometry
  /** 장난감 색 (world3d toy) */
  toy: (tx: number, ty: number, salt: number) => number
  disposables: { dispose(): void }[]
}

type WallKind = (c: WallCtx) => void

const lam = (opts: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color: 0xffffff, ...opts })
const height = (c: WallCtx, tx: number, ty: number) => c.wallH[0] + (c.wallH[1] - c.wallH[0]) * hash(tx, ty, 1)
const DIRS: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]]

/** 벽 옆면 무늬 (흰 바탕의 밝기만 — 색은 인스턴스 색) */
function canvasTex(c: WallCtx, W: number, H: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d')!
  draw(g)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  c.disposables.push(tex)
  return tex
}
const grey = (v: number) => {
  const n = Math.round(Math.max(0, Math.min(1, v)) * 255)
  return `rgb(${n},${n},${n})`
}
/** 텍스처 아래쪽 = 벽 아래 (바닥에 닿은 그늘) */
function footShade(g: CanvasRenderingContext2D, W: number, H: number, a: number): void {
  const grd = g.createLinearGradient(0, H, 0, H * 0.75)
  grd.addColorStop(0, `rgba(0,0,0,${a})`)
  grd.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grd
  g.fillRect(0, H * 0.75, W, H * 0.25)
}

/** 실내: 레고식 블록 쌓기 — 층마다 장난감 색(같은 층은 세 칸씩 같은 색 · 층마다 이음 자리가 어긋난다) · 둥근 모서리 · 맨 위 돌기 넷 */
const lego: WallKind = (c) => {
  const LH = 0.75
  const block = c.inst(new RoundedBoxGeometry(1, 1, 1, 1, 0.07), lam(), c.vis.length * 3)
  // 돌기: 옆면 + 윗뚜껑만 (아래 뚜껑은 안 보인다 — 돌기가 벽 수 × 4 라 면을 아낀다)
  const studGeo = mergeGeometries([new THREE.CylinderGeometry(0.15, 0.15, 0.12, 8, 1, true).translate(0, 0.06, 0), new THREE.CircleGeometry(0.15, 8).rotateX(-Math.PI / 2).translate(0, 0.12, 0)])!
  const stud = c.inst(studGeo, lam(), c.vis.length * 4 + 480, false)
  const base = new THREE.Color(c.t.wall)
  const col = new THREE.Color()
  const tc = new THREE.Color()
  const color = (tx: number, ty: number, l: number) => col.copy(base).lerp(tc.setHex(c.toy(Math.floor((tx + ty + l * 2) / 3), l, 30)), 0.6)
  const studs = (x: number, y: number, z: number, s: number) => {
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) c.put(stud, x + dx * 0.24 * s, y, z + dz * 0.24 * s, s, s, s, 0, col)
  }
  for (const [tx, ty] of c.vis) {
    const n = Math.max(2, Math.min(3, Math.round(height(c, tx, ty) / LH)))
    for (let l = 0; l < n; l++) c.put(block, tx + 0.5, l * LH + LH / 2, ty + 0.5, 0.97, LH * 0.96, 0.97, 0, color(tx, ty, l))
    studs(tx + 0.5, n * LH - 0.02, ty + 0.5, 1)
  }
  // 무너진 모서리: 벽 끝(이웃 벽이 하나뿐)에 흩어진 작은 블록 (돌기 넷)
  const bit = c.inst(new RoundedBoxGeometry(1, 1, 1, 1, 0.08), lam(), 120)
  let n = 0
  for (const [tx, ty] of c.vis) {
    if (n >= 40 || hash(tx, ty, 4) > 0.6 || DIRS.filter(([dx, dy]) => c.isWall(tx + dx, ty + dy)).length !== 1) continue
    for (let k = 0; k < 3; k++) {
      const a = hash(tx, ty, 10 + k) * Math.PI * 2
      const x = tx + 0.5 + Math.cos(a) * 0.72
      const z = ty + 0.5 + Math.sin(a) * 0.72
      col.setHex(c.toy(tx, ty, 14 + k))
      c.put(bit, x, 0.13, z, 0.36, 0.26, 0.36, 0, col)
      studs(x, 0.25, z, 0.36)
    }
    n++
  }
}

/** 수영장 타일 벽 (+ 파도 풀은 튜브 더미): 흰 · 하늘 작은 타일 줄눈 + 둥근 턱(코핑) */
const poolWall: WallKind = (c) => {
  const tex = canvasTex(c, 128, 256, (g) => {
    g.fillStyle = grey(0.97)
    g.fillRect(0, 0, 128, 256)
    g.fillStyle = grey(0.8)
    for (let k = 0; k <= 4; k++) g.fillRect(k * 32 - 2, 0, 4, 256)
    for (let k = 0; k <= 8; k++) g.fillRect(0, k * 32 - 2, 128, 4)
    footShade(g, 128, 256, 0.3)
  })
  const block = c.inst(new THREE.BoxGeometry(1, 1, 1), lam({ map: tex }), c.vis.length)
  const coping = c.inst(new RoundedBoxGeometry(1.1, 0.18, 1.1, 1, 0.07), lam(), c.vis.length)
  const base = new THREE.Color(c.t.wall).lerp(new THREE.Color(0xffffff), 0.55)
  const top = new THREE.Color(c.t.wallTop).lerp(new THREE.Color(0xffffff), 0.5)
  const col = new THREE.Color()
  const tubes = c.map.id === 'cistern' ? c.inst(new THREE.TorusGeometry(0.33, 0.13, 8, 18).rotateX(Math.PI / 2), lam(), c.vis.length * 3) : null
  for (const [tx, ty] of c.vis) {
    const h = height(c, tx, ty)
    c.put(block, tx + 0.5, h / 2, ty + 0.5, 1, h, 1, 0, col.copy(base).multiplyScalar(0.96 + 0.06 * hash(tx, ty, 2)))
    c.put(coping, tx + 0.5, h + 0.09, ty + 0.5, 1, 1, 1, 0, top)
    if (tubes && hash(tx, ty, 60) < 0.1) {
      for (let k = 0; k < 2 + Math.floor(hash(tx, ty, 61) * 2); k++) {
        c.put(tubes, tx + 0.5 + (hash(tx, ty, 62 + k) - 0.5) * 0.15, h + 0.3 + k * 0.25, ty + 0.5 + (hash(tx, ty, 65 + k) - 0.5) * 0.15, 1, 1, 1, 0, col.setHex(c.toy(tx, ty, 68 + k)))
      }
    }
  }
}

/** 거울 미로: 연보라 테 + 밝은 빗금 반사 판 */
const mirrorWall: WallKind = (c) => {
  const tex = canvasTex(c, 128, 256, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, 256)
    grd.addColorStop(0, grey(1))
    grd.addColorStop(1, grey(0.86))
    g.fillStyle = grd
    g.fillRect(0, 0, 128, 256)
    g.strokeStyle = 'rgba(255,255,255,0.95)'
    g.lineWidth = 12
    g.beginPath()
    g.moveTo(-10, 150)
    g.lineTo(140, 20)
    g.stroke()
    g.lineWidth = 5
    g.beginPath()
    g.moveTo(-10, 200)
    g.lineTo(140, 70)
    g.stroke()
    g.strokeStyle = grey(0.62)
    g.lineWidth = 12
    g.strokeRect(6, 6, 116, 244)
    footShade(g, 128, 256, 0.25)
  })
  const panel = c.inst(new THREE.BoxGeometry(1, 1, 1), lam({ map: tex }), c.vis.length)
  const cap = c.inst(new RoundedBoxGeometry(1.06, 0.12, 1.06, 1, 0.05), lam(), c.vis.length)
  const base = new THREE.Color(c.t.wall).lerp(new THREE.Color(0xd8c8ff), 0.5)
  const col = new THREE.Color()
  for (const [tx, ty] of c.vis) {
    const h = height(c, tx, ty)
    c.put(panel, tx + 0.5, h / 2, ty + 0.5, 1, h, 1, 0, col.copy(base).multiplyScalar(0.96 + 0.07 * hash(tx, ty, 2)))
    c.put(cap, tx + 0.5, h + 0.06, ty + 0.5, 1, 1, 1, 0, col.multiplyScalar(0.85))
  }
}

/** 작은 꽃 (꽃잎 색 — 가운데는 노랑) */
const FLOWER = [0xffffff, 0xffc2da, 0xdccbff, 0xfff1a8]

/** 바깥(운동장 · 불꽃놀이 언덕 · 폭죽 들판): 다듬은 생울타리 + 바닥 쪽 면에 작은 꽃 + 사이사이 막대 사탕 나무 */
const hedge: WallKind = (c) => {
  const leaf = c.inst(c.shade(new RoundedBoxGeometry(1, 1, 1, 2, 0.28), -0.5, 0.3, 0.62), lam({ vertexColors: true }), c.vis.length)
  const flower = c.inst(new THREE.SphereGeometry(0.08, 5, 3).scale(1, 1, 0.5), lam(), c.vis.length * 2, false)
  const base = new THREE.Color(c.t.wall)
  const col = new THREE.Color()
  for (const [tx, ty] of c.vis) {
    const h = height(c, tx, ty)
    c.put(leaf, tx + 0.5, h / 2, ty + 0.5, 1.04, h, 1.04, 0, col.copy(base).multiplyScalar(0.9 + 0.14 * hash(tx, ty, 2)))
    const d = DIRS.find(([dx, dy]) => c.isFloor(tx + dx, ty + dy))
    if (!d) continue
    for (let k = 0; k < 2; k++) {
      if (hash(tx, ty, 40 + k) > 0.45) continue
      const along = (hash(tx, ty, 42 + k) - 0.5) * 0.7
      c.put(flower, tx + 0.5 + d[0] * 0.535 + d[1] * along, h * (0.3 + 0.55 * hash(tx, ty, 44 + k)), ty + 0.5 + d[1] * 0.535 + d[0] * along, 1, 1, 1, Math.atan2(d[0], d[1]), col.setHex(FLOWER[Math.floor(hash(tx, ty, 46 + k) * FLOWER.length)]))
    }
  }
  // 막대 사탕 나무 (흰 막대 + 동그란 사탕) — 예전 들판 그대로
  const stick = c.inst(new THREE.CylinderGeometry(0.05, 0.06, 1.7, 6).translate(0, 0.85, 0), lam({ color: 0xfff4ea }), c.vis.length)
  const candy = c.inst(new THREE.SphereGeometry(0.46, 14, 10).scale(1, 1, 0.55).translate(0, 1.95, 0), lam(), c.vis.length)
  for (const [tx, ty] of c.vis) {
    if (hash(tx, ty, 20) >= 0.12) continue
    const s = 0.8 + hash(tx, ty, 21) * 0.6
    const r = hash(tx, ty, 22) * 6.28
    c.put(stick, tx + 0.5, 0, ty + 0.5, 1, s, 1, r)
    c.put(candy, tx + 0.5, 0, ty + 0.5, s, s, s, r, col.setHex(c.toy(tx, ty, 23)))
  }
}

/** 모래 놀이터: 모래성 벽 — 양동이로 찍은 줄무늬 블록 + 위 톱니(총안) + 가끔 깃발 */
const castle: WallKind = (c) => {
  const tex = canvasTex(c, 128, 256, (g) => {
    g.fillStyle = grey(0.93)
    g.fillRect(0, 0, 128, 256)
    for (let y = 40; y < 256; y += 48) {
      g.fillStyle = grey(0.8)
      g.fillRect(0, y, 128, 3)
      g.fillStyle = grey(1)
      g.fillRect(0, y + 3, 128, 2)
    }
    for (let i = 0; i < 260; i++) {
      g.fillStyle = grey(0.82 + hash(i, 0, 500) * 0.2)
      g.fillRect(hash(i, 1, 500) * 128, hash(i, 2, 500) * 256, 2, 2)
    }
    footShade(g, 128, 256, 0.3)
  })
  const block = c.inst(new THREE.BoxGeometry(1, 1, 1), lam({ map: tex }), c.vis.length)
  const merlon = c.inst(new THREE.BoxGeometry(0.34, 0.32, 0.34), lam({ map: tex }), c.vis.length * 2)
  const pole = c.inst(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 4).translate(0, 0.35, 0), lam(), 60, false)
  const flagGeo = new THREE.BufferGeometry()
  flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.7, 0, 0, 0.44, 0, 0.32, 0.57, 0], 3))
  flagGeo.computeVertexNormals()
  const flag = c.inst(flagGeo, lam({ side: THREE.DoubleSide }), 60, false)
  const sand = new THREE.Color(c.t.wall).lerp(new THREE.Color(0xf2d6a0), 0.55)
  const col = new THREE.Color()
  let flags = 0
  for (const [tx, ty] of c.vis) {
    const h = height(c, tx, ty)
    col.copy(sand).multiplyScalar(0.95 + 0.08 * hash(tx, ty, 2))
    c.put(block, tx + 0.5, h / 2, ty + 0.5, 1, h, 1, 0, col)
    c.put(merlon, tx + 0.25, h + 0.16, ty + 0.25, 1, 1, 1, 0, col)
    c.put(merlon, tx + 0.75, h + 0.16, ty + 0.75, 1, 1, 1, 0, col)
    if (flags < 60 && hash(tx, ty, 70) < 0.05) {
      c.put(pole, tx + 0.5, h, ty + 0.5, 1, 1, 1)
      c.put(flag, tx + 0.5, h, ty + 0.5, 1, 1, 1, hash(tx, ty, 71) * 6.28, col.setHex(c.toy(tx, ty, 72)))
      flags++
    }
  }
}

/** 공룡 굴 · 버섯 과자 동굴: 쌓은 쿠키(위에 초코칩) · 웨하스 */
const cookie: WallKind = (c) => {
  const tex = canvasTex(c, 64, 256, (g) => {
    for (let y = 0; y < 256; y += 16) {
      g.fillStyle = grey(0.97)
      g.fillRect(0, y, 64, 11)
      g.fillStyle = grey(0.74)
      g.fillRect(0, y + 11, 64, 5)
    }
    footShade(g, 64, 256, 0.25)
  })
  const disc = c.inst(new THREE.CylinderGeometry(0.46, 0.46, 0.2, 14), lam(), c.vis.length * 11)
  const chip = c.inst(new THREE.SphereGeometry(0.06, 5, 4).scale(1, 0.6, 1), lam({ color: 0x6b4330 }), c.vis.length * 3, false)
  const wafer = c.inst(new THREE.BoxGeometry(0.86, 1, 0.86), lam({ map: tex }), c.vis.length)
  const ck = new THREE.Color(c.t.wall)
  const wf = new THREE.Color(c.t.wallTop).lerp(new THREE.Color(0xfff0c8), 0.4)
  const col = new THREE.Color()
  for (const [tx, ty] of c.vis) {
    const h = height(c, tx, ty)
    if (hash(tx, ty, 50) < 0.55) {
      const n = Math.max(4, Math.round(h / 0.22))
      for (let i = 0; i < n; i++) {
        c.put(disc, tx + 0.5 + (hash(tx * 16 + i, ty, 51) - 0.5) * 0.08, 0.1 + i * 0.22, ty + 0.5 + (hash(tx * 16 + i, ty, 52) - 0.5) * 0.08, 1, 1, 1, 0, col.copy(ck).multiplyScalar(0.9 + 0.18 * hash(tx * 16 + i, ty, 53)))
      }
      for (let k = 0; k < 3; k++) c.put(chip, tx + 0.5 + (hash(tx, ty, 54 + k) - 0.5) * 0.6, n * 0.22 + 0.01, ty + 0.5 + (hash(tx, ty, 57 + k) - 0.5) * 0.6, 1, 1, 1)
    } else {
      c.put(wafer, tx + 0.5, h / 2, ty + 0.5, 1, h, 1, (hash(tx, ty, 59) - 0.5) * 0.3, col.copy(wf).multiplyScalar(0.95 + 0.08 * hash(tx, ty, 2)))
    }
  }
}

/** 벌집 궁전: 꿀색 육각 기둥 (나란히 서면 벌집 벽) + 밝은 뚜껑 */
const honeycomb: WallKind = (c) => {
  const pillar = c.inst(c.shade(new THREE.CylinderGeometry(0.58, 0.58, 1, 6).translate(0, 0.5, 0), 0, 0.5, 0.65), lam({ vertexColors: true }), c.vis.length)
  const cap = c.inst(new THREE.CylinderGeometry(0.6, 0.6, 0.08, 6), lam(), c.vis.length)
  const base = new THREE.Color(c.t.wall)
  const top = new THREE.Color(c.t.wallTop)
  const col = new THREE.Color()
  for (const [tx, ty] of c.vis) {
    const h = height(c, tx, ty)
    c.put(pillar, tx + 0.5, 0, ty + 0.5, 1, h, 1, 0, col.copy(base).multiplyScalar(0.9 + 0.14 * hash(tx, ty, 2)))
    c.put(cap, tx + 0.5, h + 0.04, ty + 0.5, 1, 1, 1, 0, col.copy(top).multiplyScalar(0.95 + 0.08 * hash(tx, ty, 3)))
  }
}

/** 볼풀 구덩이: 푹신한 쿠션 벽 (장난감 색 · 둥근 모서리) */
const cushion: WallKind = (c) => {
  const pad = c.inst(c.shade(new RoundedBoxGeometry(1, 1, 1, 2, 0.3), -0.5, 0.2, 0.7), lam({ vertexColors: true }), c.vis.length)
  const base = new THREE.Color(c.t.wall)
  const col = new THREE.Color()
  const tc = new THREE.Color()
  for (const [tx, ty] of c.vis) {
    const h = height(c, tx, ty)
    c.put(pad, tx + 0.5, h / 2, ty + 0.5, 0.98, h, 0.98, 0, col.copy(base).lerp(tc.setHex(c.toy(Math.floor((tx + ty) / 2), 0, 80)), 0.45))
  }
}

/** 솜사탕 숲: 줄무늬 막대 + 매끈한 솜사탕 구름(구 넷) — 분홍 · 하늘 · 보라 */
const FLUFF = [0xffb3d6, 0xb8dcff, 0xd9c2ff, 0xffd1e6]
const candyTree: WallKind = (c) => {
  const stickGeo = new THREE.CylinderGeometry(0.06, 0.07, 1, 6, 8).translate(0, 0.5, 0)
  const sp = stickGeo.getAttribute('position')
  const sc = new Float32Array(sp.count * 3)
  const pink = new THREE.Color(0xffa6c9)
  for (let i = 0; i < sp.count; i++) {
    const on = Math.floor(sp.getY(i) * 8 + 0.01) % 2 === 1
    sc[i * 3] = on ? pink.r : 1
    sc[i * 3 + 1] = on ? pink.g : 1
    sc[i * 3 + 2] = on ? pink.b : 1
  }
  stickGeo.setAttribute('color', new THREE.BufferAttribute(sc, 3))
  const stick = c.inst(stickGeo, lam({ vertexColors: true }), c.vis.length)
  const fluffGeo = mergeGeometries([
    new THREE.SphereGeometry(0.58, 10, 7).translate(0, 1.5, 0),
    new THREE.SphereGeometry(0.44, 9, 6).translate(0.36, 1.22, 0.1),
    new THREE.SphereGeometry(0.42, 9, 6).translate(-0.32, 1.26, -0.14),
  ])!
  const fluff = c.inst(c.shade(fluffGeo, 0.85, 1.7, 0.72), lam({ vertexColors: true }), c.vis.length)
  const base = new THREE.Color(c.t.wall)
  const col = new THREE.Color()
  const tc = new THREE.Color()
  for (const [tx, ty] of c.vis) {
    const s = height(c, tx, ty) / 2.6
    const x = tx + 0.5 + (hash(tx, ty, 5) - 0.5) * 0.25
    const z = ty + 0.5 + (hash(tx, ty, 6) - 0.5) * 0.25
    c.put(stick, x, 0, z, 1, s * 1.15, 1)
    c.put(fluff, x, 0, z, s, s, s, hash(tx, ty, 9) * 6.28, col.copy(base).lerp(tc.setHex(FLUFF[Math.floor(hash(tx, ty, 7) * FLUFF.length)]), 0.7))
  }
}

/** 젤리 늪: 젤리 버섯 나무 (크림색 줄기 + 둥근 젤리 갓) */
const jellyTree: WallKind = (c) => {
  const stem = c.inst(c.shade(new THREE.CylinderGeometry(0.12, 0.17, 1, 8).translate(0, 0.5, 0), 0, 0.6, 0.6), lam({ color: 0xfff3e2, vertexColors: true }), c.vis.length)
  const capGeo = new THREE.SphereGeometry(0.78, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.72, 1).translate(0, 0.98, 0)
  const cap = c.inst(c.shade(capGeo, 0.98, 1.3, 0.75), lam({ vertexColors: true }), c.vis.length)
  const base = new THREE.Color(c.t.wall)
  const col = new THREE.Color()
  const tc = new THREE.Color()
  for (const [tx, ty] of c.vis) {
    const s = height(c, tx, ty) / 2.6
    const x = tx + 0.5 + (hash(tx, ty, 5) - 0.5) * 0.25
    const z = ty + 0.5 + (hash(tx, ty, 6) - 0.5) * 0.25
    c.put(stem, x, 0, z, 1, s, 1)
    c.put(cap, x, 0, z, s, s, s, 0, col.copy(base).lerp(tc.setHex(c.toy(tx, ty, 8)), 0.35))
  }
}

// ---------------------------------------------------------------- 공 텍스처 · 맵 주제 소품 (C — 5.2 · 5.3)

/** 커다란 공 무늬: 체육관은 농구공, 나머지는 비치볼(색 띠 여섯) — 인스턴스 색은 흰색으로 둔다 */
export function ballTexture(c: Pick<WallCtx, 'disposables'>, basket: boolean): THREE.CanvasTexture {
  return canvasTex(c as WallCtx, 128, 64, (g) => {
    if (basket) {
      g.fillStyle = '#ffa860'
      g.fillRect(0, 0, 128, 64)
      g.strokeStyle = '#7a4630'
      g.lineWidth = 2.5
      g.beginPath()
      for (const x of [32, 96]) {
        g.moveTo(x, 0)
        g.lineTo(x, 64)
      }
      g.moveTo(0, 32)
      g.lineTo(128, 32)
      for (let x = 0; x <= 128; x += 4) {
        const y = 32 + Math.sin((x / 128) * Math.PI * 2) * 20
        if (x === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      }
      g.stroke()
    } else {
      ;['#ff8fb8', '#ffffff', '#8fc8ff', '#ffffff', '#ffe07a', '#ffffff'].forEach((col, i) => {
        g.fillStyle = col
        g.fillRect(Math.floor((i * 128) / 6), 0, Math.ceil(128 / 6) + 1, 64)
      })
      g.fillStyle = '#ffffff'
      g.fillRect(0, 0, 128, 6)
      g.fillRect(0, 58, 128, 6)
    }
  })
}

export interface PropCtx extends WallCtx {
  /** 소품을 놓을 바닥 칸 (가장자리 한 줄 빼고) */
  floors: [number, number][]
  nearWall: (tx: number, ty: number) => boolean
}
type PropKind = (c: PropCtx) => void

/** 정점 색 하나로 칠한 조각 (합친 소품의 부분마다 색 — 인스턴스 색 없이) */
export function vc(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const col = new THREE.Color(hex)
  const n = geo.getAttribute('position').count
  const a = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    a[i * 3] = col.r
    a[i * 3 + 1] = col.g
    a[i * 3 + 2] = col.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3))
  return geo
}

/** 소품 자리: 일반 소품(world3d — hash 30 이 0.3 아래)과 겹치지 않는 칸만 */
function spots(c: PropCtx, rate: number, wall = false): [number, number][] {
  return c.floors.filter(([tx, ty]) => {
    const r = hash(tx, ty, 30)
    return r >= 0.3 && r < 0.3 + rate && (!wall || c.nearWall(tx, ty))
  })
}
const jitter = (tx: number, ty: number, salt: number) => (hash(tx, ty, salt) - 0.5) * 0.5

/** 운동장: 트래픽 콘(흰 띠) · 바닥에 놓인 줄넘기 */
const playground: PropKind = (c) => {
  const coneGeo = mergeGeometries([
    vc(new THREE.ConeGeometry(0.16, 0.42, 10).translate(0, 0.21, 0), 0xffa070),
    vc(new THREE.CylinderGeometry(0.075, 0.09, 0.06, 10).translate(0, 0.2, 0), 0xffffff),
    vc(new THREE.BoxGeometry(0.36, 0.03, 0.36).translate(0, 0.015, 0), 0xffa070),
  ])!
  const ropeGeo = mergeGeometries([
    vc(new THREE.TorusGeometry(0.32, 0.018, 4, 20, Math.PI * 1.4).rotateX(-Math.PI / 2).translate(0, 0.02, 0), 0xffffff),
    vc(new THREE.SphereGeometry(0.045, 6, 4).scale(1, 0.8, 1.8).translate(0.32, 0.04, 0), 0xff8fb8),
    vc(new THREE.SphereGeometry(0.045, 6, 4).scale(1, 0.8, 1.8).translate(-0.099, 0.04, 0.304), 0xff8fb8),
  ])!
  const s1 = spots(c, 0.03, true)
  const s2 = spots(c, 0.06).filter((p) => !s1.includes(p))
  const cone = c.inst(coneGeo, lam({ vertexColors: true }), s1.length * 2)
  const rope = c.inst(ropeGeo, lam({ vertexColors: true }), s2.length, false)
  for (const [tx, ty] of s1) {
    c.put(cone, tx + 0.5 + jitter(tx, ty, 120), 0, ty + 0.5 + jitter(tx, ty, 121), 1, 1, 1)
    if (hash(tx, ty, 122) < 0.5) c.put(cone, tx + 0.5 + jitter(tx, ty, 123), 0, ty + 0.5 + jitter(tx, ty, 124), 1, 1, 1)
  }
  for (const [tx, ty] of s2) c.put(rope, tx + 0.5, 0, ty + 0.5, 1, 1, 1, hash(tx, ty, 125) * 6.28)
}

/** 체육관: 굴러다니는 농구공 · 벽 곁 뜀틀 조각 */
const gym: PropKind = (c) => {
  const tex = ballTexture(c, true)
  const balls = spots(c, 0.035)
  const ball = c.inst(new THREE.SphereGeometry(0.17, 12, 8).translate(0, 0.17, 0), lam({ map: tex }), balls.length, false)
  for (const [tx, ty] of balls) c.put(ball, tx + 0.5 + jitter(tx, ty, 130), 0, ty + 0.5 + jitter(tx, ty, 131), 1, 1, 1, hash(tx, ty, 132) * 6.28)
  const vaults = spots(c, 0.07, true).filter((p) => !balls.includes(p))
  const vaultGeo = mergeGeometries([
    vc(new THREE.BoxGeometry(0.8, 0.16, 0.5).translate(0, 0.08, 0), 0xfff3e2),
    vc(new THREE.BoxGeometry(0.74, 0.16, 0.46).translate(0, 0.25, 0), 0xffe6c8),
    vc(new THREE.BoxGeometry(0.68, 0.16, 0.42).translate(0, 0.42, 0), 0xfff3e2),
    vc(new THREE.BoxGeometry(0.7, 0.07, 0.44).translate(0, 0.535, 0), 0xff9fb8),
  ])!
  const vault = c.inst(vaultGeo, lam({ vertexColors: true }), vaults.length)
  for (const [tx, ty] of vaults) c.put(vault, tx + 0.5, 0, ty + 0.5, 1, 1, 1, hash(tx, ty, 133) < 0.5 ? 0 : Math.PI / 2)
}

/** 수영장 · 파도 풀: 오리 튜브 */
const poolside: PropKind = (c) => {
  const duckGeo = mergeGeometries([
    vc(new THREE.TorusGeometry(0.26, 0.1, 8, 16).rotateX(Math.PI / 2).translate(0, 0.1, 0), 0xffe066),
    vc(new THREE.SphereGeometry(0.12, 10, 8).translate(0.3, 0.27, 0), 0xffe066),
    vc(new THREE.ConeGeometry(0.05, 0.1, 6).rotateZ(-Math.PI / 2).translate(0.45, 0.26, 0), 0xff9a4a),
  ])!
  const s = spots(c, 0.035)
  const duck = c.inst(duckGeo, lam({ vertexColors: true }), s.length)
  for (const [tx, ty] of s) c.put(duck, tx + 0.5 + jitter(tx, ty, 140), 0, ty + 0.5 + jitter(tx, ty, 141), 1, 1, 1, hash(tx, ty, 142) * 6.28)
}

/** 솜사탕 숲: 포장 사탕 (버섯은 원래 소품) */
const sweets: PropKind = (c) => {
  const candyGeo = mergeGeometries([
    new THREE.SphereGeometry(0.1, 10, 7).scale(1.3, 1, 1),
    new THREE.ConeGeometry(0.08, 0.12, 6).rotateZ(Math.PI / 2).translate(0.2, 0, 0),
    new THREE.ConeGeometry(0.08, 0.12, 6).rotateZ(-Math.PI / 2).translate(-0.2, 0, 0),
  ])!.translate(0, 0.09, 0)
  const s = spots(c, 0.05)
  const candy = c.inst(candyGeo, lam(), s.length * 2, false)
  const col = new THREE.Color()
  for (const [tx, ty] of s) {
    for (let k = 0; k < 1 + Math.floor(hash(tx, ty, 150) * 2); k++) {
      c.put(candy, tx + 0.5 + jitter(tx, ty, 151 + k), 0, ty + 0.5 + jitter(tx, ty, 153 + k), 1.2, 1.2, 1.2, hash(tx, ty, 155 + k) * 6.28, col.setHex(c.toy(tx, ty, 157 + k)))
    }
  }
}

/** 벌집 궁전: 꿀단지 (단지 + 테 + 꿀 국자) */
const honeypot: PropKind = (c) => {
  const potGeo = mergeGeometries([
    vc(new THREE.SphereGeometry(0.2, 12, 9).translate(0, 0.19, 0), 0xffb84a),
    vc(new THREE.CylinderGeometry(0.14, 0.15, 0.06, 12).translate(0, 0.38, 0), 0xfff0d0),
    vc(new THREE.CylinderGeometry(0.016, 0.016, 0.34, 5).rotateZ(0.5).translate(0.07, 0.48, 0), 0xc89060),
  ])!
  const s = spots(c, 0.05, true)
  const pot = c.inst(potGeo, lam({ vertexColors: true }), s.length)
  for (const [tx, ty] of s) c.put(pot, tx + 0.5 + jitter(tx, ty, 160), 0, ty + 0.5 + jitter(tx, ty, 161), 1.2, 1.2, 1.2, hash(tx, ty, 162) * 6.28)
}

/** 볼풀 구덩이: 흩어진 공 */
const ballpit: PropKind = (c) => {
  const s = spots(c, 0.12)
  const ball = c.inst(new THREE.SphereGeometry(0.12, 10, 7).translate(0, 0.12, 0), lam(), s.length * 3, false)
  const col = new THREE.Color()
  const tc = new THREE.Color()
  for (const [tx, ty] of s) {
    for (let k = 0; k < 1 + Math.floor(hash(tx, ty, 170) * 3); k++) {
      c.put(ball, tx + 0.5 + jitter(tx, ty, 171 + k) * 1.4, 0, ty + 0.5 + jitter(tx, ty, 174 + k) * 1.4, 1, 1, 1, 0, col.setHex(c.toy(tx, ty, 177 + k)).lerp(tc.setHex(0xffffff), 0.25))
    }
  }
}

/** 거울 미로: 바닥 별 스티커 */
const stickers: PropKind = (c) => {
  const shape = new THREE.Shape()
  for (let k = 0; k <= 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5
    const r = k % 2 === 0 ? 0.2 : 0.09
    if (k === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r)
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  const s = spots(c, 0.05)
  const star = c.inst(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, 0.012, 0), lam(), s.length, false)
  const col = new THREE.Color()
  for (const [tx, ty] of s) c.put(star, tx + 0.5 + jitter(tx, ty, 180), 0, ty + 0.5 + jitter(tx, ty, 181), 1, 1, 1, hash(tx, ty, 182) * 6.28, col.setHex([0xffe07a, 0xffa6c9, 0x9cc8ff][Math.floor(hash(tx, ty, 183) * 3)]))
}

/** 맵 id → 주제 소품 (밟히지 않는 장식) */
export const BRIGHT_PROPS: Record<string, PropKind> = {
  fields: playground,
  cathedral: gym,
  sewer: poolside,
  cistern: poolside,
  forest: sweets,
  nest: honeypot,
  pit: ballpit,
  maze: stickers,
}

/** 맵 id → 벽 (대기실은 world3d 의 울타리 · 숙소, 투기장 맵은 예전 벽) */
export const BRIGHT_WALL: Record<string, WallKind> = {
  cathedral: lego,
  crypt: lego,
  archive: lego,
  butchery: lego,
  ruins: lego,
  wardroom: lego,
  stair: lego,
  throne: lego,
  sewer: poolWall,
  rite: poolWall,
  cistern: poolWall,
  maze: mirrorWall,
  fields: hedge,
  rift: hedge,
  ashen: hedge,
  cave: castle,
  hollow: cookie,
  nest: honeycomb,
  pit: cushion,
  forest: candyTree,
  swamp: jellyTree,
}
