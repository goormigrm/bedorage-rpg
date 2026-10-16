// ☀ 철면수심전용 놀이터 랜드마크 (2026-10-17 그래픽 개편 D — docs/철면수심-그래픽-개편-계획.md 6장 · 사용자 결정: 코드로 조립).
// 맵 안쪽의 꽉 찬 사각형 벽 덩어리(바깥 맵 3 × 2 · 기둥 맵 2 × 2) 자리 안에만 세운다 → 충돌(그 칸은 여전히 벽)과 겉모습이 맞다.
// 덩어리가 1칸 폭인 맵(굴 · 공 창고 · 수로 …)과 보스 방은 C 단계 벽 그대로.
// 부품은 정점 색으로 칠해 한 지오메트리로 합치고, 같은 종류는 InstancedMesh 하나 — 맵마다 그리기 호출 = 종류 수(2 ~ 4).
// 높이는 2.6 안(55° 내려다보는 카메라에서 뒤의 캐릭터를 가리지 않게 — 계획서 2장).

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { GameMap, TILE_WALL } from '../core/map'
import { hash } from './brightFloor'
import { vc } from './brightWalls'

const WHITE = 0xffffff
const PINK = 0xff9fc0
const PINK_L = 0xffd0e0
const SKY = 0x9cc8ff
const SKY_D = 0x6fa8f0
const YELLOW = 0xffe07a
const MINT = 0x8fe0c8
const LILAC = 0xd2b4ff
const PEACH = 0xffb894
const CREAM = 0xfff3e2
const BROWN = 0xb07a58
const ORANGE = 0xff9a4a
const GREY = 0xb8bcd0
const TOYS = [PINK, SKY, YELLOW, MINT, LILAC, PEACH]

/** 부품 쌓기 도우미 — 모두 정점 색 하나로 칠해 parts 에 넣는다 (회전은 X → Z → Y 차례 뒤 옮김) */
function kit(parts: THREE.BufferGeometry[]) {
  const add = (g: THREE.BufferGeometry, c: number, x: number, y: number, z: number, rx = 0, rz = 0, ry = 0) =>
    parts.push(vc(g.rotateX(rx).rotateZ(rz).rotateY(ry).translate(x, y, z), c))
  return {
    box: (w: number, h: number, d: number, x: number, y: number, z: number, c: number, rz = 0, ry = 0, rx = 0) => add(new THREE.BoxGeometry(w, h, d), c, x, y, z, rx, rz, ry),
    rbox: (w: number, h: number, d: number, x: number, y: number, z: number, c: number) => add(new RoundedBoxGeometry(w, h, d, 1, Math.min(w, h, d) * 0.2), c, x, y, z),
    /** 원기둥 (축은 y — rx · rz 로 눕힌다) */
    cyl: (rt: number, rb: number, h: number, x: number, y: number, z: number, c: number, seg = 8, rx = 0, rz = 0, open = false) =>
      add(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), c, x, y, z, rx, rz),
    cone: (r: number, h: number, x: number, y: number, z: number, c: number, seg = 8, ry = 0) => add(new THREE.ConeGeometry(r, h, seg), c, x, y, z, 0, 0, ry),
    sph: (r: number, x: number, y: number, z: number, c: number, sx = 1, sy = 1, sz = 1, seg = 10) => add(new THREE.SphereGeometry(r, seg, Math.max(5, seg - 3)).scale(sx, sy, sz), c, x, y, z),
    /** 반구 (바닥이 y) */
    dome: (r: number, x: number, y: number, z: number, c: number, sx = 1, sy = 1, sz = 1) => add(new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(sx, sy, sz), c, x, y, z),
    /** 고리 (기본은 바닥에 눕힘) */
    tor: (R: number, r: number, x: number, y: number, z: number, c: number, rx = Math.PI / 2) => add(new THREE.TorusGeometry(R, r, 6, 20), c, x, y, z, rx),
    /** 삼각 깃발 (오른쪽으로 펄럭) */
    flag: (x: number, y: number, z: number, c: number) => add(new THREE.ConeGeometry(0.15, 0.36, 3).scale(1, 1, 0.2), c, x + 0.18, y, z, 0, -Math.PI / 2),
  }
}
type Kit = ReturnType<typeof kit>

