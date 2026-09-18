// 몬스터 그리기. 종류마다 부품(몸통·머리·눈·팔·다리…)을 InstancedMesh 하나씩으로 두고,
// 매 프레임 몬스터마다 "뿌리 행렬 × 부품 행렬" 을 채운다 → 몬스터가 100마리여도 그리기 호출은 부품 수만큼(종류당 6~8번).
// 뼈대 애니메이션 없이 기울기·흔들림·부풀기로 움직임을 낸다. 로컬 좌표: 발 아래 원점, +y 위, 정면 +z (character3d.ts 와 같다).
//
// 분위기(2026-09-18 사용자): 디아블로·다키스트 던전풍 어두운 괴물. 캐릭터(말랑한 오리)와 대비되도록
// 창백하고 마른 살빛 · 뼈 · 썩은 녹색, 그리고 **어둠 속에서 빛나는 눈**(MeshBasic — 조명과 상관없이 보인다).

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MONSTER_LIST } from '../core/monsters'
import { GameState, MS_WINDUP, Monster } from '../core/state'
import { U } from './world3d'

/** 몬스터가 매 프레임 넘기는 움직임 상태 */
interface Anim {
  /** 걸음 위상 */
  walk: number
  /** 이동 중 (0..1 부드럽게) */
  move: number
  /** 예고 진행 0..1 (예고 중이 아니면 0) */
  wind: number
  /** 공격 직후 휘두름 1 → 0 */
  swing: number
  /** 맞은 번쩍임 1 → 0 */
  flash: number
  /** 치명타였나 (번쩍임 색) */
  crit: boolean
  /** 쓰러짐 0 → 1 (시체) */
  dead: number
  /** 몸 크기 흔들림 (스프링) */
  squash: number
  squashV: number
  /** 보간한 바라보는 각 (라디안) */
  yaw: number
}

interface Part {
  mesh: InstancedMesh
  /** 부품의 로컬 행렬을 anim 으로 만든다 */
  pose: (a: Anim, o: THREE.Object3D) => void
  /** 맞으면 번쩍이는 부품 (살·뼈). 눈은 안 번쩍인다 */
  flashes: boolean
}

type InstancedMesh = THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>

interface Corpse {
  kind: number
  x: number
  z: number
  yaw: number
  t: number
}

interface MVis extends Anim {
  seen: number
}

const CAP = 220
const lambert = (color: number) => new THREE.MeshLambertMaterial({ color })
const glow = (color: number) => new THREE.MeshBasicMaterial({ color })

function cap(r: number, len: number): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(r, len, 3, 6)
}

/** 부품 하나 = 지오메트리 + 재질 + 자세 함수 */
function part(geo: THREE.BufferGeometry, mat: THREE.Material, flashes: boolean, pose: (a: Anim, o: THREE.Object3D) => void, shadow = true): Part {
  const mesh = new THREE.InstancedMesh(geo, mat, CAP) as InstancedMesh
  mesh.count = 0
  mesh.frustumCulled = false
  mesh.castShadow = shadow
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  if (flashes) {
    const white = new THREE.Color(1, 1, 1)
    for (let i = 0; i < CAP; i++) mesh.setColorAt(i, white)
  }
  return { mesh, pose, flashes }
}

const sin = Math.sin

