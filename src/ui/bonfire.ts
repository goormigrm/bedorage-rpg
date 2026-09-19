// 캐릭터 선택 장면 (디아블로 2 의 모닥불 — GUIDE 11장): 밤의 야영지, 가운데 모닥불, 뒤편에 캐릭터들이 반원으로 서 있다.
// 누르면(또는 ◀ ▶) 그 캐릭터가 불 앞으로 걸어 나오고, 빈 발판에는 금빛 고리가 남는다. 불티가 올라가고 불빛이 흔들린다.
// 12명은 **돌 발판 두 단**에 선다(2026-09-19 요청 "2열이 안 보여 — 발판 같은 거로 모두 보이게"):
//   앞 단 여섯은 낮은 발판, 뒤 단 여섯은 높은 발판 위 앞 단 사이사이 — 뒤 단의 몸이 앞 단 머리 위로 다 보인다.
//   발판마다 이름패(앞 단은 발판 앞, 뒤 단은 머리 위). 마우스를 올리면 고리·몸이 밝아지고, 누르면 고른다.
// 오른쪽 패널·아래 캐릭터 카드에 가리지 않게, 카메라는 **비어 있는 칸(frame)** 한가운데에 무대 전체가 들어오도록 맞춘다.
// 로비의 배경일 뿐 게임 상태와는 무관하다. 로비를 닫을 때 dispose.

import * as THREE from 'three'
import { CHARACTERS, CharacterId } from '../core/characters'
import { CharacterRig, buildCharacter } from '../render3d/character3d'

interface Seat {
  id: CharacterId
  rig: CharacterRig
  /** 발판 위 자리 (y = 발판 높이) */
  home: THREE.Vector3
  front: THREE.Vector3
  k: number
  /** 발판 윗면의 고리 (마우스를 올리면 · 고른 사람의 빈 발판이면 빛난다) */
  ring: THREE.Mesh
  plate: THREE.Sprite
  /** 지금 몸에 걸린 밝기 (바뀔 때만 setFlash) */
  glow: number
}

/** 카메라가 무대를 담을 화면 칸 (캔버스 픽셀) — 패널·카드에 가리지 않는 곳 */
export interface SceneFrame {
  x0: number
  x1: number
  y0: number
  y1: number
}

/**
 * 발판 자리: 앞 단(낮음)과 뒤 단(높음)이 x 로 엇갈린다 — 뒤 단 캐릭터가 앞 단 두 사람 사이, 머리 위로 보인다.
 * 여섯씩 왼쪽 → 오른쪽. 불(원점) 뒤편 반원.
 */
const FRONT_ROW = [[-2.7, -0.95], [-1.8, -1.6], [-0.75, -1.95], [0.75, -1.95], [1.8, -1.6], [2.7, -0.95]] as const
const BACK_ROW = [[-3.45, -1.85], [-2.3, -2.6], [-1.25, -3.0], [1.25, -3.0], [2.3, -2.6], [3.45, -1.85]] as const
const FRONT_H = 0.4
const BACK_H = 1.3
/** 고른 캐릭터가 걸어 나오는 자리 — 불 옆 (불 앞에 서면 불을 등져 새까맣다) */
const FRONT_SPOT = new THREE.Vector3(1.3, 0, 1.6)
/** 발판 위의 사람들이 바라보는 곳 (불과 카메라 사이 — 얼굴이 보이게) */
const LOOK = new THREE.Vector3(0, 0, 4.5)
/** 카메라가 보는 무대 한가운데와 방향(약 20도 내려다봄) · 무대가 들어가야 할 반너비·반높이 (월드 단위) */
const TARGET = new THREE.Vector3(0, 1.3, -1.1)
const VIEW_DIR = new THREE.Vector3(0, 0.36, 1).normalize()
const STAGE_HALF_W = 4.6
const STAGE_HALF_H = 2.45