function build(f: (p: Kit) => void): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  f(kit(parts))
  // 둥근 상자(RoundedBoxGeometry)는 인덱스가 없다 — 합치려면 모두 같은 형식이어야 해서 다 인덱스 없이
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p))
  const g = mergeGeometries(flat)!
  for (const p of flat) p.dispose()
  for (const p of parts) p.dispose()
  return g
}

interface Landmark {
  geo: () => THREE.BufferGeometry
  /** 늘 카메라 쪽(+z)을 보게 (농구 골대 판처럼 앞이 있는 것) */
  face?: boolean
}

// ---------------------------------------------------------------- 3 × 2 (x 3칸 · z 2칸 · 가운데가 원점)

/** 미끄럼틀: 지붕 있는 발판 + 사다리 + 미끄럼 판 */
const slide: Landmark = {
  geo: () =>
    build((p) => {
      for (const [x, z] of [[-1.3, -0.5], [-0.5, -0.5], [-1.3, 0.5], [-0.5, 0.5]]) p.cyl(0.06, 0.06, 1.9, x, 0.95, z, WHITE)
      p.box(0.95, 0.12, 1.15, -0.9, 1.6, 0, YELLOW)
      p.cone(0.85, 0.6, -0.9, 2.2, 0, PINK, 4, Math.PI / 4)
      for (const z of [-0.3, 0.3]) p.box(0.05, 1.6, 0.05, -1.42, 0.8, z, WHITE)
      for (let k = 1; k <= 4; k++) p.box(0.05, 0.05, 0.6, -1.42, k * 0.35, 0, WHITE)
      p.box(2.35, 0.06, 0.6, 0.45, 0.875, 0, SKY, -0.678)
      for (const z of [-0.31, 0.31]) p.box(2.35, 0.14, 0.05, 0.45, 0.95, z, SKY_D, -0.678)
      p.box(0.42, 0.06, 0.6, 1.3, 0.13, 0, SKY)
    }),
}

/** 정글짐: 기둥 · 가로대 격자 (칸마다 다른 장난감 색) */
const jungleGym: Landmark = {
  geo: () =>
    build((p) => {
      const xs = [-1.35, -0.45, 0.45, 1.35]
      xs.forEach((x, i) => {
        for (const z of [-0.8, 0.8]) p.cyl(0.05, 0.05, 1.7, x, 0.85, z, TOYS[i])
        for (const y of [0.85, 1.7]) p.cyl(0.04, 0.04, 1.6, x, y, 0, TOYS[i], 6, Math.PI / 2)
      })
      for (const z of [-0.8, 0.8]) for (const y of [0.85, 1.7]) p.cyl(0.04, 0.04, 2.7, 0, y, z, WHITE, 6, 0, Math.PI / 2)
      p.box(0.9, 0.06, 1.6, -0.9, 1.72, 0, YELLOW)
    }),
}

/** 시소 둘 (기울기가 서로 다르게) */
const seesaw: Landmark = {
  geo: () =>
    build((p) => {
      for (const [z, t, c] of [[-0.5, 0.22, PINK], [0.5, -0.18, SKY]] as const) {
        p.box(0.26, 0.5, 0.4, 0, 0.25, z, YELLOW)
        p.box(2.8, 0.08, 0.32, 0, 0.55, z, c, t)
        for (const s of [-1, 1]) {
          const ex = s * 1.2 * Math.cos(t)
          const ey = 0.55 + s * 1.2 * Math.sin(t)
          p.box(0.34, 0.06, 0.36, ex, ey + 0.07, z, WHITE, t)
          p.cyl(0.025, 0.025, 0.3, ex - s * 0.22, ey + 0.2, z, WHITE, 6)
        }
      }
    }),
}

/** 그네: A 모양 틀 + 위 가로대 + 그네 둘 */
const swing: Landmark = {
  geo: () =>
    build((p) => {
      for (const xe of [-1.35, 1.35]) for (const s of [-1, 1]) p.cyl(0.06, 0.06, 2.15, xe, 1.0, s * 0.4, SKY_D, 8, -s * 0.38)
      p.cyl(0.06, 0.06, 2.9, 0, 2.0, 0, SKY_D, 8, 0, Math.PI / 2)
      for (const [sx, c] of [[-0.6, PINK], [0.6, YELLOW]] as const) {
        for (const rz of [-0.12, 0.12]) p.cyl(0.015, 0.015, 1.45, sx, 1.275, rz, WHITE, 4)
        p.box(0.5, 0.05, 0.3, sx, 0.55, 0, c)
      }
    }),
}

