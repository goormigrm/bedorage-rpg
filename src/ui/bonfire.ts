// 캐릭터 선택 장면 (디아블로 2 의 모닥불 — GUIDE 11장): 밤의 야영지, 가운데 모닥불, 뒤편에 캐릭터들이 반원으로 서 있다.
// 누르면(또는 ◀ ▶) 그 캐릭터가 불 앞으로 걸어 나오고, 나머지는 어둠 속에 물러선다. 불티가 올라가고 불빛이 흔들린다.
// 로비의 배경일 뿐 게임 상태와는 무관하다. 로비를 닫을 때 dispose.

import * as THREE from 'three'
import { CHARACTERS, CharacterId } from '../core/characters'
import { CharacterRig, buildCharacter } from '../render3d/character3d'

interface Seat {
  id: CharacterId
  rig: CharacterRig
  home: THREE.Vector3
  front: THREE.Vector3
  k: number
}

export class BonfireScene {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)
  private seats: Seat[] = []
  private selected: CharacterId | null = null
  private fire: THREE.PointLight
  private flames: THREE.Sprite[] = []
  private embers: THREE.Points
  private emberV: Float32Array
  private raf = 0
  private t = 0
  private last = performance.now()
  private ray = new THREE.Raycaster()
  private disposed = false

  constructor(
    private canvas: HTMLCanvasElement,
    ids: CharacterId[],
    private onPick: (id: CharacterId) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    this.renderer.shadowMap.enabled = true
    this.scene.background = new THREE.Color(0x030304)
    this.scene.fog = new THREE.Fog(0x030304, 7, 16)
    this.camera.position.set(0, 3.1, 9.6)
    this.camera.lookAt(0, 0.9, 0)

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
    for (const [x, z, s] of [[-4.6, -3.8, 1.2], [4.8, -3.4, 1], [0.6, -6.2, 1.4]] as const) {
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
    this.scene.add(new THREE.HemisphereLight(0x3a4468, 0x100c08, 0.35))
    // 앞으로 나온 캐릭터만 비추는 따뜻한 빛 (카메라 쪽, 짧은 거리)
    const front = new THREE.PointLight(0xffb070, 9, 4.5, 1.6)
    front.position.set(0.6, 1.6, 3.3)
    this.scene.add(front)
    const glow = glowTexture()
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

    // 캐릭터: 불 뒤편 반원, 불을 바라본다
    // 여섯씩 두 줄 (앞줄 가까이 · 뒷줄 한 발 뒤) — 12명이 한 줄이면 겹친다
    const row = 6
    ids.forEach((id, i) => {
      const rig = buildCharacter(CHARACTERS[id])
      const back = Math.floor(i / row)
      const j = i % row
      const n = Math.min(row, ids.length - back * row)
      const a = ((j - (n - 1) / 2) / Math.max(1, n - 1)) * (back ? 2.0 : 2.3) + (back ? 0.12 : 0)
      const rx = back ? 4.6 : 3.4
      const rz = back ? 3.2 : 2.1
      const home = new THREE.Vector3(Math.sin(a) * rx, 0, -Math.cos(a) * rz + 0.3)
      // 불 옆 앞자리 — 불빛을 옆에서 받는다 (불 앞에 서면 불을 등져 새까맣다)
      const front = new THREE.Vector3(1.25, 0, 1.7)
      rig.root.position.copy(home)
      rig.root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = true
      })
      this.scene.add(rig.root)
      this.seats.push({ id, rig, home, front, k: 0 })
    })

    canvas.addEventListener('pointerdown', this.onDown)
    window.addEventListener('resize', this.resize)
    this.resize()
    this.loop()
  }

  select(id: CharacterId): void {
    this.selected = id
  }

  private resetEmber(pos: Float32Array, i: number, y = 0): void {
    pos[i * 3] = (Math.random() - 0.5) * 0.4
    pos[i * 3 + 1] = 0.3 + y
    pos[i * 3 + 2] = (Math.random() - 0.5) * 0.4
    this.emberV[i] = 0.5 + Math.random() * 0.9
  }

  private onDown = (e: PointerEvent): void => {
    const r = this.canvas.getBoundingClientRect()
    const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    this.ray.setFromCamera(v, this.camera)
    let best: { id: CharacterId; d: number } | null = null
    for (const s of this.seats) {
      const hit = this.ray.intersectObject(s.rig.root, true)[0]
      if (hit && (!best || hit.distance < best.d)) best = { id: s.id, d: hit.distance }
    }
    if (best) this.onPick(best.id)
  }

  private resize = (): void => {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / Math.max(1, h)
    // 좁은 화면(폰 세로)이면 뒤로 물러나 여섯이 다 들어오게
    this.camera.position.z = this.camera.aspect < 1 ? 13 : 9.6
    this.camera.lookAt(0, 0.9, 0)
    this.camera.updateProjectionMatrix()
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
    for (const s of this.seats) {
      const want = s.id === this.selected ? 1 : 0
      s.k += (want - s.k) * Math.min(1, dt * 3)
      const p = s.rig.root.position
      p.lerpVectors(s.home, s.front, s.k)
      // 불 쪽(서 있는 자리에서 원점)을 보다가, 앞으로 나오면 카메라를 본다
      const toFire = Math.atan2(-p.x, -p.z)
      const toCam = Math.atan2(this.camera.position.x - p.x, this.camera.position.z - p.z)
      s.rig.root.rotation.y = toFire + (toCam - toFire) * s.k
      s.rig.body.position.y = Math.sin(t * 2 + p.x) * 0.02
      // 뽑히지 않은 사람은 어둠 속에 조금 가라앉는다
      s.rig.setFlash(0)
    }
    this.renderer.render(this.scene, this.camera)
    this.raf = requestAnimationFrame(this.loop)
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.canvas.removeEventListener('pointerdown', this.onDown)
    window.removeEventListener('resize', this.resize)
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose()
    })
    this.renderer.dispose()
  }
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
