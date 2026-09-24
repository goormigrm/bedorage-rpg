// 동작 옮겨 붙이기 (2026-09-19): Quaternius "Universal Animation Library"(CC0) 의 동작을 받은 괴물 모델 뼈대로 옮긴다.
//
//   node tools/retarget.mjs            # 모두
//   node tools/retarget.mjs ghoul      # 한 종류만
//
// 입력: art-src/anim/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb (UE 마네킹 뼈대)
//       art-src/monsters/<종류>/src/scene.gltf (받은 원본)
// 출력: art-src/monsters/<종류>/retarget.json — tools/pack-monsters.py 가 읽어 .glb 에 "UAL_<동작>" 으로 넣는다.
//
// 왜: 구울(좀비) · 해골 모델에는 죽음 · 맞음 · (해골은) 공격 · 대기 동작이 없다. 받은 모델이 없는 10종이 이 둘을 쓴다.
//
// 방법 (월드 회전 변화량):
// - 기준 자세 = 노드 기본값(서 있는 한 장면). 묶음 행렬(inverseBindMatrices)로 되살리면 Sketchfab 원본은 좌표계가 달라
//   누운 자세가 나왔다(구울). 기본값이 동작 한 장면이어도 괜찮다 — 아래 보정 C 가 뼈 방향을 원본 기준 자세에 맞춘다.
// - 두 모델의 방향틀(위 = 골반→머리, 왼쪽 = 오른 허벅지→왼 허벅지)로 원본 → 대상 회전 B 를 구한다.
// - 뼈마다 기준 자세의 뼈 방향이 같아지도록 보정 C (T 자세 ↔ A 자세 차이). 방향을 못 정하는 뼈(손 · 머리)는 부모 것을 쓴다.
// - 프레임마다: 대상 월드 회전 = B · (원본 월드 회전 · 원본 기준⁻¹) · B⁻¹ · C · 대상 기준.
//   짝이 없는 뼈(비틀기 · 손가락 · 중간 척추)는 기준 자세의 부모 기준 회전을 그대로 둔다.
// - 골반 위치: 원본 골반의 움직임을 다리 길이 비율로 줄여 옮긴다(쓰러질 때 몸이 내려간다).

import * as THREE from 'three'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const UAL = path.join(ROOT, 'art-src', 'anim', 'Universal Animation Library[Standard]', 'Unreal-Godot', 'UAL1_Standard.glb')
const FPS = 30

// 원본(UE 마네킹) 뼈 → 대상 뼈. dir = 뼈 방향을 정할 자식(원본 쪽 이름)
const UE = {
  pelvis: 'spine_01',
  spine_01: 'spine_02',
  spine_02: 'spine_03',
  spine_03: 'neck_01',
  neck_01: 'Head',
  Head: null,
  clavicle_l: 'upperarm_l',
  upperarm_l: 'lowerarm_l',
  lowerarm_l: 'hand_l',
  hand_l: null,
  clavicle_r: 'upperarm_r',
  upperarm_r: 'lowerarm_r',
  lowerarm_r: 'hand_r',
  hand_r: null,
  thigh_l: 'calf_l',
  calf_l: 'foot_l',
  foot_l: 'ball_l',
  ball_l: null,
  thigh_r: 'calf_r',
  calf_r: 'foot_r',
  foot_r: 'ball_r',
  ball_r: null,
}