/** 버섯 집: 크림색 몸통 + 분홍 갓(흰 점) + 문 · 창 + 작은 버섯 둘 */
const mushroomHouse: Landmark = {
  geo: () =>
    build((p) => {
      p.cyl(0.7, 0.8, 1.2, -0.3, 0.6, 0, CREAM, 14)
      p.dome(1.15, -0.3, 1.15, 0, PINK, 1, 0.75, 0.85)
      for (let k = 0; k < 7; k++) {
        const th = k * 0.9 + 0.3
        const ph = 0.45 + (k % 3) * 0.28
        p.sph(0.14, -0.3 + 1.15 * Math.sin(ph) * Math.cos(th), 1.15 + 1.15 * Math.cos(ph) * 0.75, 1.15 * Math.sin(ph) * Math.sin(th) * 0.85, WHITE, 1, 0.5, 1, 8)
      }
      p.box(0.36, 0.6, 0.06, -0.3, 0.3, 0.77, BROWN)
      p.cyl(0.13, 0.13, 0.05, 0.12, 0.85, 0.66, YELLOW, 12, Math.PI / 2)
      for (const [x, z, s] of [[1.0, 0.35, 1], [1.1, -0.5, 0.7]]) {
        p.cyl(0.1 * s, 0.12 * s, 0.45 * s, x, 0.22 * s, z, CREAM)
        p.dome(0.35 * s, x, 0.43 * s, z, LILAC, 1, 0.7, 1)
      }
    }),
}

/** 막대 사탕 숲: 높이가 다른 막대 사탕 다섯 (앞을 보는 동그란 사탕 + 흰 소용돌이) */
const lollipopGrove: Landmark = {
  geo: () =>
    build((p) => {
      ;[[-1.1, -0.4, 1.9], [-0.4, 0.45, 1.5], [0.3, -0.5, 2.1], [0.9, 0.4, 1.6], [1.25, -0.45, 1.2]].forEach(([x, z, h], i) => {
        p.cyl(0.04, 0.05, h, x, h / 2, z, WHITE, 6)
        p.cyl(0.36, 0.36, 0.1, x, h + 0.3, z, TOYS[i], 16, Math.PI / 2)
        p.tor(0.2, 0.035, x, h + 0.3, z + 0.06, WHITE, 0)
      })
    }),
}

/** 젤리 언덕: 큰 젤리 둔덕 + 빛 반사 + 젤리 조각 셋 */
const jellyHill: Landmark = {
  geo: () =>
    build((p) => {
      p.dome(1.2, 0, 0, 0, MINT, 1.2, 0.75, 0.8)
      p.sph(0.2, -0.4, 0.72, 0.35, WHITE, 1.4, 0.4, 1)
      p.rbox(0.5, 0.5, 0.5, 1.15, 0.25, 0.62, PINK)
      p.rbox(0.42, 0.42, 0.42, -1.18, 0.21, -0.68, LILAC)
      p.rbox(0.4, 0.4, 0.4, 0.15, 1.05, 0, YELLOW)
    }),
}

/** 폭죽 통 더미: 받침 위 색 통 일곱 (흰 띠 · 뾰족 뚜껑 · 심지) */
const fireworkPile: Landmark = {
  geo: () =>
    build((p) => {
      p.box(2.9, 0.15, 1.9, 0, 0.075, 0, CREAM)
      ;[[-1.0, -0.4, 1.3, 0.22], [-0.55, 0.35, 1.0, 0.2], [-0.1, -0.35, 1.6, 0.25], [0.4, 0.4, 1.2, 0.2], [0.8, -0.35, 0.9, 0.22], [1.2, 0.35, 1.4, 0.2], [0.2, 0.0, 0.8, 0.18]].forEach(([x, z, h, r], i) => {
        p.cyl(r, r, h, x, 0.15 + h / 2, z, TOYS[i % TOYS.length], 12)
        p.cyl(r + 0.012, r + 0.012, 0.1, x, 0.15 + h * 0.65, z, WHITE, 12)
        p.cone(r * 0.9, 0.25, x, 0.15 + h + 0.125, z, WHITE, 10)
        p.cyl(0.015, 0.015, 0.2, x, 0.15 + h + 0.35, z, BROWN, 4)
      })
    }),
}

