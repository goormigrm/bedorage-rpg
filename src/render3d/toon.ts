// 툰 그림체 (2026-10-08 퀄리티 2차 3단계 G8 — 사용자 결정 "둘 다 툰으로 묶기"): 사실적인 괴물 · 매끈한 계란 · 각진 바위가
// 한 화면에서 따로 놀던 것을 캐릭터 · 괴물 · 마을 사람부터 한 그림체로 묶는다.
//  ① 명암 3단(MeshToonMaterial + 계단 그러데이션) ② 먹선: 시선과 거의 수직인 가장자리를 어둡게 — 둥근 몸에 외곽선이 생긴다.
// 따로 한 번 더 그리지 않고(뒤집은 껍질 · 화면 윤곽선 없이) 셰이더 몇 줄이라 가볍다. 괴물의 프레임 셰이더와 이어 붙인다(chain).

import * as THREE from 'three'

let gradient: THREE.DataTexture | null = null

/**
 * 점광원 하나가 주는 빛의 상한 (2026-10-08 영상 확인): 등불 · 횃불 · 모닥불 바로 곁의 계란 · 괴물이 1 을 훌쩍 넘게 밝아져
 * 툰 명암이 한 단으로 뭉개지고 빛 번짐(후처리)까지 붙어 하얀 덩어리로 보였다 — 마을에서 파티가 모이면 특히. 바닥 · 벽은 그대로
 */
const POINT_CAP = 1.25
const LIGHTS_CAPPED = THREE.ShaderChunk.lights_fragment_begin.replace(
  'getPointLightInfo( pointLight, geometryPosition, directLight );',
  `getPointLightInfo( pointLight, geometryPosition, directLight );
		directLight.color = min( directLight.color, vec3( ${POINT_CAP.toFixed(2)} ) );`,
)

/**
 * ☀ 바닥 · 벽 · 랜드마크용 점광원 상한 (2026-11-12 그래픽 검토): 파스텔 바닥은 해 빛만으로 거의 1 이라 총구 섬광 · 스킬 빛(세기 6 ~ 40) · 횃불이 얹히면
 * 무늬가 씻겨 흰 판이 됐다(3인칭에서는 유리 징검다리 윗면 · 먼 벽 위가 화면을 가로지르는 흰 띠). 점광원 하나가 더하는 빛을 낮게 묶는다 — 색 기운만 남는다
 */
export function capPointLights(mat: THREE.Material, cap = 0.16): void {
  if (mat.userData.pcap || !(mat as THREE.MeshLambertMaterial).isMeshLambertMaterial) return
  mat.userData.pcap = true
  const prev = mat.onBeforeCompile
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r)
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <lights_fragment_begin>',
      THREE.ShaderChunk.lights_fragment_begin.replace(
        'getPointLightInfo( pointLight, geometryPosition, directLight );',
        `getPointLightInfo( pointLight, geometryPosition, directLight );
		directLight.color = min( directLight.color * 0.25, vec3( ${cap.toFixed(2)} ) );`,
      ),
    )
  }
  const key = mat.customProgramCacheKey.bind(mat)
  mat.customProgramCacheKey = () => `${key()}|floorcap`
}

/** 명암 계단: 그늘 · 중간 · 밝음 (가장 어두운 단도 너무 까맣지 않게 — 어두운 던전이라) */
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient
  const v = [96, 176, 255]
  const data = new Uint8Array(v.length * 4)
  v.forEach((c, i) => data.set([c, c, c, 255], i * 4))
  gradient = new THREE.DataTexture(data, v.length, 1, THREE.RGBAFormat)
  gradient.minFilter = THREE.NearestFilter
  gradient.magFilter = THREE.NearestFilter
  gradient.generateMipmaps = false
  gradient.needsUpdate = true
  return gradient
}

/**
 * 먹선에 얹는 것 (2026-11-12 그래픽 최종 — 캐릭터 · 무기 · ☀ 괴물):
 *  rim  = 림 빛 — 화면 위쪽을 보는 가장자리(하늘빛을 받는 쪽)는 먹선 대신 밝은 테. 한 색 덩어리(둥근 몸 · 4배로 커진 ☀ 보스)에 입체가 생긴다
 *  spec = 쇠의 반짝임 — 화면 왼쪽 위를 보는 면에 또렷한 흰 점(툰 재질은 반사광이 없어 총 · 칼이 플라스틱처럼 보였다)
 * 켠 것마다 셰이더가 다르다(프로그램 키) — 새 갈래를 쓰는 물체는 warmKit · queueWarm 을 거친다
 */
export interface ToonFx { rim?: number; spec?: number }

