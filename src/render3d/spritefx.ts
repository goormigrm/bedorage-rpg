// 부드러운 빛 알갱이 · 연기 (2026-10-08 퀄리티 2차 1단계 — 상용 게임과 견준 검토 G6).
// 전에는 불꽃 · 마법 · 먼지까지 모두 빛을 받지 않는 불투명 상자(0.1 칸)였다 → 불꽃 · 마법은 가운데가 하얗게 타는 더하기 빛,
// 연기 · 먼지는 커지며 옅어지는 반투명 알갱이로. 카메라를 늘 보는 네모 하나를 인스턴스로 그린다(한 번에 그리기 · 셰이더에서 돌려 세운다).

import * as THREE from 'three'

interface Sprite {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  life: number
  max: number
  r: number
  g: number
  b: number
  /** 처음 크기 (월드 단위) · 끝날 때 크기 배율 */
  size: number
  grow: number
  /** 처음 진하기 (0 ~ 1) */
  alpha: number
  gravity: number
  /** 한 틱(1/60초)에 남는 속도 비율 (공기 저항) */
  drag: number
  rot: number
  spin: number
}

const VERT = /* glsl */ `
attribute vec3 aCenter;
attribute vec4 aColor;
attribute float aSize;
attribute float aRot;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vUv = uv;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);
  float c = cos(aRot);
  float s = sin(aRot);
  mv.xy += vec2(c * position.x - s * position.y, s * position.x + c * position.y) * aSize;
  gl_Position = projectionMatrix * mv;
}
`

const FRAG = /* glsl */ `
uniform float uSoft;
uniform float uCore;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = pow(clamp(1.0 - d, 0.0, 1.0), uSoft);
  if (a * vColor.a < 0.004) discard;
  // 더하기 빛은 가운데가 하얗게 탄다 (불꽃 · 마법의 뜨거운 심)
  vec3 col = mix(vColor.rgb, vec3(1.0), pow(a, 3.0) * uCore);
  gl_FragColor = vec4(col, vColor.a * a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export class SpriteFx {
  readonly mesh: THREE.Mesh
  private list: Sprite[] = []
  private readonly geo: THREE.InstancedBufferGeometry
  private readonly aCenter: THREE.InstancedBufferAttribute
  private readonly aColor: THREE.InstancedBufferAttribute
  private readonly aSize: THREE.InstancedBufferAttribute
  private readonly aRot: THREE.InstancedBufferAttribute
  private readonly tmp = new THREE.Color()

  /** additive = 불꽃 · 마법(더하기 빛), 아니면 연기 · 먼지(반투명) */
  constructor(
    private readonly max: number,
    private readonly additive: boolean,
  ) {
    const base = new THREE.PlaneGeometry(1, 1)
    const g = new THREE.InstancedBufferGeometry()
    g.index = base.index
    g.setAttribute('position', base.getAttribute('position'))
    g.setAttribute('uv', base.getAttribute('uv'))
    const attr = (n: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(max * n), n)
      a.setUsage(THREE.DynamicDrawUsage)
      return a
    }
    this.aCenter = attr(3)
    this.aColor = attr(4)
    this.aSize = attr(1)
    this.aRot = attr(1)
    g.setAttribute('aCenter', this.aCenter)
    g.setAttribute('aColor', this.aColor)
    g.setAttribute('aSize', this.aSize)
    g.setAttribute('aRot', this.aRot)
    g.instanceCount = 0
    this.geo = g
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uSoft: { value: additive ? 1.6 : 1.2 }, uCore: { value: additive ? 0.55 : 0 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    })
    this.mesh = new THREE.Mesh(g, mat)
    this.mesh.frustumCulled = false
    // 연기가 먼저, 빛이 그 위에
    this.mesh.renderOrder = additive ? 6 : 5
  }

  get count(): number {
    return this.list.length
  }

  spawn(
    x: number, y: number, z: number, vx: number, vy: number, vz: number,
    life: number, color: number, size: number,
    o: { grow?: number; alpha?: number; gravity?: number; drag?: number } = {},
  ): void {
    // 넘치면 가장 오래된 것 자리에
    if (this.list.length >= this.max) this.list.shift()
    const c = this.tmp.setHex(color)
    this.list.push({
      x, y, z, vx, vy, vz, life, max: life, r: c.r, g: c.g, b: c.b, size,
      grow: o.grow ?? (this.additive ? 0.3 : 2.2),
      alpha: o.alpha ?? (this.additive ? 1 : 0.5),
      gravity: o.gravity ?? (this.additive ? 0.12 : -0.02),
      drag: o.drag ?? (this.additive ? 0.94 : 0.9),
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * (this.additive ? 2 : 1.2),
    })
  }

  clear(): void {
    this.list.length = 0
    this.geo.instanceCount = 0
  }

  update(dt: number): void {
    const k = dt * 60
    let live = 0
    const c = this.aCenter.array as Float32Array
    const col = this.aColor.array as Float32Array
    const sz = this.aSize.array as Float32Array
    const rot = this.aRot.array as Float32Array
    for (let i = 0; i < this.list.length; i++) {
      const q = this.list[i]
      q.life -= dt
      if (q.life <= 0) continue
      const drag = Math.pow(q.drag, k)
      q.vx *= drag
      q.vz *= drag
      q.vy = q.vy * drag - q.gravity * dt
      q.x += q.vx * k
      q.y += q.vy * k
      q.z += q.vz * k
      if (q.y < 0.04) {
        q.y = 0.04
        q.vy = 0
      }
      q.rot += q.spin * dt
      const t = 1 - q.life / q.max
      // 빛: 막 생길 때 짧게 차오르고 끝으로 갈수록 사그라든다 · 연기: 천천히 옅어진다
      const fade = this.additive ? Math.min(1, t * 12) * (1 - t) * (1 - t) : Math.min(1, t * 6) * (1 - t)
      c[live * 3] = q.x
      c[live * 3 + 1] = q.y
      c[live * 3 + 2] = q.z
      col[live * 4] = q.r
      col[live * 4 + 1] = q.g
      col[live * 4 + 2] = q.b
      col[live * 4 + 3] = q.alpha * fade
      sz[live] = q.size * (1 + (q.grow - 1) * t)
      rot[live] = q.rot
      this.list[live++] = q
    }
    this.list.length = live
    this.geo.instanceCount = live
    if (live > 0) {
      this.aCenter.needsUpdate = true
      this.aColor.needsUpdate = true
      this.aSize.needsUpdate = true
      this.aRot.needsUpdate = true
    }
  }

  dispose(): void {
    this.geo.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}