/** 회전목마 + 풍선 다발 */
const carousel: Landmark = {
  geo: () =>
    build((p) => {
      const cx = -0.45
      p.cyl(0.95, 0.98, 0.16, cx, 0.08, 0, WHITE, 20)
      p.cyl(0.9, 0.9, 0.04, cx, 0.18, 0, PINK_L, 20)
      p.cyl(0.07, 0.07, 2.0, cx, 1.1, 0, YELLOW)
      p.cyl(1.0, 1.0, 0.12, cx, 2.04, 0, WHITE, 16)
      p.cone(1.0, 0.5, cx, 2.35, 0, PINK, 12)
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2 + Math.PI / 4
        const hx = cx + 0.62 * Math.cos(a)
        const hz = 0.62 * Math.sin(a)
        const y = 0.75 + (k % 2) * 0.15
        p.cyl(0.025, 0.025, 1.84, hx, 1.1, hz, YELLOW, 6)
        p.box(0.42, 0.2, 0.16, hx, y, hz, TOYS[k], 0, -a + Math.PI / 2)
        p.sph(0.1, hx - Math.sin(a) * 0.24, y + 0.13, hz + Math.cos(a) * 0.24, TOYS[k], 1, 1, 1, 8)
      }
      p.cyl(0.12, 0.14, 0.15, 1.05, 0.075, 0, GREY, 10)
      ;[[0, 0], [0.22, 0.15], [-0.2, 0.18], [0.12, -0.2], [-0.1, -0.12]].forEach(([dx, dz], i) => {
        const by = 1.55 + (i % 3) * 0.18
        p.cyl(0.006, 0.006, by - 0.15, 1.05 + dx * 0.5, (by + 0.15) / 2, dz * 0.5, WHITE, 3)
        p.sph(0.22, 1.05 + dx, by, dz, TOYS[(i + 2) % TOYS.length], 1, 1.15, 1)
      })
    }),
}

// ---------------------------------------------------------------- 2 × 2

/** 농구 골대: 받침 + 기둥 + 흰 판(주황 네모) + 링 + 그물 — 판은 늘 카메라 쪽 */
const hoop: Landmark = {
  face: true,
  geo: () =>
    build((p) => {
      p.box(1.0, 0.3, 0.6, 0, 0.15, -0.65, GREY)
      p.cyl(0.07, 0.08, 2.2, 0, 1.1, -0.65, GREY)
      p.box(0.1, 0.1, 0.42, 0, 2.05, -0.45, GREY)
      p.box(1.3, 0.85, 0.06, 0, 2.0, -0.22, WHITE)
      p.box(0.5, 0.04, 0.02, 0, 2.04, -0.18, ORANGE)
      p.box(0.5, 0.04, 0.02, 0, 1.66, -0.18, ORANGE)
      for (const x of [-0.25, 0.25]) p.box(0.04, 0.42, 0.02, x, 1.85, -0.18, ORANGE)
      p.tor(0.22, 0.025, 0, 1.68, 0.07, ORANGE)
      p.cyl(0.2, 0.14, 0.3, 0, 1.52, 0.07, WHITE, 10, 0, 0, true)
    }),
}