const TARGETS = {
  // 구울 (Auto-Rig Pro 뼈대 — 척추 다섯 · 비틀기 뼈는 짝 뼈의 자식이라 따라온다)
  ghoul: {
    map: {
      pelvis: 'root.x_01',
      spine_01: 'spine_01.x_014',
      spine_02: 'spine_03.x_016',
      spine_03: 'spine_05.x_018',
      neck_01: 'neck.x_031',
      Head: 'head.x_032',
      clavicle_l: 'shoulder.l_024',
      upperarm_l: 'arm_stretch.l_025',
      lowerarm_l: 'forearm_stretch.l_026',
      hand_l: 'hand.l_027',
      clavicle_r: 'shoulder.r_019',
      upperarm_r: 'arm_stretch.r_020',
      lowerarm_r: 'forearm_stretch.r_021',
      hand_r: 'hand.r_022',
      thigh_l: 'thigh_stretch.l_02',
      calf_l: 'leg_stretch.l_03',
      foot_l: 'foot.l_04',
      ball_l: 'toes_01.l_05',
      thigh_r: 'thigh_stretch.r_08',
      calf_r: 'leg_stretch.r_09',
      foot_r: 'foot.r_010',
      ball_r: 'toes_01.r_011',
    },
    clips: ['Death01', 'Hit_Chest', 'Sword_Attack', 'Spell_Simple_Shoot', 'Pistol_Shoot'],
  },
  // 해골 궁수 (3ds Max Biped 뼈대)
  archer: {
    map: {
      pelvis: 'Bip01_Pelvis_01',
      spine_01: 'Bip01_Spine_011',
      spine_02: 'Bip01_Spine2_013',
      spine_03: 'Bip01_Spine4_014',
      neck_01: 'Bip01_Neck1_015',
      Head: 'Bip01_Head1_016',
      clavicle_l: 'Bip01_L_Clavicle_018',
      upperarm_l: 'Bip01_L_UpperArm_019',
      lowerarm_l: 'Bip01_L_Forearm_020',
      hand_l: 'Bip01_L_Hand_021',
      clavicle_r: 'Bip01_R_Clavicle_042',
      upperarm_r: 'Bip01_R_UpperArm_043',
      lowerarm_r: 'Bip01_R_Forearm_044',
      hand_r: 'Bip01_R_Hand_045',
      thigh_l: 'Bip01_L_Thigh_02',
      calf_l: 'Bip01_L_Calf_03',
      foot_l: 'Bip01_L_Foot_04',
      ball_l: 'Bip01_L_Toe0_05',
      thigh_r: 'Bip01_R_Thigh_07',
      calf_r: 'Bip01_R_Calf_00',
      foot_r: 'Bip01_R_Foot_08',
      ball_r: 'Bip01_R_Toe0_09',
    },
    clips: ['Idle_Loop', 'Walk_Loop', 'Hit_Chest', 'Sword_Attack', 'Spell_Simple_Shoot', 'Pistol_Shoot', 'Punch_Cross', 'Death01'],
    // 손가락 · 끝점은 옮기지 않는다 (노드 기본값 그대로 — 채널 수가 세 배가 된다)
    skip: /Finger|effector|Toeeff/,
    // 기본 자세는 +z 를 보는데, 원래 걷기 동작(Take 001 1.67~)은 뿌리째 돌아 +x 를 본다.
    // 명세의 yaw 는 종류마다 하나라 옮긴 동작도 +x 를 보게 90° 돌린다(2026-09-19 — 안 돌리면 옆을 보고 걸었다)
    turn: Math.PI / 2,
  },
  // 도살자 — Pig Demon (Lexington Dath · CC BY 4.0). 3ds Max Biped(Bip001) — 해골 궁수와 같은 계열 (2026-09-23)
  // 목이 다섯 마디(Neck ~ Neck4)라 첫 마디와 머리만 짝을 짓고 가운데는 기본 자세를 둔다
  butcher: {
    map: {
      pelvis: 'Bip001 Pelvis_058',
      spine_01: 'Bip001 Spine_0103',
      spine_02: 'Bip001 Spine1_0104',
      spine_03: 'Bip001 Spine2_0105',
      neck_01: 'Bip001 Neck_053',
      Head: 'Bip001 Head_05',
      clavicle_l: 'Bip001 L Clavicle_010',
      upperarm_l: 'Bip001 L UpperArm_046',
      lowerarm_l: 'Bip001 L Forearm_035',
      hand_l: 'Bip001 L Hand_036',
      clavicle_r: 'Bip001 R Clavicle_060',
      upperarm_r: 'Bip001 R UpperArm_096',
      lowerarm_r: 'Bip001 R Forearm_085',
      hand_r: 'Bip001 R Hand_086',
      thigh_l: 'Bip001 L Thigh_037',
      calf_l: 'Bip001 L Calf_09',
      foot_l: 'Bip001 L Foot_031',
      ball_l: 'Bip001 L Toe0_038',
      thigh_r: 'Bip001 R Thigh_087',
      calf_r: 'Bip001 R Calf_059',
      foot_r: 'Bip001 R Foot_081',
      ball_r: 'Bip001 R Toe0_088',
    },
    clips: ['Idle_Loop', 'Walk_Loop', 'Hit_Chest', 'Sword_Attack', 'Punch_Cross', 'Death01'],
    skip: /Finger|Nub|Twist|Ear|Jaw|Toe[123]/,
  },
  // 관리인 — Overlord (DJMaesen · CC BY 4.0). 척추가 둘(spine · chest)뿐이라 원본 윗 척추(spine_03)를 가슴에 잇는다 —
  // 월드 회전 변화량을 옮기므로 윗몸 전체의 기울기가 가슴에 들어간다 (2026-09-23)
  warden: {
    map: {
      pelvis: 'hips_2_01',
      spine_01: 'spine_2_012',
      spine_03: 'chest_2_013',
      neck_01: 'neck_2_061',
      Head: 'head_2_062',
      clavicle_l: 'L_shoulder_2_014',
      upperarm_l: 'L_arm_2_015',
      lowerarm_l: 'L_elbow_2_016',
      hand_l: 'L_wrist_2_017',
      clavicle_r: 'R_shoulder_2_038',
      upperarm_r: 'R_arm_2_039',
      lowerarm_r: 'R_elbow_2_040',
      hand_r: 'R_wrist_2_041',
      thigh_l: 'L_leg_2_02',
      calf_l: 'L_knee_2_03',
      foot_l: 'L_ankle_2_04',
      ball_l: 'L_foot_2_05',
      thigh_r: 'R_leg_2_07',
      calf_r: 'R_knee_2_08',
      foot_r: 'R_ankle_2_09',
      ball_r: 'R_foot_2_010',
    },
    clips: ['Idle_Loop', 'Walk_Loop', 'Hit_Chest', 'Sword_Attack', 'Death01'],
    skip: /thumb|pink|ring|middle|point|Joint_|toes|tip/,
  },
  // ---- 2차 졸개 (2026-09-24 — 사용자가 받아 준 여섯 중 사람형 넷) ----
  // 보물 고블린 — Minion (DJMaesen · CC BY 4.0). 관리인과 같은 제작자 뼈대(목 없음 — 가슴에 머리). 기본 자세가 앞으로 숙여
  // 머리 → 골반으로 위를 잡으면 동작 전체가 눕는다 → 위는 세계 +Y (upY)
  goblin: {
    map: {
      pelvis: 'hip_01',
      spine_01: 'spine_011',
      spine_03: 'chest_012',
      Head: 'head_045',
      clavicle_l: 'L_shoulder_029',
      upperarm_l: 'L_arm_030',
      lowerarm_l: 'L_elbow_031',
      hand_l: 'L_wrist_032',
      clavicle_r: 'R_shoulder_013',
      upperarm_r: 'R_arm_014',
      lowerarm_r: 'R_elbow_015',
      hand_r: 'R_wrist_016',
      thigh_l: 'L_leg_02',
      calf_l: 'L_knee_03',
      foot_l: 'L_ankle_04',
      ball_l: 'L_foot_05',
      thigh_r: 'R_leg_07',
      calf_r: 'R_knee_08',
      foot_r: 'R_ankle_09',
      ball_r: 'R_foot_010',
    },
    clips: ['Idle_Loop', 'Jog_Fwd_Loop', 'Hit_Chest', 'Death01'],
    skip: /thumb|pink|finger|Joint_|jaw|lip|tip|Eye|toes/,
    upY: true,
  },
  // 방패병 — Cursed Undead Soldier Rig (DM-913 · CC BY 4.0). 손 · 발이 IK 조종 뼈(ArmIK · LegIK — 뿌리의 자식)에 달려 있다 →
  // 짝 뼈 따라가기(follow)가 손은 아래팔 끝, 발은 정강이 끝에 붙인다. 앞으로 숙인 자세라 위는 +Y. 받은 동작 Slash 는 공격으로 쓴다
  shield: {
    map: {
      pelvis: 'Pelvis_52',
      spine_01: 'Spine_13',
      spine_03: 'Torso_49',
      neck_01: 'Neck_31',
      Head: 'Head_47',
      clavicle_l: 'Shoulder.L_38',
      upperarm_l: 'Upper Arm.L_34',
      lowerarm_l: 'Forearm.L_32',
      hand_l: 'Hand.L_68',
      clavicle_r: 'Shoulder.R_45',
      upperarm_r: 'Upper Arm.R_41',
      lowerarm_r: 'Forearm.R_39',
      hand_r: 'Hand.R_86',
      thigh_l: 'Thigh.L_17',
      calf_l: 'Lower Leg.L_14',
      foot_l: 'Foot.L_92',
      ball_l: 'Toes.L_91',
      thigh_r: 'Thigh.R_25',
      calf_r: 'Lower Leg.R_22',
      foot_r: 'Foot.R_89',
      ball_r: 'Toes.R_88',
    },
    clips: ['Idle_Loop', 'Walk_Loop', 'Hit_Chest', 'Death01'],
    skip: /Pinky|Ring Finger|Mid Finger|Index|Thumb|POLE|Pole|Target|Jaw/,
    upY: true,
  },
  // 강령술사 — PBR Shadowkin Mage (Rigged) (Ferocious Industries · CC BY 4.0). Character Creator 뼈대 · 받은 동작은 자세 둘뿐
  necro: {
    map: {
      pelvis: 'CC_Base_Hip_03',
      spine_01: 'CC_Base_Waist_035',
      spine_02: 'CC_Base_Spine01_036',
      spine_03: 'CC_Base_Spine02_037',
      neck_01: 'CC_Base_NeckTwist01_038',
      Head: 'CC_Base_Head_040',
      clavicle_l: 'CC_Base_L_Clavicle_051',
      upperarm_l: 'CC_Base_L_Upperarm_052',
      lowerarm_l: 'CC_Base_L_Forearm_053',
      hand_l: 'CC_Base_L_Hand_057',
      clavicle_r: 'CC_Base_R_Clavicle_079',
      upperarm_r: 'CC_Base_R_Upperarm_080',
      lowerarm_r: 'CC_Base_R_Forearm_081',
      hand_r: 'CC_Base_R_Hand_085',
      thigh_l: 'CC_Base_L_Thigh_05',
      calf_l: 'CC_Base_L_Calf_06',
      foot_l: 'CC_Base_L_Foot_07',
      ball_l: 'CC_Base_L_ToeBase_09',
      thigh_r: 'CC_Base_R_Thigh_020',
      calf_r: 'CC_Base_R_Calf_021',
      foot_r: 'CC_Base_R_Foot_023',
      ball_r: 'CC_Base_R_ToeBase_024',
    },
    clips: ['Idle_Loop', 'Walk_Loop', 'Spell_Simple_Shoot', 'Hit_Chest', 'Death01'],
    skip: /Twist|Share|Toe1|Finger|Thumb|Index|Mid|Ring|Pinky|Facial|Jaw|Tongue|Teeth|Eye|_end/,
  },
  // 그림자 — Terrifying Hooded Horror Woman (Purple.Point · CC BY 4.0). 뼈 스물다섯의 단순한 사람형 · 받은 RunFast 는 걷기로 쓴다
  shade: {
    map: {
      pelvis: 'Hips_23',
      spine_01: 'Spine02_22',
      spine_02: 'Spine01_21',
      spine_03: 'Spine_20',
      neck_01: 'neck_19',
      Head: 'Head_18',
      clavicle_l: 'LeftShoulder_11',
      upperarm_l: 'LeftArm_10',
      lowerarm_l: 'LeftForeArm_9',
      hand_l: 'LeftHand_8',
      clavicle_r: 'RightShoulder_15',
      upperarm_r: 'RightArm_14',
      lowerarm_r: 'RightForeArm_13',
      hand_r: 'RightHand_12',
      thigh_l: 'LeftUpLeg_3',
      calf_l: 'LeftLeg_2',
      foot_l: 'LeftFoot_1',
      ball_l: 'LeftToeBase_0',
      thigh_r: 'RightUpLeg_7',
      calf_r: 'RightLeg_6',
      foot_r: 'RightFoot_5',
      ball_r: 'RightToeBase_4',
    },
    clips: ['Idle_Loop', 'Punch_Cross', 'Hit_Chest', 'Death01'],
    skip: /head_end|headfront/,
  },
}

