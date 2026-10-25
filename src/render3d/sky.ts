// ☀ 3인칭 하늘 (2026-10-25 검토 — 배경이 한 색 판이라 3인칭 화면 절반이 밋밋한 하늘색이었다): 카메라를 따라가는 안쪽 구 하나.
// 지평선은 그 지역 안개색(먼 땅이 녹아드는 색) · 위로 갈수록 짙은 하늘 · 낮은 띠에 솜구름. 그림 한 장 · 그리기 한 번 · 🌙 는 쓰지 않는다.

import * as THREE from 'three'

export class Sky {
  readonly mesh: THREE.Mesh
  private readonly canvas = document.createElement('canvas')
  private readonly tex: THREE.CanvasTexture
  private color = -1

  constructor() {
    this.canvas.width = 512
    this.canvas.height = 256
    this.tex = new THREE.CanvasTexture(this.canvas)
    this.tex.colorSpace = THREE.SRGBColorSpace
    // 안개는 끈다(구가 안개 끝보다 멀어 통째로 안개색이 된다) · 깊이를 쓰지 않고 맨 먼저 그린다
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, side: THREE.BackSide, fog: false, depthWrite: false })
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), mat)
    this.mesh.renderOrder = -10
    this.mesh.frustumCulled = false
    this.mesh.visible = false
  }

  /** 지평선 색(그 지역 안개색)이 바뀌면 그림을 다시 (지역을 옮길 때) */
  setHorizon(horizon: number): void {
    if (horizon === this.color) return
    this.color = horizon
    const W = this.canvas.width
    const H = this.canvas.height
    const g = this.canvas.getContext('2d')!
    const hz = new THREE.Color(horizon)
    const top = hz.clone().offsetHSL(0, 0.14, -0.14)
    const css = (c: THREE.Color) => `#${c.getHexString()}`
    // 위(천정) → 적도(지평선) · 아래 반은 지평선 색 (땅 · 맵 밖 판이 가린다)
    const grad = g.createLinearGradient(0, 0, 0, H / 2)
    grad.addColorStop(0, css(top))
    grad.addColorStop(0.75, css(hz.clone().lerp(top, 0.25)))
    grad.addColorStop(1, css(hz))
    g.fillStyle = grad
    g.fillRect(0, 0, W, H / 2)
    g.fillStyle = css(hz)
    g.fillRect(0, H / 2, W, H / 2)
    // 솜구름: 높이 10 ~ 35° 띠에 열넷 — 둥근 덩이를 몇 개씩 겹친다 (가로는 이어 붙게 양옆에 한 번 더)
    let seed = 7
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    for (let i = 0; i < 14; i++) {
      const cx = rnd() * W
      const cy = H * 0.27 + rnd() * H * 0.19
      const n = 3 + Math.floor(rnd() * 4)
      for (let k = 0; k < n; k++) {
        const r = 7 + rnd() * 11
        const x = cx + (k - n / 2) * r * 0.9
        const y = cy + (rnd() - 0.5) * r * 0.5
        for (const ox of [-W, 0, W]) {
          // 가로로 1.6배 늘인 둥근 덩이 (그러데이션째 늘린다)
          g.save()
          g.translate(x + ox, y)
          g.scale(1.6, 1)
          const rg = g.createRadialGradient(0, 0, 0, 0, 0, r)
          rg.addColorStop(0, 'rgba(255,252,248,0.8)')
          rg.addColorStop(1, 'rgba(255,252,248,0)')
          g.fillStyle = rg
          g.beginPath()
          g.arc(0, 0, r, 0, Math.PI * 2)
          g.fill()
          g.restore()
        }
      }
    }
    this.tex.needsUpdate = true
  }

  dispose(): void {
    this.tex.dispose()
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}
