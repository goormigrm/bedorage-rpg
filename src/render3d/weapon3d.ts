// 손에 든 무기 (2026-11-12 그래픽 최종 — 사용자: "무기들의 퀄리티 높이기"): 예전 총은 상자 · 원통 대여섯 개라 각진 막대였다.
// 이제 무기마다 **옆모습을 그려 밀어낸 판**(개머리판의 기울기 · 휜 탄창 · 비스듬한 손잡이)과 원통(총열 · 조준경)으로 짜고,
// 정점 색으로 메시 하나에 굽는다(bake.ts) — 부품은 전보다 서너 배 많지만 그리기 호출은 무기 하나에 1 ~ 2번(전에는 7 ~ 16번).
// 등급(마법 ~ 신화)은 몸통 옆줄 · 총구 고리 · 보석으로 드러나고 전설부터는 스스로 빛난다.
// 로컬: 손 자리 원점 · 앞 = +z · 위 = +y. 길이는 총 길이 L 의 백분율(z) · 굵기는 0.01 × s(x · y) 로 적는다.

import * as THREE from 'three'
import { WeaponDef } from '../core/weapons'
import { Bake, V3, at, ball, limb, slab } from './bake'
import { toonMat } from './toon'

/** 등급 색 (items.ts RARITY_COLORS 와 같다 — 일반은 장식 없음) */
const RARITY_HEX = [0xd8d8d8, 0x6c9cff, 0xffd84a, 0xff8a2a, 0xe060ff]

const DARK = 0x2f3136
const BLACK = 0x17181b
const METAL = 0x9aa2ab
const WOOD = 0x8a5a32
const WOOD_D = 0x6b4424
const BRASS = 0xc9a24a

/** 무기 재질: 정점 색 툰 + 림 빛 + 쇠 반짝임. 무기마다 따로 만든다(쓰러진 사람의 무기만 흐려지게 — setRigOpacity) */
export function gunMat(emissive?: number): THREE.MeshToonMaterial {
  const m = toonMat({ vertexColors: true }, 0.7, { rim: 0.5, spec: 0.55 })
  if (emissive !== undefined) m.emissive.set(emissive).multiplyScalar(0.75)
  return m
}

/** 무기 하나를 짜는 도구: 부품을 굽기 묶음에 넣는다. glow(색) = 스스로 빛나는 부품 묶음 */
class Kit {
  b = new Bake()
  private glows = new Map<number, Bake>()
  /** 굵기 단위 (0.01 × s) */
  u: number
  constructor(readonly L: number, readonly s: number) {
    this.u = 0.01 * s
  }
  z(pct: number): number {
    return pct * 0.01 * this.L
  }
  glow(color: number): Bake {
    let g = this.glows.get(color)
    if (!g) this.glows.set(color, (g = new Bake()))
    return g
  }
  /** 옆모습 판: pts = [z%, y, z%, y …] · w = 두께 */
  slab(c: number, w: number, pts: number[], x = 0, bevel = 0.5, to = this.b): void {
    to.add(slab(pts.map((v, i) => (i % 2 === 0 ? this.z(v) : v * this.u)), w * this.u, bevel * this.u, x * this.u), c)
  }
  /** 앞뒤로 뻗는 원통: z0% ~ z1% · 뒤 반지름 r · 앞 반지름 r1 */
  tube(c: number, r: number, z0: number, z1: number, y = 0, x = 0, r1 = r, seg = 10, to = this.b): void {
    const len = this.z(z1 - z0)
    const g = new THREE.CylinderGeometry(r1 * this.u, r * this.u, len, seg)
    g.rotateX(Math.PI / 2)
    to.add(at(g, x * this.u, y * this.u, this.z(z0) + len / 2), c)
  }
  box(c: number, w: number, h: number, z0: number, z1: number, y = 0, x = 0, to = this.b): void {
    const d = this.z(z1 - z0)
    to.add(at(new THREE.BoxGeometry(w * this.u, h * this.u, d), x * this.u, y * this.u, this.z(z0) + d / 2), c)
  }
  /** 총열을 두르는 고리 */
  ring(c: number, r: number, t: number, z: number, y = 0, x = 0, to = this.b): void {
    to.add(at(new THREE.TorusGeometry(r * this.u, t * this.u, 6, 14), x * this.u, y * this.u, this.z(z)), c)
  }
  /** 두 점 사이 막대: 점 = [x, y, z%] */
  rod(c: number, r: number, a: [number, number, number], b: [number, number, number], to = this.b, r1 = r): void {
    to.add(limb(V3(a[0] * this.u, a[1] * this.u, this.z(a[2])), V3(b[0] * this.u, b[1] * this.u, this.z(b[2])), r * this.u, r1 * this.u, 6), c)
  }
  ball(c: number, r: number, x: number, y: number, z: number, to = this.b, sx = 1, sy = sx, sz = sx): void {
    to.add(ball(r * this.u, x * this.u, y * this.u, this.z(z), sx, sy, sz, 10, 8), c)
  }
  /** 굽기: 몸(메시 하나) + 빛나는 부품(색마다 하나) */
  build(): THREE.Group {
    const g = new THREE.Group()
    g.add(this.b.mesh(gunMat()))
    for (const [c, b] of this.glows) g.add(b.mesh(gunMat(c), false))
    return g
  }
}

/** 총 모양 하나: 부품을 넣고 총구 자리(y · z%)와 등급 줄을 넣을 몸통 옆면(z0% · z1% · 높이 y · 반 두께)을 돌려준다 */
type GunShape = (k: Kit, body: number) => { y: number; z: number; band: [number, number, number, number] }

/** 권총처럼 쥐는 손잡이 + 방아쇠울 (거의 모든 총) */
function grip(k: Kit, c = DARK, z = 0): void {
  k.slab(c, 3.8, [z - 2, -3.5, z + 7, -3.5, z + 4, -15.5, z - 5.5, -14.5])
  k.slab(BLACK, 1.4, [z + 7, -7, z + 16, -7, z + 16, -8.2, z + 7, -8.2], 0, 0.2)
  k.slab(BLACK, 1.0, [z + 9.5, -3.5, z + 11.5, -3.5, z + 10.5, -6.4, z + 9.5, -6.2], 0, 0.2)
}

