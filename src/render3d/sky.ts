// 3인칭 하늘 (2026-10-25 검토 — 배경이 한 색 판이라 3인칭 화면 절반이 밋밋했다): 카메라를 따라가는 안쪽 구 하나.
// ☀ 낮: 지평선은 그 지역 안개색(먼 땅이 녹아드는 색) · 위로 갈수록 짙은 하늘 · 낮은 띠에 솜구름.
// 🌙 밤(2026-10-25 사용자: "아예 검은 하늘보다는 달과 달에 비친 구름을 표현해줘"): 안개색 지평선 → 짙은 남색 · 별 · 둥근 달(따로 띄운
// 스프라이트 — 하늘 그림 한 칸이 0.35° 라 달이 흐려진다) · 달 쪽 가장자리가 은빛으로 빛나는 구름. 쿼터뷰는 하늘이 보이지 않아 3인칭만.

import * as THREE from 'three'

/** 달의 방향 (세계 — 높이 22° · 고정): 3인칭으로 그쪽을 보면 화면 위쪽에 걸린다 */
const MOON_EL = (22 * Math.PI) / 180
const MOON_AZ = 0.62 * Math.PI * 2

export class Sky {
  readonly mesh: THREE.Mesh
  private readonly canvas = document.createElement('canvas')
  private readonly tex: THREE.CanvasTexture
  private color = -1
  private readonly moon: THREE.Sprite | null = null
  /** 하늘빛 네 색(천정 → 지평선) · 바꾸는 자리(f — 천정 0 · 지평선 1) · 얹는 그림 */
  private readonly u = {
    uC0: { value: new THREE.Color() },
    uC1: { value: new THREE.Color() },
    uC2: { value: new THREE.Color() },
    uC3: { value: new THREE.Color() },
    uP: { value: new THREE.Vector3(0.5, 0.9, 1) },
    uTex: { value: null as THREE.Texture | null },
  }