// 제자리 동작(대기 · 걷기)은 골반의 앞뒤 · 옆 움직임을 빼고 위아래만 남긴다
const IN_PLACE = new Set(['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop'])

// ---------- glTF 읽기 ----------
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }

function loadGltf(file) {
  let json
  let bin
  if (file.endsWith('.glb')) {
    const b = fs.readFileSync(file)
    const jlen = b.readUInt32LE(12)
    json = JSON.parse(b.subarray(20, 20 + jlen).toString('utf8'))
    const off = 20 + jlen
    bin = b.subarray(off + 8, off + 8 + b.readUInt32LE(off))
  } else {
    json = JSON.parse(fs.readFileSync(file, 'utf8'))
    bin = fs.readFileSync(path.join(path.dirname(file), json.buffers[0].uri))
  }
  const floats = (ai) => {
    const a = json.accessors[ai]
    const v = json.bufferViews[a.bufferView]
    const n = NCOMP[a.type]
    const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0)
    const st = v.byteStride ?? n * 4
    assert(a.componentType === 5126, 'float 만 읽는다')
    const out = []
    for (let i = 0; i < a.count; i++) {
      const row = []
      for (let k = 0; k < n; k++) row.push(bin.readFloatLE(off + i * st + k * 4))
      out.push(row)
    }
    return out
  }
  const nodes = json.nodes
  const parent = new Array(nodes.length).fill(-1)
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => (parent[c] = i)))
  const byName = new Map(nodes.map((n, i) => [n.name, i]))
  return { json, floats, nodes, parent, byName }
}

