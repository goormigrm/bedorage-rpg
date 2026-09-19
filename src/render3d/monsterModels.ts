// 실사 괴물 모델 (2026-09-19 사용자: "몬스터 · 보스들의 실사 모습 — 그래야 게임 할 맛이 난다").
//
// Sketchfab 의 CC-BY 모델(출처는 CREDITS.md)을 tools/pack-monsters.py 로 줄여 public/assets3d/monsters/ 에 둔다.
// 게임은 그 괴물을 **처음 만날 때** 받는다(서버 없는 게임 — 접속할 때 한꺼번에 받지 않는다).
//
// 뼈대 모델은 InstancedMesh 로 그릴 수 없다(스키닝이 안 된다). 그래서 불러올 때 동작을 **프레임 몇 장으로 구워**
// 모양 키(morph target)로 넣어 두고, 마리마다 `InstancedMesh.setMorphAt` 으로 프레임 두 장을 섞어 고른다.
// → 몇 마리든 종류당 그리기 호출은 재질 수만큼이다(지금 도형 괴물과 같다). 받기 전 · 실패 · "끔" 이면 도형 괴물.
//
// 좌표: 발 아래 원점 · +y 위 · 정면 +z (monsters3d 의 도형 괴물과 같다).
//
// 접속 용량(2026-09-19 사용자 — 서버 없는 게임): 여기에는 명세만 둔다. 굽는 코드(monsterBake.ts — 애니메이션 · 로더)는
// 처음 모델을 받을 때 따로 받는다(본체 JS 에 넣지 않는다).

import type * as THREE from 'three'

export type SegName = 'idle' | 'walk' | 'attack' | 'hit' | 'death'
export interface Seg {
  start: number
  count: number
  loop: boolean
}

interface ClipPick {
  clip: string
  /** 클립의 일부만 (초) */
  from?: number
  to?: number
  frames: number
}

export interface ModelSpec {
  /** public/assets3d/monsters/<file>.glb */
  file: string
  /** 크기 1 일 때의 키(fit='height') 또는 몸 길이(fit='length') — 타일 단위 */
  size: number
  fit?: 'height' | 'length'
  /** 정면을 +z 로 돌리는 각 (라디안) */
  yaw?: number
  clips: Partial<Record<SegName, ClipPick>>
  /** 공격 클립에서 예고(치켜듦)가 차지하는 앞부분 비율 — 예고 틱과 휘두름 틱에 맞춘다 */
  windup?: number
  /** 모든 모양 키를 이 세기로 (부푼 시체 = 구울 + 살찐 몸) */
  fat?: number
  /** 색 곱하기 */
  tint?: [number, number, number]
  /** 빛나는 눈 재질 이름 → 빛 색 (어둠 속에서 먼저 보이는 것 — 이 게임 괴물의 정체성) */
  glow?: Record<string, number>
}

const GHOUL_CLIPS: ModelSpec['clips'] = {
  idle: { clip: 'Idle', frames: 6 },
  walk: { clip: 'Walk1', frames: 12 },
  attack: { clip: 'Attack1.001', frames: 10 },
}