/** Lambert 와 같은 인자로 툰 재질 + 먹선 */
export function toonMat(p: THREE.MeshToonMaterialParameters = {}, ink = 0.7, fx?: ToonFx): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ gradientMap: toonGradient(), ...p })
  addInk(m, ink, fx)
  return m
}

/**
 * 먹선: 법선이 시선과 거의 수직(가장자리)인 곳을 어둡게. 이미 있는 onBeforeCompile(괴물의 프레임 셰이더 등)은 그대로 부르고 덧붙인다.
 * 빛을 받은 뒤 · 톤 매핑 뒤 마지막에 곱한다
 */
export function addInk(mat: THREE.Material, strength = 0.7, fx: ToonFx = {}): void {
  if (mat.userData.ink) return
  mat.userData.ink = strength
  const rim = fx.rim ?? 0
  const spec = fx.spec ?? 0
  const prev = mat.onBeforeCompile
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r)
    sh.uniforms.uInk = { value: strength }
    sh.uniforms.uRim = { value: rim }
    sh.uniforms.uSpec = { value: spec }
    sh.fragmentShader = 'uniform float uInk;\nuniform float uRim;\nuniform float uSpec;\n' + sh.fragmentShader.replace('#include <lights_fragment_begin>', LIGHTS_CAPPED).replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
      {
        vec3 nI = normalize( normal );
        float nv = abs( dot( nI, normalize( vViewPosition ) ) );
        float ink = 1.0 - smoothstep( 0.16, 0.42, nv );
        ${rim > 0 ? `float lit = smoothstep( 0.0, 0.5, nI.y );
        gl_FragColor.rgb *= 1.0 - ink * uInk * ( 1.0 - lit );
        gl_FragColor.rgb += ( 1.0 - smoothstep( 0.2, 0.46, nv ) ) * lit * uRim * ( gl_FragColor.rgb * 0.55 + vec3( 0.07 ) );` : 'gl_FragColor.rgb *= 1.0 - ink * uInk;'}
        ${spec > 0 ? 'gl_FragColor.rgb += smoothstep( 0.9, 0.93, dot( nI, vec3( -0.31, 0.78, 0.54 ) ) ) * uSpec * ( gl_FragColor.rgb * 0.6 + vec3( 0.25 ) );' : ''}
      }`,
    )
  }
  const key = mat.customProgramCacheKey.bind(mat)
  mat.customProgramCacheKey = () => `${key()}|ink|pcap${rim > 0 ? '|rim' : ''}${spec > 0 ? '|spec' : ''}`
}

/**
 * ☀ 귀여운 괴물의 몸 무늬 (2026-11-12 그래픽 최종 — 한 색 덩어리라 4배로 커진 보스는 무늬 없는 색 판이었다):
 * 배(아래를 보는 면)는 밝게 · 발치로 갈수록 조금 짙게, spots 면 등(위를 보는 면)에 짙은 물방울 무늬. 모델 좌표라 움직여도 무늬가 몸에 붙어 있다.
 * 프레임 셰이더(괴물) · 먹선과 이어 붙는다 — 첫 컴파일 전에 단다
 */
export function addBodyShade(mat: THREE.Material, spots: boolean): void {
  if (mat.userData.bodyShade) return
  mat.userData.bodyShade = true
  const prev = mat.onBeforeCompile
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r)
    sh.vertexShader = 'varying vec3 vBodyP;\nvarying vec3 vBodyN;\n' + sh.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      vBodyP = transformed;
      vBodyN = normalize( objectNormal );`,
    )
    sh.fragmentShader = 'varying vec3 vBodyP;\nvarying vec3 vBodyN;\n' + sh.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      {
        vec3 bn = normalize( vBodyN );
        float belly = smoothstep( 0.1, -0.7, bn.y );
        diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 1.3 + vec3( 0.06 ), belly * 0.6 );
        diffuseColor.rgb *= 0.86 + 0.14 * smoothstep( 0.0, 0.45, vBodyP.y );
        ${spots ? `vec2 q = vBodyP.xz * 8.0 + vec2( 0.0, floor( vBodyP.x * 8.0 ) * 0.5 );
        float dotR = length( fract( q ) - 0.5 );
        float back = smoothstep( 0.3, 0.8, bn.y );
        diffuseColor.rgb *= 1.0 - 0.34 * back * ( 1.0 - smoothstep( 0.27, 0.33, dotR ) );
        float band = smoothstep( 0.4, 0.5, abs( fract( vBodyP.y * 2.6 ) - 0.5 ) );
        diffuseColor.rgb *= 1.0 - 0.14 * band * ( 1.0 - back ) * ( 1.0 - belly );` : ''}
      }`,
    )
  }
  const key = mat.customProgramCacheKey.bind(mat)
  mat.customProgramCacheKey = () => `${key()}|body${spots ? 's' : ''}`
}
