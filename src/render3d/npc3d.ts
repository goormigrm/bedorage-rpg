// 마을 사람 (2026-10-08 퀄리티 4단계 — 전에는 원뿔 몸 + 두건이라 이 게임의 계란 캐릭터들 사이에서 혼자 어색했다):
// 플레이어처럼 **계란 몸**에 눈 · 볼 · 웃는 입, 역할마다 차림 하나씩.
//   상인 = 납작 모자 · 앞치마 · 돈주머니 / 대장장이 = 가죽 앞치마 · 머리띠 · 망치 · 옆에 모루 / 도박꾼 = 실크햇 · 나비넥타이 · 주사위
//   촌장 = 흰 수염 · 지팡이 (철면수심전용: 안내원 모모 = 분홍 모자 · 깃발 · 호루라기) / 용병 대장 = 투구 · 깃털 · 허리 칼
//   보관함 = 쇠테 궤짝 (철면수심전용: 민트 사물함 궤짝)
// 그림만 — 자리 · 말 걸기는 그대로(core/world townNpcs). 가만히 서서 숨 쉬듯 통통 (renderer3d updateMarkers 가 userData.npc 로 움직인다).

import * as THREE from 'three'
import type { NpcId } from '../core/world'
import { toonMat } from './toon'

const R = 0.4
const CY = 0.62
const EGG_Y = 1.25

/** 마을 사람 재질: 툰 명암 + 먹선 (2026-10-08 G8 — 계란 캐릭터와 같다) */
const lam = (color: number, extra: THREE.MeshToonMaterialParameters = {}) => toonMat({ color, ...extra })

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(geo, m)
  o.position.set(x, y, z)
  o.castShadow = true
  return o
}

