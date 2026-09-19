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
import { BakedModel, MODEL_SPECS, loadMonsterModel } from './monsterModels'

/** 실사 모델 한 종류: 부품(재질)마다 InstancedMesh + 프레임 고르기용 배열 */
interface ModelKind {
  baked: BakedModel
  meshes: InstancedMesh[]
  dummy: { morphTargetInfluences: Float32Array }
}

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
  /** 정예 (크게 · 금빛으로 달아오른다) */
  elite?: boolean
  /** 우두머리 (더 크게) */
  unique?: boolean
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
  /** 날아가는 속도 (쏜 쪽 반대로 — 손맛) */
  vx: number
  vz: number
  /** 정예·우두머리였나 (시체도 큰 몸 그대로) */
  elite?: boolean
  unique?: boolean
}

interface MVis extends Anim {
  seen: number
  /** 맞아서 밀린 만큼 (그림만 — sim 위치와 따로, 곧 돌아온다) */
  kx: number
  kz: number
}

const CAP = 220
/** 네 발 짐승 (쓰러지면 옆으로 눕는다): 늑대 · 독거미 · 거미 여왕 — MONSTER_LIST 번호 */
const QUADRUPEDS = new Set([5, 6, 8])
const SPIDER_KIND = 6
/** 옆으로 눕거나 뒤집힐 때 들어 올리는 높이 (크기 1 기준 타일) */
const FALL_LIFT: Record<number, number> = { 5: 0.13, 6: 0.22, 8: 0.45 }
/** 시체가 바닥에 남는 시간 (초) — 디아블로 2 처럼 싸운 자리에 시체가 쌓인다. 끝 1초 동안 가라앉는다 */
const CORPSE_LIFE = 24
const CORPSE_MAX = 90
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

