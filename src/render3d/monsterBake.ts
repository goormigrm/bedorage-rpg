// 실사 괴물 모델 굽기 (monsterModels.ts 가 처음 모델을 받을 때 따로 받는 코드 — 본체 JS 를 가볍게).
// 동작을 프레임 몇 장으로 구워 모양 키로 넣는다. 자세한 설명은 monsterModels.ts.

import * as THREE from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { BakedModel, ModelSpec, SegName } from './monsterModels'

const SEG_ORDER: SegName[] = ['idle', 'walk', 'attack', 'hit']

let loaderP: Promise<{ load: (url: string) => Promise<GLTF> }> | null = null
const files = new Map<string, Promise<GLTF>>()

/** 모델 파일 받기 (같은 파일은 한 번만 — 구울과 부푼 시체가 같이 쓴다). 로더 코드도 이때 받는다 */
function loadFile(file: string): Promise<GLTF> {
  let p = files.get(file)
  if (!p) {
    loaderP ??= import('three/examples/jsm/loaders/GLTFLoader.js').then(({ GLTFLoader }) => {
      const l = new GLTFLoader()
      return { load: (url: string) => l.loadAsync(url) }
    })
    const url = `${import.meta.env.BASE_URL}assets3d/monsters/${file}.glb`
    p = loaderP.then((l) => l.load(url))
    files.set(file, p)
  }
  return p
}

/** 명세 하나를 받아 굽는다 */
export async function bakeModel(spec: ModelSpec): Promise<BakedModel> {
  const gltf = await loadFile(spec.file)
  return bake(gltf, spec)
}

const _m = new THREE.Matrix4()

/** 동작을 프레임으로 굽는다: 프레임마다 모든 정점을 뼈대로 움직여 위치 · 노멀을 모은다 */
function bake(gltf: GLTF, spec: ModelSpec): BakedModel {
  // 같은 파일을 두 종류가 쓰므로 장면을 복제해서 굽는다 (모양 키 세기가 다르다)
  const root = cloneSkinned(gltf.scene)
  const meshes: THREE.Mesh[] = []
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh)
  })
  const segs = SEG_ORDER.filter((s) => spec.clips[s])
  const seg: BakedModel['seg'] = {}
  let frames = 0
  for (const s of segs) {
    const pick = spec.clips[s]!
    seg[s] = { start: frames, count: pick.frames, loop: s === 'idle' || s === 'walk' }
    frames += pick.frames
  }
  const pos: Float32Array[][] = meshes.map(() => [])
  const nrm: Float32Array[][] = meshes.map(() => [])
  const mixer = new THREE.AnimationMixer(root)
  for (const s of segs) {
    const pick = spec.clips[s]!
    const clip = gltf.animations.find((a) => a.name === pick.clip)
    if (!clip) throw new Error(`${spec.file}: 동작 "${pick.clip}" 없음`)
    mixer.stopAllAction()
    const act = mixer.clipAction(clip)
    act.reset().play()
    const from = pick.from ?? 0
    const to = Math.min(pick.to ?? clip.duration, clip.duration - 1e-4)
    const loop = seg[s]!.loop
    for (let k = 0; k < pick.frames; k++) {
      const u = loop ? k / pick.frames : pick.frames === 1 ? 0 : k / (pick.frames - 1)
      act.time = from + (to - from) * u
      mixer.update(0)
      root.updateMatrixWorld(true)
      meshes.forEach((m, i) => {
        const [p, n] = skinFrame(m, spec.fat ?? 0)
        pos[i].push(p)
        nrm[i].push(n)
      })
    }
  }
  mixer.stopAllAction()

  // 크기 · 자리 맞추기: 첫 프레임의 상자로 발을 y=0, 가운데를 원점, 키(또는 길이)를 spec.size 로
  const box = new THREE.Box3()
  const v = new THREE.Vector3()
  for (const p of pos) {
    const f = p[0]
    for (let i = 0; i < f.length; i += 3) box.expandByPoint(v.set(f[i], f[i + 1], f[i + 2]))
  }
  const sz = box.getSize(new THREE.Vector3())
  const scale = spec.size / (spec.fit === 'length' ? Math.max(sz.x, sz.z) : sz.y)
  const cx = (box.min.x + box.max.x) / 2
  const cz = (box.min.z + box.max.z) / 2
  const cy = Math.cos(spec.yaw ?? 0)
  const sy = Math.sin(spec.yaw ?? 0)
  for (let i = 0; i < meshes.length; i++) {
    for (const f of pos[i]) {
      for (let j = 0; j < f.length; j += 3) {
        const x = (f[j] - cx) * scale
        const z = (f[j + 2] - cz) * scale
        f[j] = x * cy + z * sy
        f[j + 1] = (f[j + 1] - box.min.y) * scale
        f[j + 2] = -x * sy + z * cy
      }
    }
    for (const f of nrm[i]) {
      for (let j = 0; j < f.length; j += 3) {
        const x = f[j]
        const z = f[j + 2]
        f[j] = x * cy + z * sy
        f[j + 2] = -x * sy + z * cy
      }
    }
  }

  const parts = meshes.map((m, i) => {
    const src = m.geometry
    const geo = new THREE.BufferGeometry()
    if (src.index) geo.setIndex(src.index)
    geo.setAttribute('position', new THREE.BufferAttribute(pos[i][0].slice(), 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm[i][0].slice(), 3))
    if (src.attributes.uv) geo.setAttribute('uv', src.attributes.uv)
    geo.morphAttributes.position = pos[i].map((f) => new THREE.BufferAttribute(f, 3))
    geo.morphAttributes.normal = nrm[i].map((f) => new THREE.BufferAttribute(f, 3))
    geo.morphTargetsRelative = false
    geo.computeBoundingSphere()
    return { geo, mat: toLambert(m.material as THREE.MeshStandardMaterial, spec) }
  })
  return { parts, frames, seg, windup: spec.windup ?? 0.5 }
}