  /** night = 🌙 (밤하늘 · 달). 구 반지름은 카메라 끝보다 안쪽 — 🌙 3인칭은 48칸 너머를 그리지 않는다 */
  constructor(private readonly night = false) {
    this.canvas.width = night ? 1024 : 512
    this.canvas.height = night ? 512 : 256
    this.tex = new THREE.CanvasTexture(this.canvas)
    this.tex.colorSpace = THREE.SRGBColorSpace
    // 알파를 곱해서 올린다 — 곱하지 않은 채 늘려 그리면 거의 투명한 칸의 색이 칸마다 튀어 하늘에 격자가 보였다
    this.tex.premultiplyAlpha = true
    // 하늘빛(그러데이션)은 셰이더가 높이로 바로 칠하고, 그림(구름 · 별 · 달무리 — 투명 바탕)은 그 위에 얹는다:
    // 8비트 그림에 그러데이션을 담아 크게 늘리면(그림 한 칸이 화면 5px) 어두운 밤하늘에 격자 줄무늬가 보였다.
    // 안개는 없다(구가 안개 끝보다 멀어 통째로 안개색이 된다) · 깊이를 쓰지 않고 맨 먼저 그린다
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: 'varying vec3 vDir; varying vec2 vUv; void main() { vDir = position; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec3 uP;
uniform sampler2D uTex;
varying vec3 vDir;
varying vec2 vUv;
void main() {
  // f: 천정 0 → 지평선 1 (아래 반은 1 — 지평선 색)
  float f = clamp(1.0 - asin(clamp(normalize(vDir).y, 0.0, 1.0)) / 1.5707963, 0.0, 1.0);
  vec3 c = f < uP.x ? mix(uC0, uC1, f / uP.x) : f < uP.y ? mix(uC1, uC2, (f - uP.x) / (uP.y - uP.x)) : mix(uC2, uC3, (f - uP.y) / max(1e-4, 1.0 - uP.y));
  vec4 t = texture2D(uTex, vUv);
  gl_FragColor = vec4(c * (1.0 - t.a) + t.rgb, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
      side: THREE.BackSide,
      depthWrite: false,
    })
    const R = night ? 40 : 60
    this.u.uTex.value = this.tex
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 24), mat)
    this.mesh.renderOrder = -10
    this.mesh.frustumCulled = false
    this.mesh.visible = false
    if (night) {
      const m = new THREE.SpriteMaterial({ map: moonTexture(), fog: false, depthWrite: false, transparent: true })
      this.moon = new THREE.Sprite(m)
      const d = R * 0.9
      this.moon.position.set(-Math.cos(MOON_AZ) * Math.cos(MOON_EL) * d, Math.sin(MOON_EL) * d, Math.sin(MOON_AZ) * Math.cos(MOON_EL) * d)
      // 무리까지 16° (달 원반은 그 절반 남짓)
      const s = 2 * d * Math.tan((8 * Math.PI) / 180)
      this.moon.scale.set(s, s, 1)
      this.moon.renderOrder = -9
      this.moon.frustumCulled = false
      this.mesh.add(this.moon)
    }
  }

  /** 지평선 색(그 지역 안개색)이 바뀌면 그림을 다시 (지역을 옮길 때) */
  setHorizon(horizon: number): void {
    if (horizon === this.color) return
    this.color = horizon
    if (this.night) this.paintNight(horizon)
    else this.paintDay(horizon)
    this.tex.needsUpdate = true
  }

  private paintDay(horizon: number): void {
    const W = this.canvas.width
    const H = this.canvas.height
    const g = this.canvas.getContext('2d')!
    const hz = new THREE.Color(horizon)
    const top = hz.clone().offsetHSL(0, 0.14, -0.14)
    // 천정 → 지평선 (아래 반은 지평선 색 — 땅 · 맵 밖 판이 가린다)
    this.setGrad([top, top.clone().lerp(hz, 0.5), hz.clone().lerp(top, 0.25), hz], [0.375, 0.75])
    g.clearRect(0, 0, W, H)
    // 솜구름: 높이 10 ~ 35° 띠에 열넷 — 둥근 덩이를 몇 개씩 겹친다 (가로는 이어 붙게 양옆에 한 번 더)
    const rnd = lcg(7)
    for (let i = 0; i < 14; i++) {
      const cx = rnd() * W
      const cy = H * 0.27 + rnd() * H * 0.19
      const n = 3 + Math.floor(rnd() * 4)
      for (let k = 0; k < n; k++) {
        const r = 7 + rnd() * 11
        puff(g, W, cx + (k - n / 2) * r * 0.9, cy + (rnd() - 0.5) * r * 0.5, r, 'rgba(255,252,248,0.8)')
      }
    }
  }

  private paintNight(horizon: number): void {
    const W = this.canvas.width
    const H = this.canvas.height
    const g = this.canvas.getContext('2d')!
    const hz = new THREE.Color(horizon)
    // 지평선은 안개색 그대로(먼 땅이 묻힌다) → 조금 위가 옅은 남색 빛(밤하늘이 지평선 쪽에서 밝다) → 천정은 짙은 남색
    const glow = hz.clone().lerp(new THREE.Color(0x1c2638), 0.75)
    const zen = new THREE.Color(0x05080f)
    this.setGrad([zen, zen.clone().lerp(glow, 0.55), glow, hz], [0.7, 0.93])
    g.clearRect(0, 0, W, H)
    // 달 자리 (그림 좌표) · 하늘 그림의 한 점이 달에서 몇 도인지
    const mx = (MOON_AZ / (Math.PI * 2)) * W
    const my = ((Math.PI / 2 - MOON_EL) / Math.PI) * H
    const md = dirOf(mx, my, W, H)
    const angTo = (x: number, y: number) => Math.acos(Math.max(-1, Math.min(1, dot(dirOf(x, y, W, H), md))))
    // 달 둘레 하늘이 은은하게 밝다 (높이 따라 가로로 늘어나는 것을 맞춰 타원으로)
    const wide = 1 / Math.cos(MOON_EL)
    for (const ox of [-W, 0, W]) {
      g.save()
      g.translate(mx + ox, my)
      g.scale(wide, 1)
      const rg = g.createRadialGradient(0, 0, 0, 0, 0, H * 0.3)
      rg.addColorStop(0, 'rgba(120,145,190,0.32)')
      rg.addColorStop(1, 'rgba(120,145,190,0)')
      g.fillStyle = rg
      g.fillRect(-H * 0.3, -H * 0.3, H * 0.6, H * 0.6)
      g.restore()
    }
    // 별: 높이 10° 위 · 달 곁(14°)은 빼고 · 지평선 쪽은 드물게
    const rnd = lcg(19)
    for (let i = 0; i < 260; i++) {
      const x = rnd() * W
      const y = rnd() * rnd() * H * 0.44
      if (angTo(x, y) < 0.25) continue
      const a = 0.3 + rnd() * 0.7
      const r = 0.35 + rnd() * rnd() * 0.55
      g.fillStyle = `rgba(225,232,255,${a.toFixed(2)})`
      g.beginPath()
      g.arc(x, y, r, 0, Math.PI * 2)
      g.fill()
    }
    // 구름: 높이 8 ~ 40° 에 열여덟. 몸은 어두운 남회색 — 달 쪽 가장자리를 먼저 은빛으로 칠하고 그 위에 몸을 조금 비켜 얹어 테를 남긴다.
    // 달에 가까운 구름일수록 테가 밝고 넓다
    const crnd = lcg(31)
    for (let i = 0; i < 18; i++) {
      const cx = crnd() * W
      const cy = H * 0.28 + crnd() * H * 0.18
      const ang = angTo(cx, cy)
      const lit = Math.max(0.12, 1 - ang / 1.1) ** 1.4
      // 그림 안에서 달 쪽 (가로는 감아 가장 가까운 쪽)
      let dx = mx - cx
      if (dx > W / 2) dx -= W
      if (dx < -W / 2) dx += W
      const dy = my - cy
      const dl = Math.hypot(dx, dy) || 1
      const n = 3 + Math.floor(crnd() * 4)
      for (let k = 0; k < n; k++) {
        const r = 14 + crnd() * 20
        const x = cx + (k - n / 2) * r * 0.9
        const y = cy + (crnd() - 0.5) * r * 0.5
        puff(g, W, x + (dx / dl) * r * 0.22, y + (dy / dl) * r * 0.22, r, `rgba(205,218,248,${(0.75 * lit).toFixed(3)})`)
        puff(g, W, x - (dx / dl) * r * 0.08, y - (dy / dl) * r * 0.08, r * 0.96, `rgba(34,42,60,${(0.55 + 0.2 * (1 - lit)).toFixed(3)})`)
      }
    }
  }

  /** 하늘빛: 천정 → 지평선 네 색 · 가운데 두 자리(f) — 색은 sRGB 값으로 받아 three 가 선형으로 바꿔 둔다 */
  private setGrad(c: THREE.Color[], at: [number, number]): void {
    this.u.uC0.value.copy(c[0])
    this.u.uC1.value.copy(c[1])
    this.u.uC2.value.copy(c[2])
    this.u.uC3.value.copy(c[3])
    this.u.uP.value.set(at[0], at[1], 1)
  }

  dispose(): void {
    this.tex.dispose()
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    if (this.moon) {
      this.moon.material.map?.dispose()
      this.moon.material.dispose()
    }
  }
}