function assert(ok, msg) {
  if (!ok) throw new Error(msg)
}

function nodeLocal(n) {
  const m = new THREE.Matrix4()
  if (n.matrix) return m.fromArray(n.matrix)
  const t = n.translation ?? [0, 0, 0]
  const r = n.rotation ?? [0, 0, 0, 1]
  const s = n.scale ?? [1, 1, 1]
  return m.compose(new THREE.Vector3(...t), new THREE.Quaternion(...r), new THREE.Vector3(...s))
}

/** 모든 노드의 월드 행렬 (locals[i] 가 있으면 그것을 쓴다) */
function worlds(g, locals) {
  const W = new Array(g.nodes.length)
  const get = (i) => {
    if (W[i]) return W[i]
    const L = locals?.[i] ?? nodeLocal(g.nodes[i])
    W[i] = g.parent[i] < 0 ? L.clone() : get(g.parent[i]).clone().multiply(L)
    return W[i]
  }
  for (let i = 0; i < g.nodes.length; i++) get(i)
  return W
}

const dec = (m) => {
  const p = new THREE.Vector3()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3()
  m.decompose(p, q, s)
  return { p, q, s }
}

/** 동작 한 장면의 관절 로컬 행렬 */
function sampleClip(g, anim, t) {
  const locals = []
  const trs = new Map()
  for (const ch of anim.channels) {
    const node = ch.target.node
    if (node === undefined) continue
    const s = anim.samplers[ch.sampler]
    const times = s._t ?? (s._t = g.floats(s.input).map((r) => r[0]))
    const vals = s._v ?? (s._v = g.floats(s.output))
    let i = times.findIndex((x) => x > t)
    let v
    if (i <= 0) v = i === 0 ? vals[0] : vals[vals.length - 1]
    else {
      const a = (t - times[i - 1]) / (times[i] - times[i - 1])
      const v0 = vals[i - 1]
      const v1 = vals[i]
      if (ch.target.path === 'rotation') {
        const q = new THREE.Quaternion(...v0).slerp(new THREE.Quaternion(...v1), s.interpolation === 'STEP' ? 0 : a)
        v = [q.x, q.y, q.z, q.w]
      } else v = v0.map((x, k) => (s.interpolation === 'STEP' ? x : x + (v1[k] - x) * a))
    }
    if (!trs.has(node)) trs.set(node, {})
    trs.get(node)[ch.target.path] = v
  }
  for (const [node, o] of trs) {
    const n = g.nodes[node]
    locals[node] = nodeLocal({ translation: o.translation ?? n.translation, rotation: o.rotation ?? n.rotation, scale: o.scale ?? n.scale })
  }
  return locals
}