export class BonfireScene {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)
  private seats: Seat[] = []
  private selected: CharacterId | null = null
  private hovered: CharacterId | null = null
  /** 눌러 고를 수 있는 것 (캐릭터 몸 · 발판) — userData.seat 로 누구인지 */
  private pickables: THREE.Object3D[] = []
  private fire: THREE.PointLight
  private flames: THREE.Sprite[] = []
  private embers: THREE.Points
  private emberV: Float32Array
  private raf = 0
  private t = 0
  private last = performance.now()
  private ray = new THREE.Raycaster()
  private disposed = false
  /** 카메라 맞추기: 목표와 지금 값 (카드 높이가 바뀌면 부드럽게 옮겨 간다) */
  private view = { fw: 1, fh: 1, ox: 0, oy: 0, d: 11 }
  private goal = { fw: 1, fh: 1, ox: 0, oy: 0, d: 11 }
  private fitted = false
  private textures: THREE.Texture[] = []

  constructor(
    private canvas: HTMLCanvasElement,
    ids: CharacterId[],
    private onPick: (id: CharacterId) => void,
    /** 무대를 담을 칸 (없으면 캔버스 전체) */
    private frame?: () => SceneFrame,
    /** 이름패 둘째 줄 (레벨 등) */
    sub?: (id: CharacterId) => string,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    this.renderer.shadowMap.enabled = true
    this.scene.background = new THREE.Color(0x030304)
    this.scene.fog = new THREE.Fog(0x030304, 10, 24)

    // 땅: 다진 흙 + 모닥불 둘레 돌
    const ground = new THREE.Mesh(new THREE.CircleGeometry(14, 48), new THREE.MeshLambertMaterial({ color: 0x2a241c }))
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    this.scene.add(ground)
    for (let k = 0; k < 11; k++) {
      const a = (k / 11) * Math.PI * 2
      const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16 + (k % 3) * 0.03, 0), new THREE.MeshLambertMaterial({ color: 0x55504a, flatShading: true }))
      s.position.set(Math.cos(a) * 0.62, 0.1, Math.sin(a) * 0.62)
      s.rotation.set(k, k * 2, 0)
      this.scene.add(s)
    }
    for (let k = 0; k < 3; k++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.9, 6), new THREE.MeshLambertMaterial({ color: 0x3a2618 }))
      log.rotation.set(Math.PI / 2, (k * Math.PI * 2) / 3, 0.35)
      log.position.y = 0.16
      this.scene.add(log)
    }
    // 뒤편 어둠 속의 천막 · 수레 윤곽 (야영지)
    const tentM = new THREE.MeshLambertMaterial({ color: 0x3a2e28 })
    for (const [x, z, s] of [[-5.6, -4.6, 1.2], [5.8, -4.2, 1], [0.6, -7.2, 1.4]] as const) {
      const tent = new THREE.Mesh(new THREE.ConeGeometry(1.3 * s, 1.8 * s, 4), tentM)
      tent.position.set(x, 0.9 * s, z)
      tent.rotation.y = 0.4
      this.scene.add(tent)
    }

    // 불: 빛(흔들림) + 불꽃 스프라이트 + 불티
    this.fire = new THREE.PointLight(0xff8a3a, 26, 14, 1.4)
    this.fire.position.set(0, 0.9, 0)
    this.fire.castShadow = true
    this.scene.add(this.fire)
    this.scene.add(new THREE.HemisphereLight(0x3a4468, 0x100c08, 0.5))
    // 무대를 위앞에서 은은하게 — 뒤 단은 불에서 멀어 이것 없이는 어둠에 묻힌다
    const stage = new THREE.SpotLight(0xffc890, 60, 30, 0.62, 0.8, 1.2)
    stage.position.set(0, 7.5, 6)
    stage.target.position.set(0, 1, -2.3)
    this.scene.add(stage, stage.target)
    // 앞으로 나온 캐릭터만 비추는 따뜻한 빛 (카메라 쪽, 짧은 거리)
    const front = new THREE.PointLight(0xffb070, 9, 4.5, 1.6)
    front.position.set(0.6, 1.6, 3.3)
    this.scene.add(front)
    const glow = glowTexture()
    this.textures.push(glow)
    const flameMat = new THREE.SpriteMaterial({ map: glow, color: 0xffa04a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    for (let k = 0; k < 5; k++) {
      const sp = new THREE.Sprite(flameMat)
      sp.position.set(Math.cos(k * 1.3) * 0.12, 0.35 + (k % 2) * 0.2, Math.sin(k * 1.3) * 0.12)
      this.flames.push(sp)
      this.scene.add(sp)
    }
    const N = 70
    const pos = new Float32Array(N * 3)
    this.emberV = new Float32Array(N)
    for (let i = 0; i < N; i++) this.resetEmber(pos, i, Math.random() * 3)
    const eg = new THREE.BufferGeometry()
    eg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.embers = new THREE.Points(eg, new THREE.PointsMaterial({ color: 0xffa050, size: 0.05, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }))
    this.scene.add(this.embers)

    // 캐릭터: 돌 발판 두 단 (앞 단 여섯 · 뒤 단 여섯)
    const stoneM = new THREE.MeshLambertMaterial({ color: 0x4a443d, flatShading: true })
    const capM = new THREE.MeshLambertMaterial({ color: 0x625a50, flatShading: true })
    ids.forEach((id, i) => {
      const back = i >= FRONT_ROW.length
      const [x, z] = (back ? BACK_ROW[i - FRONT_ROW.length] : FRONT_ROW[i]) ?? [0, -4.5]
      const h = back ? BACK_H : FRONT_H
      const ped = pedestal(h, back, stoneM, capM)
      ped.position.set(x, 0, z)
      ped.userData.seat = id
      this.scene.add(ped)
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.34, 0.46, 32),
        new THREE.MeshBasicMaterial({ color: 0xe8b85a, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }),
      )
      ring.rotation.x = -Math.PI / 2
      ring.position.set(x, h + 0.012, z)
      this.scene.add(ring)

      const rig = buildCharacter(CHARACTERS[id])
      const home = new THREE.Vector3(x, h, z)
      rig.root.position.copy(home)
      rig.root.userData.seat = id
      rig.root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = true
      })
      this.scene.add(rig.root)

      // 이름패: 앞 단은 발판 앞면, 뒤 단은 머리 위 (뒤 단 발판 앞면은 앞 단 사람에게 가린다)
      const tex = plateTexture(CHARACTERS[id].name, sub?.(id) ?? '')
      this.textures.push(tex)
      const plate = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, opacity: 0.75 }))
      plate.scale.set(1.15, 0.36, 1)
      if (back) plate.position.set(x, h + rig.height + 0.32, z)
      else plate.position.set(x, h * 0.5, z + 0.55)
      this.scene.add(plate)

      this.pickables.push(ped, rig.root)
      this.seats.push({ id, rig, home, front: FRONT_SPOT.clone(), k: 0, ring, plate, glow: 0 })
    })

    canvas.addEventListener('pointerdown', this.onDown)
    canvas.addEventListener('pointermove', this.onMove)
    canvas.addEventListener('pointerleave', this.onLeave)
    window.addEventListener('resize', this.resize)
    this.resize()
    this.loop()
  }

  select(id: CharacterId): void {
    this.selected = id
  }

  /** 패널·카드 크기가 바뀌었다 (캐릭터 카드는 캐릭터마다 높이가 다르다) — 카메라를 다시 맞춘다 */
  refit(): void {
    this.fit(false)
  }

  private resetEmber(pos: Float32Array, i: number, y = 0): void {
    pos[i * 3] = (Math.random() - 0.5) * 0.4
    pos[i * 3 + 1] = 0.3 + y
    pos[i * 3 + 2] = (Math.random() - 0.5) * 0.4
    this.emberV[i] = 0.5 + Math.random() * 0.9
  }

  /** 화면 좌표 → 그 자리의 캐릭터 (몸이나 발판) */
  private pick(e: PointerEvent): CharacterId | null {
    const r = this.canvas.getBoundingClientRect()
    const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    this.ray.setFromCamera(v, this.camera)
    for (const hit of this.ray.intersectObjects(this.pickables, true)) {
      for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) if (o.userData.seat) return o.userData.seat as CharacterId
    }
    return null
  }

  private onDown = (e: PointerEvent): void => {
    const id = this.pick(e)
    if (id) this.onPick(id)
  }

  private onMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return
    this.hovered = this.pick(e)
    this.canvas.style.cursor = this.hovered ? 'pointer' : 'default'
  }

  private onLeave = (): void => {
    this.hovered = null
  }

  private resize = (): void => {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.fit(true)
  }

  /**
   * 무대 전체가 빈 칸(frame) 한가운데에 들어오게: 투영 중심을 칸 가운데로 옮기고(setViewOffset),
   * 칸의 너비·높이 중 빠듯한 쪽에 맞춰 카메라 거리를 정한다.
   */
  private fit(snap: boolean): void {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    const f = this.frame?.() ?? { x0: 0, x1: w, y0: 0, y1: h }
    const x0 = Math.max(0, f.x0)
    const x1 = Math.min(w, Math.max(x0 + 160, f.x1))
    const y0 = Math.max(0, f.y0)
    const y1 = Math.min(h, Math.max(y0 + 140, f.y1))
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    const fw = cx < w / 2 ? 2 * (w - cx) : 2 * cx
    const fh = cy < h / 2 ? 2 * (h - cy) : 2 * cy
    const px = fh / (2 * Math.tan((this.camera.fov * Math.PI) / 360))
    const d = Math.max(8.5, (px * STAGE_HALF_W) / ((x1 - x0) / 2), (px * STAGE_HALF_H) / ((y1 - y0) / 2))
    this.goal = { fw, fh, ox: fw / 2 - cx, oy: fh / 2 - cy, d }
    if (snap || !this.fitted) {
      this.view = { ...this.goal }
      this.fitted = true
      this.applyView()
    }
  }

  private applyView(): void {
    const v = this.view
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.camera.aspect = v.fw / v.fh
    this.camera.setViewOffset(v.fw, v.fh, v.ox, v.oy, w, h)
    this.camera.position.copy(TARGET).addScaledVector(VIEW_DIR, v.d)
    this.camera.lookAt(TARGET)
    this.camera.updateProjectionMatrix()
    const fog = this.scene.fog as THREE.Fog
    fog.near = v.d + 1
    fog.far = v.d + 15
  }

  private loop = (): void => {
    if (this.disposed) return
    const now = performance.now()
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    this.t += dt
    const t = this.t
    this.fire.intensity = 26 * (1 + Math.sin(t * 11) * 0.07 + Math.sin(t * 23.7) * 0.05 + Math.sin(t * 5.3) * 0.04)
    this.flames.forEach((f, k) => {
      const s = (1.05 - k * 0.12) * (1 + Math.sin(t * 12 + k * 1.7) * 0.1)
      f.scale.set(s * 0.8, s * 1.2, 1)
    })
    const pa = this.embers.geometry.getAttribute('position') as THREE.BufferAttribute
    const pos = pa.array as Float32Array
    for (let i = 0; i < this.emberV.length; i++) {
      pos[i * 3 + 1] += this.emberV[i] * dt
      pos[i * 3] += Math.sin(t * 2 + i) * 0.004
      if (pos[i * 3 + 1] > 3.2) this.resetEmber(pos, i)
    }
    pa.needsUpdate = true
    // 카메라: 카드 높이가 바뀌면 목표로 부드럽게
    const v = this.view
    const g = this.goal
    const e = Math.min(1, dt * 6)
    if (Math.abs(v.d - g.d) + Math.abs(v.ox - g.ox) + Math.abs(v.oy - g.oy) + Math.abs(v.fw - g.fw) + Math.abs(v.fh - g.fh) > 0.01) {
      v.d += (g.d - v.d) * e
      v.ox += (g.ox - v.ox) * e
      v.oy += (g.oy - v.oy) * e
      v.fw += (g.fw - v.fw) * e
      v.fh += (g.fh - v.fh) * e
      this.applyView()
    }
    for (const s of this.seats) {
      const chosen = s.id === this.selected
      const hover = s.id === this.hovered
      s.k += ((chosen ? 1 : 0) - s.k) * Math.min(1, dt * 3)
      const p = s.rig.root.position
      p.lerpVectors(s.home, s.front, s.k)
      // 발판에서 뛰어내린다 (뒤 단은 높아서 포물선으로)
      p.y += Math.sin(s.k * Math.PI) * 0.5
      // 발판 위에서는 불과 카메라 사이를 보다가, 앞으로 나오면 카메라를 본다
      const toLook = Math.atan2(LOOK.x - p.x, LOOK.z - p.z)
      const toCam = Math.atan2(this.camera.position.x - p.x, this.camera.position.z - p.z)
      s.rig.root.rotation.y = toLook + (toCam - toLook) * s.k
      s.rig.body.position.y = Math.sin(t * 2 + p.x) * 0.02
      // 마우스를 올리면 몸이 불빛처럼 밝아진다 (바뀔 때만)
      const glow = hover && !chosen ? 0.18 : 0
      if (glow !== s.glow) {
        s.glow = glow
        s.rig.setFlash(glow, 0xffb060)
      }
      // 고리: 올리면 밝게 · 고른 사람의 빈 발판은 숨 쉬듯
      ;(s.ring.material as THREE.MeshBasicMaterial).opacity = hover ? 0.85 : chosen ? 0.45 + Math.sin(t * 3) * 0.15 : 0.12
      ;(s.plate.material as THREE.SpriteMaterial).opacity = hover || chosen ? 1 : 0.72
    }
    this.renderer.render(this.scene, this.camera)
    this.raf = requestAnimationFrame(this.loop)
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.canvas.removeEventListener('pointerdown', this.onDown)
    this.canvas.removeEventListener('pointermove', this.onMove)
    this.canvas.removeEventListener('pointerleave', this.onLeave)
    window.removeEventListener('resize', this.resize)
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose()
    })
    for (const t of this.textures) t.dispose()
    this.renderer.dispose()
  }
}