const lcg = (s: number) => () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** 하늘 그림 좌표 → 세계 방향 (three SphereGeometry 의 uv 와 같다 — u 0 이 -x · 위가 천정) */
function dirOf(x: number, y: number, W: number, H: number): number[] {
  const phi = (x / W) * Math.PI * 2
  const th = (y / H) * Math.PI
  return [-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th)]
}

/** 가로로 1.6배 늘인 둥근 덩이 (그러데이션째 늘린다 · 가로는 이어 붙게 양옆에 한 번 더) */
function puff(g: CanvasRenderingContext2D, W: number, x: number, y: number, r: number, color: string): void {
  const clear = color.replace(/[\d.]+\)$/, '0)')
  for (const ox of [-W, 0, W]) {
    g.save()
    g.translate(x + ox, y)
    g.scale(1.6, 1)
    const rg = g.createRadialGradient(0, 0, 0, 0, 0, r)
    rg.addColorStop(0, color)
    rg.addColorStop(1, clear)
    g.fillStyle = rg
    g.beginPath()
    g.arc(0, 0, r, 0, Math.PI * 2)
    g.fill()
    g.restore()
  }
}

/** 달 그림: 둘레 무리 · 은빛 원반 · 옅은 바다(어두운 얼룩) · 가장자리는 살짝 어둡게 */
function moonTexture(): THREE.CanvasTexture {
  const N = 256
  const c = document.createElement('canvas')
  c.width = c.height = N
  const g = c.getContext('2d')!
  const C = N / 2
  const halo = g.createRadialGradient(C, C, N * 0.12, C, C, C)
  halo.addColorStop(0, 'rgba(200,215,255,0.42)')
  halo.addColorStop(0.45, 'rgba(160,185,240,0.14)')
  halo.addColorStop(1, 'rgba(140,165,230,0)')
  g.fillStyle = halo
  g.fillRect(0, 0, N, N)
  const R = N * 0.27
  const disk = g.createRadialGradient(C - R * 0.25, C - R * 0.25, R * 0.1, C, C, R)
  disk.addColorStop(0, '#fbf8ee')
  disk.addColorStop(0.8, '#e8e4d6')
  disk.addColorStop(1, '#c9c5b8')
  g.fillStyle = disk
  g.beginPath()
  g.arc(C, C, R, 0, Math.PI * 2)
  g.fill()
  // 달의 바다 (몇 개의 어두운 얼룩 — 원반 안에서만)
  g.save()
  g.beginPath()
  g.arc(C, C, R, 0, Math.PI * 2)
  g.clip()
  // 가장자리가 흐린 얼룩 — 또렷한 원이면 쿠키 점처럼 보였다
  for (const [x, y, r, a] of [[-0.3, -0.2, 0.36, 0.12], [0.18, -0.32, 0.26, 0.09], [0.25, 0.15, 0.34, 0.1], [-0.1, 0.38, 0.22, 0.07], [-0.45, 0.2, 0.2, 0.07]]) {
    const m = g.createRadialGradient(C + x * R, C + y * R, 0, C + x * R, C + y * R, r * R)
    m.addColorStop(0, `rgba(118,116,110,${a})`)
    m.addColorStop(1, 'rgba(118,116,110,0)')
    g.fillStyle = m
    g.fillRect(0, 0, N, N)
  }
  g.restore()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
