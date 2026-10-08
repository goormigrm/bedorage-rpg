// 화면 후처리: 빛 번짐(bloom) + 막마다 색감 (2026-10-08 퀄리티 2차 2단계 — 상용 게임과 견준 검토 G1 · G2).
// 전에는 장면을 화면에 바로 그렸다(후처리 없음). 이제 장면을 HDR 그림(반정밀 · MSAA 4)에 그리고 —
//  ① 밝은 곳만 1/4 크기로 걸러(문턱 · 부드러운 무릎) ② 1/4 · 1/8 에서 가로세로로 번지게 하고
//  ③ 마지막 한 번에: 장면 + 번짐 → 색감(채도 · 대비 · 그늘/밝은 곳 빛깔) → 톤 매핑(ACES) → sRGB 로 화면에.
// 가벼운 방식만 쓴다(번짐은 작은 그림에서만). 자동 화질이 낮아지면 끄고 예전처럼 바로 그린다(enabled = false).

import * as THREE from 'three'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'

/** 색감 한 벌 (선형 공간 — 톤 매핑 앞) */
export interface Grade {
  /** 번짐 세기 · 문턱(이보다 밝은 것만 번진다 — 1 = 흰 종이) · 무릎(문턱 위로 서서히) */
  bloom: number
  threshold: number
  knee: number
  /** 채도 (1 = 그대로) · 대비 (1 = 그대로 — 중간 회색 둘레로) */
  sat: number
  contrast: number
  /** 그늘 · 밝은 곳에 곱하는 빛깔 (1,1,1 = 그대로) */
  shadow: [number, number, number]
  high: [number, number, number]
  /** 노출 배율 */
  exposure: number
}

export const NEUTRAL: Grade = { bloom: 0.55, threshold: 1, knee: 0.6, sat: 1, contrast: 1, shadow: [1, 1, 1], high: [1, 1, 1], exposure: 1 }

/**
 * 막마다 색감 (공포스러움). 영화처럼 그늘은 차갑게 · 밝은 곳은 따뜻하게를 바탕으로 막의 분위기를 얹는다.
 * 1막 피의 들판 · 묘지(청록 그늘 · 주황 불빛) · 2막 숲 · 늪(초록 그늘) · 3막 하수도 · 폐허(차고 바랜 푸름) · 4막 지옥(붉은 그늘 · 불빛)
 */
const DARK_ACT: Grade[] = [
  { bloom: 0.6, threshold: 0.95, knee: 0.6, sat: 1.06, contrast: 1.08, shadow: [0.9, 1.0, 1.08], high: [1.07, 1.0, 0.9], exposure: 1 },
  { bloom: 0.55, threshold: 0.95, knee: 0.6, sat: 0.96, contrast: 1.06, shadow: [0.9, 1.05, 0.94], high: [1.05, 1.03, 0.88], exposure: 1 },
  { bloom: 0.6, threshold: 0.95, knee: 0.6, sat: 0.84, contrast: 1.1, shadow: [0.88, 0.98, 1.12], high: [1.0, 1.0, 1.03], exposure: 1.02 },
  { bloom: 0.7, threshold: 0.9, knee: 0.6, sat: 1.1, contrast: 1.12, shadow: [1.12, 0.9, 0.86], high: [1.08, 0.97, 0.84], exposure: 1 },
]
/** 마을: 모닥불 곁의 따뜻한 빛 */
const DARK_TOWN: Grade = { bloom: 0.55, threshold: 0.95, knee: 0.6, sat: 1.04, contrast: 1.04, shadow: [0.96, 0.98, 1.04], high: [1.06, 1.0, 0.9], exposure: 1.03 }
/** 철면수심전용(밝은 낮): 장면이 밝아 문턱을 높이고 번짐은 옅게 — 파스텔이 하얗게 날아가지 않게 */
const BRIGHT_GRADE: Grade = { bloom: 0.32, threshold: 1.5, knee: 0.8, sat: 1.08, contrast: 1.02, shadow: [1.0, 0.98, 1.05], high: [1.03, 1.01, 0.97], exposure: 1 }

/** 지역의 색감. 보스가 깨어 있으면 대비 · 번짐을 조금 올린다 */
export function gradeFor(act: number, town: boolean, bright: boolean, boss: boolean): Grade {
  const g = bright ? BRIGHT_GRADE : town ? DARK_TOWN : DARK_ACT[Math.max(0, Math.min(DARK_ACT.length - 1, act))]
  if (!boss) return g
  return { ...g, contrast: g.contrast + 0.05, bloom: g.bloom + 0.12, sat: g.sat + 0.04 }
}