/** 구울: 굽은 등, 긴 팔을 늘어뜨리고, 예고 때 두 팔을 치켜든다 */
function ghoulParts(): Part[] {
  // 창백한 회녹색 살 — 등불(따뜻한 빛) 아래에서 노랗게 뜨지 않도록 채도를 낮춘다
  const skin = lambert(0x7d8479)
  const dark = lambert(0x3d3a36)
  const eye = glow(0xd6ff5c)
  const legGeo = cap(0.07, 0.2)
  const armGeo = cap(0.055, 0.46)
  return [
    part(new THREE.SphereGeometry(0.5, 12, 10), skin, true, (a, o) => {
      const lean = 0.55 + a.move * 0.15 - a.wind * 0.35 + a.swing * 0.5
      o.position.set(0, 0.52 + Math.abs(sin(a.walk)) * 0.04 * a.move, -0.02)
      o.rotation.set(lean, 0, sin(a.walk) * 0.08 * a.move)
      o.scale.set(0.36 * (1 + a.squash * 0.3), 0.42 * (1 - a.squash * 0.3), 0.33)
    }),
    part(new THREE.SphereGeometry(0.5, 10, 8), skin, true, (a, o) => {
      o.position.set(0, 0.76 - a.wind * 0.02, 0.24 + a.swing * 0.08)
      o.rotation.set(0.3 - a.wind * 0.4, 0, 0)
      o.scale.set(0.36, 0.32, 0.4)
    }),
    // 턱 (벌린 입 — 어두운 색)
    part(new THREE.SphereGeometry(0.5, 8, 6), dark, false, (a, o) => {
      o.position.set(0, 0.69 - a.wind * 0.03, 0.36 + a.swing * 0.08)
      o.rotation.set(0.2, 0, 0)
      o.scale.set(0.2, 0.08 + a.wind * 0.06, 0.12)
    }, false),
    // 눈 두 개를 한 부품으로
    part(mergeGeometries([new THREE.SphereGeometry(0.036, 6, 5).translate(-0.075, 0, 0), new THREE.SphereGeometry(0.036, 6, 5).translate(0.075, 0, 0)])!, eye, false, (a, o) => {
      o.position.set(0, 0.8 - a.wind * 0.02, 0.4 + a.swing * 0.08)
      o.rotation.set(0.3 - a.wind * 0.4, 0, 0)
      o.scale.setScalar(1 + a.wind * 0.5)
    }, false),
    // 팔 (왼·오른)
    ...[-1, 1].map((side) =>
      part(armGeo, skin, true, (a, o) => {
        // 늘어뜨림(앞으로) → 예고 때 치켜듦(뒤로) → 휘두름
        const swingF = sin(a.walk + (side > 0 ? 0 : Math.PI)) * 0.35 * a.move
        const rx = 1.0 + swingF - a.wind * 2.3 + a.swing * 1.6
        o.position.set(side * 0.26, 0.6, 0.1)
        o.rotation.set(rx, 0, side * 0.15)
        o.scale.setScalar(1)
        // 캡슐 중심이 어깨 아래로 오도록 앞으로 내민다
        o.translateY(-0.25)
      }),
    ),
    ...[-1, 1].map((side) =>
      part(legGeo, dark, false, (a, o) => {
        o.position.set(side * 0.13, 0.2, -0.05)
        o.rotation.set(sin(a.walk + (side > 0 ? 0 : Math.PI)) * 0.6 * a.move, 0, 0)
        o.scale.setScalar(1)
      }),
    ),
  ]
}

