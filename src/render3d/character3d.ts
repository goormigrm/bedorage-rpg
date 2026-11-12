// 덕코프식 일체형 캐릭터: 머리와 몸이 하나인 달걀형 몸통에 얼굴·옷이 텍스처로 그려진다.
// 머리카락·모자·귀·마이크는 작은 메쉬, 팔은 옆구리의 짧은 캡슐(총을 앞에 든 자세), 다리는 바닥의 작은 캡슐.
// 로컬 좌표: 발 아래 원점, +y 위, 정면 = +z. 단위 1 = 타일 한 칸(32px).

import * as THREE from 'three'
import { CharacterDef, Look } from '../core/characters'
import { WEAPONS, WeaponDef } from '../core/weapons'
import { bodyTexture, labelTexture } from './faceTexture'
import { ToonFx, toonMat } from './toon'
import { Bake, Tint, V3, at, ball, hoop, limb } from './bake'
import { buildGun } from './weapon3d'

export { buildGun }

const OUTLINE = 0x2b2412

/** 달걀 세로 비율 (반지름 대비) */
const EGG_Y = 1.15
/** 가려진 몸 윤곽의 짙기 */
const XRAY_OPACITY = 0.7
/** 정수리 쪽 좁아지는 정도 */
const EGG_TAPER = 0.1
const LEG_H = 0.14
/** 손에 든 총의 배율 */
const GUN_HOLD = 1.4

/** 계란 캐릭터 재질: 툰 명암 + 먹선 (2026-10-08 G8) + 림 빛 (2026-11-12 — 위에서 받는 빛의 밝은 테 · 둥근 몸에 입체가 생긴다) */
const RIG_FX: ToonFx = { rim: 0.6 }
/** 등급 색 (items.ts RARITY_COLORS) — 투구 · 갑옷 장식 */
const RARITY_HEX = [0xd8d8d8, 0x6c9cff, 0xffd84a, 0xff8a2a, 0xe060ff]

/** 몸 반지름: 대두·덩치가 둘 다 달걀 크기에 반영된다 */
export function eggRadius(L: Look): number {
  return 0.4 * (0.55 * L.headScale + 0.45 * L.bodyScale)
}

/** 구 지오메트리를 달걀형으로 (위가 좁고, 세로로 길게). 중심은 원점 */
function eggify(g: THREE.BufferGeometry, r: number): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const t = y / r
    const k = 1 - EGG_TAPER * Math.max(0, t)
    pos.setXYZ(i, x * k, y * EGG_Y, z * k)
  }
  pos.needsUpdate = true
  g.computeVertexNormals()
  return g
}

/** 달걀 표면의 높이 y(중심 기준)에서의 가로 반지름 */
function eggRadiusAt(r: number, y: number): number {
  const t = Math.max(-1, Math.min(1, y / (r * EGG_Y)))
  const k = 1 - EGG_TAPER * Math.max(0, t)
  return r * Math.sqrt(Math.max(0, 1 - t * t)) * k
}

export interface CharacterRig {
  /** 무적 보호막 (렌더러가 처음 필요할 때 만든다) */
  shield?: THREE.Mesh
  root: THREE.Group
  body: THREE.Group
  head: THREE.Group
  arms: THREE.Group
  legL: THREE.Mesh
  legR: THREE.Mesh
  gunTip: THREE.Object3D
  def: CharacterDef
  weapon: WeaponDef
  /** 고기 악기의 고기 (items.ts MEATS 번호 — 철면란) */
  meat: number
  /** 이름표 높이 (발 기준) */
  height: number
  /** 몸통(달걀) 중심 높이 — 구르기 회전축 */
  centerY: number
  /** 걸음 폭 배율 (다리가 길수록 성큼성큼). 렌더러의 걷기 애니메이션이 쓴다 */
  stride: number
  /** 가려진 몸 윤곽 (판 안에서만 켠다 — enableXray) */
  xray: THREE.Mesh
  /** 피격 플래시용 재질 목록 */
  flashMats: THREE.MeshToonMaterial[]
  /** 피격 플래시. tint 는 색(기본 흰색) — 몸통은 빨강, 머리는 금색 */
  setFlash(k: number, tint?: number): void
  /** 무기 바꿔 끼우기 (무기 칸에 변형 무기를 끼면 — 리볼버 · 석궁 … · 고기 악기는 고기가 바뀌어도 · 등급이 바뀌어도) */
  setWeapon(w: WeaponDef, meat?: number, rarity?: number): void
  /** 낀 무기의 등급 (장식 — weapon3d trim) */
  rarity: number
  /** 투구 · 갑옷 등급을 겉모습에 (2026-11-12): 투구 = 머리띠와 보석 · 갑옷 = 어깨 보호대. 0 이면 없음 */
  setGear(helm: number, armor: number): void
  /** 눈 깜빡임 (감은 얼굴 그림으로 잠깐 바꾼다 — 뜬 눈인 캐릭터만) */
  setBlink(on: boolean): void
}