/** 돌 발판: 낮은 것은 한 덩이, 높은 것은 밑단 · 기둥 · 윗판 세 켜 */
function pedestal(h: number, tall: boolean, stone: THREE.Material, cap: THREE.Material): THREE.Group {
  const g = new THREE.Group()
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, y: number) => {
    const mesh = new THREE.Mesh(geo, m)
    mesh.position.y = y
    mesh.castShadow = true
    mesh.receiveShadow = true
    g.add(mesh)
  }
  if (tall) {
    add(new THREE.CylinderGeometry(0.62, 0.68, 0.22, 10), stone, 0.11)
    add(new THREE.CylinderGeometry(0.46, 0.52, h - 0.36, 10), stone, 0.22 + (h - 0.36) / 2)
    add(new THREE.CylinderGeometry(0.54, 0.5, 0.14, 10), cap, h - 0.07)
  } else {
    add(new THREE.CylinderGeometry(0.52, 0.6, h - 0.12, 10), stone, (h - 0.12) / 2)
    add(new THREE.CylinderGeometry(0.54, 0.54, 0.12, 10), cap, h - 0.06)
  }
  return g
}

/** 이름패: 금빛 이름 + 작은 둘째 줄 (레벨) */
function plateTexture(name: string, sub: string): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 80
  const g = c.getContext('2d')!
  g.fillStyle = 'rgba(8,6,4,0.72)'
  g.strokeStyle = 'rgba(201,162,74,0.7)'
  g.lineWidth = 2
  g.beginPath()
  g.roundRect(8, 6, 240, 68, 8)
  g.fill()
  g.stroke()
  g.textAlign = 'center'
  g.fillStyle = '#f1d58a'
  g.font = '800 30px "Nanum Myeongjo", serif'
  g.fillText(name, 128, sub ? 38 : 50)
  if (sub) {
    g.fillStyle = '#b8a67e'
    g.font = '600 18px "IBM Plex Sans KR", sans-serif'
    g.fillText(sub, 128, 64)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 36, 2, 32, 32, 30)
  grad.addColorStop(0, 'rgba(255,240,200,1)')
  grad.addColorStop(0.3, 'rgba(255,170,70,0.9)')
  grad.addColorStop(0.7, 'rgba(200,70,20,0.3)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}