/** 해골 궁수: 누더기 두건 · 갈비뼈 · 해골 · 붉은 눈구멍 · 활 */
function archerParts(): Part[] {
  const bone = lambert(0xd9d1bb)
  const cloth = lambert(0x2e2530)
  const wood = lambert(0x5c3b22)
  const eye = glow(0xff3b24)
  return [
    // 두건 망토 (원뿔 치마)
    part(new THREE.ConeGeometry(0.3, 0.72, 10, 1, true), cloth, false, (a, o) => {
      o.position.set(0, 0.4, 0)
      o.rotation.set(0.05 * a.move, 0, sin(a.walk) * 0.05 * a.move)
      o.scale.setScalar(1)
    }),
    // 갈비뼈
    part(new THREE.SphereGeometry(0.5, 10, 8), bone, true, (a, o) => {
      o.position.set(0, 0.86 + Math.abs(sin(a.walk)) * 0.03 * a.move, 0)
      o.rotation.set(0.1 - a.wind * 0.15, 0, 0)
      o.scale.set(0.4 * (1 + a.squash * 0.2), 0.46 * (1 - a.squash * 0.2), 0.3)
    }),
    // 해골
    part(new THREE.SphereGeometry(0.5, 10, 8), bone, true, (a, o) => {
      o.position.set(0, 1.18, 0.03)
      o.rotation.set(-a.wind * 0.15, 0, 0)
      o.scale.set(0.3, 0.32, 0.32)
    }),
    part(mergeGeometries([new THREE.SphereGeometry(0.04, 6, 5).translate(-0.065, 0, 0), new THREE.SphereGeometry(0.04, 6, 5).translate(0.065, 0, 0)])!, eye, false, (a, o) => {
      o.position.set(0, 1.2, 0.17)
      o.rotation.set(-a.wind * 0.15, 0, 0)
      o.scale.setScalar(1 + a.wind * 0.8)
    }, false),
    // 활: 반원 고리를 세워서 앞에 든다. 예고 때 당긴다(앞으로 조금)
    part(new THREE.TorusGeometry(0.34, 0.025, 4, 14, Math.PI), wood, false, (a, o) => {
      o.position.set(0.06, 0.9, 0.3 + a.wind * 0.06)
      o.rotation.set(0, Math.PI / 2, Math.PI / 2)
      o.scale.setScalar(1)
    }),
    // 두 팔 (활 쪽으로 뻗는다)
    part(mergeGeometries([cap(0.035, 0.34).rotateX(Math.PI / 2).translate(-0.14, 0, 0.16), cap(0.035, 0.34 - 0.12).rotateX(Math.PI / 2).translate(0.14, 0, 0.1)])!, bone, true, (a, o) => {
      o.position.set(0, 0.92, 0.02)
      o.rotation.set(0, 0, 0)
      o.scale.set(1, 1, 1 + a.wind * 0.25)
    }),
    ...[-1, 1].map((side) =>
      part(cap(0.04, 0.3), bone, false, (a, o) => {
        o.position.set(side * 0.1, 0.22, 0)
        o.rotation.set(sin(a.walk + (side > 0 ? 0 : Math.PI)) * 0.5 * a.move, 0, 0)
        o.scale.setScalar(1)
      }),
    ),
  ]
}

/** 부푼 시체: 부은 배 · 작은 머리 · 고름 물집. 예고(부풀기) 동안 점점 커지며 붉게 깜빡인다 */
function bloaterParts(): Part[] {
  const flesh = lambert(0x9aa46c)
  const dark = lambert(0x5d5a4a)
  const pus = lambert(0xc8d25c)
  const eye = glow(0xffe05c)
  const blisters = mergeGeometries([
    new THREE.SphereGeometry(0.08, 6, 5).translate(0.24, 0.12, 0.36),
    new THREE.SphereGeometry(0.06, 6, 5).translate(-0.3, -0.05, 0.3),
    new THREE.SphereGeometry(0.07, 6, 5).translate(0.05, 0.3, 0.38),
    new THREE.SphereGeometry(0.05, 6, 5).translate(-0.12, -0.25, 0.42),
  ])!
  const belly = (a: Anim, o: THREE.Object3D) => {
    const swell = 1 + a.wind * 0.45 + sin(a.wind * 40) * 0.04 * a.wind
    o.position.set(0, 0.56 + Math.abs(sin(a.walk)) * 0.03 * a.move, 0)
    o.rotation.set(0.05, 0, sin(a.walk) * 0.1 * a.move)
    o.scale.set(swell * (1 + a.squash * 0.25), swell * (1 - a.squash * 0.25), swell)
  }
  return [
    part(new THREE.SphereGeometry(0.5, 14, 12).scale(1, 0.95, 1), flesh, true, belly),
    part(blisters, pus, true, belly),
    part(new THREE.SphereGeometry(0.5, 10, 8), flesh, true, (a, o) => {
      o.position.set(0, 1.05 + a.wind * 0.18, 0.12)
      o.rotation.set(0.2, 0, 0)
      o.scale.set(0.26, 0.24, 0.26)
    }),
    part(mergeGeometries([new THREE.SphereGeometry(0.028, 6, 5).translate(-0.05, 0, 0), new THREE.SphereGeometry(0.028, 6, 5).translate(0.05, 0, 0)])!, eye, false, (a, o) => {
      o.position.set(0, 1.07 + a.wind * 0.18, 0.24)
      o.rotation.set(0, 0, 0)
      o.scale.setScalar(1)
    }, false),
    ...[-1, 1].map((side) =>
      part(cap(0.1, 0.14), dark, false, (a, o) => {
        o.position.set(side * 0.2, 0.15, 0)
        o.rotation.set(sin(a.walk + (side > 0 ? 0 : Math.PI)) * 0.4 * a.move, 0, 0)
        o.scale.setScalar(1)
      }),
    ),
    ...[-1, 1].map((side) =>
      part(cap(0.07, 0.16), flesh, true, (a, o) => {
        o.position.set(side * 0.5 * (1 + a.wind * 0.4), 0.62, 0.05)
        o.rotation.set(0.4, 0, side * 0.9)
        o.scale.setScalar(1)
      }),
    ),
  ]
}