/** 얼굴 텍스처: 계란 빛 바탕에 눈 · 볼 · 입, 아래쪽은 옷 띠 (SphereGeometry 의 u = 0.25 가 +z 정면) */
function faceTexture(cloth: number, beard: boolean): THREE.CanvasTexture {
  const W = 256
  const H = 128
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  g.fillStyle = '#f6ead6'
  g.fillRect(0, 0, W, H)
  // 옷 (아래 40%)
  g.fillStyle = `#${cloth.toString(16).padStart(6, '0')}`
  g.fillRect(0, H * 0.6, W, H * 0.4)
  const fx = W * 0.25
  // 눈
  for (const s of [-1, 1]) {
    g.fillStyle = '#2a1e18'
    g.beginPath()
    g.ellipse(fx + s * 11, H * 0.4, 4, 5.5, 0, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#ffffff'
    g.beginPath()
    g.arc(fx + s * 11 + 1.3, H * 0.4 - 2, 1.4, 0, Math.PI * 2)
    g.fill()
    // 볼
    g.fillStyle = 'rgba(255,140,140,0.45)'
    g.beginPath()
    g.ellipse(fx + s * 19, H * 0.48, 5, 3, 0, 0, Math.PI * 2)
    g.fill()
  }
  if (!beard) {
    g.strokeStyle = '#6a3a2a'
    g.lineWidth = 2
    g.beginPath()
    g.arc(fx, H * 0.47, 5, 0.15 * Math.PI, 0.85 * Math.PI)
    g.stroke()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** 계란 몸 + 발 + 손 (공통) */
function eggBody(f: THREE.Group, cloth: number, beard = false): { handL: THREE.Vector3; handR: THREE.Vector3 } {
  const egg = mesh(new THREE.SphereGeometry(R, 32, 22), toonMat({ map: faceTexture(cloth, beard) }), 0, CY, 0)
  egg.scale.set(1, EGG_Y, 1)
  f.add(egg)
  const shoe = lam(0x3a2e26)
  for (const s of [-1, 1]) {
    const foot = mesh(new THREE.SphereGeometry(0.1, 12, 8), shoe, s * 0.15, 0.06, 0.06)
    foot.scale.set(1, 0.6, 1.4)
    f.add(foot)
  }
  const skin = lam(0xf2dcc0)
  const handL = new THREE.Vector3(-R * 0.98, CY - 0.08, 0.1)
  const handR = new THREE.Vector3(R * 0.98, CY - 0.08, 0.1)
  f.add(mesh(new THREE.SphereGeometry(0.075, 10, 8), skin, handL.x, handL.y, handL.z), mesh(new THREE.SphereGeometry(0.075, 10, 8), skin, handR.x, handR.y, handR.z))
  return { handL, handR }
}

/** 몸 위 꼭대기 높이 */
const TOP = CY + R * EGG_Y

/** 마을 사람 하나 (bright = 철면수심전용) */
export function buildNpc(id: NpcId, bright: boolean): THREE.Group {
  const f = new THREE.Group()
  if (id === 'stash') {
    // 궤짝 (철면수심전용: 민트 사물함 궤짝)
    const box = mesh(new THREE.BoxGeometry(1.1, 0.7, 0.7), lam(bright ? 0x7fdcc0 : 0x4a3420), 0, 0.35, 0)
    const lid = mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.1, 14, 1, false, 0, Math.PI), lam(bright ? 0x9fe8d0 : 0x5a4028), 0, 0.7, 0)
    lid.rotation.z = Math.PI / 2
    lid.rotation.y = Math.PI / 2
    const band = mesh(new THREE.BoxGeometry(1.14, 0.08, 0.74), lam(bright ? 0xffd36e : 0x8a8070), 0, 0.55, 0)
    const lock = mesh(new THREE.BoxGeometry(0.16, 0.18, 0.06), lam(0xc9a24a), 0, 0.5, 0.37)
    f.add(box, lid, band, lock)
    return f
  }
  if (id === 'merchant') {
    const { handR } = eggBody(f, 0x5a7a3a)
    // 납작 모자 + 앞치마 + 돈주머니
    const capM = lam(0x6a8a4a)
    const dome = mesh(new THREE.SphereGeometry(0.26, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), capM, 0, TOP - 0.08, 0)
    dome.scale.set(1, 0.55, 1)
    const brim = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 16), capM, 0, TOP - 0.08, 0.18)
    brim.scale.set(1, 1, 0.6)
    const apron = mesh(new THREE.BoxGeometry(0.42, 0.36, 0.04), lam(0xf2e6c8), 0, CY - 0.22, R * 0.92)
    const pouch = mesh(new THREE.SphereGeometry(0.11, 12, 10), lam(0x8a5a2a), handR.x + 0.04, handR.y - 0.12, handR.z)
    const coin = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.015, 12), lam(0xffd34a, { emissive: 0x3a2a00 }), handR.x + 0.04, handR.y - 0.01, handR.z)
    f.add(dome, brim, apron, pouch, coin)
  } else if (id === 'smith') {
    const { handR } = eggBody(f, 0x4a3a30)
    const apron = mesh(new THREE.BoxGeometry(0.46, 0.44, 0.05), lam(0x5a3a24), 0, CY - 0.18, R * 0.9)
    const band = mesh(new THREE.TorusGeometry(R * 0.82, 0.035, 6, 24), lam(0xb83a2a), 0, CY + 0.32, 0)
    band.rotation.x = Math.PI / 2
    band.scale.set(1, 1, 1)
    // 망치: 손잡이 + 머리
    const hammer = new THREE.Group()
    hammer.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.45, 6), lam(0x7a5a3a), 0, 0.12, 0))
    hammer.add(mesh(new THREE.BoxGeometry(0.2, 0.1, 0.1), lam(0x8b949c), 0, 0.34, 0))
    hammer.position.copy(handR)
    hammer.rotation.z = -0.5
    // 모루 (옆)
    const anvil = new THREE.Group()
    anvil.add(mesh(new THREE.BoxGeometry(0.22, 0.28, 0.2), lam(0x3a3e44), 0, 0.14, 0))
    anvil.add(mesh(new THREE.BoxGeometry(0.46, 0.1, 0.22), lam(0x5a6068), 0, 0.33, 0))
    anvil.position.set(0.72, 0, 0.1)
    f.add(apron, band, hammer, anvil)
  } else if (id === 'gambler') {
    const { handL } = eggBody(f, 0x4a2a52)
    // 실크햇 + 띠 + 나비넥타이 + 주사위
    const hatM = lam(bright ? 0xc6a4ff : 0x2a1e30)
    const brim = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 18), hatM, 0, TOP - 0.06, 0)
    const crown = mesh(new THREE.CylinderGeometry(0.19, 0.2, 0.34, 18), hatM, 0, TOP + 0.11, 0)
    const ribbon = mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.06, 18), lam(0xd8402a), 0, TOP + 0.0, 0)
    const bowM = lam(0xd8402a)
    const bowL = mesh(new THREE.ConeGeometry(0.06, 0.12, 8), bowM, -0.06, CY - 0.06, R * 0.95)
    bowL.rotation.z = Math.PI / 2
    const bowR = mesh(new THREE.ConeGeometry(0.06, 0.12, 8), bowM, 0.06, CY - 0.06, R * 0.95)
    bowR.rotation.z = -Math.PI / 2
    const dieM = lam(0xffffff)
    const die1 = mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), dieM, handL.x - 0.02, handL.y + 0.1, handL.z)
    die1.rotation.set(0.5, 0.7, 0.2)
    const die2 = mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), dieM, handL.x + 0.1, handL.y + 0.16, handL.z + 0.04)
    die2.rotation.set(0.2, 0.3, 0.8)
    f.add(brim, crown, ribbon, bowL, bowR, die1, die2)
  } else if (id === 'elder') {
    if (bright) {
      // 안내원 모모: 분홍 모자(챙) · 깃발 · 호루라기
      const { handR } = eggBody(f, 0xff8fb8)
      const capM = lam(0xff8fb8)
      const dome = mesh(new THREE.SphereGeometry(0.27, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), capM, 0, TOP - 0.1, 0)
      dome.scale.set(1, 0.6, 1)
      const visor = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 16), lam(0xffffff), 0, TOP - 0.1, 0.2)
      visor.scale.set(1, 1, 0.65)
      const pole = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.9, 6), lam(0xffffff), handR.x, handR.y + 0.35, handR.z)
      const flag = mesh(new THREE.ConeGeometry(0.16, 0.3, 3), lam(0xffd36e, { side: THREE.DoubleSide }), handR.x + 0.14, handR.y + 0.68, handR.z)
      flag.rotation.z = -Math.PI / 2
      flag.scale.set(1, 1, 0.2)
      const whistle = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 8), lam(0xffd34a), 0.06, CY - 0.02, R * 0.96)
      whistle.rotation.z = Math.PI / 2
      f.add(dome, visor, pole, flag, whistle)
    } else {
      // 촌장 카인: 흰 수염 · 갈색 두건 · 지팡이
      const { handR } = eggBody(f, 0x5a5a4a, true)
      const beard = mesh(new THREE.ConeGeometry(0.17, 0.42, 12), lam(0xf2f0ea), 0, CY - 0.12, R * 0.82)
      beard.rotation.x = Math.PI
      const hood = mesh(new THREE.SphereGeometry(R * 1.04, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.32), lam(0x6a5a40), 0, CY + 0.02, 0)
      hood.scale.set(1, EGG_Y, 1)
      const staff = mesh(new THREE.CylinderGeometry(0.03, 0.035, 1.3, 6), lam(0x6a4a2a), handR.x + 0.05, 0.65, handR.z)
      const knob = mesh(new THREE.SphereGeometry(0.07, 10, 8), lam(0x8a6a3a), handR.x + 0.05, 1.32, handR.z)
      f.add(beard, hood, staff, knob)
    }
  } else if (id === 'captain') {
    const { handL } = eggBody(f, 0x5a2a22)
    // 투구 + 깃털 + 허리 칼
    const helm = mesh(new THREE.SphereGeometry(R * 1.05, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.33), lam(0x9aa4ad), 0, CY + 0.06, 0)
    helm.scale.set(1, EGG_Y, 1)
    const plume = mesh(new THREE.ConeGeometry(0.07, 0.36, 8), lam(bright ? 0xff8fb8 : 0xd8402a), 0, TOP + 0.14, -0.04)
    plume.rotation.x = -0.4
    const blade = mesh(new THREE.BoxGeometry(0.04, 0.5, 0.02), lam(0xd8dde2), handL.x - 0.02, handL.y - 0.28, handL.z)
    blade.rotation.z = 0.2
    const hilt = mesh(new THREE.BoxGeometry(0.16, 0.03, 0.05), lam(0xc9a24a), handL.x - 0.0, handL.y - 0.02, handL.z)
    f.add(helm, plume, blade, hilt)
  }
  return f
}