const GUNS: Partial<Record<WeaponDef['id'], GunShape>> = {
  // 소총: 나무 개머리 · 덮개 · 나무 총열 덮개 · 가스관 · 앞으로 휜 탄창 · 가늠쇠
  rifle(k, body) {
    k.slab(WOOD, 4.6, [-40, 2.5, -14, 4, -12, -3, -22, -4.5, -38, -9.5, -41, -8.5])
    k.slab(BLACK, 5, [-43, 3, -40.5, 3, -40.5, -9.5, -43, -9], 0, 0.3)
    k.slab(body, 6.2, [-14, 4.5, 36, 4.5, 36, -1.5, 31, -4, -14, -4])
    k.slab(DARK, 5.2, [-10, 4.5, 24, 4.5, 22, 6.6, -8, 6.6])
    k.box(BLACK, 0.5, 2.2, 5, 17, 1.6, -3.1)
    k.slab(WOOD, 5.6, [36, 3.6, 62, 3.2, 62, -2.2, 36, -2.6])
    for (const z of [42, 49, 56]) k.box(WOOD_D, 5.9, 1, z, z + 3, 0.8)
    k.tube(DARK, 1.1, 36, 66, 5.2)
    k.tube(METAL, 1.5, 62, 95, 1.2)
    k.tube(DARK, 2.3, 92, 99, 1.2)
    k.slab(DARK, 1.4, [84, 2.5, 90, 2.5, 88.5, 8.2, 85.5, 8.2], 0, 0.2)
    k.slab(DARK, 3, [18, 6.6, 23, 6.6, 23, 8.4, 18, 8.4], 0, 0.3)
    k.slab(DARK, 3.6, [15, -4, 27, -4, 34, -17, 31, -20, 22, -19.5])
    k.slab(METAL, 3.9, [22.3, -18, 31.6, -18.5, 31, -20.3, 21.8, -19.8], 0, 0.2)
    grip(k, WOOD_D)
    return { y: 1.2, z: 99, band: [-10, 30, 0.6, 3.1] }
  },
  // 석궁: 나무 몸대 · 뒤로 휜 활대 · 당긴 시위 · 얹힌 화살 · 발걸이
  crossbow(k, body) {
    k.slab(WOOD, 4.8, [-38, 2.5, -12, 3.5, 74, 3, 76, 0, 74, -1.5, 20, -3, -12, -4, -34, -9.5, -39, -8])
    k.slab(body, 5.4, [-30, 3.2, -8, 4, -8, -3.6, -26, -6])
    k.slab(DARK, 5.6, [62, 4, 72, 4, 72, -2.4, 62, -2.4])
    const u = k.u
    const y = 2
    for (const sd of [-1, 1]) {
      const a: [number, number, number] = [sd * 2.5, y, 68]
      const m: [number, number, number] = [(sd * k.z(26)) / u, y, 64]
      const e: [number, number, number] = [(sd * k.z(46)) / u, y, 50]
      k.rod(DARK, 1.9, a, m, k.b, 1.5)
      k.rod(DARK, 1.5, m, e, k.b, 0.9)
      k.ball(BRASS, 1.5, e[0], y, e[2])
      k.rod(0xf1e8cc, 0.5, e, [0, 4.2, 40])
    }
    // 화살: 대 · 촉 · 깃
    k.tube(0xd8c49a, 0.8, 40, 90, 4.4)
    k.tube(METAL, 1.9, 90, 99, 4.4, 0, 0.2, 6)
    k.slab(0xd8452a, 0.5, [41, 4.4, 50, 4.4, 47, 7.4, 41, 7.4], 0, 0)
    k.box(0xd8452a, 6, 0.5, 41, 49, 4.4)
    k.slab(DARK, 2.2, [36, 3.5, 42, 3.5, 42, 5.4, 36, 5.4], 0, 0.2)
    k.ring(METAL, 3.4, 0.7, 78, 0.5)
    grip(k, WOOD_D)
    return { y: 4.4, z: 99, band: [-6, 56, 0.6, 2.4] }
  },
  // SMG: 짧은 몸통 · 구멍 난 총열 덮개 · 곧은 긴 탄창 · 철사 개머리 · 위 레일
  smg(k, body) {
    k.slab(body, 6.4, [-8, 5, 48, 5, 52, 2.5, 52, -3, -8, -4])
    k.slab(DARK, 2.8, [-2, 5, 40, 5, 40, 6.6, -2, 6.6], 0, 0.3)
    k.slab(DARK, 1.6, [2, 6.6, 6, 6.6, 6, 8.6, 2, 8.6], 0, 0.2)
    k.slab(DARK, 1.2, [36, 6.6, 39, 6.6, 38.5, 8.6, 36.5, 8.6], 0, 0.2)
    k.box(BLACK, 0.5, 2, 14, 28, 1.6, -3.2)
    k.tube(DARK, 2.9, 52, 76, 1)
    for (const z of [57, 63, 69]) k.ring(BLACK, 2.9, 0.45, z, 1)
    k.tube(METAL, 1.5, 76, 84, 1)
    k.tube(DARK, 2, 82, 88, 1)
    k.slab(DARK, 3.6, [23, -3.5, 33, -3.5, 31.5, -23, 22, -23])
    k.slab(METAL, 3.9, [21.8, -21.6, 31.7, -21.6, 31.5, -23.2, 21.8, -23.2], 0, 0.2)
    k.rod(DARK, 0.8, [-2.4, 3.4, -8], [-2.4, 3.4, -36])
    k.rod(DARK, 0.8, [2.4, 3.4, -8], [2.4, 3.4, -36])
    k.slab(DARK, 5.6, [-38, 5, -35, 5, -35, -8, -38, -8], 0, 0.4)
    k.tube(METAL, 1, 30, 34, 3, -4, 1, 6)
    grip(k)
    return { y: 1, z: 88, band: [-4, 46, -1, 3.2] }
  },
  // 화염방사기: 쇠 관 · 벌어진 노즐 · 옆의 붉은 연료통(띠 · 마개) · 호스 · 압력계 · 노즐 아래 불씨
  flamer(k, body) {
    k.tube(METAL, 3.4, -18, 60, 0)
    k.tube(DARK, 3.9, -22, -16, 0)
    k.tube(DARK, 3, 60, 82, 0, 0, 5.8)
    k.ring(BLACK, 5.8, 0.6, 82, 0)
    for (const z of [50, 56]) k.ring(DARK, 3.6, 0.6, z, 0)
    // 연료통
    k.tube(body, 6.2, 2, 44, -3, 7.5, 6.2, 12)
    k.ball(body, 6.2, 7.5, -3, 2, k.b, 1, 1, 0.6)
    k.ball(body, 6.2, 7.5, -3, 44, k.b, 1, 1, 0.6)
    for (const z of [12, 34]) k.tube(DARK, 6.5, z, z + 3, -3, 7.5, 6.5, 12)
    k.tube(METAL, 1.6, 44, 50, -3, 7.5)
    k.rod(DARK, 1.2, [7.5, -3, 50], [0, -2.4, 58])
    // 압력계
    k.b.add(at(new THREE.CylinderGeometry(2.4 * k.u, 2.4 * k.u, 1.2 * k.u, 12), 0, 4.2 * k.u, k.z(24)), BLACK)
    k.b.add(at(new THREE.CylinderGeometry(1.9 * k.u, 1.9 * k.u, 1.4 * k.u, 12), 0, 4.3 * k.u, k.z(24)), 0xf2f0e6)
    // 불씨
    k.ball(0xffc060, 1.8, 0, -4.8, 78, k.glow(0xff7a10))
    k.rod(DARK, 0.6, [0, -3, 62], [0, -4.6, 76])
    k.slab(DARK, 3.6, [40, -3, 48, -3, 46, -12, 39, -11])
    grip(k, DARK, 6)
    return { y: 0, z: 84, band: [-12, 44, 0, 3.5] }
  },
  // 산탄총: 쇠 몸통 · 굵은 총열 · 아래 탄창관 · 홈 파인 나무 펌프 · 나무 개머리 · 옆의 붉은 탄 셋
  shotgun(k, body) {
    k.slab(body, 5.6, [-4, 4.6, -4, -4.5, -12, -6.5, -40, -10.5, -43, -9, -43, -0.5, -14, 4.2])
    k.slab(BLACK, 6, [-45.5, 0, -43, 0, -43, -10, -45.5, -9.5], 0, 0.3)
    k.slab(DARK, 6.6, [-4, 5.6, 28, 5.6, 28, -3.6, -4, -4.6])
    k.box(BLACK, 0.5, 2.4, 6, 20, 1.2, -3.3)
    for (let i = 0; i < 3; i++) k.tube(0xc8402a, 1.3, 4 + i * 7, 9.5 + i * 7, 2.6, 4, 1.3, 8)
    for (let i = 0; i < 3; i++) k.tube(BRASS, 1.35, 4 + i * 7, 5.5 + i * 7, 2.6, 4, 1.35, 8)
    k.tube(DARK, 2.7, 28, 93, 2)
    k.tube(BLACK, 2.2, 92.5, 93.5, 2)
    k.tube(DARK, 2.1, 28, 82, -2.6)
    k.tube(METAL, 2.3, 80, 84, -2.6)
    k.tube(body, 3.7, 44, 66, -2.6, 0, 3.7, 12)
    for (const z of [48, 53, 58, 63]) k.ring(WOOD_D, 3.7, 0.45, z, -2.6)
    k.ball(BRASS, 1, 0, 5, 91)
    k.slab(BLACK, 1.4, [1, -4.6, 11, -4.6, 11, -8.6, 1, -7.8], 0, 0.2)
    return { y: 2, z: 94, band: [0, 26, -0.6, 3.4] }
  },
  // 더블배럴: 나란한 쇠 총열 둘 · 가운데 띠 · 금빛 꺾쇠 · 공이치기 둘 · 큰 나무 개머리 · 총열 받침
  doublebarrel(k, body) {
    k.slab(body, 6.4, [8, 4.2, 8, -5, -4, -7.5, -40, -11.5, -43, -10, -43, -1.5, -10, 4])
    k.slab(BLACK, 6.8, [-45.5, -1, -43, -1, -43, -11, -45.5, -10.5], 0, 0.3)
    k.slab(BRASS, 8.4, [8, 5, 25, 5, 25, -4, 8, -5.2])
    for (const sd of [-1, 1]) {
      k.tube(METAL, 2.6, 24, 95, 1.4, sd * 2.7)
      k.tube(BLACK, 2.1, 94.6, 95.4, 1.4, sd * 2.7)
      k.slab(DARK, 1.4, [3, 5, 8, 5, 8, 8, 5, 8.4], sd * 2.2, 0.2)
    }
    k.box(DARK, 1.2, 1, 25, 93, 3.9)
    k.ball(BRASS, 0.9, 0, 4.6, 92)
    k.slab(body, 7.6, [27, -0.6, 58, -0.6, 55, -5.2, 29, -5.2])
    k.slab(BRASS, 2.2, [12, 5, 18, 5, 17, 6.4, 13, 6.4], 0, 0.2)
    k.slab(BLACK, 1.4, [-2, -7.5, 9, -5.4, 9, -9.4, -1, -10.6], 0, 0.2)
    return { y: 1.4, z: 96, band: [10, 23, 0, 4.3] }
  },
  // 저격총: 긴 총열 · 총구 제동기 · 큰 조준경(빛나는 렌즈 · 조절 손잡이) · 볼받침 · 노리쇠 · 탄창 · 접은 양각대
  sniper(k, body) {
    k.slab(body, 5.6, [-6, 4, -6, -4, -14, -5, -19, -9.5, -42, -10.5, -45, -9, -45, 2.5, -30, 4.4])
    k.slab(DARK, 4.6, [-36, 4.4, -14, 4.4, -16, 7, -34, 7])
    k.slab(BLACK, 6, [-47.5, 3, -45, 3, -45, -10, -47.5, -9.5], 0, 0.3)
    k.slab(body, 6, [-6, 4.5, 40, 4.5, 40, -2, 31, -4, -6, -4])
    k.tube(DARK, 1.9, 40, 60, 1, 0, 1.6)
    k.tube(DARK, 1.6, 60, 98, 1)
    k.slab(DARK, 4.4, [98, 3.4, 107, 3.4, 107, -1.4, 98, -1.4])
    for (const z of [100.5, 103.5]) k.box(BLACK, 4.8, 1.6, z, z + 1.6, 1)
    // 조준경
    k.tube(DARK, 2.7, 2, 36, 9.6)
    k.tube(DARK, 2.7, 34, 40, 9.6, 0, 4)
    k.tube(DARK, 4, 40, 45, 9.6)
    k.tube(DARK, 3.4, -3, 3, 9.6, 0, 2.7)
    k.tube(0x7ad8ff, 3.5, 44.6, 45.4, 9.6, 0, 3.5, 12, k.glow(0x1a6a8a))
    k.b.add(at(new THREE.CylinderGeometry(1.5 * k.u, 1.5 * k.u, 2.6 * k.u, 8), 0, 12.8 * k.u, k.z(19)), METAL)
    k.b.add(at(new THREE.CylinderGeometry(1.5 * k.u, 1.5 * k.u, 2.6 * k.u, 8), -3.4 * k.u, 9.6 * k.u, k.z(19), 0, 0, Math.PI / 2), METAL)
    for (const z of [8, 28]) k.slab(DARK, 2.4, [z, 4.5, z + 3.5, 4.5, z + 3.5, 8, z, 8], 0, 0.3)
    // 노리쇠 손잡이
    k.rod(METAL, 0.7, [-3, 2.4, 4], [-6.4, 0.6, 2])
    k.ball(BLACK, 1.5, -6.8, 0.2, 2)
    k.slab(DARK, 3.4, [14, -4, 25, -4, 24, -10.5, 15, -10.5])
    for (const sd of [-1, 1]) k.rod(DARK, 0.75, [sd * 2, -2.6, 48], [sd * 2.4, -3.4, 76])
    for (const sd of [-1, 1]) k.ball(BLACK, 1.1, sd * 2.4, -3.4, 76)
    grip(k, body, -3)
    return { y: 1, z: 107, band: [-2, 36, 0.2, 3] }
  },
  // 레일건: 짙은 몸통 · 나란한 레일 둘 · 빛나는 심 · 코일 셋 · 옆 에너지 칸 · 방열판
  railgun(k, body) {
    const shell = 0x2a2f3a
    const glow = k.glow(0x2ad0ff)
    k.slab(shell, 7.8, [-10, 5.5, 42, 5.5, 46, 2, 46, -3, 36, -5, -10, -5])
    k.slab(shell, 5.6, [-10, 4, -10, -5, -32, -8.5, -36, -7, -36, 1.5, -28, 4])
    k.slab(BLACK, 6, [-38.5, 2, -36, 2, -36, -8, -38.5, -7.5], 0, 0.3)
    for (const sd of [-1, 1]) k.slab(body, 2.2, [42, 4.4, 95, 3.2, 95, -1.2, 42, -2.4], sd * 3.6)
    k.tube(0x8af6ff, 0.9, 42, 93, 1, 0, 0.9, 6, glow)
    for (const z of [52, 66, 80]) k.ring(0x8af6ff, 6, 1.1, z, 1, 0, glow)
    for (const z of [48.5, 62.5, 76.5]) k.box(DARK, 9.6, 2.2, z, z + 7, -3.2)
    k.box(0x8af6ff, 1, 3, 6, 30, 1.6, 4, glow)
    k.box(0x8af6ff, 1, 3, 6, 30, 1.6, -4, glow)
    for (const z of [8, 15, 22]) k.slab(DARK, 5, [z, 5.5, z + 4, 5.5, z + 3, 8.4, z + 1, 8.4], 0, 0.3)
    k.slab(DARK, 3.4, [30, -5, 38, -5, 36, -13, 30, -12])
    grip(k, DARK)
    return { y: 1, z: 96, band: [-8, 4, -2.4, 3.95] }
  },
  // 기관총: 굵은 몸통 · 급탄 덮개 · 구멍 난 방열 덮개 · 옆 탄통과 탄띠 · 운반 손잡이 · 펼친 양각대 · 뼈대 개머리
  mg(k, body) {
    k.slab(body, 8.4, [-8, 6, 40, 6, 40, -4, -8, -5])
    k.slab(DARK, 7.2, [2, 6, 30, 6, 28, 8.2, 4, 8.2])
    k.slab(DARK, 5.6, [-8, 5, -8, -4.5, -34, -8.5, -37, -7, -37, 3], 0, 0.5)
    k.slab(BLACK, 6.2, [-39.5, 3.4, -37, 3.4, -37, -8, -39.5, -7.5], 0, 0.3)
    k.tube(DARK, 3.4, 40, 76, 1)
    for (const z of [45, 51, 57, 63, 69]) k.ring(BLACK, 3.4, 0.5, z, 1)
    k.tube(METAL, 1.7, 76, 93, 1)
    k.tube(DARK, 1.7, 91, 98, 1, 0, 2.6)
    // 탄통 · 탄띠
    k.box(body, 9, 10, 6, 28, -5.5, 8.6)
    k.box(DARK, 9.6, 1.6, 5, 29, 0.2, 8.6)
    for (let i = 0; i < 4; i++) k.tube(BRASS, 0.9, 13, 21, 2.2 + i * 0.9, 6.6 - i * 1.5, 0.9, 6)
    // 운반 손잡이
    k.rod(DARK, 0.8, [0, 8, 8], [0, 12, 12])
    k.rod(DARK, 0.8, [0, 8, 30], [0, 12, 26])
    k.rod(DARK, 1.2, [0, 12, 11], [0, 12, 27])
    for (const sd of [-1, 1]) {
      k.rod(DARK, 0.8, [0, -2, 62], [sd * 5.5, -13, 74])
      k.ball(BLACK, 1.2, sd * 5.5, -13, 74)
    }
    k.slab(DARK, 1.4, [84, 2.4, 89, 2.4, 88, 7, 85, 7], 0, 0.2)
    grip(k)
    return { y: 1, z: 98, band: [-4, 36, 2.4, 4.25] }
  },
  // 유탄발사기: 여섯 구멍 회전 탄창 · 굵은 총열(검은 구멍) · 총구 테 · 고리 조준기 · 앞 손잡이 · 개머리
  launcher(k, body) {
    k.tube(DARK, 7.4, 6, 28, 0, 0, 7.4, 6)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6
      k.tube(BRASS, 1.9, 28, 28.8, Math.sin(a) * 4.4, Math.cos(a) * 4.4, 1.9, 8)
    }
    k.tube(body, 5, 28, 84, 1, 0, 5, 12)
    k.tube(DARK, 5.6, 79, 86, 1, 0, 5.6, 12)
    k.tube(BLACK, 4.2, 85.6, 86.4, 1, 0, 4.2, 12)
    for (const z of [40, 60]) k.ring(DARK, 5.1, 0.6, z, 1)
    k.slab(DARK, 2.6, [30, 6, 62, 6, 62, 7.6, 30, 7.6], 0, 0.3)
    k.b.add(at(new THREE.TorusGeometry(2.6 * k.u, 0.6 * k.u, 6, 12), 0, 10.6 * k.u, k.z(44)), DARK)
    k.slab(DARK, 5.4, [-4, 3.5, 6, 4, 6, -4.5, -4, -4.5])
    k.slab(DARK, 5, [-4, 3, -4, -4, -30, -7.5, -33, -6, -33, 1.5], 0, 0.5)
    k.slab(BLACK, 5.6, [-35.5, 2, -33, 2, -33, -7, -35.5, -6.5], 0, 0.3)
    k.slab(DARK, 3.6, [46, -4, 54, -4, 52, -14.5, 45, -13.5])
    grip(k)
    return { y: 1, z: 87, band: [32, 76, 1, 5.05] }
  },
  // 권총 · 리볼버 (지금은 안 쓰는 계열)
  pistol(k, body) {
    k.slab(body, 5, [-4, 5, 62, 5, 62, 0, 10, -1, -4, -1])
    k.tube(DARK, 1.4, 58, 66, 2.6)
    grip(k)
    return { y: 2.6, z: 66, band: [0, 50, 2, 2.55] }
  },
  revolver(k, body) {
    k.tube(DARK, 4.4, 8, 22, 1, 0, 4.4, 6)
    k.tube(body, 1.7, 22, 74, 2)
    k.slab(body, 4, [-4, 4, 10, 4, 10, -2, -4, -2])
    grip(k, WOOD)
    return { y: 2, z: 74, band: [-2, 8, 1, 2.05] }
  },
}