/** 부품 목록: MONSTER_LIST 순서 */
const BUILDERS = [ghoulParts, archerParts, bloaterParts]

/** 머리 위 체력 바를 띄울 높이 (타일 단위) */
export const MONSTER_TOP = [1.05, 1.45, 1.4]

export class MonsterView {
  readonly group = new THREE.Group()
  private kinds: Part[][]
  private vis = new Map<number, MVis>()
  private corpses: Corpse[] = []
  private o = new THREE.Object3D()
  private root = new THREE.Matrix4()
  private tmp = new THREE.Matrix4()
  private col = new THREE.Color()
  private prevPos = new Map<number, { x: number; y: number }>()
  /** 그린 위치 (체력 바·조준선이 쓴다) */
  readonly shown = new Map<number, { x: number; z: number }>()

  constructor() {
    this.kinds = BUILDERS.map((b) => b())
    for (const parts of this.kinds) for (const p of parts) this.group.add(p.mesh)
  }

  /** 맞음: 번쩍 + 움찔 */
  hit(id: number, crit: boolean): void {
    const v = this.vis.get(id)
    if (!v) return
    v.flash = 1
    v.crit = crit
    v.squashV += crit ? 7 : 4
  }

  /** 쓰러짐: 시체로 남겨 넘어지며 가라앉게 한다 */
  died(m: { m: number; kind: number; x: number; y: number }): void {
    const v = this.vis.get(m.m)
    const s = this.shown.get(m.m)
    this.corpses.push({ kind: m.kind, x: s ? s.x : m.x * U, z: s ? s.z : m.y * U, yaw: v ? v.yaw : 0, t: 0 })
    if (this.corpses.length > 60) this.corpses.shift()
  }

  /** 휘두름(공격 직후) */
  swiped(id: number): void {
    const v = this.vis.get(id)
    if (v) v.swing = 1
  }