const VERT = /* glsl */ `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
attribute vec3 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/** 밝은 곳 거르기 + 1/4 로 줄이기 (네 점 평균 — 깜빡임을 줄인다) */
const BRIGHT = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThr;
uniform float uKnee;
varying vec2 vUv;
vec3 pick(vec2 o) {
  vec3 c = texture2D(tSrc, vUv + o * uTexel).rgb;
  float l = max(c.r, max(c.g, c.b));
  float k = clamp((l - uThr) / max(uKnee, 1e-4), 0.0, 1.0);
  return c * k * k;
}
void main() {
  vec3 c = pick(vec2(-1.0, -1.0)) + pick(vec2(1.0, -1.0)) + pick(vec2(-1.0, 1.0)) + pick(vec2(1.0, 1.0));
  // 아주 밝은 한 점이 번쩍이지 않게 상한
  gl_FragColor = vec4(min(c * 0.25, vec3(8.0)), 1.0);
}
`

/** 9 탭 가우스 번짐 (방향 uDir) */
const BLUR = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;
  c += texture2D(tSrc, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tSrc, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tSrc, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  c += texture2D(tSrc, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}
`

const COMP = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform sampler2D tBloomA;
uniform sampler2D tBloomB;
uniform float uBloom;
uniform float uSat;
uniform float uContrast;
uniform vec3 uShadow;
uniform vec3 uHigh;
uniform float uExposure;
uniform float toneMappingExposure;
varying vec2 vUv;
#include <tonemapping_pars_fragment>
#include <colorspace_pars_fragment>
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  c += (texture2D(tBloomA, vUv).rgb * 0.6 + texture2D(tBloomB, vUv).rgb * 0.8) * uBloom;
  c *= uExposure;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  c *= mix(uShadow, uHigh, smoothstep(0.02, 0.7, l));
  c = 0.18 * pow(max(c, vec3(0.0)) / 0.18, vec3(uContrast));
  gl_FragColor = vec4(c, 1.0);
  #ifdef ACES_FILMIC_TONE_MAPPING
    gl_FragColor.rgb = ACESFilmicToneMapping(gl_FragColor.rgb);
  #endif
  #ifdef SRGB_TRANSFER
    gl_FragColor = sRGBTransferOETF(gl_FragColor);
  #endif
}
`

const mat = (frag: string, uniforms: Record<string, THREE.IUniform>, defines?: Record<string, string>) =>
  new THREE.RawShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, defines, depthTest: false, depthWrite: false })

export class PostFx {
  /** 꺼져 있으면 장면을 화면에 바로 그린다 (자동 화질 낮음 · 오래된 GPU) */
  enabled = true
  /** 반정밀(HDR) 그림에 그릴 수 있는 GPU 인가 — 아니면 늘 끈다 */
  readonly supported: boolean
  readonly grade: Grade = { ...NEUTRAL, shadow: [1, 1, 1], high: [1, 1, 1] }
  private readonly scene: THREE.WebGLRenderTarget
  private readonly qa: THREE.WebGLRenderTarget
  private readonly qb: THREE.WebGLRenderTarget
  private readonly ea: THREE.WebGLRenderTarget
  private readonly eb: THREE.WebGLRenderTarget
  private readonly brightMat: THREE.RawShaderMaterial
  private readonly blurMat: THREE.RawShaderMaterial
  private readonly compMat: THREE.RawShaderMaterial
  private readonly quad = new FullScreenQuad()
  private w = 1
  private h = 1