/**
 * 등급 장식 (2026-11-12 — 전에는 무슨 등급을 끼든 손의 무기가 똑같았다): 마법 = 몸통 옆 색줄 · 희귀 = + 금빛 총구 고리 ·
 * 전설 = 줄과 고리가 스스로 빛나고 보석 하나 · 신화 = 줄 둘 + 보석 + 총구 앞 빛 고리
 */
function trim(k: Kit, t: { y: number; z: number; band: [number, number, number, number] }, rarity: number): void {
  if (rarity <= 0) return
  const c = RARITY_HEX[rarity] ?? RARITY_HEX[1]
  const to = rarity >= 3 ? k.glow(c) : k.b
  const [z0, z1, y, hw] = t.band
  for (const sd of [-1, 1]) {
    k.box(c, 0.5, rarity >= 4 ? 0.9 : 1.2, z0, z1, y + (rarity >= 4 ? 1.1 : 0), sd * (hw + 0.2), to)
    if (rarity >= 4) k.box(c, 0.5, 0.9, z0, z1, y - 1.1, sd * (hw + 0.2), to)
  }
  if (rarity >= 2) k.ring(rarity >= 3 ? c : BRASS, 2.6, 0.7, t.z - 3, t.y, 0, to)
  if (rarity >= 3) {
    const gem = at(new THREE.OctahedronGeometry(1.7 * k.u), 0, (y + 5.6) * k.u, k.z(z0 + 3), 0, 0, 0, 0.8, 1.2, 0.8)
    to.add(gem, c)
  }
  if (rarity >= 4) k.ring(c, 3.6, 0.35, t.z + 2, t.y, 0, to)
}