  /**
   * 한 프레임 그리기. hidden(m) = 시야 밖이라 숨길지.
   * prev 는 보간용 이전 틱 상태 (몬스터 배열이 줄어들 수 있어 id 로 찾는다)
   */
  update(prev: GameState, curr: GameState, alpha: number, dt: number, hidden: (m: Monster) => boolean): void {
    this.prevPos.clear()
    for (const m of prev.monsters) this.prevPos.set(m.id, { x: m.x, y: m.y })
    const counts = this.kinds.map(() => 0)
    const live = new Set<number>()
    this.shown.clear()
    for (const m of curr.monsters) {
      if (m.hp <= 0) continue
      live.add(m.id)
      let v = this.vis.get(m.id)
      const yawTarget = ((m.aim & 1023) / 1024) * Math.PI * 2
      if (!v) {
        v = { walk: Math.random() * 6, move: 0, wind: 0, swing: 0, flash: 0, crit: false, dead: 0, squash: 0, squashV: 0, yaw: yawTarget, seen: 0 }
        this.vis.set(m.id, v)
      }
      const p = this.prevPos.get(m.id) ?? m
      const x = (p.x + (m.x - p.x) * alpha) * U
      const z = (p.y + (m.y - p.y) * alpha) * U
      this.shown.set(m.id, { x, z })
      // 움직임 상태
      const def = MONSTER_LIST[m.kind]
      v.move += ((m.moving ? 1 : 0) - v.move) * Math.min(1, dt * 10)
      v.walk += dt * (6 + def.speed * 3) * v.move
      v.wind = m.st === MS_WINDUP ? 1 - m.t / def.windup : Math.max(0, v.wind - dt * 6)
      v.swing = Math.max(0, v.swing - dt * 5)
      v.flash = Math.max(0, v.flash - dt * 7)
      v.squashV += (-120 * v.squash - 10 * v.squashV) * dt
      v.squash = Math.max(-0.4, Math.min(0.4, v.squash + v.squashV * dt))
      let d = yawTarget - v.yaw
      while (d > Math.PI) d -= Math.PI * 2
      while (d < -Math.PI) d += Math.PI * 2
      v.yaw += d * Math.min(1, dt * 14)
      if (hidden(m)) continue
      this.put(m.kind, counts, x, z, v.yaw, v, 0)
    }
    for (const id of this.vis.keys()) if (!live.has(id)) this.vis.delete(id)
    // 시체: 뒤로 넘어지며 가라앉는다 (1.1초)
    const still: Corpse[] = []
    const dead: Anim = { walk: 0, move: 0, wind: 0, swing: 0, flash: 0, crit: false, dead: 0, squash: 0, squashV: 0, yaw: 0 }
    for (const c of this.corpses) {
      c.t += dt
      if (c.t > 1.1) continue
      still.push(c)
      dead.dead = Math.min(1, c.t / 0.35)
      dead.flash = Math.max(0, 1 - c.t * 6)
      this.put(c.kind, counts, c.x, c.z, c.yaw, dead, c.t)
    }
    this.corpses = still
    this.kinds.forEach((parts, k) => {
      for (const p of parts) {
        p.mesh.count = counts[k]
        p.mesh.instanceMatrix.needsUpdate = true
        if (p.flashes && p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true
      }
    })
  }

  private put(kind: number, counts: number[], x: number, z: number, yaw: number, a: Anim, corpseT: number): void {
    const i = counts[kind]
    if (i >= CAP) return
    counts[kind]++
    const def = MONSTER_LIST[kind]
    const size = def.r / 13 // 구울(13px) 기준 크기
    // 뿌리: 위치 · 방향 (정면 +z 가 조준 방향이 되도록 — character3d 와 같은 규칙) · 크기 · 시체면 넘어짐·가라앉음
    this.o.position.set(x, -Math.max(0, corpseT - 0.5) * 0.9, z)
    this.o.rotation.set(0, Math.PI / 2 - yaw, 0)
    this.o.scale.setScalar(size)
    this.o.updateMatrix()
    this.root.copy(this.o.matrix)
    if (a.dead > 0) {
      const fall = new THREE.Matrix4().makeRotationX(-a.dead * Math.PI * 0.48)
      this.root.multiply(fall)
    }
    // 번쩍임 색: 보통 빨강, 치명타 금색. 예고 중이면 살이 붉게 달아오른다 (피할 때라는 신호)
    const f = a.flash
    const w = a.wind
    if (f > 0) this.col.setRGB(1 + f * 1.6, 1 + f * (a.crit ? 1.2 : -0.4), 1 + f * (a.crit ? -0.4 : -0.5))
    else if (w > 0) this.col.setRGB(1 + w * 0.9 + (kind === 2 ? sin(w * 30) * 0.5 * w : 0), 1 - w * 0.35, 1 - w * 0.4)
    else this.col.setRGB(1, 1, 1)
    for (const p of this.kinds[kind]) {
      this.o.position.set(0, 0, 0)
      this.o.rotation.set(0, 0, 0)
      this.o.scale.setScalar(1)
      p.pose(a, this.o)
      this.o.updateMatrix()
      this.tmp.multiplyMatrices(this.root, this.o.matrix)
      p.mesh.setMatrixAt(i, this.tmp)
      if (p.flashes) p.mesh.setColorAt(i, this.col)
    }
  }

  dispose(): void {
    for (const parts of this.kinds) {
      for (const p of parts) {
        p.mesh.geometry.dispose()
        ;(p.mesh.material as THREE.Material).dispose()
        p.mesh.dispose()
      }
    }
  }
}