export function buildCharacter(def: CharacterDef): CharacterRig {
  const L = def.look
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  const flashMats: THREE.MeshToonMaterial[] = []
  const track = (m: THREE.MeshToonMaterial) => {
    flashMats.push(m)
    return m
  }
  // 부품은 모두 정점 색으로 칠해 이 재질 하나로 그린다 (bake.ts — 머리 장식 · 팔 · 다리가 메시 하나씩)
  const rigM = track(toonMat({ vertexColors: true }, 0.7, RIG_FX))

  const R = eggRadius(L)
  // 가로(마름)·세로(키) 배율. 몸통 그룹에 걸어 두면 구르기 회전에도 같이 따라 돈다
  const wide = L.slim ?? 1
  const tall = L.tall ?? 1
  // 위에서 내려다보는 시점이라 세로로 늘리는 것만으로는 키 차이가 잘 안 보인다.
  // 그래서 키가 큰 쪽은 **다리를 더 길게** 해 몸을 바닥에서 띄운다. 그림자와 벌어지는 거리가 키로 읽힌다.
  const legStretch = Math.max(0.35, 1 + (tall - 1) * 2.2)
  const legLen = (LEG_H + R * 0.25) * legStretch
  const centerY = LEG_H * legStretch + R * EGG_Y
  const top = R * EGG_Y
  const cloth = L.coat !== undefined ? L.coat : L.shirt

  // ---- 다리: 바지 통 · 바짓단 · 운동화(몸 · 앞코 · 흰 밑창) — 다리 하나가 메시 하나 ----
  const pants = L.pants ?? 0x34405a
  const legR0 = 0.062
  const mkLeg = () => {
    const b = new Bake()
    b.add(limb(V3(0, 0, 0), V3(0, -legLen + 0.06, 0), legR0 * 1.18, legR0, 10), pants)
    b.add(ball(legR0 * 1.18), pants)
    b.add(at(new THREE.CylinderGeometry(legR0 * 1.2, legR0 * 1.2, 0.024, 10), 0, -legLen + 0.07, 0), pants, () => -0.3)
    const sy = -legLen + legR0 * 0.9
    b.add(ball(legR0 * 1.75, 0, sy, legR0 * 1.0, 1, 0.62, 1.55, 14, 10), 0x2a2622)
    b.add(ball(legR0 * 1.25, 0, sy + 0.002, legR0 * 2.25, 1.08, 0.56, 0.9, 10, 8), def.accentColor, () => 0.12)
    b.add(at(new THREE.CylinderGeometry(legR0 * 1.78, legR0 * 1.78, 0.02, 14), 0, -legLen + 0.01, legR0 * 1.0, 0, 0, 0, 1, 1, 1.55), 0xf2efe6)
    return b.mesh(rigM)
  }
  const legL = mkLeg()
  const legR = mkLeg()
  legL.position.set(-R * 0.36, legLen, 0)
  legR.position.set(R * 0.36, legLen, 0)
  body.add(legL, legR)

  // ---- 몸통 (달걀, 얼굴·옷 텍스처) ----
  const head = new THREE.Group() // 머리 장식이 붙는 그룹 (몸통 중심)
  head.position.y = centerY
  body.add(head)
  const bodyM = track(toonMat({ map: bodyTexture(def) }, 0.7, RIG_FX))
  const egg = new THREE.Mesh(eggify(new THREE.SphereGeometry(R, 40, 28), R), bodyM)
  egg.castShadow = true
  head.add(egg)
  // 가려진 몸: 무언가(거대한 보스 · 벽) 뒤에 있으면 옅은 윤곽만 보인다 (2026-09-24 — 보스가 네 배로 커져 뒤에 선 사람이 사라졌다).
  // 깊이 시험을 거꾸로(GreaterDepth) — 앞에 가린 것이 있는 자리에만 그린다. 가장자리만 밝게(프레넬) — 납작한 원판이 아니라 윤곽으로 보이게
  const xrayM = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(0x9fd8ff) }, opacity: { value: XRAY_OPACITY } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 color; uniform float opacity; varying vec3 vN; varying vec3 vV; void main() { float f = 1.0 - max(dot(normalize(vN), normalize(vV)), 0.0); gl_FragColor = vec4(color, opacity * (0.18 + 0.82 * f * f)); }',
    transparent: true,
    depthWrite: false,
    depthFunc: THREE.GreaterDepth,
  })
  xrayM.userData.xray = true
  // 스텐실: 캐릭터 몸 · 옷 · 무기가 찍힌 자리(1)에는 그리지 않는다 — 제 모자 · 머리칼 · 손에 가린 몸이 파란 선으로 보였다(2026-09-24 대기실)
  xrayM.stencilWrite = true
  xrayM.stencilWriteMask = 0
  xrayM.stencilRef = 1
  xrayM.stencilFunc = THREE.NotEqualStencilFunc
  const xray = new THREE.Mesh(egg.geometry, xrayM)
  xray.renderOrder = 8
  // 판 안에서만 켠다 (enableXray) — 대기실 모닥불 장면에는 가릴 것이 없다
  xray.visible = false
  egg.add(xray)

  // ---- 머리 장식: 귀 · 머리카락 · 모자 · 옷깃 · 후드 … 를 메시 하나로 ----
  const deco = new Bake()
  const earY = top * 0.48
  const earS = (L.earScale ?? 1) * R * 0.2
  if (L.animal === 'cat') {
    // 고양이: 뾰족한 귀(안쪽 분홍) · 등 뒤로 말아 올린 꼬리(끝이 짙다)
    const fur = L.furColor ?? L.skin
    for (const side of [-1, 1]) {
      const ex = side * R * 0.5
      const ey = top * 0.82
      deco.add(at(new THREE.ConeGeometry(R * 0.26, R * 0.5, 4), ex, ey + R * 0.16, R * 0.02, 0, Math.PI / 4, -side * 0.42, 1, 1, 0.55), fur)
      deco.add(at(new THREE.ConeGeometry(R * 0.15, R * 0.32, 4), ex * 1.01, ey + R * 0.13, R * 0.075, 0, Math.PI / 4, -side * 0.42, 1, 1, 0.4), 0xffb8b0)
    }
    const ty = -top * 0.55
    const curve = new THREE.CatmullRomCurve3([V3(0, ty, -eggRadiusAt(R, ty) * 0.9), V3(R * 0.1, ty - R * 0.05, -R * 1.05), V3(R * 0.28, ty + R * 0.3, -R * 1.3), V3(R * 0.2, ty + R * 0.75, -R * 1.22), V3(R * 0.02, ty + R * 0.95, -R * 1.02)])
    deco.add(new THREE.TubeGeometry(curve, 14, R * 0.085, 7), fur, (_x, y) => (y > ty + R * 0.62 ? -0.35 : 0))
    deco.add(ball(R * 0.085, R * 0.02, ty + R * 0.95, -R * 1.02), fur, () => -0.35)
  } else {
    // 귀: 눈 높이 옆 — 귓바퀴 + 안쪽 그늘
    for (const side of [-1, 1]) {
      const ex = side * (eggRadiusAt(R, earY) - earS * 0.2)
      deco.add(ball(earS, ex, earY, R * 0.02, 0.45, 1, 0.75, 12, 10), L.skin)
      deco.add(ball(earS * 0.55, ex + side * earS * 0.28, earY - earS * 0.05, R * 0.02 + earS * 0.16, 0.4, 0.9, 0.6, 8, 6), L.skin, () => -0.22)
    }
  }
  buildHair(deco, L, def, R)
  // 옷깃: 그림 한 줄이던 목선을 도톰한 띠로 (앞은 낮고 뒤는 높다 — faceTexture 의 옷깃 선과 같은 기울기). V넥은 그림 그대로 · 후드는 굵게
  if (L.neck !== 'v') {
    const yf = Math.cos(0.7 * Math.PI) * top
    const yb = Math.cos(0.58 * Math.PI) * top
    const rf = eggRadiusAt(R, yf)
    const rb = eggRadiusAt(R, yb)
    const rho = Math.hypot(yf - yb, rf + rb) / 2
    const tilt = -Math.atan2(yf - yb, rf + rb)
    const yc = (yf + yb) / 2
    const hooded = L.hood !== undefined
    const tube = R * (hooded ? 0.085 : 0.04)
    const g = new THREE.TorusGeometry(rho * 1.0, tube, 7, 30)
    g.rotateX(Math.PI / 2)
    deco.add(at(g, 0, yc, (rf - rb) / 2, tilt, 0, 0, (eggRadiusAt(R, yc) / rho) * 1.01, 1, 1), hooded ? L.hood! : cloth, () => (hooded ? 0 : L.coat !== undefined ? 0.14 : -0.14))
    if (hooded) {
      // 등에 늘어진 후드 주머니 + 앞의 끈 둘
      deco.add(ball(R * 0.42, 0, yb - R * 0.12, -rb * 0.92, 1.25, 0.8, 0.5, 14, 10), L.hood!)
      for (const side of [-1, 1]) deco.add(limb(V3(side * R * 0.14, yf + R * 0.02, rf * 1.0), V3(side * R * 0.17, yf - R * 0.2, eggRadiusAt(R, yf - R * 0.2) * 1.02), R * 0.022, R * 0.022, 6), 0xf4f0e6)
    }
  }
  // 나비넥타이 (단군란): 그림 위에 도톰하게
  if (L.bowTie !== undefined) {
    const y = Math.cos(0.7 * Math.PI) * top - R * 0.02
    const z = eggRadiusAt(R, y) * 1.03
    for (const side of [-1, 1]) deco.add(at(new THREE.ConeGeometry(R * 0.11, R * 0.2, 4), side * R * 0.1, y, z, 0, 0, side * Math.PI / 2, 1, 1, 0.5), L.bowTie)
    deco.add(ball(R * 0.045, 0, y, z + R * 0.01), 0x333333)
  }
  const decoMesh = deco.mesh(rigM)
  head.add(decoMesh)
  // 모자 라벨 ("침착") — 글자 그림이라 따로
  if (L.extra === 'cap' && L.capText) {
    const brimY = Math.cos(Math.PI * 0.34) * top * 1.08
    const labelM = toonMat({ map: labelTexture(L.capText, L.capBand ?? 0xf4f4f0, def.accentColor) }, 0.7, RIG_FX)
    const label = new THREE.Mesh(new THREE.PlaneGeometry(R * 0.62, R * 0.31), labelM)
    const ly = brimY + R * 0.28
    label.position.set(0, ly, eggRadiusAt(R * 1.08, ly / 1.0) + 0.012)
    label.rotation.x = -0.35
    head.add(label)
  }

  // ---- 팔 + 무기 (옆구리에서 앞으로, 하나의 그룹) ----
  const arms = new THREE.Group()
  // 팔은 얼굴 아래(옷깃 높이)에서 앞으로 — 총이 입을 가리지 않게
  const armY = -top * 0.3
  arms.position.set(0, centerY + armY, eggRadiusAt(R, armY) * 0.5)
  body.add(arms)
  const armLen = R * 0.9
  const armR = R * 0.15
  const gs = Math.max(0.8, R / 0.42)
  /**
   * 두 팔을 메시 하나로 (2026-11-12): 전에는 두 팔이 나란히 앞으로 뻗은 막대였다 — 팔꿈치를 옆으로 벌려(뒤 · 위에서 보인다)
   * 오른손은 손잡이를, 왼손은 총열 덮개를 받친다. 겉옷이 있으면 긴소매 + 흰 소매 끝, 없으면 반소매 + 맨 팔
   */
  const mkArms = (melee: boolean): THREE.Mesh => {
    const b = new Bake()
    const rs = eggRadiusAt(R, armY) * 0.82
    const long = L.coat !== undefined || L.hood !== undefined
    for (const side of [-1, 1]) {
      const S = V3(side * rs, 0, -R * 0.15)
      const E = V3(side * (rs + R * 0.1), -R * 0.2, R * 0.24)
      const rear = side < 0
      const H = melee
        ? V3(side * R * 0.07, -0.015, armLen * 0.55 + (rear ? 0.0 : 0.075))
        : rear
          ? V3(-0.012, -0.02 - 0.085 * GUN_HOLD * gs, armLen * 0.55 + 0.01)
          : V3(0.035, -0.02 - 0.045 * GUN_HOLD * gs, armLen * 0.55 + R * 0.52)
      b.add(ball(armR * 1.25, S.x, S.y, S.z, 1, 1, 1, 10, 8), cloth)
      b.add(limb(S, E, armR * 1.15, armR, 10), cloth)
      b.add(ball(armR * 1.02, E.x, E.y, E.z, 1, 1, 1, 10, 8), long ? cloth : L.skin)
      const W = E.clone().lerp(H, 0.8)
      b.add(limb(E, W, armR, armR * 0.86, 10), long ? cloth : L.skin)
      if (long) b.add(limb(W, E.clone().lerp(H, 0.9), armR * 0.98, armR * 0.98, 8), L.coat !== undefined ? L.shirt : cloth, () => (L.coat !== undefined ? 0 : -0.2))
      else b.add(at(new THREE.TorusGeometry(armR * 1.02, armR * 0.2, 5, 10), E.x, E.y, E.z, 0, side * 0.9, 0), cloth, () => -0.2)
      // 손: 벙어리 손 + 엄지
      b.add(ball(armR * 1.3, H.x, H.y, H.z, 1, 0.9, 1.1, 10, 8), L.skin)
      b.add(ball(armR * 0.6, H.x - side * armR * 0.9, H.y + armR * 0.55, H.z + armR * 0.3, 1, 1, 1, 8, 6), L.skin)
    }
    return b.mesh(rigM)
  }
  const weapon = WEAPONS[def.weapon]
  let armsMesh = mkArms(!!weapon.melee)
  arms.add(armsMesh)
  // 총은 몸에 비해 작아 모양이 안 보였다 — 손에 든 총만 키운다 (근접 무기는 이미 크다 · 1인칭 손 총은 따로 · 2026-10-24)
  const hold = (w: WeaponDef, gg: THREE.Group) => {
    gg.position.set(0.02, -0.02, armLen * 0.55)
    if (!w.melee) gg.scale.setScalar(GUN_HOLD)
    arms.add(gg)
  }
  let gun = buildGun(weapon, R)
  hold(weapon, gun.group)

  // ---- 투구 · 갑옷 등급 장식 (끼면 겉모습에 드러난다) ----
  let gear: THREE.Group | null = null
  let gearKey = 0
  let blinkTex: THREE.Texture | null = null

  body.scale.set(wide, tall, wide)
  const height = (centerY + R * EGG_Y + R * 0.35) * tall
  const dropGroup = (g: THREE.Object3D) => {
    g.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      m.geometry.dispose()
      if (m.material !== rigM) (m.material as THREE.Material).dispose()
    })
  }
  const rig: CharacterRig = {
    root, body, head, arms, legL, legR, gunTip: gun.tip, def, weapon, meat: 0, rarity: 0, height, centerY, xray,
    stride: Math.max(0.7, Math.min(1.55, legStretch)),
    flashMats,
    setFlash(k: number, tint = 0xffffff) {
      const e = k > 0 ? new THREE.Color(tint).multiplyScalar(k) : new THREE.Color(0, 0, 0)
      for (const m of flashMats) m.emissive.copy(e)
    },
    setWeapon(w: WeaponDef, meat = 0, rarity = 0) {
      if (rig.weapon.id === w.id && rig.meat === meat && rig.rarity === rarity) return
      arms.remove(gun.group)
      dropGroup(gun.group)
      gun = buildGun(w, R, meat, rarity)
      hold(w, gun.group)
      if (!!w.melee !== !!rig.weapon.melee) {
        // 근접 ↔ 총: 손 자리가 다르다
        arms.remove(armsMesh)
        armsMesh.geometry.dispose()
        armsMesh = mkArms(!!w.melee)
        arms.add(armsMesh)
        if (xray.visible) markStencil(armsMesh)
      }
      if (xray.visible) markStencil(gun.group)
      // 쓰러져 흐려지는 중에 바뀐 무기도 같은 짙기로
      if (rigM.opacity < 1) setRigOpacity(rig, rigM.opacity)
      rig.gunTip = gun.tip
      rig.weapon = w
      rig.meat = meat
      rig.rarity = rarity
    },
    setGear(helm: number, armor: number) {
      const key = helm * 8 + armor
      if (key === gearKey) return
      gearKey = key
      if (gear) {
        head.remove(gear)
        dropGroup(gear)
        gear = null
      }
      if (helm <= 0 && armor <= 0) return
      gear = buildGear(L, R, helm, armor, rigM, armY)
      head.add(gear)
      if (xray.visible) markStencil(gear)
      if (rigM.opacity < 1) setRigOpacity(rig, rigM.opacity)
    },
    setBlink(on: boolean) {
      if (!canBlink(def)) return
      const want = on ? (blinkTex ??= bodyTexture(def, true)) : bodyTexture(def)
      if (bodyM.map !== want) bodyM.map = want
    },
  }
  return rig
}