/** 구울: 굽은 등, 긴 팔을 늘어뜨리고, 예고 때 두 팔을 치켜든다. 도살자(보스)는 같은 뼈대에 붉은 살 · 붉은 눈 · 앞치마 */
function ghoulParts(skinColor = 0x7d8479, eyeColor = 0xd6ff5c, darkColor = 0x3d3a36): Part[] {
  // 창백한 회녹색 살 — 등불(따뜻한 빛) 아래에서 노랗게 뜨지 않도록 채도를 낮춘다
  const skin = lambert(skinColor)
  const dark = lambert(darkColor)
  const eye = glow(eyeColor)
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

/** 도살자: 구울 뼈대를 키우고 붉은 살 · 핏빛 눈 · 가죽 앞치마 · 큰 식칼 */
function butcherParts(): Part[] {
  const parts = ghoulParts(0x8a5a50, 0xff2a1a, 0x2a1a14)
  const leather = lambert(0x4a3020)
  const steel = lambert(0x9aa0a6)
  parts.push(
    part(new THREE.SphereGeometry(0.5, 10, 8), leather, false, (a, o) => {
      o.position.set(0, 0.42, 0.12)
      o.rotation.set(0.5, 0, 0)
      o.scale.set(0.34, 0.3, 0.2)
      void a
    }),
    // 식칼: 오른팔 끝의 넓적한 날 — 휘두를 때 팔과 함께 돈다
    part(new THREE.BoxGeometry(0.06, 0.42, 0.28), steel, true, (a, o) => {
      const rx = 1.0 - a.wind * 2.3 + a.swing * 1.6
      o.position.set(0.3, 0.6, 0.1)
      o.rotation.set(rx, 0, 0.15)
      o.translateY(-0.62)
      o.scale.setScalar(1)
    }),
  )
  return parts
}

/** 보물 고블린: 작고 구부정한 초록 몸 · 등에 불룩한 금 자루 (반짝) · 큰 귀 */
function goblinParts(): Part[] {
  const skin = lambert(0x6a8a4a)
  const sack = lambert(0xc89a3a)
  const gold = glow(0xffd84a)
  const eye = glow(0xffe05c)
  return [
    part(new THREE.SphereGeometry(0.5, 10, 8), skin, true, (a, o) => {
      o.position.set(0, 0.42 + Math.abs(sin(a.walk)) * 0.06 * a.move, 0.04)
      o.rotation.set(0.5, 0, sin(a.walk) * 0.12 * a.move)
      o.scale.set(0.3, 0.34, 0.28)
    }),
    part(new THREE.SphereGeometry(0.5, 10, 8), skin, true, (a, o) => {
      o.position.set(0, 0.66 + a.wind * 0, 0.2)
      o.rotation.set(0.2, 0, 0)
      o.scale.set(0.3, 0.26, 0.3)
    }),
    part(mergeGeometries([new THREE.ConeGeometry(0.06, 0.3, 5).rotateZ(1.2).translate(-0.2, 0, 0), new THREE.ConeGeometry(0.06, 0.3, 5).rotateZ(-1.2).translate(0.2, 0, 0)])!, skin, true, (a, o) => {
      o.position.set(0, 0.72, 0.2)
      o.scale.setScalar(1)
      void a
    }),
    part(mergeGeometries([new THREE.SphereGeometry(0.03, 6, 5).translate(-0.06, 0, 0), new THREE.SphereGeometry(0.03, 6, 5).translate(0.06, 0, 0)])!, eye, false, (a, o) => {
      o.position.set(0, 0.7, 0.34)
      o.scale.setScalar(1)
      void a
    }, false),
    // 금 자루: 등 뒤에서 흔들린다
    part(new THREE.SphereGeometry(0.5, 12, 10), sack, true, (a, o) => {
      o.position.set(0, 0.62 + sin(a.walk * 2) * 0.03 * a.move, -0.22)
      o.rotation.set(0, 0, sin(a.walk) * 0.2 * a.move)
      o.scale.set(0.34, 0.38, 0.3)
    }),
    part(new THREE.SphereGeometry(0.05, 6, 5), gold, false, (a, o) => {
      o.position.set(0.08, 0.95, -0.2)
      o.scale.setScalar(1 + sin(a.walk * 3) * 0.3)
    }, false),
    ...[-1, 1].map((side) =>
      part(cap(0.05, 0.16), skin, false, (a, o) => {
        o.position.set(side * 0.1, 0.16, 0)
        o.rotation.set(sin(a.walk + (side > 0 ? 0 : Math.PI)) * 0.9 * a.move, 0, 0)
        o.scale.setScalar(1)
      }),
    ),
  ]
}

/** 늑대: 낮고 긴 몸 · 뾰족한 주둥이 · 네 다리 · 붉은 눈. 예고 때 몸을 낮췄다가 덤빈다 */
function wolfParts(): Part[] {
  const fur = lambert(0x7a7266)
  const dark = lambert(0x3e3a34)
  const eye = glow(0xff4a2a)
  const leg = cap(0.05, 0.22)
  const legs: [number, number][] = [[-0.12, 0.2], [0.12, 0.2], [-0.12, -0.2], [0.12, -0.2]]
  return [
    part(cap(0.18, 0.5).rotateX(Math.PI / 2), fur, true, (a, o) => {
      o.position.set(0, 0.34 - a.wind * 0.08 + Math.abs(sin(a.walk * 2)) * 0.03 * a.move, a.swing * 0.12)
      o.rotation.set(-a.wind * 0.15, 0, 0)
      o.scale.set(1, 1 - a.squash * 0.3, 1)
    }),
    part(new THREE.SphereGeometry(0.16, 10, 8), fur, true, (a, o) => {
      o.position.set(0, 0.42 - a.wind * 0.1, 0.42 + a.swing * 0.15)
      o.scale.set(1, 0.9, 1.1)
    }),
    part(new THREE.ConeGeometry(0.08, 0.22, 6).rotateX(Math.PI / 2), dark, false, (a, o) => {
      o.position.set(0, 0.38 - a.wind * 0.1, 0.6 + a.swing * 0.15)
      o.scale.setScalar(1)
    }),
    part(mergeGeometries([new THREE.ConeGeometry(0.05, 0.12, 4).translate(-0.08, 0, 0), new THREE.ConeGeometry(0.05, 0.12, 4).translate(0.08, 0, 0)])!, fur, false, (a, o) => {
      o.position.set(0, 0.58 - a.wind * 0.1, 0.4 + a.swing * 0.15)
      o.scale.setScalar(1)
    }),
    part(mergeGeometries([new THREE.SphereGeometry(0.025, 6, 5).translate(-0.06, 0, 0), new THREE.SphereGeometry(0.025, 6, 5).translate(0.06, 0, 0)])!, eye, false, (a, o) => {
      o.position.set(0, 0.47 - a.wind * 0.1, 0.55 + a.swing * 0.15)
      o.scale.setScalar(1 + a.wind * 0.6)
    }, false),
    part(cap(0.04, 0.3).rotateX(-0.9), fur, false, (a, o) => {
      o.position.set(0, 0.4, -0.45)
      o.rotation.set(0, sin(a.walk * 2) * 0.4 * a.move, 0)
      o.scale.setScalar(1)
    }),
    ...legs.map(([lx, lz], k) =>
      part(leg, dark, false, (a, o) => {
        o.position.set(lx, 0.15, lz)
        o.rotation.set(sin(a.walk * 2 + (k % 2 === 0 ? 0 : Math.PI) + (k < 2 ? 0 : Math.PI / 2)) * 0.7 * a.move, 0, 0)
        o.scale.setScalar(1)
      }),
    ),
  ]
}

/** 독거미 · 거미 여왕: 둥근 배 · 작은 머리 · 다리 여덟(한쪽 넷씩) · 붉은 눈 여럿. 여왕은 보랏빛 배에 흰 무늬 */
function spiderParts(queen = false): Part[] {
  const body = lambert(queen ? 0x6a3a76 : 0x4e4238)
  const mark = lambert(queen ? 0xe8e0f0 : 0xb03a2a)
  const leg = lambert(0x3a322c)
  const eye = glow(0xff2a2a)
  const legGeo = (side: number) =>
    mergeGeometries([0, 1, 2, 3].map((k) => cap(0.025, 0.42).rotateZ(side * 1.0).rotateY(side * (0.9 - k * 0.55)).translate(side * 0.22, 0.18, 0.18 - k * 0.12)))!
  return [
    part(new THREE.SphereGeometry(0.34, 12, 10), body, true, (a, o) => {
      o.position.set(0, 0.3 + Math.abs(sin(a.walk * 3)) * 0.02 * a.move, -0.2)
      o.scale.set(1 + a.squash * 0.2 + a.wind * 0.1, 0.85, 1.1)
    }),
    part(new THREE.SphereGeometry(0.12, 8, 6).scale(1.3, 0.4, 1), mark, false, (a, o) => {
      o.position.set(0, 0.56, -0.24)
      o.scale.setScalar(1 + a.wind * 0.1)
    }, false),
    part(new THREE.SphereGeometry(0.16, 10, 8), body, true, (a, o) => {
      o.position.set(0, 0.26, 0.16 + a.swing * 0.08)
      o.scale.set(1, 0.8, 1)
    }),
    part(mergeGeometries([-0.06, -0.02, 0.02, 0.06].map((x) => new THREE.SphereGeometry(0.02, 5, 4).translate(x, Math.abs(x) * 0.4, 0)))!, eye, false, (a, o) => {
      o.position.set(0, 0.32, 0.3 + a.swing * 0.08)
      o.scale.setScalar(1 + a.wind * 0.8)
    }, false),
    ...[-1, 1].map((side) =>
      part(legGeo(side), leg, false, (a, o) => {
        o.position.set(0, 0, 0)
        o.rotation.set(sin(a.walk * 3 + (side > 0 ? 0 : Math.PI)) * 0.2 * a.move, sin(a.walk * 3) * 0.15 * a.move, 0)
        o.scale.setScalar(1)
      }),
    ),
  ]
}

/** 버섯 주술사: 굽은 누더기 몸 · 머리 위 커다란 빛나는 버섯 갓 · 지팡이. 고칠 때 갓이 부풀어 빛난다 */
function shamanParts(): Part[] {
  const robe = lambert(0x6a5a40)
  const skin = lambert(0x9aae78)
  const cap0 = glow(0x9ad8a0)
  const staff = lambert(0x3a2a1a)
  return [
    part(new THREE.ConeGeometry(0.34, 0.9, 10), robe, true, (a, o) => {
      o.position.set(0, 0.45, 0)
      o.rotation.set(0.15, 0, sin(a.walk) * 0.05 * a.move)
      o.scale.set(1 + a.squash * 0.2, 1 - a.squash * 0.2, 1)
    }),
    part(new THREE.SphereGeometry(0.16, 10, 8), skin, true, (_a, o) => {
      o.position.set(0, 0.92, 0.1)
      o.scale.setScalar(1)
    }),
    part(new THREE.SphereGeometry(0.34, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1), cap0, false, (a, o) => {
      o.position.set(0, 1.04, 0.06)
      o.scale.setScalar(1 + a.wind * 0.35)
    }, false),
    part(cap(0.03, 1.1), staff, false, (a, o) => {
      o.position.set(0.28, 0.6, 0.12)
      o.rotation.set(0.1 - a.wind * 0.4, 0, -0.1)
      o.scale.setScalar(1)
    }),
  ]
}

/** 방패병: 녹슨 갑옷 · 투구의 빛나는 눈 틈 · 앞을 가리는 큰 방패. 예고 때 방패를 밀어 친다 */
function shieldParts(): Part[] {
  const iron = lambert(0x6a6a70)
  const dark = lambert(0x3a3a40)
  const wood = lambert(0x6a4a2a)
  const eye = glow(0xffb84a)
  return [
    part(new THREE.CylinderGeometry(0.26, 0.3, 0.62, 10), iron, true, (a, o) => {
      o.position.set(0, 0.62 + Math.abs(sin(a.walk)) * 0.03 * a.move, 0)
      o.rotation.set(0.08 + a.wind * 0.1, 0, sin(a.walk) * 0.05 * a.move)
      o.scale.set(1 + a.squash * 0.2, 1 - a.squash * 0.2, 1)
    }),
    part(new THREE.CylinderGeometry(0.17, 0.2, 0.3, 10), dark, true, (_a, o) => {
      o.position.set(0, 1.08, 0.02)
      o.rotation.set(0.05, 0, 0)
      o.scale.setScalar(1)
    }),
    part(new THREE.BoxGeometry(0.22, 0.03, 0.02), eye, false, (_a, o) => {
      o.position.set(0, 1.1, 0.2)
      o.scale.setScalar(1)
    }, false),
    // 방패 (몸 앞) — 겉은 나무, 테두리는 쇠
    part(mergeGeometries([new THREE.BoxGeometry(0.66, 0.86, 0.06), new THREE.BoxGeometry(0.72, 0.08, 0.08).translate(0, 0.41, 0), new THREE.BoxGeometry(0.72, 0.08, 0.08).translate(0, -0.41, 0)])!, wood, true, (a, o) => {
      o.position.set(0.04, 0.62 - a.wind * 0.05, 0.36 + a.swing * 0.22 - a.wind * 0.06)
      o.rotation.set(-0.05 - a.swing * 0.2, 0, 0)
      o.scale.setScalar(1)
    }),
    part(new THREE.CylinderGeometry(0.08, 0.08, 0.04, 10).rotateX(Math.PI / 2), iron, false, (a, o) => {
      o.position.set(0.04, 0.64 - a.wind * 0.05, 0.41 + a.swing * 0.22 - a.wind * 0.06)
      o.scale.setScalar(1)
    }),
    ...[-1, 1].map((side) =>
      part(cap(0.07, 0.24), dark, false, (a, o) => {
        o.position.set(side * 0.13, 0.2, 0)
        o.rotation.set(sin(a.walk + (side > 0 ? 0 : Math.PI)) * 0.5 * a.move, 0, 0)
        o.scale.setScalar(1)
      }),
    ),
  ]
}

/** 강령술사: 긴 보랏빛 두건 옷 · 어둠 속 보랏빛 눈 · 해골 구슬이 달린 지팡이. 일으킬 때 지팡이를 치켜든다 */
function necroParts(): Part[] {
  const robe = lambert(0x3a2a44)
  const trim = lambert(0x6a5a3a)
  const bone = lambert(0xd8d0bc)
  const eye = glow(0xc08aff)
  const orb = glow(0xb07aff)
  return [
    part(new THREE.ConeGeometry(0.32, 1.1, 10), robe, true, (a, o) => {
      o.position.set(0, 0.55, 0)
      o.rotation.set(0.04, 0, sin(a.walk) * 0.04 * a.move)
      o.scale.set(1 + a.squash * 0.2, 1 - a.squash * 0.15, 1)
    }),
    part(new THREE.TorusGeometry(0.2, 0.03, 4, 16).rotateX(Math.PI / 2), trim, false, (_a, o) => {
      o.position.set(0, 0.62, 0)
      o.scale.setScalar(1)
    }),
    part(new THREE.SphereGeometry(0.19, 10, 8), robe, true, (a, o) => {
      o.position.set(0, 1.18, 0.02)
      o.rotation.set(0.2 - a.wind * 0.3, 0, 0)
      o.scale.set(1, 1.15, 1)
    }),
    part(mergeGeometries([new THREE.SphereGeometry(0.03, 6, 5).translate(-0.06, 0, 0), new THREE.SphereGeometry(0.03, 6, 5).translate(0.06, 0, 0)])!, eye, false, (a, o) => {
      o.position.set(0, 1.16, 0.17)
      o.scale.setScalar(1 + a.wind * 0.8)
    }, false),
    part(cap(0.025, 1.3), trim, false, (a, o) => {
      o.position.set(0.3, 0.75 + a.wind * 0.25, 0.1)
      o.rotation.set(-a.wind * 0.3, 0, -0.08)
      o.scale.setScalar(1)
    }),
    part(new THREE.SphereGeometry(0.09, 8, 6), bone, false, (a, o) => {
      o.position.set(0.3, 1.45 + a.wind * 0.3, 0.1 - a.wind * 0.1)
      o.scale.setScalar(1)
    }),
    part(new THREE.SphereGeometry(0.13, 10, 8), orb, false, (a, o) => {
      o.position.set(0.3, 1.45 + a.wind * 0.3, 0.1 - a.wind * 0.1)
      o.scale.setScalar(0.6 + a.wind * 0.9)
    }, false),
  ]
}

/** 산성 토사꾼: 굽은 부은 몸 · 목의 빛나는 산 주머니(예고 동안 부푼다) · 짧은 다리 */
function spitterParts(): Part[] {
  const skin = lambert(0x7a8458)
  const dark = lambert(0x3e4430)
  const sac = glow(0x9aff3a)
  const eye = glow(0xffe05c)
  return [
    part(new THREE.SphereGeometry(0.5, 12, 10), skin, true, (a, o) => {
      o.position.set(0, 0.5 + Math.abs(sin(a.walk)) * 0.03 * a.move, -0.04)
      o.rotation.set(0.35 - a.wind * 0.2 + a.swing * 0.4, 0, sin(a.walk) * 0.06 * a.move)
      o.scale.set(0.42 * (1 + a.squash * 0.3), 0.44 * (1 - a.squash * 0.3), 0.4)
    }),
    part(new THREE.SphereGeometry(0.5, 10, 8), skin, true, (a, o) => {
      o.position.set(0, 0.8 - a.wind * 0.06, 0.2 + a.swing * 0.1)
      o.rotation.set(0.2 - a.wind * 0.5, 0, 0)
      o.scale.set(0.28, 0.24, 0.3)
    }),
    part(new THREE.SphereGeometry(0.5, 10, 8), sac, false, (a, o) => {
      o.position.set(0, 0.64 - a.wind * 0.04, 0.3 + a.swing * 0.1)
      o.scale.setScalar(0.16 + a.wind * 0.14)
    }, false),
    part(mergeGeometries([new THREE.SphereGeometry(0.03, 6, 5).translate(-0.07, 0, 0), new THREE.SphereGeometry(0.03, 6, 5).translate(0.07, 0, 0)])!, eye, false, (a, o) => {
      o.position.set(0, 0.84 - a.wind * 0.06, 0.34 + a.swing * 0.1)
      o.scale.setScalar(1)
    }, false),
    ...[-1, 1].map((side) =>
      part(cap(0.08, 0.18), dark, false, (a, o) => {
        o.position.set(side * 0.16, 0.16, -0.02)
        o.rotation.set(sin(a.walk + (side > 0 ? 0 : Math.PI)) * 0.5 * a.move, 0, 0)
        o.scale.setScalar(1)
      }),
    ),
  ]
}

/** 관리인(보스): 검은 쇠 갑옷 거인 · 빛나는 눈 틈 · 오른손 쇠곤봉 · 왼손 등불. 내려찍기 예고 때 곤봉을 머리 위로 */
function wardenParts(): Part[] {
  const iron = lambert(0x4a4448)
  const rust = lambert(0x6a4a34)
  const dark = lambert(0x2a2628)
  const eye = glow(0xff7a2a)
  const lamp = glow(0xffd070)
  return [
    part(new THREE.SphereGeometry(0.5, 12, 10), iron, true, (a, o) => {
      o.position.set(0, 0.62 + Math.abs(sin(a.walk)) * 0.03 * a.move, 0)
      o.rotation.set(0.12 - a.wind * 0.15 + a.swing * 0.3, 0, sin(a.walk) * 0.05 * a.move)
      o.scale.set(0.44 * (1 + a.squash * 0.2), 0.46 * (1 - a.squash * 0.2), 0.36)
    }),
    part(new THREE.CylinderGeometry(0.15, 0.17, 0.26, 10), dark, true, (a, o) => {
      o.position.set(0, 1.02 - a.wind * 0.03, 0.04)
      o.rotation.set(-a.wind * 0.2, 0, 0)
      o.scale.setScalar(1)
    }),
    part(new THREE.BoxGeometry(0.2, 0.03, 0.02), eye, false, (a, o) => {
      o.position.set(0, 1.04 - a.wind * 0.03, 0.2)
      o.scale.setScalar(1 + a.wind * 0.4)
    }, false),
    // 어깨 판
    part(mergeGeometries([new THREE.SphereGeometry(0.14, 8, 6).translate(-0.3, 0, 0), new THREE.SphereGeometry(0.14, 8, 6).translate(0.3, 0, 0)])!, rust, false, (a, o) => {
      o.position.set(0, 0.86 + a.swing * 0.04, 0)
      o.scale.set(1, 0.7, 1)
    }),
    // 쇠곤봉 (오른손) — 예고 때 뒤로 치켜들고, 휘두르면 앞으로 내리친다
    part(mergeGeometries([cap(0.04, 0.5).translate(0, -0.2, 0), new THREE.CylinderGeometry(0.1, 0.1, 0.26, 8).translate(0, 0.14, 0)])!, rust, true, (a, o) => {
      o.position.set(0.34, 0.86, 0.1)
      o.rotation.set(0.9 - a.wind * 2.5 + a.swing * 2.2, 0, -0.2)
      o.scale.setScalar(1)
      o.translateY(0.3)
    }),
    // 등불 (왼손)
    part(new THREE.SphereGeometry(0.08, 8, 6), lamp, false, (a, o) => {
      o.position.set(-0.36, 0.52 + sin(a.walk) * 0.03 * a.move, 0.16)
      o.scale.setScalar(1 + sin(a.walk * 0.5) * 0.05)
    }, false),
    ...[-1, 1].map((side) =>
      part(cap(0.09, 0.26), dark, false, (a, o) => {
        o.position.set(side * 0.16, 0.22, 0)
        o.rotation.set(sin(a.walk + (side > 0 ? 0 : Math.PI)) * 0.45 * a.move, 0, 0)
        o.scale.setScalar(1)
      }),
    ),
  ]
}

/** 그림자: 떠다니는 검보랏빛 두건 망령 · 보랏빛 눈 · 긴 발톱 팔. 순간이동 예고 때 오그라들며 흐려진다 */
function shadeParts(): Part[] {
  const cloak = new THREE.MeshLambertMaterial({ color: 0x2a1e34, transparent: true, opacity: 0.88 })
  const claw = lambert(0x4a3a56)
  const eye = glow(0xd89aff)
  const fade = (a: Anim) => 1 - a.wind * 0.75
  return [
    part(new THREE.ConeGeometry(0.34, 1.0, 10, 1, true), cloak, true, (a, o) => {
      o.position.set(0, 0.62 + sin(a.walk * 0.7) * 0.05, 0)
      o.rotation.set(0.15 + a.swing * 0.3, 0, sin(a.walk) * 0.06 * a.move)
      o.scale.setScalar(fade(a))
    }),
    part(new THREE.SphereGeometry(0.2, 10, 8), cloak, true, (a, o) => {
      o.position.set(0, 1.12 + sin(a.walk * 0.7) * 0.05, 0.06 + a.swing * 0.1)
      o.scale.set(fade(a), fade(a) * 1.1, fade(a))
    }),
    part(mergeGeometries([new THREE.SphereGeometry(0.03, 6, 5).translate(-0.06, 0, 0), new THREE.SphereGeometry(0.03, 6, 5).translate(0.06, 0, 0)])!, eye, false, (a, o) => {
      o.position.set(0, 1.12 + sin(a.walk * 0.7) * 0.05, 0.22 + a.swing * 0.1)
      o.scale.setScalar(fade(a) * (1 + a.wind))
    }, false),
    ...[-1, 1].map((side) =>
      part(cap(0.04, 0.5), claw, true, (a, o) => {
        o.position.set(side * 0.26, 0.86, 0.08)
        o.rotation.set(1.1 + a.swing * 1.4 - a.wind * 0.6, 0, side * 0.25)
        o.scale.setScalar(fade(a))
        o.translateY(-0.25)
      }),
    ),
  ]
}

/** 포격 악마: 붉은 거구 · 굽은 뿔 · 빛나는 입 · 오른팔의 굵은 포신. 쏠 때 포신이 튄다 */
function demonParts(): Part[] {
  const skin = lambert(0x8a3222)
  const horn = lambert(0xd8c8a8)
  const iron = lambert(0x3a3432)
  const mouth = glow(0xffa040)
  return [
    part(new THREE.SphereGeometry(0.5, 12, 10), skin, true, (a, o) => {
      o.position.set(0, 0.64 + Math.abs(sin(a.walk)) * 0.03 * a.move, 0)
      o.rotation.set(0.12 - a.wind * 0.1 + a.swing * 0.2, 0, sin(a.walk) * 0.05 * a.move)
      o.scale.set(0.46 * (1 + a.squash * 0.2), 0.5 * (1 - a.squash * 0.2), 0.4)
    }),
    part(new THREE.SphereGeometry(0.5, 10, 8), skin, true, (_a, o) => {
      o.position.set(0, 1.04, 0.1)
      o.scale.set(0.3, 0.28, 0.3)
    }),
    part(mergeGeometries([new THREE.ConeGeometry(0.05, 0.28, 6).rotateZ(0.5).translate(-0.14, 0.12, 0), new THREE.ConeGeometry(0.05, 0.28, 6).rotateZ(-0.5).translate(0.14, 0.12, 0)])!, horn, false, (_a, o) => {
      o.position.set(0, 1.12, 0.06)
      o.scale.setScalar(1)
    }),
    part(new THREE.BoxGeometry(0.14, 0.04, 0.02), mouth, false, (a, o) => {
      o.position.set(0, 0.98, 0.25)
      o.scale.set(1, 1 + a.wind * 2, 1)
    }, false),
    // 포신 (오른팔): 예고 때 들어 올리고, 쏘면 뒤로 튄다
    part(new THREE.CylinderGeometry(0.1, 0.12, 0.62, 10).rotateX(Math.PI / 2), iron, true, (a, o) => {
      o.position.set(0.34, 0.74 + a.wind * 0.1, 0.22 - a.swing * 0.14)
      o.rotation.set(-a.wind * 0.5, 0, 0)
      o.scale.setScalar(1)
    }),
    part(new THREE.SphereGeometry(0.07, 8, 6), mouth, false, (a, o) => {
      o.position.set(0.34, 0.74 + a.wind * 0.25, 0.54 - a.swing * 0.14)
      o.scale.setScalar(0.5 + a.wind * 1.2)
    }, false),
    ...[-1, 1].map((side) =>
      part(cap(0.09, 0.24), iron, false, (a, o) => {
        o.position.set(side * 0.16, 0.2, 0)
        o.rotation.set(sin(a.walk + (side > 0 ? 0 : Math.PI)) * 0.45 * a.move, 0, 0)
        o.scale.setScalar(1)
      }),
    ),
  ]
}

/** 심연의 군주(최종 보스): 검붉은 갑주 거인 · 뼈 뿔 왕관 · 붉게 갈라진 띠 · 등 뒤 거대한 날개 · 두 발톱 팔 */
function lordParts(): Part[] {
  const armor = lambert(0x6a2e34)
  const bone = lambert(0xd8ccb0)
  const crack = glow(0xff5a2a)
  const eye = glow(0xffd24a)
  const wing = new THREE.MeshLambertMaterial({ color: 0x7a2a30, side: THREE.DoubleSide })
  const wingGeo = new THREE.BufferGeometry()
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.9, 0.5, 0, 0.8, -0.35, 0, 0, 0, 0, 0.8, -0.35, 0, 0.35, -0.5, 0], 3))
  wingGeo.computeVertexNormals()
  return [
    part(new THREE.SphereGeometry(0.5, 12, 10), armor, true, (a, o) => {
      o.position.set(0, 0.7 + Math.abs(sin(a.walk)) * 0.03 * a.move, 0)
      o.rotation.set(0.1 - a.wind * 0.12 + a.swing * 0.25, 0, sin(a.walk) * 0.04 * a.move)
      o.scale.set(0.42 * (1 + a.squash * 0.2), 0.55 * (1 - a.squash * 0.2), 0.34)
    }),
    part(new THREE.TorusGeometry(0.34, 0.035, 5, 20).rotateX(Math.PI / 2), crack, false, (a, o) => {
      o.position.set(0, 0.62, 0)
      o.scale.setScalar(1 + a.wind * 0.12)
    }, false),
    part(new THREE.SphereGeometry(0.5, 10, 8), armor, true, (a, o) => {
      o.position.set(0, 1.14 - a.wind * 0.03, 0.05)
      o.rotation.set(-a.wind * 0.2, 0, 0)
      o.scale.set(0.26, 0.28, 0.27)
    }),
    part(mergeGeometries([-0.12, -0.04, 0.04, 0.12].map((x) => new THREE.ConeGeometry(0.035, 0.26 - Math.abs(x) * 0.5, 5).translate(x, 0.12, 0)))!, bone, false, (a, o) => {
      o.position.set(0, 1.24 - a.wind * 0.03, 0.03)
      o.scale.setScalar(1)
    }),
    part(mergeGeometries([new THREE.SphereGeometry(0.03, 6, 5).translate(-0.06, 0, 0), new THREE.SphereGeometry(0.03, 6, 5).translate(0.06, 0, 0)])!, eye, false, (a, o) => {
      o.position.set(0, 1.15 - a.wind * 0.03, 0.18)
      o.scale.setScalar(1 + a.wind * 0.6)
    }, false),
    // 날개 (좌·우): 예고 때 크게 편다
    ...[-1, 1].map((side) =>
      part(wingGeo, wing, false, (a, o) => {
        o.position.set(side * 0.18, 1.0, -0.2)
        o.rotation.set(0.2, side * (0.9 - a.wind * 0.5) + (side > 0 ? 0 : Math.PI), sin(a.walk * 0.5) * 0.1)
        o.scale.setScalar(1.1 + a.wind * 0.3)
      }),
    ),
    ...[-1, 1].map((side) =>
      part(cap(0.07, 0.52), armor, true, (a, o) => {
        o.position.set(side * 0.34, 0.92, 0.08)
        o.rotation.set(0.9 - a.wind * 1.8 + a.swing * 1.8, 0, side * 0.2)
        o.scale.setScalar(1)
        o.translateY(-0.28)
      }),
    ),
    ...[-1, 1].map((side) =>
      part(cap(0.09, 0.28), armor, false, (a, o) => {
        o.position.set(side * 0.16, 0.22, 0)
        o.rotation.set(sin(a.walk + (side > 0 ? 0 : Math.PI)) * 0.4 * a.move, 0, 0)
        o.scale.setScalar(1)
      }),
    ),
  ]
}