/** 한 프레임의 정점 위치 · 노멀 (장면 좌표) */
function skinFrame(mesh: THREE.Mesh, fat: number): [Float32Array, Float32Array] {
  const g = mesh.geometry
  const P = g.attributes.position
  const N = g.attributes.normal
  const n = P.count
  const outP = new Float32Array(n * 3)
  const outN = new Float32Array(n * 3)
  const morphs = fat > 0 ? g.morphAttributes.position : undefined
  const rel = g.morphTargetsRelative
  const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh
  let K: Float32Array | null = null
  const SI = g.attributes.skinIndex
  const SW = g.attributes.skinWeight
  if (skinned) {
    const sm = mesh as THREE.SkinnedMesh
    const bones = sm.skeleton.bones
    const inv = sm.skeleton.boneInverses
    K = new Float32Array(bones.length * 16)
    const pre = new THREE.Matrix4().multiplyMatrices(sm.matrixWorld, sm.bindMatrixInverse)
    for (let b = 0; b < bones.length; b++) {
      _m.multiplyMatrices(bones[b].matrixWorld, inv[b]).premultiply(pre).multiply(sm.bindMatrix)
      K.set(_m.elements, b * 16)
    }
  }
  const W = mesh.matrixWorld.elements
  const e = new Float32Array(16)
  for (let i = 0; i < n; i++) {
    let px = P.getX(i)
    let py = P.getY(i)
    let pz = P.getZ(i)
    if (morphs) {
      for (const t of morphs) {
        const dx = t.getX(i)
        const dy = t.getY(i)
        const dz = t.getZ(i)
        if (rel) {
          px += dx * fat
          py += dy * fat
          pz += dz * fat
        } else {
          px += (dx - P.getX(i)) * fat
          py += (dy - P.getY(i)) * fat
          pz += (dz - P.getZ(i)) * fat
        }
      }
    }
    let M: ArrayLike<number> = W
    if (K) {
      e.fill(0)
      for (let c = 0; c < 4; c++) {
        const w = SW.getComponent(i, c)
        if (w === 0) continue
        const o = SI.getComponent(i, c) * 16
        for (let q = 0; q < 16; q++) e[q] += K[o + q] * w
      }
      M = e
    }
    const o = i * 3
    outP[o] = M[0] * px + M[4] * py + M[8] * pz + M[12]
    outP[o + 1] = M[1] * px + M[5] * py + M[9] * pz + M[13]
    outP[o + 2] = M[2] * px + M[6] * py + M[10] * pz + M[14]
    const nx = N ? N.getX(i) : 0
    const ny = N ? N.getY(i) : 1
    const nz = N ? N.getZ(i) : 0
    const tx = M[0] * nx + M[4] * ny + M[8] * nz
    const ty = M[1] * nx + M[5] * ny + M[9] * nz
    const tz = M[2] * nx + M[6] * ny + M[10] * nz
    const l = Math.hypot(tx, ty, tz) || 1
    outN[o] = tx / l
    outN[o + 1] = ty / l
    outN[o + 2] = tz / l
  }
  return [outP, outN]
}

/** glTF 의 PBR 재질을 이 게임의 Lambert 로 (다른 괴물 · 조명과 맞추고 가볍게) */
function toLambert(src: THREE.MeshStandardMaterial, spec: ModelSpec): THREE.Material {
  const mat = new THREE.MeshLambertMaterial({
    map: src.map ?? null,
    normalMap: src.normalMap ?? null,
    color: src.color ? src.color.clone() : new THREE.Color(1, 1, 1),
    side: src.side,
  })
  if (spec.tint) mat.color.multiply(new THREE.Color(...spec.tint))
  const glow = spec.glow?.[src.name]
  if (glow !== undefined) {
    // 눈: 조명과 상관없이 빛난다
    mat.emissive = new THREE.Color(glow)
    mat.emissiveIntensity = 1.4
  }
  return mat
}

/** 뼈대가 있는 장면 복제 (뼈 참조까지 새로) */
function cloneSkinned(src: THREE.Object3D): THREE.Object3D {
  const map = new Map<THREE.Object3D, THREE.Object3D>()
  const clone = src.clone(true)
  const a: THREE.Object3D[] = []
  const b: THREE.Object3D[] = []
  src.traverse((o) => a.push(o))
  clone.traverse((o) => b.push(o))
  a.forEach((o, i) => map.set(o, b[i]))
  clone.traverse((o) => {
    const sm = o as THREE.SkinnedMesh
    if (!sm.isSkinnedMesh) return
    const orig = a[b.indexOf(o)] as THREE.SkinnedMesh
    const bones = orig.skeleton.bones.map((bn) => map.get(bn) as THREE.Bone)
    sm.bind(new THREE.Skeleton(bones, orig.skeleton.boneInverses), orig.bindMatrix)
  })
  return clone
}