function frameBasis(pos, pelvis, head, thighL, thighR, upY = false) {
  // upY: 기본 자세가 앞으로 숙인 모델(고블린 · 방패병)은 머리 → 골반 대신 세계 +Y 를 위로 (안 그러면 동작 전체가 기운다)
  const up = upY ? new THREE.Vector3(0, 1, 0) : pos(head).sub(pos(pelvis)).normalize()
  const left = pos(thighL).sub(pos(thighR))
  left.addScaledVector(up, -left.dot(up)).normalize()
  const fwd = new THREE.Vector3().crossVectors(left, up)
  return new THREE.Matrix4().makeBasis(left, up, fwd)
}

function retarget(kind) {
  const T = TARGETS[kind]
  const src = loadGltf(UAL)
  const dst = loadGltf(path.join(ROOT, 'art-src', 'monsters', kind, 'src', 'scene.gltf'))
  const S = (name) => {
    const i = src.byName.get(name)
    assert(i !== undefined, `원본 뼈 없음: ${name}`)
    return i
  }
  const D = (name) => {
    const i = dst.byName.get(name)
    assert(i !== undefined, `${kind}: 뼈 없음: ${name}`)
    return i
  }

  // 기준 자세 (노드 기본값)
  const sRest = worlds(src)
  const dRest = worlds(dst)
  const sPos = (n) => dec(sRest[S(n)]).p
  const dPos = (n) => dec(dRest[D(T.map[n])]).p

  // 방향틀: 원본 → 대상
  const Ms = frameBasis(sPos, 'pelvis', 'Head', 'thigh_l', 'thigh_r')
  const Md = frameBasis(dPos, 'pelvis', 'Head', 'thigh_l', 'thigh_r', T.upY)
  const qB = new THREE.Quaternion().setFromRotationMatrix(Md.clone().multiply(Ms.clone().transpose()))
  const qBi = qB.clone().invert()

  // 뼈마다 기준 자세 보정 C (원본 방향으로)
  const C = {}
  for (const [sn, child] of Object.entries(UE)) {
    if (!T.map[sn]) continue
    if (child && T.map[child]) {
      const ds = sPos(child).sub(sPos(sn)).normalize().applyQuaternion(qB)
      const dd = dPos(child).sub(dPos(sn)).normalize()
      C[sn] = new THREE.Quaternion().setFromUnitVectors(dd, ds)
    }
  }
  // 방향을 못 정한 뼈는 부모(원본 뼈대 기준)의 보정
  for (const sn of Object.keys(UE)) {
    if (!T.map[sn] || C[sn]) continue
    let p = src.parent[S(sn)]
    while (p >= 0 && !C[src.nodes[p].name]) p = src.parent[p]
    C[sn] = p >= 0 ? C[src.nodes[p].name].clone() : new THREE.Quaternion()
  }

  const dq = (i) => dec(dRest[i]).q
  const sq = (i) => dec(sRest[i]).q
  const sRestQ = {}
  const dRestQ = {}
  for (const sn of Object.keys(T.map)) {
    sRestQ[sn] = sq(S(sn))
    dRestQ[sn] = dq(D(T.map[sn]))
  }

  // 골반 높이 비율 (발 = 두 발목의 가운데 높이)
  const upD = new THREE.Vector3(0, 1, 0).applyMatrix4(Md.clone().setPosition(0, 0, 0))
  const upS = new THREE.Vector3(0, 1, 0).applyMatrix4(Ms.clone().setPosition(0, 0, 0))
  const hS = sPos('pelvis').sub(sPos('foot_l').add(sPos('foot_r')).multiplyScalar(0.5)).dot(upS)
  const hD = dPos('pelvis').sub(dPos('foot_l').add(dPos('foot_r')).multiplyScalar(0.5)).dot(upD)
  const k = hD / hS

  // 대상 관절: 부모 먼저
  const joints = dst.json.skins[0].joints
  const jointSet = new Set(joints)
  const depth = (i) => (dst.parent[i] < 0 ? 0 : 1 + depth(dst.parent[i]))
  const dToS = new Map(Object.entries(T.map).map(([s, d]) => [D(d), s]))
  const pelvisD = D(T.map.pelvis)
  // 골반을 먼저 (Biped 는 척추가 골반의 형제라 같은 깊이다)
  const byDepth = [...joints].sort((a, b) => depth(a) - depth(b) || (a === pelvisD ? -1 : b === pelvisD ? 1 : 0))
  // 뼈 계층이 원본과 다른 짝 뼈 → 원본 쪽 부모(가장 가까운 짝 뼈)를 따라가게 한다.
  // 예: Biped 의 척추는 골반의 자식이 아니다 — 골반이 내려가면 몸통이 떠 있었다(2026-09-19)
  const follow = new Map()
  for (const [sn, dn] of Object.entries(T.map)) {
    let sp = src.parent[S(sn)]
    while (sp >= 0 && !T.map[src.nodes[sp].name]) sp = src.parent[sp]
    if (sp < 0) continue
    const dp = D(T.map[src.nodes[sp].name])
    const j = D(dn)
    if (dst.parent[j] !== dp) follow.set(j, { dp, off: dec(dRest[dp].clone().invert().multiply(dRest[j])).p })
  }
  // 차례: 부모 · 따라갈 짝 뼈가 먼저 (방패병처럼 손이 IK 조종 뼈에 달려 계층이 얕으면, 깊이 순서로는 아래팔보다 손을 먼저 계산했다)
  const order = []
  const done = new Set()
  const visit = (j) => {
    if (done.has(j)) return
    done.add(j)
    const P = dst.parent[j]
    if (jointSet.has(P)) visit(P)
    const fo = follow.get(j)
    if (fo) visit(fo.dp)
    order.push(j)
  }
  for (const j of byDepth) visit(j)
  // 기준 자세의 관절 로컬
  const bindLocal = new Map()
  for (const j of joints) bindLocal.set(j, dec(nodeLocal(dst.nodes[j])))
  const pelvisRestW = dPos('pelvis')
  const qTurn = new THREE.Quaternion().setFromAxisAngle(upD, T.turn ?? 0)
  const pelvisRestS = sPos('pelvis')

  const out = { kind, source: 'Quaternius Universal Animation Library (CC0)', clips: [] }
  for (const name of T.clips) {
    const anim = src.json.animations.find((a) => a.name === name)
    assert(anim, `원본 동작 없음: ${name}`)
    let dur = 0
    for (const s of anim.samplers) dur = Math.max(dur, src.json.accessors[s.input].max[0])
    const n = Math.max(2, Math.round(dur * FPS) + 1)
    const times = []
    const tracks = new Map() // 노드 → { rotation: [], translation: [], scale: [] }
    for (const j of joints) tracks.set(j, { rotation: [], translation: [], scale: [] })
    for (let f = 0; f < n; f++) {
      const t = Math.min(dur, f / FPS)
      times.push(t)
      const sW = worlds(src, sampleClip(src, anim, t))
      const W = new Array(dst.nodes.length)
      const parentW = (j) => {
        const P = dst.parent[j]
        return jointSet.has(P) ? W[P] : dRest[P]
      }
      for (const j of order) {
        const bl = bindLocal.get(j)
        let q = bl.q.clone()
        let p = bl.p.clone()
        const sn = dToS.get(j)
        const PW = parentW(j)
        const pq = dec(PW).q
        if (sn) {
          const sw = dec(sW[S(sn)]).q
          const delta = sw.multiply(sRestQ[sn].clone().invert()) // 원본 월드 변화량
          const world = qTurn.clone().multiply(qB).multiply(delta).multiply(qBi).multiply(C[sn]).multiply(dRestQ[sn])
          q = pq.clone().invert().multiply(world)
          if (j === pelvisD) {
            const mv = dec(sW[S('pelvis')]).p.sub(pelvisRestS).applyQuaternion(qB).multiplyScalar(k)
            if (IN_PLACE.has(name)) {
              const vert = upD.clone().multiplyScalar(mv.dot(upD))
              mv.copy(vert)
            }
            const wp = pelvisRestW.clone().add(mv.applyQuaternion(qTurn))
            p = wp.applyMatrix4(PW.clone().invert())
          }
          const fo = follow.get(j)
          if (fo) p = fo.off.clone().applyMatrix4(W[fo.dp]).applyMatrix4(PW.clone().invert())
        }
        W[j] = PW.clone().multiply(new THREE.Matrix4().compose(p, q, bl.s))
        const tr = tracks.get(j)
        tr.rotation.push([q.x, q.y, q.z, q.w])
        tr.translation.push([p.x, p.y, p.z])
        tr.scale.push([bl.s.x, bl.s.y, bl.s.z])
      }
    }
    // 쿼터니언 부호를 이어지게 (보간이 먼 길로 돌지 않게)
    for (const tr of tracks.values()) {
      for (let f = 1; f < tr.rotation.length; f++) {
        const a = tr.rotation[f - 1]
        const b = tr.rotation[f]
        if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0) tr.rotation[f] = b.map((x) => -x)
      }
    }
    // 내내 노드 기본값과 같은 채널은 뺀다 (three 는 동작에 없는 채널을 기본값으로 둔다)
    const DEF = { rotation: [0, 0, 0, 1], translation: [0, 0, 0], scale: [1, 1, 1] }
    const same = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 1e-4)
    const list = []
    for (const [node, tr] of tracks) {
      if (T.skip?.test(dst.nodes[node].name)) continue
      const o = { node }
      for (const p of ['rotation', 'translation', 'scale']) {
        const d = dst.nodes[node][p] ?? DEF[p]
        const flip = p === 'rotation' ? d.map((x) => -x) : d
        if (tr[p].every((v) => same(v, d) || same(v, flip))) continue
        o[p] = tr[p]
      }
      if (Object.keys(o).length > 1) list.push(o)
    }
    out.clips.push({ name: `UAL_${name}`, times, tracks: list })
    console.log(`${kind}: UAL_${name} ${dur.toFixed(2)}초 · ${n}장`)
  }
  const file = path.join(ROOT, 'art-src', 'monsters', kind, 'retarget.json')
  fs.writeFileSync(file, JSON.stringify(out))
  console.log(`→ ${path.relative(ROOT, file)} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`)
}

const kinds = process.argv.slice(2)
for (const k of kinds.length ? kinds : Object.keys(TARGETS)) retarget(k)