/** 부품 목록: MONSTER_LIST 순서 */
const BUILDERS = [
  () => ghoulParts(), archerParts, bloaterParts, butcherParts, goblinParts,
  wolfParts, () => spiderParts(), shamanParts, () => spiderParts(true),
  shieldParts, necroParts, spitterParts, wardenParts,
  shadeParts, demonParts, lordParts,
]

/** 머리 위 체력 바를 띄울 높이 (타일 단위) */
export const MONSTER_TOP = [1.05, 1.45, 1.4, 1.05, 1.1, 0.8, 0.8, 1.45, 0.8, 1.3, 1.6, 1.05, 1.25, 1.3, 1.3, 1.4]

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
  /** 실사 모델 (종류 번호 → 받는 중 · 실패 · 준비됨). 2026-09-19 */
  private models: (ModelKind | 'loading' | 'failed' | undefined)[] = []
  private mcounts: number[] = []
  /** 실사 괴물을 쓸지 (Esc 메뉴 — 끄면 도형 괴물) */
  private real = true
  private clock = 0
  private local = new THREE.Matrix4()

  constructor() {
    this.kinds = BUILDERS.map((b) => b())
    for (const parts of this.kinds) for (const p of parts) this.group.add(p.mesh)
    this.mcounts = this.kinds.map(() => 0)
  }

  /** 실사 괴물 켜기/끄기. 끄면 받은 모델은 두고 도형 괴물로 그린다 */
  setReal(on: boolean): void {
    this.real = on
  }

  /** 실사 모델 상태 (확인용 — __bd.models()) */
  modelStatus(): { ready: number[]; loading: number[]; failed: number[] } {
    const r: { ready: number[]; loading: number[]; failed: number[] } = { ready: [], loading: [], failed: [] }
    this.models.forEach((m, k) => {
      if (m === 'loading') r.loading.push(k)
      else if (m === 'failed') r.failed.push(k)
      else if (m) r.ready.push(k)
    })
    return r
  }

  /** 이 종류를 처음 만나면 모델을 받아 굽는다 (그동안은 도형 괴물) */
  private want(kind: number): void {
    if (!this.real || this.models[kind] || !MODEL_SPECS[kind]) return
    this.models[kind] = 'loading'
    loadMonsterModel(kind)
      .then((baked) => {
        if (!baked) {
          this.models[kind] = 'failed'
          return
        }
        const meshes = baked.parts.map((p) => {
          const mesh = new THREE.InstancedMesh(p.geo, p.mat, CAP) as InstancedMesh
          mesh.frustumCulled = false
          mesh.castShadow = true
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
          const white = new THREE.Color(1, 1, 1)
          for (let i = 0; i < CAP; i++) mesh.setColorAt(i, white)
          // 프레임 텍스처는 첫 setMorphAt 때의 count(= CAP) 로 만들어진다 — count 를 줄이기 전에 부른다
          const init = new Float32Array(baked.frames)
          init[0] = 1
          mesh.setMorphAt(0, { morphTargetInfluences: init } as unknown as THREE.Mesh)
          mesh.count = 0
          this.group.add(mesh)
          return mesh
        })
        this.models[kind] = { baked, meshes, dummy: { morphTargetInfluences: new Float32Array(baked.frames) } }
      })
      .catch((err) => {
        console.warn('실사 괴물 모델을 받지 못했다 — 도형 괴물로 그린다', kind, err)
        this.models[kind] = 'failed'
      })
  }

  /** 맞음: 번쩍 + 움찔 */
  /**
   * 맞음 (2026-09-19 손맛): 번쩍 · 찌그러짐에 더해 **쏜 방향으로 밀려났다 돌아온다**. dx·dz = 쏜 방향(단위 벡터, 그림 좌표).
   */
  hit(id: number, crit: boolean, dx = 0, dz = 0): void {
    const v = this.vis.get(id)
    if (!v) return
    v.flash = 1
    v.crit = crit
    v.squashV += crit ? 7 : 4
    const push = crit ? 0.3 : 0.14
    v.kx += dx * push
    v.kz += dz * push
    const k = Math.hypot(v.kx, v.kz)
    if (k > 0.5) {
      v.kx *= 0.5 / k
      v.kz *= 0.5 / k
    }
  }

  /** 등급: 0 졸개 · 1 정예 · 2 우두머리 (죽기 전의 모습 — 쓰러짐 연출의 크기) */
  rank(id: number): number {
    const v = this.vis.get(id)
    return v?.unique ? 2 : v?.elite ? 1 : 0
  }

  /** 쓰러짐: 쏜 쪽 반대로 날아가며 뒤로 넘어지고, 한동안 누워 있다가 가라앉는다. dx·dz = 쏜 방향 · power = 세기 */
  died(m: { m: number; kind: number; x: number; y: number }, dx = 0, dz = 0, power = 0): void {
    const v = this.vis.get(m.m)
    const s = this.shown.get(m.m)
    // 쏜 사람을 바라보게 두면 "뒤로" 넘어지는 쪽이 곧 쏜 쪽 반대다
    const yaw = dx !== 0 || dz !== 0 ? Math.atan2(-dz, -dx) : v ? v.yaw : 0
    this.corpses.push({ kind: m.kind, x: s ? s.x : m.x * U, z: s ? s.z : m.y * U, yaw, t: 0, vx: dx * power, vz: dz * power, elite: v?.elite, unique: v?.unique })
    if (this.corpses.length > CORPSE_MAX) this.corpses.shift()
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
    this.mcounts.fill(0)
    this.clock += dt
    const live = new Set<number>()
    this.shown.clear()
    for (const m of curr.monsters) {
      if (m.hp <= 0) continue
      live.add(m.id)
      let v = this.vis.get(m.id)
      const yawTarget = ((m.aim & 1023) / 1024) * Math.PI * 2
      if (!v) {
        v = { walk: Math.random() * 6, move: 0, wind: 0, swing: 0, flash: 0, crit: false, dead: 0, squash: 0, squashV: 0, yaw: yawTarget, seen: 0, kx: 0, kz: 0 }
        this.vis.set(m.id, v)
      }
      const p = this.prevPos.get(m.id) ?? m
      // 맞아서 밀린 만큼 더해 그린다 (빠르게 돌아온다)
      if (v) {
        const back = Math.exp(-dt * 11)
        v.kx *= back
        v.kz *= back
      }
      const x = (p.x + (m.x - p.x) * alpha) * U + (v?.kx ?? 0)
      const z = (p.y + (m.y - p.y) * alpha) * U + (v?.kz ?? 0)
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
      v.elite = m.elite > 0
      v.unique = (m.elite & 64) !== 0
      this.want(m.kind)
      if (hidden(m)) continue
      this.put(m.kind, counts, x, z, v.yaw, v, 0)
    }
    for (const id of this.vis.keys()) if (!live.has(id)) this.vis.delete(id)
    // 시체: 뒤로 넘어져 한동안 누워 있다가 가라앉는다
    const still: Corpse[] = []
    const dead: Anim = { walk: 0, move: 0, wind: 0, swing: 0, flash: 0, crit: false, dead: 0, squash: 0, squashV: 0, yaw: 0 }
    for (const c of this.corpses) {
      c.t += dt
      if (c.t > CORPSE_LIFE) continue
      // 날아가다 멈춘다
      if (c.vx !== 0 || c.vz !== 0) {
        c.x += c.vx * dt
        c.z += c.vz * dt
        const slow = Math.exp(-dt * 7)
        c.vx *= slow
        c.vz *= slow
        if (Math.abs(c.vx) + Math.abs(c.vz) < 0.01) c.vx = c.vz = 0
      }
      dead.elite = c.elite
      dead.unique = c.unique
      still.push(c)
      dead.dead = Math.min(1, c.t / 0.35)
      dead.flash = Math.max(0, 1 - c.t * 6)
      this.put(c.kind, counts, c.x, c.z, c.yaw, dead, Math.max(0, c.t - (CORPSE_LIFE - 1.5)))
    }
    this.corpses = still
    this.kinds.forEach((parts, k) => {
      for (const p of parts) {
        p.mesh.count = counts[k]
        p.mesh.instanceMatrix.needsUpdate = true
        if (p.flashes && p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true
      }
    })
    this.models.forEach((mk, k) => {
      if (!mk || typeof mk === 'string') return
      const n = this.real ? this.mcounts[k] : 0
      for (const mesh of mk.meshes) {
        mesh.count = n
        if (n === 0) continue
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
        if (mesh.morphTexture) mesh.morphTexture.needsUpdate = true
      }
    })
  }

  private put(kind: number, counts: number[], x: number, z: number, yaw: number, a: Anim, corpseT: number): void {
    const mk = this.real ? this.models[kind] : undefined
    const model = mk && typeof mk !== 'string' ? mk : null
    const i = model ? this.mcounts[kind] : counts[kind]
    if (i >= CAP) return
    if (model) this.mcounts[kind]++
    else counts[kind]++
    const def = MONSTER_LIST[kind]
    const size = (def.r / 13) * (a.unique ? 1.7 : a.elite ? 1.35 : 1) // 구울(13px) 기준 크기 · 정예·우두머리는 더 크게
    // 뿌리: 위치 · 방향 (정면 +z 가 조준 방향이 되도록 — character3d 와 같은 규칙) · 크기 · 시체면 넘어짐·가라앉음
    this.o.position.set(x, -Math.max(0, corpseT - 0.5) * 0.9, z)
    this.o.rotation.set(0, Math.PI / 2 - yaw, 0)
    this.o.scale.setScalar(size)
    this.o.updateMatrix()
    this.root.copy(this.o.matrix)
    if (a.dead > 0) {
      // 사람 모양은 뒤로 넘어진다. 네 발 짐승은 뒤로 넘어가면 꼬리로 서 버렸다(2026-09-19) — 늑대 · 여왕은 옆으로 눕고, 거미는 뒤집힌다
      const fall =
        kind === SPIDER_KIND ? this.tmp.makeRotationZ(a.dead * Math.PI)
        : QUADRUPEDS.has(kind) ? this.tmp.makeRotationZ(a.dead * Math.PI * 0.5)
        : this.tmp.makeRotationX(-a.dead * Math.PI * 0.48)
      // 발을 축으로 돌면 몸이 땅에 묻힌다 → 누운 몸 두께만큼 들어 올린다
      const lift = FALL_LIFT[kind] ?? 0
      if (lift > 0) fall.setPosition(0, lift * a.dead, 0)
      this.root.multiply(fall)
    }
    // 번쩍임 색: 보통 빨강, 치명타 금색. 예고 중이면 살이 붉게 달아오른다 (피할 때라는 신호)
    const f = a.flash
    const w = a.wind
    if (f > 0) this.col.setRGB(1 + f * 1.6, 1 + f * (a.crit ? 1.2 : -0.4), 1 + f * (a.crit ? -0.4 : -0.5))
    else if (w > 0) this.col.setRGB(1 + w * 0.9 + (kind === 2 ? sin(w * 30) * 0.5 * w : 0), 1 - w * 0.35, 1 - w * 0.4)
    else if (a.elite) this.col.setRGB(1.25 + 0.1 * Math.sin(Date.now() / 200), 1.1, 0.75)
    else this.col.setRGB(1, 1, 1)
    if (model) {
      this.putModel(model, i, a)
      return
    }
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

  /**
   * 실사 모델 한 마리: 동작 상태로 프레임 두 장을 골라 섞고, 뿌리에 예고(몸을 뒤로) · 휘두름(앞으로 내밂) · 움찔을 더한다.
   * - 예고 wind 0→1 = 공격 클립의 앞부분(windup), 휘두름 swing 1→0 = 뒷부분 — 판정 틱과 보이는 휘두름이 맞는다.
   * - 걷기는 걸음 위상(walk)으로 — 발이 미끄러지지 않게 이동 속도를 따른다.
   */
  private putModel(mk: ModelKind, i: number, a: Anim): void {
    const b = mk.baked
    const s = b.seg
    let seg = s.idle ?? s.walk!
    let t = 0
    if (a.dead > 0) {
      seg = s.hit ?? s.idle ?? s.walk!
      t = s.hit ? 1 : 0
    } else if (a.wind > 0 && s.attack) {
      seg = s.attack
      t = a.wind * b.windup
    } else if (a.swing > 0 && s.attack) {
      seg = s.attack
      t = b.windup + (1 - a.swing) * (1 - b.windup)
    } else if (a.flash > 0.5 && s.hit) {
      seg = s.hit
      t = 1 - a.flash
    } else if (a.move > 0.35 && s.walk) {
      seg = s.walk
      t = a.walk / (Math.PI * 2)
    } else if (s.idle) {
      seg = s.idle
      t = this.clock * 0.45 + a.walk * 0.13
    } else {
      // 대기 동작이 없는 모델: 걷기 첫 장에 멈춰 선다
      seg = s.walk!
      t = 0
    }
    let fi: number
    let i0: number
    let i1: number
    if (seg.loop) {
      fi = (((t % 1) + 1) % 1) * seg.count
      i0 = Math.floor(fi)
      i1 = (i0 + 1) % seg.count
    } else {
      fi = Math.max(0, Math.min(1, t)) * (seg.count - 1)
      i0 = Math.floor(fi)
      i1 = Math.min(seg.count - 1, i0 + 1)
    }
    const f = fi - i0
    const infl = mk.dummy.morphTargetInfluences
    infl[seg.start + i0] = 1 - f
    infl[seg.start + i1] += f
    // 뿌리: 예고 때 몸을 뒤로 젖히고, 휘두를 때 앞으로 내민다 · 맞으면 움찔(찌그러짐)
    this.o.position.set(0, 0, a.swing * 0.16 - a.wind * 0.05)
    this.o.rotation.set(-a.wind * 0.12 + a.swing * 0.1, 0, 0)
    this.o.scale.set(1 + a.squash * 0.25, 1 - a.squash * 0.25, 1 + a.squash * 0.25)
    this.o.updateMatrix()
    this.local.multiplyMatrices(this.root, this.o.matrix)
    for (const mesh of mk.meshes) {
      mesh.setMatrixAt(i, this.local)
      mesh.setColorAt(i, this.col)
      mesh.setMorphAt(i, mk.dummy as unknown as THREE.Mesh)
    }
    infl[seg.start + i0] = 0
    infl[seg.start + i1] = 0
  }

  dispose(): void {
    for (const mk of this.models) {
      if (!mk || typeof mk === 'string') continue
      for (const mesh of mk.meshes) {
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
        mesh.dispose()
      }
    }
    for (const parts of this.kinds) {
      for (const p of parts) {
        p.mesh.geometry.dispose()
        ;(p.mesh.material as THREE.Material).dispose()
        p.mesh.dispose()
      }
    }
  }
}