/** 공 바구니 수레: 바퀴 · 틀 + 수북한 공 */
const ballCart: Landmark = {
  geo: () =>
    build((p) => {
      p.box(1.4, 0.08, 1.0, 0, 0.32, 0, SKY_D)
      for (const x of [-0.6, 0.6]) for (const z of [-0.45, 0.45]) p.cyl(0.1, 0.1, 0.06, x, 0.1, z, GREY, 10, 0, Math.PI / 2)
      for (const x of [-0.68, 0.68]) for (const z of [-0.48, 0.48]) p.cyl(0.025, 0.025, 0.7, x, 0.67, z, SKY_D, 5)
      for (const y of [0.65, 1.0]) {
        for (const z of [-0.48, 0.48]) p.box(1.4, 0.04, 0.04, 0, y, z, SKY_D)
        for (const x of [-0.68, 0.68]) p.box(0.04, 0.04, 1.0, x, y, 0, SKY_D)
      }
      const cols = [ORANGE, WHITE, SKY, PINK]
      let k = 0
      for (const [y, pts] of [[0.56, [[-0.42, -0.22], [0, -0.22], [0.42, -0.22], [-0.42, 0.22], [0, 0.22], [0.42, 0.22]]], [0.86, [[-0.22, 0], [0.22, 0], [0, -0.25], [0, 0.25]]], [1.12, [[0, 0]]]] as const) {
        for (const [x, z] of pts) p.sph(0.21, x, y, z, cols[k++ % cols.length], 1, 1, 1, 10)
      }
    }),
}

/** 큰 구슬 더미: 커다란 구슬 다섯(피라미드) + 흩어진 작은 구슬 */
const marblePile: Landmark = {
  geo: () =>
    build((p) => {
      const big = [[-0.42, 0.42, -0.42], [0.42, 0.42, -0.42], [-0.42, 0.42, 0.42], [0.42, 0.42, 0.42], [0, 1.01, 0]]
      big.forEach(([x, y, z], i) => {
        p.sph(0.42, x, y, z, TOYS[i], 1, 1, 1, 14)
        p.sph(0.1, x - 0.15, y + 0.2, z + 0.25, WHITE, 1, 0.6, 1, 6)
      })
      for (let k = 0; k < 6; k++) {
        const a = k * 1.05 + 0.4
        p.sph(0.1, Math.cos(a) * 0.88, 0.1, Math.sin(a) * 0.88, TOYS[(k + 3) % TOYS.length], 1, 1, 1, 8)
      }
    }),
}

/** 딱지 탑: 엇갈려 쌓은 큰 딱지 (파랑 · 분홍 · 접힌 X 줄) */
const ddakjiTower: Landmark = {
  geo: () =>
    build((p) => {
      for (let k = 0; k < 14; k++) {
        const y = 0.035 + k * 0.075
        const ry = k * 0.35
        p.box(1.3, 0.07, 1.3, (hash(k, 0, 600) - 0.5) * 0.1, y, (hash(k, 1, 600) - 0.5) * 0.1, k % 2 ? SKY_D : PINK, 0, ry)
      }
      const top = 0.035 + 13 * 0.075 + 0.04
      for (const a of [Math.PI / 4, -Math.PI / 4]) p.box(1.5, 0.012, 0.1, 0, top, 0, WHITE, 0, a + 13 * 0.35)
      for (const [x, z, a] of [[-0.75, 0.7, 0.4], [0.8, -0.65, 1.1]]) p.box(0.5, 0.05, 0.5, x, 0.025, z, YELLOW, 0, a)
    }),
}

/** 유리 다리 기둥: 옅은 하늘빛 유리 상자 + 흰 모서리 · 테 + 빗금 반사 + 위 등불 */
const glassPillar: Landmark = {
  geo: () =>
    build((p) => {
      p.box(1.3, 2.2, 1.3, 0, 1.1, 0, 0xcdeffc)
      for (const x of [-0.65, 0.65]) for (const z of [-0.65, 0.65]) p.box(0.08, 2.2, 0.08, x, 1.1, z, WHITE)
      for (const y of [0.05, 2.2]) p.box(1.42, 0.1, 1.42, 0, y, 0, WHITE)
      p.box(0.08, 1.2, 0.01, -0.2, 1.3, 0.66, WHITE, 0.5)
      p.box(0.04, 0.8, 0.01, 0.15, 1.2, 0.66, WHITE, 0.5)
      p.sph(0.25, 0, 2.5, 0, YELLOW, 1, 1, 1, 12)
    }),
}

/** 계단 탑: 파스텔 네 단 + 꼭대기 깃발 */
const stepTower: Landmark = {
  geo: () =>
    build((p) => {
      ;[1.9, 1.5, 1.1, 0.7].forEach((s, i) => p.box(s, 0.42, s, 0, 0.21 + i * 0.42, 0, [PINK, MINT, YELLOW, SKY][i]))
      p.cyl(0.025, 0.025, 0.7, 0, 2.03, 0, WHITE, 5)
      p.flag(0, 2.22, 0, PINK)
    }),
}