/** 종류 번호 → 모델 (없으면 도형 괴물) */
export const MODEL_SPECS: (ModelSpec | undefined)[] = []
// 구울 — Zombie (Rigged & Animated) · Aiden Studios · CC BY 4.0
MODEL_SPECS[0] = { file: 'ghoul', size: 0.95, clips: GHOUL_CLIPS, windup: 0.5, glow: { 'Sphere.001': 0xd6ff5c, 'Sphere_1.001': 0xd6ff5c } }
// 해골 궁수 — Skeleton animated · danielmclogan · CC BY 4.0
// (옆 +x 를 보고 걷는다 → -90° 돌려 +z 로)
// 동작이 한 줄(3.3초)에 셋 이어 붙어 있었다: 0~0.85 옆으로 선 자세 · 0.88~1.6 **쓰러짐** · 1.67~3.2 정면에서 팔을 뻗는 흔들림.
// 통째로 걷기로 돌리면 살아 있는 궁수가 주기적으로 누워 보였다(2026-09-19) → 셋째를 걷기, 둘째를 죽음으로 쓴다
MODEL_SPECS[1] = {
  file: 'archer', size: 1.2, yaw: -Math.PI / 2,
  clips: { walk: { clip: 'Take 001', from: 1.67, to: 3.2, frames: 12 }, death: { clip: 'Take 001', from: 0.88, to: 1.6, frames: 6 } },
}
// 부푼 시체 — 구울 모델 + 살찐 몸 모양 키 + 누런 녹색
MODEL_SPECS[2] = { file: 'ghoul', size: 1.0, clips: GHOUL_CLIPS, windup: 0.5, fat: 2.2, tint: [0.95, 1.05, 0.7], glow: { 'Sphere.001': 0xb8ff5a, 'Sphere_1.001': 0xb8ff5a } }
// 도살자(1막 보스) — 구울 모델 + 살찐 몸 + 붉은 살 + 붉은 눈 (식칼은 도형 부품을 겹쳐 그린다 — monsters3d MODEL_EXTRAS).
// 2차 묶음의 Pig Demon 을 받기 전까지 쓴다 (받을 파일이 늘지 않는다)
MODEL_SPECS[3] = { file: 'ghoul', size: 1.0, clips: GHOUL_CLIPS, windup: 0.5, fat: 1.4, tint: [1.3, 0.72, 0.64], glow: { 'Sphere.001': 0xff3a1a, 'Sphere_1.001': 0xff3a1a } }
// ---- 임시 실사화 (2026-09-19): 받은 모델 + 도형 부품(monsters3d MODEL_EXTRAS). 2차 묶음을 받으면 제 모델로 바꾼다 ----
const SKELETON_CLIPS: ModelSpec['clips'] = { walk: { clip: 'Take 001', from: 1.67, to: 3.2, frames: 12 }, death: { clip: 'Take 001', from: 0.88, to: 1.6, frames: 6 } }
// 보물 고블린 — 작고 푸르죽죽한 좀비 + 금 자루
MODEL_SPECS[4] = { file: 'ghoul', size: 0.8, clips: GHOUL_CLIPS, windup: 0.5, tint: [0.78, 1.0, 0.7], glow: { 'Sphere.001': 0xffe05c, 'Sphere_1.001': 0xffe05c } }
// 버섯 주술사 — 창백한 좀비 + 빛나는 버섯 갓 · 지팡이
MODEL_SPECS[7] = { file: 'ghoul', size: 1.1, clips: GHOUL_CLIPS, windup: 0.5, tint: [0.85, 0.92, 1.05], glow: { 'Sphere.001': 0x7affc8, 'Sphere_1.001': 0x7affc8 } }
// 방패병 — 해골 + 투구 · 눈구멍 빛 · 큰 방패
MODEL_SPECS[9] = { file: 'archer', size: 1.15, yaw: -Math.PI / 2, clips: SKELETON_CLIPS, tint: [0.82, 0.82, 0.78] }
// 강령술사 — 검게 삭은 해골 + 해골 지팡이 · 빛나는 구슬
MODEL_SPECS[10] = { file: 'archer', size: 1.2, yaw: -Math.PI / 2, clips: SKELETON_CLIPS, tint: [0.62, 0.56, 0.7] }
// 산성 토사꾼 — 초록 살찐 좀비 + 산 주머니
MODEL_SPECS[11] = { file: 'ghoul', size: 1.0, clips: GHOUL_CLIPS, windup: 0.5, fat: 1.0, tint: [0.72, 1.1, 0.55], glow: { 'Sphere.001': 0xb8ff5a, 'Sphere_1.001': 0xb8ff5a } }
// 그림자 — 검보라 해골 + 두건 · 빛나는 눈
MODEL_SPECS[13] = { file: 'archer', size: 1.15, yaw: -Math.PI / 2, clips: SKELETON_CLIPS, tint: [0.34, 0.28, 0.46] }
// 굶주린 늑대 — Grey Wolf (Rigged and Animated) · rhcreations · CC BY 4.0
// (머리가 -x 를 본다 → 90° 돌려 +z 로. 회색 털이 등불 아래 하얗게 뜨지 않게 조금 어둡게)
// (2026-09-19: 게임에서 "길쭉하게 늘어나 보인다" 고 꺼 두었는데, 쿼터뷰에서 카메라 쪽 · 반대쪽을 향한 네 발 짐승이
//  화면 세로로 길게 보이는 것이었다 — 모델은 정상. 기절시켜 세워 두고 확인했다)
MODEL_SPECS[5] = {
  file: 'wolf', size: 1.15, fit: 'length', yaw: Math.PI / 2, tint: [0.72, 0.7, 0.68],
  clips: { walk: { clip: 'Wolf ArmatureAction', frames: 16 } },
  glow: { Wolf_Eye_Material: 0xffc04a },
}
// 독거미 — Wolf Spider (Rigged) · Dreaming In Alternation 27 · CC BY 4.0
MODEL_SPECS[6] = {
  file: 'spider', size: 1.0, fit: 'length',
  clips: { walk: { clip: 'Wolf Spider Armature|Spider walking', frames: 12 }, attack: { clip: 'Wolf Spider Armature|Spider running', frames: 6 } },
  windup: 0.5,
}
// 거미 여왕(보스) — Amethystine Blight Queen · HighPolyDensity · CC BY 4.0
MODEL_SPECS[8] = {
  file: 'queen', size: 1.2, fit: 'length',
  clips: {
    idle: { clip: 'Basic Idle', frames: 8 },
    walk: { clip: 'Walk Cycle', frames: 12 },
    attack: { clip: 'Leap', frames: 12 },
    hit: { clip: 'Take Damage', frames: 4 },
  },
  windup: 0.45,
  glow: { Eyes: 0xd8a8ff },
}

export interface BakedModel {
  parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[]
  frames: number
  seg: Partial<Record<SegName, Seg>>
  windup: number
}

/** 종류 하나를 받아 굽는다. 모델이 없는 종류면 null (굽는 코드 · 로더 · 모델 파일을 이때 받는다) */
export async function loadMonsterModel(kind: number): Promise<BakedModel | null> {
  const spec = MODEL_SPECS[kind]
  if (!spec) return null
  const { bakeModel } = await import('./monsterBake')
  return bakeModel(spec)
}