/**
 * 손에 든 무기 (2026-10-24 사용자: "무기 외형이 개선됐으면 · 무기를 바꿔 꼈을 때 외형이 바뀌었으면"):
 * 무기마다 위(쿼터뷰) · 뒤(3인칭)에서 알아보는 모양 — 석궁 = 가로 활대 · 더블배럴 = 나란한 총열 · 저격총 = 큰 조준경 · 레일건 = 빛나는 코일 …
 * rarity = 낀 무기 아이템의 등급(없으면 0 — 장식 없음)
 */
export function buildGun(w: WeaponDef, R: number, meat = 0, rarity = 0): { group: THREE.Group; tip: THREE.Object3D } {
  const s = Math.max(0.8, R / 0.42)
  const len = (0.26 + w.length / 120) * s
  const k = new Kit(len, s)
  let tipAt: [number, number, number]
  if (w.melee) {
    tipAt = w.family === 'violin' ? violin(k, len, w.id === 'cello', meat, rarity) : w.family === 'rapier' ? sword(k, len, w.id === 'katana', rarity) : w.id === 'wok' ? wok(k, len, rarity) : pan(k, len, w.color, rarity)
  } else {
    const t = (GUNS[w.id] ?? (GUNS.rifle as GunShape))(k, w.color)
    trim(k, t, rarity)
    tipAt = [0, t.y * k.u, k.z(t.z) + 0.02]
  }
  const g = k.build()
  const tip = new THREE.Object3D()
  tip.position.set(tipAt[0], tipAt[1], tipAt[2])
  g.add(tip)
  return { group: g, tip }
}