/** 스스로 빛나는 장식 재질 (전설 · 신화 보석과 테) — 캐릭터 재질과 같은 셰이더 */
function glowMat(c: number): THREE.MeshToonMaterial {
  const m = toonMat({ vertexColors: true }, 0.7, RIG_FX)
  m.emissive.set(c).multiplyScalar(0.75)
  return m
}

/**
 * 투구 · 갑옷 등급 장식 (2026-11-12 — 전에는 무엇을 끼든 겉모습이 같았다): 투구 = 이마의 머리띠 + 등급 색 보석(희귀부터 금테 · 전설부터 빛나고 깃 둘 · 신화는 뿔 셋),
 * 갑옷 = 어깨 보호대(등급 색 테 · 전설부터 빛난다 · 신화는 가시). 메시 하나(빛나는 것이 있으면 둘)
 */
function buildGear(L: Look, R: number, helm: number, armor: number, rigM: THREE.Material, armY: number): THREE.Group {
  const g = new THREE.Group()
  const b = new Bake()
  const glows = new Map<number, Bake>()
  const glow = (c: number) => {
    let x = glows.get(c)
    if (!x) glows.set(c, (x = new Bake()))
    return x
  }
  const top = R * EGG_Y
  const STEEL = 0x8a93a0
  const GOLD = 0xe0b548
  if (helm > 0) {
    const c = RARITY_HEX[helm] ?? RARITY_HEX[1]
    const y = top * 0.6
    const rr = eggRadiusAt(R, y) * 1.12
    b.add(hoop(rr, R * 0.04, y), helm >= 2 ? GOLD : STEEL)
    const to = helm >= 3 ? glow(c) : b
    to.add(at(new THREE.OctahedronGeometry(R * 0.085), 0, y + R * 0.02, rr + R * 0.02, 0, 0, 0, 0.8, 1.25, 0.6), c)
    if (helm >= 3) {
      for (const side of [-1, 1]) b.add(at(new THREE.ConeGeometry(R * 0.075, R * 0.34, 4), side * rr * 0.98, y + R * 0.15, -R * 0.06, -0.5, 0, -side * 0.3, 0.5, 1, 1.3), GOLD)
    }
    if (helm >= 4) {
      for (const a of [-0.5, 0, 0.5]) b.add(at(new THREE.ConeGeometry(R * 0.05, R * (a === 0 ? 0.26 : 0.18), 4), Math.sin(a) * rr, y + R * (a === 0 ? 0.2 : 0.14), Math.cos(a) * rr), GOLD)
    }
  }
  if (armor > 0) {
    const c = RARITY_HEX[armor] ?? RARITY_HEX[1]
    const rs = eggRadiusAt(R, armY) * 0.95
    const to = armor >= 3 ? glow(c) : b
    for (const side of [-1, 1]) {
      const x = side * rs
      const y = armY + R * 0.16
      b.add(ball(R * 0.25, x, y, -R * 0.06, 1, 0.62, 1.15, 12, 8), armor >= 2 ? 0x6a7280 : STEEL)
      const ring = new THREE.TorusGeometry(R * 0.235, R * 0.028, 5, 14)
      ring.rotateX(Math.PI / 2)
      to.add(at(ring, x, y - R * 0.03, -R * 0.06, 0, 0, 0, 1, 1, 1.15), c)
      if (armor >= 4) b.add(at(new THREE.ConeGeometry(R * 0.06, R * 0.22, 5), x + side * R * 0.08, y + R * 0.2, -R * 0.06, 0, 0, -side * 0.5), GOLD)
    }
    // 가슴 보석 (희귀부터)
    if (armor >= 2) {
      const y = Math.cos(0.7 * Math.PI) * top - R * 0.16
      to.add(at(new THREE.OctahedronGeometry(R * 0.07), 0, y, eggRadiusAt(R, y) * 1.02, 0, 0, 0, 1, 1.2, 0.5), c)
    }
  }
  if (!b.empty) g.add(b.mesh(rigM))
  for (const [c, x] of glows) g.add(x.mesh(glowMat(c), false))
  void L
  return g
}