/** 맵 id → 랜드마크 (big = 3 × 2 덩어리마다 차례로 · small = 2 × 2 기둥의 40% 에 무작위로) */
const PLAN: Record<string, { big?: Landmark[]; small?: Landmark[] }> = {
  fields: { big: [slide, jungleGym, seesaw, swing] },
  forest: { big: [mushroomHouse, lollipopGrove] },
  swamp: { big: [jellyHill] },
  rift: { big: [fireworkPile] },
  ashen: { big: [carousel] },
  cathedral: { small: [hoop, ballCart] },
  ruins: { small: [marblePile, ddakjiTower] },
  rite: { small: [glassPillar] },
  stair: { small: [stepTower] },
}
const SMALL_RATE = 0.4

export interface PlacedLandmark {
  def: Landmark
  x: number
  z: number
  rot: number
  /** 그 자리의 벽 칸 (벽으로 그리지 않는다) */
  tiles: number[]
}

/** 맵 안쪽의 꽉 찬 사각형 벽 덩어리(테두리에 붙지 않은) 중 3 × 2 · 2 × 3 · 2 × 2 를 골라 랜드마크를 정한다 (같은 맵이면 같은 결과) */
export function planLandmarks(map: GameMap): PlacedLandmark[] {
  const plan = PLAN[map.id]
  if (!plan) return []
  const W = map.w
  const seen = new Uint8Array(map.w * map.h)
  const out: PlacedLandmark[] = []
  let bigN = 0
  for (let i = 0; i < map.tiles.length; i++) {
    if (seen[i] || map.tiles[i] !== TILE_WALL) continue
    const members: number[] = []
    let x0 = i % W
    let y0 = Math.floor(i / W)
    let x1 = x0
    let y1 = y0
    let border = false
    const stack = [i]
    seen[i] = 1
    while (stack.length) {
      const j = stack.pop()!
      members.push(j)
      const x = j % W
      const y = Math.floor(j / W)
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
      if (x <= 1 || y <= 1 || x >= map.w - 2 || y >= map.h - 2) border = true
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue
        const k = ny * W + nx
        if (seen[k] || map.tiles[k] !== TILE_WALL) continue
        seen[k] = 1
        stack.push(k)
      }
    }
    const w = x1 - x0 + 1
    const h = y1 - y0 + 1
    if (border || members.length !== w * h) continue
    const cx = x0 + w / 2
    const cz = y0 + h / 2
    const r = hash(x0, y0, 610)
    if (plan.big && ((w === 3 && h === 2) || (w === 2 && h === 3))) {
      const def = plan.big[bigN++ % plan.big.length]
      out.push({ def, x: cx, z: cz, rot: (w === 3 ? 0 : Math.PI / 2) + (r < 0.5 ? 0 : Math.PI), tiles: members })
    } else if (plan.small && w === 2 && h === 2 && r < SMALL_RATE) {
      const def = plan.small[Math.floor(hash(x0, y0, 611) * plan.small.length)]
      out.push({ def, x: cx, z: cz, rot: def.face ? 0 : Math.floor(hash(x0, y0, 612) * 4) * (Math.PI / 2), tiles: members })
    }
  }
  return out
}

/** 정한 랜드마크를 세운다 — 종류마다 지오메트리 하나 · InstancedMesh 하나 (그림자 넣음) */
export function buildLandmarks(
  marks: PlacedLandmark[],
  inst: (geo: THREE.BufferGeometry, mat: THREE.Material, n: number, shadow?: boolean) => THREE.InstancedMesh,
  put: (m: THREE.InstancedMesh, x: number, y: number, z: number, sx: number, sy: number, sz: number, rotY?: number) => void,
): void {
  const byDef = new Map<Landmark, PlacedLandmark[]>()
  for (const m of marks) byDef.set(m.def, [...(byDef.get(m.def) ?? []), m])
  for (const [def, list] of byDef) {
    const mesh = inst(def.geo(), new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }), list.length)
    for (const m of list) put(mesh, m.x, 0, m.z, 1, 1, 1, m.rot)
  }
}