/** 근접 무기의 등급: 빛나는 묶음(전설부터) 또는 몸 묶음 */
function tier(k: Kit, rarity: number): { c: number; to: Bake } | null {
  if (rarity <= 0) return null
  const c = RARITY_HEX[rarity] ?? RARITY_HEX[1]
  return { c, to: rarity >= 3 ? k.glow(c) : k.b }
}

/** 바닥과 나란한 판: 윤곽(x, z)을 그려 두께(y)만큼 */
function plate(outline: THREE.Shape, thick: number, bevel: number, y: number): THREE.BufferGeometry {
  const b = Math.min(bevel, thick * 0.4)
  const g = new THREE.ExtrudeGeometry(outline, { depth: thick - b * 2, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2, steps: 1, curveSegments: 10 })
  g.rotateX(Math.PI / 2)
  g.translate(0, y + thick - b, 0)
  return g
}

/**
 * 후라이팬. 판을 **바닥과 나란히 눕혀** 쿼터뷰에서 둥근 판이 보이게 한다(2026-09-06 — 막대처럼 보였다):
 * 손잡이(마디 · 걸이 구멍) + 벽이 있는 깊은 판 + 안쪽 밝은 면 + 계란후라이
 */
function pan(k: Kit, len: number, color: number, rarity: number): [number, number, number] {
  const handleLen = len * 0.62
  const r = len * 0.42
  const cz = handleLen * 0.5 + r * 0.92
  const hz = handleLen - r * 0.1
  const g = new THREE.CapsuleGeometry(0.028, hz - 0.056, 3, 10)
  g.rotateX(Math.PI / 2)
  k.b.add(at(g, 0, 0.012, hz / 2), 0x2b2b2b)
  for (const z of [0.25, 0.5]) k.b.add(at(new THREE.TorusGeometry(0.03, 0.006, 5, 12), 0, 0.012, hz * z), 0x4a4a4e)
  k.b.add(at(new THREE.TorusGeometry(0.02, 0.007, 5, 12), 0, 0.012, -0.012, Math.PI / 2), METAL)
  // 판: 바닥 · 비스듬한 벽 · 도톰한 테 (돌려 만든다)
  const P = (x: number, y: number) => new THREE.Vector2(x, y)
  const dish = new THREE.LatheGeometry([P(0, -0.006), P(r * 0.82, -0.006), P(r * 1.0, 0.036), P(r * 1.03, 0.05), P(r * 0.98, 0.054), P(r * 0.8, 0.014), P(0, 0.014)], 28)
  k.b.add(at(dish, 0, 0.012, cz), color)
  k.b.add(at(new THREE.CircleGeometry(r * 0.8, 24), 0, 0.028, cz, -Math.PI / 2), 0x6f767c)
  // 계란후라이 (요청): 흰자는 찌그러진 납작한 덩이 · 노른자는 도톰한 반구(빛난다)
  const egg = new THREE.Shape()
  const pts: THREE.Vector2[] = []
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2
    const rr = r * (0.5 + 0.1 * Math.sin(i * 2.3) + 0.06 * Math.cos(i * 4.1))
    pts.push(P(Math.cos(a) * rr * 1.1, Math.sin(a) * rr * 0.9))
  }
  egg.moveTo(pts[0].x, pts[0].y)
  egg.splineThru([...pts.slice(1), pts[0]])
  k.b.add(at(plate(egg, 0.016, 0.006, 0.03), r * 0.06, 0, cz - r * 0.05, 0, 0.5), 0xfaf6ee)
  k.b.add(ball(r * 0.2, r * 0.02, 0.048, cz - r * 0.08, 1, 0.55, 1, 14, 10), 0xffb300, undefined)
  const t = tier(k, rarity)
  if (t) {
    t.to.add(at(new THREE.TorusGeometry(r * 1.02, 0.008, 5, 28), 0, 0.064, cz, Math.PI / 2), t.c)
    t.to.add(at(new THREE.TorusGeometry(0.031, 0.008, 5, 12), 0, 0.012, hz * 0.8), t.c)
  }
  return [0, 0.03, cz]
}