/** 눈 감은 얼굴 그림 (깜빡이는 캐릭터만 — 렌더러가 미리 올려 둔다) */
export function blinkTexture(def: CharacterDef): THREE.Texture | null {
  return canBlink(def) ? bodyTexture(def, true) : null
}

/** 뜬 눈으로 그려진 캐릭터만 깜빡인다 (웃는 눈 · 실눈은 늘 감은 모양) */
function canBlink(def: CharacterDef): boolean {
  const e = def.look.eyes
  return def.look.glasses !== 'sunglasses' && (e === 'normal' || e === 'angry' || e === 'calm' || e === 'sharp' || e === 'lidded')
}

/** 달걀 표면을 따라가는 캡(머리카락 · 모자). thetaLength 는 정수리부터의 각도 */
function capGeo(r: number, scale: number, thetaLength: number, phiStart = 0, phiLength = Math.PI * 2): THREE.BufferGeometry {
  return eggify(new THREE.SphereGeometry(r * scale, 28, 14, phiStart, phiLength, 0, thetaLength), r * scale)
}

/** 캡 아래 끝의 도톰한 단 (얇은 껍질 끝이 칼로 자른 듯했다 — 머리카락 · 모자에 두께가 생긴다) */
function capRim(r: number, scale: number, theta: number, tube: number, phi0 = 0, phiLen = Math.PI * 2): THREE.BufferGeometry {
  const c = Math.cos(theta)
  const rr = Math.sin(theta) * r * scale * (1 - EGG_TAPER * Math.max(0, c))
  return hoop(rr, tube, c * r * scale * EGG_Y, phi0, phiLen, Math.max(8, Math.round((28 * phiLen) / (Math.PI * 2))))
}

