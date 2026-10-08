// 공중에 떠다니는 것 (2026-10-08 퀄리티 2차 2단계 G7 — 정지 화면 같던 배경을 살아 있게).
// 막 · 분위기마다: 먼지 · 반딧불 · 차가운 먼지(떨어짐) · 불티(솟음) · 마을 모닥불 불티 · 밝은 분위기의 반짝이 · 꽃잎.
// 카메라 둘레 상자 안에서 GPU 가 시간만으로 움직인다(정점 셰이더 — CPU 는 한 프레임에 값 몇 개만). 상자 가장자리에서 옅어진다.

import * as THREE from 'three'

export interface AmbientKind {
  color: number
  count: number
  /** 점 크기 (화면 픽셀 어림 — 거리에 따라 줄어든다) · 진하기 · 솟는 빠르기(음수 = 떨어짐) · 깜빡임(0 ~ 1) · 흔들림 폭 */
  size: number
  alpha: number
  rise: number
  twinkle: number
  sway: number
}

/** 막(0 ~ 3) · 마을 · 밝은 분위기에 맞는 떠다니는 것 */
export function ambientFor(act: number, town: boolean, bright: boolean): AmbientKind {
  if (bright) {
    // 꽃잎(분홍 · 천천히 떨어짐)과 반짝이 — 막마다 조금 다르게
    return act % 2 === 0
      ? { color: 0xffffff, count: 70, size: 5, alpha: 0.55, rise: 0.05, twinkle: 1, sway: 0.7 }
      : { color: 0xffb6d2, count: 60, size: 6, alpha: 0.5, rise: -0.12, twinkle: 0.2, sway: 1.1 }
  }
  if (town) return { color: 0xffa04a, count: 60, size: 4, alpha: 0.8, rise: 0.35, twinkle: 0.7, sway: 0.5 }
  switch (act) {
    case 1:
      return { color: 0xc8ff6a, count: 45, size: 7, alpha: 0.9, rise: 0.02, twinkle: 1, sway: 1.2 } // 숲 · 늪: 반딧불
    case 2:
      return { color: 0xa8c8e0, count: 110, size: 3.5, alpha: 0.35, rise: -0.06, twinkle: 0.3, sway: 0.4 } // 하수도 · 폐허: 떨어지는 차가운 먼지
    case 3:
      return { color: 0xff7a2a, count: 150, size: 4.5, alpha: 0.9, rise: 0.45, twinkle: 0.6, sway: 0.6 } // 지옥: 솟는 불티
    default:
      return { color: 0xd8cbb0, count: 120, size: 3.5, alpha: 0.32, rise: 0.03, twinkle: 0.5, sway: 0.5 } // 들판 · 묘지: 떠도는 먼지
  }
}

const VERT = /* glsl */ `
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform float uSize;
uniform float uRise;
uniform float uTwinkle;
uniform float uSway;
uniform float uPx;
attribute vec3 aSeed;
varying float vA;
void main() {
  // 상자 안의 처음 자리 + 흔들림 + 솟음 → 카메라 둘레 상자 안으로 감는다
  vec3 p = aSeed * uBox;
  p.x += sin(uTime * 0.31 + aSeed.y * 19.0) * uSway;
  p.z += cos(uTime * 0.27 + aSeed.x * 23.0) * uSway;
  p.y += uTime * uRise * (0.6 + aSeed.z * 0.8);
  vec3 rel;
  rel.xz = mod(p.xz - uCenter.xz + uBox.xz * 0.5, uBox.xz) - uBox.xz * 0.5;
  rel.y = mod(p.y, uBox.y);
  vec3 world = vec3(uCenter.x + rel.x, 0.15 + rel.y, uCenter.z + rel.z);
  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  gl_PointSize = uSize * uPx * (0.6 + aSeed.x * 0.8) * (18.0 / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
  // 상자 가장자리 · 바닥 · 천장에서 옅어진다 · 깜빡임
  float edge = 1.0 - smoothstep(0.32, 0.5, max(abs(rel.x) / uBox.x, abs(rel.z) / uBox.z));
  float vert = smoothstep(0.0, 0.12, rel.y / uBox.y) * (1.0 - smoothstep(0.8, 1.0, rel.y / uBox.y));
  float tw = 1.0 - uTwinkle + uTwinkle * (0.5 + 0.5 * sin(uTime * (1.3 + aSeed.y * 2.7) + aSeed.z * 31.0));
  vA = edge * vert * tw;
}
`

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(max(0.0, 1.0 - d), 2.0) * vA * uAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export class AmbientFx {
  readonly points: THREE.Points
  private readonly mat: THREE.ShaderMaterial
  private readonly geo: THREE.BufferGeometry

  constructor(kind: AmbientKind, max = 160) {
    const seeds = new Float32Array(max * 3)
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random()
    this.geo = new THREE.BufferGeometry()
    // 자리는 셰이더가 정한다 — position 은 그리기 개수용 0
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3))
    this.geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3))
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(26, 5, 22) },
        uSize: { value: 4 }, uRise: { value: 0 }, uTwinkle: { value: 0 }, uSway: { value: 0.5 }, uPx: { value: 1 },
        uColor: { value: new THREE.Color() }, uAlpha: { value: 0.5 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.points = new THREE.Points(this.geo, this.mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 7
    this.set(kind)
  }

  set(k: AmbientKind): void {
    const u = this.mat.uniforms
    ;(u.uColor.value as THREE.Color).setHex(k.color)
    u.uSize.value = k.size
    u.uAlpha.value = k.alpha
    u.uRise.value = k.rise
    u.uTwinkle.value = k.twinkle
    u.uSway.value = k.sway
    this.geo.setDrawRange(0, Math.min(k.count, this.geo.getAttribute('aSeed').count))
  }

  /** 매 프레임: 시간 · 카메라가 보는 곳 · 그리기 버퍼 배율 · 수 배율(자동 화질 — 낮으면 줄인다) */
  update(t: number, x: number, z: number, px: number, k = 1): void {
    const u = this.mat.uniforms
    u.uTime.value = t
    ;(u.uCenter.value as THREE.Vector3).set(x, 0, z)
    u.uPx.value = px
    this.points.visible = k > 0
  }

  dispose(): void {
    this.geo.dispose()
    this.mat.dispose()
  }
}