/** 대형 웍: 깊은 쇠 냄비(반구) · 안쪽 면 · 테 · 나무 손잡이 · 반대편 고리 · 볶음 거리 — 납작한 후라이팬과 한눈에 다르게 */
function wok(k: Kit, len: number, rarity: number): [number, number, number] {
  const iron = 0x2e2e33
  const handleLen = len * 0.55
  const cap = (r: number, l: number, z: number) => {
    const g = new THREE.CapsuleGeometry(r, Math.max(0.001, l - r * 2), 3, 10)
    g.rotateX(Math.PI / 2)
    return at(g, 0, 0, z + l / 2)
  }
  k.b.add(cap(0.03, handleLen * 0.6, 0), WOOD)
  for (const z of [0.12, 0.3, 0.48]) k.b.add(at(new THREE.TorusGeometry(0.031, 0.005, 5, 12), 0, 0, handleLen * z), WOOD_D)
  k.b.add(cap(0.02, handleLen * 0.5, handleLen * 0.5), iron)
  const r = len * 0.5
  const cz = handleLen + r * 0.9
  k.b.add(at(new THREE.SphereGeometry(r, 24, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0, 0.07, cz, 0, 0, 0, 1, 0.55, 1), iron)
  k.b.add(at(new THREE.CircleGeometry(r * 0.94, 24), 0, 0.064, cz, -Math.PI / 2), 0x5a5f66)
  k.b.add(at(new THREE.TorusGeometry(r * 0.98, 0.02, 8, 28), 0, 0.07, cz, Math.PI / 2), iron)
  k.b.add(at(new THREE.TorusGeometry(0.045, 0.012, 6, 12), 0, 0.07, cz + r * 1.05, Math.PI / 2), iron)
  // 볶음 거리: 파 · 당근 · 달걀 · 새우
  for (const [x, z, c] of [[-0.3, -0.1, 0x6fbf4a], [0.25, 0.15, 0xff8a3a], [0.05, 0.35, 0xf2d050], [-0.1, -0.4, 0x6fbf4a], [0.4, -0.3, 0xff8a3a], [-0.45, 0.3, 0xf2d050]] as const) {
    k.b.add(at(new THREE.BoxGeometry(r * 0.22, 0.03, r * 0.14), r * x, 0.078, cz + r * z, 0, x * 3), c)
  }
  k.b.add(at(new THREE.TorusGeometry(r * 0.1, r * 0.04, 5, 10, Math.PI * 1.3), r * 0.1, 0.085, cz - r * 0.1, Math.PI / 2), 0xff9a8a)
  const t = tier(k, rarity)
  if (t) {
    t.to.add(at(new THREE.TorusGeometry(r * 1.0, 0.009, 5, 28), 0, 0.094, cz, Math.PI / 2), t.c)
    t.to.add(at(new THREE.TorusGeometry(0.032, 0.008, 5, 12), 0, 0, handleLen * 0.56), t.c)
  }
  return [0, 0.05, cz]
}

/** 고기 악기의 고기 (items.ts MEATS 순서): 소고기 · 닭고기 · 오리고기 — 위에서 보면 붉은 살 / 금빛 튀김 / 진갈색 구이 */
const MEAT_LOOK = [
  { meat: 0xa8392c, mark: 0xf2d8c8, bone: 0xe8e0cc, bumps: false },
  { meat: 0xe0a040, mark: 0xb8742a, bone: 0xf6efe0, bumps: true },
  { meat: 0x8e3e1c, mark: 0xf08a30, bone: 0xe8e0cc, bumps: false },
]

/**
 * 딱딱한 고기 바이올린 (철면란, 2026-09-19 사용자): 살코기 몸통 + 지방 · 소스 무늬 + 뼈 목. 첼로는 더 크다. 목을 쥐고 몸통으로 후려친다 — 몸통이 앞(+z).
 * 2026-11-12: 납작한 공 둘이라 스테이크로 보였다 → 허리가 잘록한 바이올린 윤곽 · 지방 테 · f 구멍 · 줄받침 · 줄걸이 · 줄 넷 · 줄감개
 */
function violin(k: Kit, len: number, big: boolean, kind: number, rarity: number): [number, number, number] {
  const s = (big ? 1.35 : 1) * 1.6
  const look = MEAT_LOOK[kind] ?? MEAT_LOOK[0]
  const neckLen = len * 0.7 * s
  // 목은 손(원점)을 지나 뒤로 조금 더 — 쥔 자리가 비지 않게
  const z0 = -neckLen * 0.25
  const neck = new THREE.CapsuleGeometry(0.022 * s, neckLen * 1.2 - 0.044 * s, 3, 10)
  neck.rotateX(Math.PI / 2)
  k.b.add(at(neck, 0, 0.01, z0 + neckLen * 0.6), look.bone)
  if (look.bumps) {
    // 닭고기: 손잡이 끝이 닭다리 뼈 마디 (동그라미 둘)
    for (const sd of [-1, 1]) k.b.add(ball(0.026 * s, sd * 0.02 * s, 0.02, z0 - 0.005, 1, 1, 1, 10, 8), look.bone)
  } else {
    // 스크롤(목 끝 돌돌 말린 부분) + 줄감개 넷: 손 쪽
    k.b.add(at(new THREE.TorusGeometry(0.03 * s, 0.012 * s, 6, 12), 0, 0.02, z0 - 0.02 * s, 0, Math.PI / 2), look.bone)
    for (let i = 0; i < 4; i++) {
      const sd = i % 2 ? 1 : -1
      k.b.add(at(new THREE.CylinderGeometry(0.007 * s, 0.01 * s, 0.05 * s, 6), sd * 0.035 * s, 0.012, z0 + (0.03 + Math.floor(i / 2) * 0.035) * s, 0, 0, Math.PI / 2), 0x3a2a20)
    }
  }
  // 몸통 윤곽 (오른쪽 반 · 목 쪽 → 아래 끝): 위 둥근 어깨 · 잘록한 허리 · 큰 아래 몸
  const cz = neckLen * 0.62 + 0.13 * s
  const half: [number, number][] = [[0.045, -0.19], [0.085, -0.165], [0.1, -0.11], [0.088, -0.055], [0.062, -0.02], [0.068, 0.02], [0.105, 0.06], [0.126, 0.12], [0.11, 0.18], [0.06, 0.215], [0, 0.226]]
  const outline = (grow: number) => {
    const sh = new THREE.Shape()
    sh.moveTo(0, -0.19 * s * grow)
    sh.splineThru(half.map(([x, z]) => new THREE.Vector2(x * s * grow, z * s * grow)))
    sh.splineThru(half.slice(0, -1).reverse().map(([x, z]) => new THREE.Vector2(-x * s * grow, z * s * grow)))
    sh.lineTo(0, -0.19 * s * grow)
    return sh
  }
  const th = 0.062 * s
  // 살코기 몸 + 가운데를 두르는 지방 테(닭고기는 튀김옷 색)
  k.b.add(at(plate(outline(1), th, 0.012 * s, -th * 0.42), 0, 0, cz), look.meat)
  k.b.add(at(plate(outline(1.035), th * 0.3, 0.004 * s, -th * 0.07), 0, 0, cz), look.mark)
  const top = th * 0.58
  if (look.bumps) {
    // 닭고기: 바삭한 튀김 알갱이
    for (const [x, dz] of [[-0.06, -0.1], [0.05, -0.06], [-0.03, 0.0], [0.07, 0.07], [-0.07, 0.1], [0.01, 0.15], [0.04, -0.14], [-0.02, 0.19]] as const) {
      k.b.add(ball(0.02 * s, x * s, top, cz + dz * s, 1, 0.7, 1, 8, 6), look.mark)
    }
  } else {
    // 소고기 = 흰 지방 줄(마블링) · 오리고기 = 주황 소스 줄 — 줄 양옆으로 비스듬히
    for (const [x, dz, w, a] of [[-0.062, -0.1, 0.05, 0.5], [0.06, -0.085, 0.05, -0.4], [-0.082, 0.1, 0.07, 0.35], [0.08, 0.13, 0.07, -0.5], [-0.05, 0.17, 0.05, -0.3]] as const) {
      k.b.add(at(new THREE.BoxGeometry(w * s, 0.008, 0.013 * s), x * s, top + 0.002, cz + dz * s, 0, a), look.mark)
    }
  }
  // f 구멍 둘 · 줄받침 · 줄걸이 · 지판 · 줄
  for (const sd of [-1, 1]) k.b.add(at(new THREE.BoxGeometry(0.01 * s, 0.006, 0.07 * s), sd * 0.04 * s, top + 0.002, cz + 0.035 * s, 0, sd * 0.2), 0x2a120e)
  k.b.add(at(new THREE.BoxGeometry(0.06 * s, 0.022 * s, 0.008 * s), 0, top + 0.011 * s, cz + 0.05 * s), look.bone)
  const dark = 0x2a1a14
  const t = tier(k, rarity)
  const tail = new THREE.Shape()
  tail.moveTo(-0.022 * s, 0)
  tail.lineTo(0.022 * s, 0)
  tail.lineTo(0.012 * s, 0.075 * s)
  tail.lineTo(-0.012 * s, 0.075 * s)
  tail.closePath()
  k.b.add(at(plate(tail, 0.01 * s, 0.003, top), 0, 0, cz + 0.11 * s), t && rarity < 3 ? t.c : dark)
  const fbLen = neckLen * 0.42 + 0.16 * s
  k.b.add(at(new THREE.BoxGeometry(0.03 * s, 0.01 * s, fbLen), 0, top + 0.004 * s, cz - 0.03 * s - fbLen / 2), dark)
  // 줄 넷: 전설부터는 등급 색으로 빛난다
  const strings = t && rarity >= 3 ? t.to : k.b
  const sc = t && rarity >= 3 ? t.c : look.bone
  const sl = neckLen * 0.62 + 0.3 * s
  for (let i = 0; i < 4; i++) strings.add(at(new THREE.BoxGeometry(0.003 * s, 0.003 * s, sl), (i - 1.5) * 0.008 * s, top + 0.02 * s, cz + 0.12 * s - sl / 2), sc)
  if (t && rarity >= 3) t.to.add(at(new THREE.OctahedronGeometry(0.016 * s), 0, top + 0.018 * s, cz + 0.16 * s), t.c)
  return [0, 0.03, cz]
}

/**
 * 길고 얇은 검 (우재란 장검 · 태도, 2026-09-19 사용자). 칼날이 앞(+z).
 * 2026-11-12: 납작한 상자 날 → 장검 = 마름모 단면으로 끝이 가늘어지는 날 · 둥근 손 가리개 · 손등 고리 / 태도 = 살짝 휜 날 · 날 무늬 · 금빛 날밑 · 마름모 감은 자루
 */
function sword(k: Kit, len: number, katana: boolean, rarity: number): [number, number, number] {
  const gold = 0xd9b04a
  const steel = 0xd8dde3
  const t = tier(k, rarity)
  const cap = (r: number, l: number, z: number, c: number) => {
    const g = new THREE.CapsuleGeometry(r, Math.max(0.001, l - r * 2), 3, 8)
    g.rotateX(Math.PI / 2)
    k.b.add(at(g, 0, 0.01, z + l / 2), c)
  }
  const bladeLen = len * (katana ? 2.3 : 2.1)
  if (katana) {
    cap(0.021, 0.15, -0.1, 0x1c1c1f)
    // 자루 감개의 마름모 무늬 · 끝 마개 · 날밑 · 날 받침
    for (let i = 0; i < 5; i++) k.b.add(at(new THREE.OctahedronGeometry(0.011), 0, 0.03, -0.078 + i * 0.027, 0, 0, 0, 0.9, 0.5, 1.1), 0xe8e0cc)
    k.b.add(at(new THREE.CylinderGeometry(0.023, 0.023, 0.016, 10), 0, 0.01, -0.1, Math.PI / 2), t ? t.c : gold)
    k.b.add(at(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 16), 0, 0.01, 0.056, Math.PI / 2), gold)
    k.b.add(at(new THREE.CylinderGeometry(0.044, 0.044, 0.014, 16), 0, 0.01, 0.056, Math.PI / 2), 0x2a2a2e)
    k.b.add(at(new THREE.BoxGeometry(0.014, 0.034, 0.03), 0, 0.012, 0.078), gold)
    // 날: 등은 위 · 날은 아래 · 끝으로 가며 살짝 위로 휜다
    const n = 9
    const up: number[] = []
    const dn: number[] = []
    for (let i = 0; i <= n; i++) {
      const f = i / n
      const z = 0.09 + bladeLen * f
      const lift = f * f * bladeLen * 0.055
      const hw = 0.017 * (1 - 0.35 * f)
      up.push(z, 0.012 + lift + hw)
      dn.unshift(i === n ? 0.012 + lift + hw * 0.7 : 0.012 + lift - hw)
      dn.unshift(i === n ? z + bladeLen * 0.03 : z)
    }
    k.b.add(slab([...up, ...dn], 0.008, 0.003), steel)
    // 날 무늬(하몬): 아래쪽 반을 더 밝게 — 날보다 아주 조금 두껍게 겹친다
    const edge: number[] = []
    const mid: number[] = []
    for (let i = 0; i <= n; i++) {
      const f = i / n
      const z = 0.09 + bladeLen * f
      const lift = f * f * bladeLen * 0.055
      const hw = 0.017 * (1 - 0.35 * f)
      mid.push(z, 0.012 + lift - hw * (0.15 + 0.25 * Math.sin(i * 2.1)))
      edge.unshift(0.012 + lift - hw * 0.98)
      edge.unshift(z)
    }
    k.b.add(slab([...mid, ...edge], 0.0086, 0.003), 0xffffff)
    if (t && rarity >= 3) for (let i = 0; i < 4; i++) {
      const f = 0.12 + i * 0.2
      t.to.add(at(new THREE.BoxGeometry(0.0095, 0.006, bladeLen * 0.14), 0, 0.012 + f * f * bladeLen * 0.055 + 0.008, 0.09 + bladeLen * (f + 0.07), -f * 0.11), t.c)
    }
    const f = 1
    return [0, 0.012 + f * bladeLen * 0.055, 0.09 + bladeLen]
  }
  cap(0.02, 0.13, -0.085, 0x3a2418)
  for (let i = 0; i < 4; i++) k.b.add(at(new THREE.TorusGeometry(0.021, 0.004, 5, 10), 0, 0.01, -0.06 + i * 0.026), 0x5a3a26)
  k.b.add(ball(0.026, 0, 0.01, -0.1, 1, 1, 1, 10, 8), t ? t.c : gold)
  // 손 가리개: 앞을 덮는 둥근 컵 · 가로 막대 · 손등 고리
  k.b.add(at(new THREE.SphereGeometry(0.058, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), 0, 0.01, 0.036, Math.PI / 2, 0, 0, 1, 0.55, 1), gold)
  k.b.add(at(new THREE.CylinderGeometry(0.007, 0.007, 0.19, 6), 0, 0.01, 0.04, 0, 0, Math.PI / 2), gold)
  for (const sd of [-1, 1]) k.b.add(ball(0.012, sd * 0.095, 0.01, 0.04), gold)
  k.b.add(at(new THREE.TorusGeometry(0.07, 0.006, 5, 14, Math.PI), 0, 0.01, -0.03, 0, Math.PI / 2, Math.PI / 2), gold)
  // 날: 마름모 단면 · 끝으로 가늘게
  const blade = new THREE.CylinderGeometry(0.002, 0.014, bladeLen, 4)
  blade.rotateX(Math.PI / 2)
  k.b.add(at(blade, 0, 0.012, 0.07 + bladeLen / 2, 0, 0, 0, 1, 0.45, 1), steel)
  k.b.add(at(new THREE.CylinderGeometry(0.016, 0.02, 0.03, 8), 0, 0.012, 0.075, Math.PI / 2), gold)
  if (t && rarity >= 3) {
    const fuller = new THREE.CylinderGeometry(0.0012, 0.0045, bladeLen * 0.8, 4)
    fuller.rotateX(Math.PI / 2)
    t.to.add(at(fuller, 0, 0.0155, 0.09 + bladeLen * 0.4, 0, 0, 0, 1, 0.5, 1), t.c)
  }
  return [0, 0.012, 0.07 + bladeLen]
}