function buildHair(d: Bake, L: Look, def: CharacterDef, R: number): void {
  const top = R * EGG_Y
  const hc = L.hairColor
  // 윤기 띠: 정수리 아래 한 바퀴가 조금 밝다 (검은 머리가 한 색 덩어리였다) · 아래 끝은 조금 짙게
  // + 머리카락 결: 정수리에서 내려오는 가닥을 한 줄 걸러 조금 다른 밝기로 (매끈하면 헬멧처럼 보였다)
  const hcC = new THREE.Color(hc)
  const strand = hcC.r + hcC.g + hcC.b < 0.25 ? 0.03 : -0.07
  const sheen: Tint = (x, y, z) => {
    const t = (top * 1.05 - y) / (top * 0.6)
    const col = Math.round((Math.atan2(z, x) / (Math.PI * 2)) * 28)
    return 0.09 * Math.exp(-(((t - 0.33) / 0.16) ** 2)) + (t > 0.12 && col % 2 === 0 ? strand : 0)
  }
  const rimT = R * 0.04
  switch (L.hair) {
    case 'spiky': {
      // 회색 옆머리 띠: 눈 위 높이, 앞(얼굴)은 비우고 옆·뒤로만
      if (L.sideColor !== undefined) {
        d.add(eggify(new THREE.SphereGeometry(R * 1.03, 28, 10, Math.PI * 0.85, Math.PI * 1.3, Math.PI * 0.25, Math.PI * 0.14), R * 1.03), L.sideColor)
      }
      d.add(capGeo(R, 1.04, Math.PI * 0.24), hc)
      // 가시 머리: 바깥 줄(크게 · 밖으로 눕는다) + 안쪽 줄 + 가운데 하나
      const spike = (a: number, ring: number, len: number, lean: number) => {
        d.add(at(new THREE.ConeGeometry(R * 0.14, R * len, 6), Math.cos(a) * R * ring, top * 0.9 + R * len * 0.25, Math.sin(a) * R * ring, Math.sin(a) * lean, 0, -Math.cos(a) * lean), hc, (_x, y) => (y > top * 1.12 ? 0.16 : 0))
      }
      for (let i = 0; i < 8; i++) spike((i / 8) * Math.PI * 2 + 0.2, 0.52, 0.62 + (i % 3) * 0.12, 0.75)
      for (let i = 0; i < 5; i++) spike((i / 5) * Math.PI * 2 + 0.7, 0.26, 0.7 + (i % 2) * 0.14, 0.35)
      spike(0, 0, 0.8, 0)
      if (L.crown === 'star') {
        // 흰 별 (철면수심 마스코트): 다섯 꼭짓점 별을 이마 위에 세운다
        const sh = new THREE.Shape()
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2 + Math.PI / 2
          const rr = R * (i % 2 === 0 ? 0.24 : 0.1)
          if (i === 0) sh.moveTo(Math.cos(a) * rr, Math.sin(a) * rr)
          else sh.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
        }
        sh.closePath()
        const star = new THREE.ExtrudeGeometry(sh, { depth: R * 0.05, bevelEnabled: true, bevelThickness: R * 0.02, bevelSize: R * 0.02, bevelSegments: 1 })
        d.add(at(star, 0, top * 1.2, R * 0.4, -0.35), 0xffffff)
      }
      break
    }
    case 'bowl': {
      // 바가지: 눈썹 위까지 덮는 둥근 캡 + 도톰한 끝단
      d.add(capGeo(R, 1.06, Math.PI * 0.4), hc, sheen)
      d.add(capRim(R, 1.06, Math.PI * 0.4, R * 0.03), hc)
      break
    }
    case 'short':
    case 'flat':
    case 'side': {
      d.add(capGeo(R, 1.05, Math.PI * 0.26), hc, sheen)
      // 뒷머리: 뒤쪽만 더 내려온다
      d.add(capGeo(R, 1.045, Math.PI * 0.42, Math.PI * 1.1, Math.PI * 0.8), hc, sheen)
      d.add(capRim(R, 1.045, Math.PI * 0.42, rimT, Math.PI * 1.1, Math.PI * 0.8), hc)
      d.add(capRim(R, 1.05, Math.PI * 0.26, rimT, Math.PI * 0.05, Math.PI * 0.9), hc)
      // 앞머리 볼륨: 이마 위로 넘긴 덩이 셋 (모자를 쓰면 안 보인다)
      if (L.extra !== 'cap') {
        const y = Math.cos(Math.PI * 0.2) * top * 1.05
        for (const [x, s] of [[-0.26, 0.2], [0.02, 0.25], [0.3, 0.19]] as const) d.add(ball(R * s, R * x, y + R * 0.02, eggRadiusAt(R, y) * 0.92, 1.15, 0.7, 0.9, 10, 8), hc)
      }
      break
    }
    case 'fringe': {
      // 짧은 머리 + 이마 한쪽을 덮는 옆으로 넘긴 앞머리 (보는 사람 기준 왼쪽으로 쏠림)
      d.add(capGeo(R, 1.05, Math.PI * 0.25), hc, sheen)
      d.add(capGeo(R, 1.045, Math.PI * 0.42, Math.PI * 1.1, Math.PI * 0.8), hc, sheen)
      d.add(capRim(R, 1.045, Math.PI * 0.42, rimT, Math.PI * 1.1, Math.PI * 0.8), hc)
      // 앞머리: 안경 위(이마)까지만, 보는 사람 기준 오른쪽으로 쏠린 조각
      d.add(capGeo(R, 1.055, Math.PI * 0.29, Math.PI * 0.44, Math.PI * 0.34), hc)
      d.add(capRim(R, 1.055, Math.PI * 0.29, rimT * 1.2, Math.PI * 0.44, Math.PI * 0.34), hc)
      d.add(capRim(R, 1.05, Math.PI * 0.25, rimT, Math.PI * 0.05, Math.PI * 0.39), hc)
      // 가르마 옆으로 뻗친 머리 한 가닥
      d.add(at(new THREE.ConeGeometry(R * 0.07, R * 0.3, 5), -R * 0.12, top * 1.07, -R * 0.1, -0.5, 0, 0.5), hc)
      break
    }
    case 'buzz': {
      d.add(capGeo(R, 1.02, Math.PI * 0.3), hc)
      break
    }
    case 'bob': {
      // 단발(통천란): 정수리 캡 + 볼 옆·뒤로 턱까지 내려오는 커튼 + 일자 앞머리.
      // 얼굴은 +Z 쪽(phi = pi/2)이라 커튼은 그 앞을 비워 둔다.
      d.add(capGeo(R, 1.05, Math.PI * 0.32), hc, sheen)
      d.add(capGeo(R, 1.05, Math.PI * 0.64, Math.PI * 0.82, Math.PI * 1.36), hc, sheen)
      d.add(capGeo(R, 1.058, Math.PI * 0.36, Math.PI * 0.27, Math.PI * 0.46), hc)
      // 안으로 말린 머리끝 · 일자 앞머리 끝단
      d.add(capRim(R, 1.05, Math.PI * 0.64, R * 0.06, Math.PI * 0.82, Math.PI * 1.36), hc)
      d.add(capRim(R, 1.058, Math.PI * 0.36, rimT, Math.PI * 0.27, Math.PI * 0.46), hc)
      break
    }
    case 'none':
    default:
      break
  }
  if (L.extra === 'cap') {
    // 야구 모자: 통 · 끝단 · 꼭대기 단추 · 납작한 챙 · 앞 핀
    const band = L.capBand ?? 0xf4f4f0
    d.add(capGeo(R, 1.08, Math.PI * 0.34), def.accentColor, (x, y, z) => (Math.abs(Math.atan2(z, x) % (Math.PI / 3)) < 0.03 && y < top ? -0.18 : 0))
    d.add(capRim(R, 1.08, Math.PI * 0.34, R * 0.03), def.accentColor, () => -0.15)
    d.add(ball(R * 0.07, 0, top * 1.08, 0, 1, 0.5, 1, 8, 6), def.accentColor, () => -0.15)
    const brimY = Math.cos(Math.PI * 0.34) * top * 1.08
    d.add(ball(R * 0.62, 0, brimY, eggRadiusAt(R, brimY) * 0.85, 1.15, 0.08, 1.05, 16, 10), band)
    if (L.capPin !== undefined) d.add(ball(R * 0.07, R * 0.3, brimY + R * 0.26, eggRadiusAt(R * 1.08, brimY + R * 0.26) * 0.99, 1, 1, 0.5, 8, 6), L.capPin)
  }
  if (L.extra === 'mic') {
    // 손 마이크: 자루 · 고리 · 그물 머리
    const my = -R * 0.12
    d.add(at(new THREE.CapsuleGeometry(0.02, R * 0.6, 3, 8), R * 0.4, my - R * 0.3, eggRadiusAt(R, my) * 0.95, 0, 0, -0.5), 0x2b2b2b)
    d.add(ball(R * 0.15, R * 0.26, my, eggRadiusAt(R, my) * 0.98, 1, 1, 1, 12, 10), 0x8f8f8f, (_x, y) => (Math.round((y - my) / (R * 0.05)) % 2 === 0 ? 0.25 : 0))
    d.add(at(new THREE.TorusGeometry(R * 0.11, R * 0.025, 5, 12), R * 0.3, my - R * 0.1, eggRadiusAt(R, my) * 0.97, Math.PI / 2, -0.5, 0), 0xd0d0d0)
  }
}