  constructor(private readonly gl: THREE.WebGLRenderer) {
    this.supported = gl.capabilities.isWebGL2 && (gl.extensions.has('EXT_color_buffer_float') || gl.extensions.has('EXT_color_buffer_half_float'))
    this.enabled = this.supported
    const rt = (samples = 0, depth = false) =>
      new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples, depthBuffer: depth, stencilBuffer: depth, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter })
    this.scene = rt(4, true)
    this.qa = rt()
    this.qb = rt()
    this.ea = rt()
    this.eb = rt()
    this.brightMat = mat(BRIGHT, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThr: { value: 1 }, uKnee: { value: 0.6 } })
    this.blurMat = mat(BLUR, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } })
    this.compMat = mat(
      COMP,
      {
        tScene: { value: this.scene.texture }, tBloomA: { value: this.qa.texture }, tBloomB: { value: this.ea.texture },
        uBloom: { value: 0.5 }, uSat: { value: 1 }, uContrast: { value: 1 }, uShadow: { value: new THREE.Vector3(1, 1, 1) }, uHigh: { value: new THREE.Vector3(1, 1, 1) },
        uExposure: { value: 1 }, toneMappingExposure: { value: 1 },
      },
      { ACES_FILMIC_TONE_MAPPING: '', SRGB_TRANSFER: '' },
    )
  }

  /** 화면 그림 크기 (그리기 버퍼 픽셀) */
  setSize(w: number, h: number): void {
    w = Math.max(1, Math.round(w))
    h = Math.max(1, Math.round(h))
    if (w === this.w && h === this.h) return
    this.w = w
    this.h = h
    this.scene.setSize(w, h)
    const qw = Math.max(1, Math.round(w / 4))
    const qh = Math.max(1, Math.round(h / 4))
    this.qa.setSize(qw, qh)
    this.qb.setSize(qw, qh)
    this.ea.setSize(Math.max(1, Math.round(qw / 2)), Math.max(1, Math.round(qh / 2)))
    this.eb.setSize(Math.max(1, Math.round(qw / 2)), Math.max(1, Math.round(qh / 2)))
  }

  /** 색감을 g 쪽으로 k(0 ~ 1)만큼 다가간다 — 지역 · 보스 방이 바뀔 때 서서히 */
  blend(g: Grade, k: number): void {
    const o = this.grade
    const lerp = (a: number, b: number) => a + (b - a) * k
    o.bloom = lerp(o.bloom, g.bloom)
    o.threshold = lerp(o.threshold, g.threshold)
    o.knee = lerp(o.knee, g.knee)
    o.sat = lerp(o.sat, g.sat)
    o.contrast = lerp(o.contrast, g.contrast)
    o.exposure = lerp(o.exposure, g.exposure)
    for (let i = 0; i < 3; i++) {
      o.shadow[i] = lerp(o.shadow[i], g.shadow[i])
      o.high[i] = lerp(o.high[i], g.high[i])
    }
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const gl = this.gl
    if (!this.enabled) {
      gl.setRenderTarget(null)
      gl.render(scene, camera)
      return
    }
    const g = this.grade
    gl.setRenderTarget(this.scene)
    gl.render(scene, camera)
    // ① 밝은 곳 → 1/4
    this.brightMat.uniforms.tSrc.value = this.scene.texture
    ;(this.brightMat.uniforms.uTexel.value as THREE.Vector2).set(1 / this.w, 1 / this.h)
    this.brightMat.uniforms.uThr.value = g.threshold
    this.brightMat.uniforms.uKnee.value = g.knee
    this.pass(this.brightMat, this.qa)
    // ② 1/4 에서 가로 · 세로, 1/8 로 내려 한 번 더 (넓은 빛무리)
    this.blur(this.qa, this.qb, 1, 0)
    this.blur(this.qb, this.qa, 0, 1)
    this.blur(this.qa, this.ea, 1, 0, 2)
    this.blur(this.ea, this.eb, 1, 0)
    this.blur(this.eb, this.ea, 0, 1)
    // ③ 합치기 → 색감 → 톤 매핑 → 화면
    const u = this.compMat.uniforms
    u.uBloom.value = g.bloom
    u.uSat.value = g.sat
    u.uContrast.value = g.contrast
    ;(u.uShadow.value as THREE.Vector3).set(g.shadow[0], g.shadow[1], g.shadow[2])
    ;(u.uHigh.value as THREE.Vector3).set(g.high[0], g.high[1], g.high[2])
    u.uExposure.value = g.exposure
    u.toneMappingExposure.value = gl.toneMappingExposure
    this.pass(this.compMat, null)
  }

  private blur(src: THREE.WebGLRenderTarget, dst: THREE.WebGLRenderTarget, dx: number, dy: number, step = 1): void {
    this.blurMat.uniforms.tSrc.value = src.texture
    ;(this.blurMat.uniforms.uDir.value as THREE.Vector2).set((dx * step) / src.width, (dy * step) / src.height)
    this.pass(this.blurMat, dst)
  }

  private pass(m: THREE.Material, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = m
    this.gl.setRenderTarget(target)
    this.quad.render(this.gl)
  }

  dispose(): void {
    for (const t of [this.scene, this.qa, this.qb, this.ea, this.eb]) t.dispose()
    for (const m of [this.brightMat, this.blurMat, this.compMat]) m.dispose()
    this.quad.dispose()
  }
}