/** 죽었을 때 재질을 반투명으로 (페이드) */
/** 무적 보호막(황금 구). 렌더러가 필요할 때 만들어 rig.root 에 붙인다 */
export function makeShield(radius: number): THREE.Mesh {
  const geo = new THREE.SphereGeometry(radius, 22, 16)
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.3, depthWrite: false })
  const m = new THREE.Mesh(geo, mat)
  m.renderOrder = 5
  return m
}

/**
 * 캐릭터 재질이 스텐실에 1 을 찍게 한다 (가려진 몸 윤곽이 제 몸 위에는 그려지지 않게).
 * 캐릭터는 다른 불투명한 것(보스 · 벽)보다 **나중에** 그린다(renderOrder 2) — 먼저 그리면 뒤에 올 보스에 덮일 자리에도 1 이 찍혀 윤곽이 막혔다
 */
function markStencil(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = (c as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
    if (!m) return
    if (!(Array.isArray(m) ? m : [m]).some((mm) => mm.userData.xray)) c.renderOrder = Math.max(c.renderOrder, 2)
    for (const mm of Array.isArray(m) ? m : [m]) {
      if (mm.userData.xray) continue
      mm.stencilWrite = true
      mm.stencilRef = 1
      mm.stencilFunc = THREE.AlwaysStencilFunc
      mm.stencilZPass = THREE.ReplaceStencilOp
    }
  })
}

/**
 * 가려진 몸 윤곽을 켠다 (판 렌더러만 — 거대한 보스 · 벽 뒤의 캐릭터). 렌더러는 stencil: true 로 만들어야 한다.
 * 캐릭터끼리 · 제 몸끼리 가린 곳에는 스텐실이 막아 그리지 않는다
 */
export function enableXray(rig: CharacterRig): void {
  markStencil(rig.root)
  rig.xray.visible = true
}

export function setRigOpacity(rig: CharacterRig, opacity: number): void {
  rig.root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
    if (!m) return
    const list = Array.isArray(m) ? m : [m]
    for (const mm of list) {
      if (mm.userData.xray) {
        ;(mm as THREE.ShaderMaterial).uniforms.opacity.value = XRAY_OPACITY * opacity
        continue
      }
      mm.transparent = opacity < 1 || (mm as THREE.MeshToonMaterial).map !== undefined
      mm.opacity = opacity
    }
  })
}

export { OUTLINE }
