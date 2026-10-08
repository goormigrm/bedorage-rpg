// 툰 그림체 (2026-10-08 퀄리티 2차 3단계 G8 — 사용자 결정 "둘 다 툰으로 묶기"): 사실적인 괴물 · 매끈한 계란 · 각진 바위가
// 한 화면에서 따로 놀던 것을 캐릭터 · 괴물 · 마을 사람부터 한 그림체로 묶는다.
//  ① 명암 3단(MeshToonMaterial + 계단 그러데이션) ② 먹선: 시선과 거의 수직인 가장자리를 어둡게 — 둥근 몸에 외곽선이 생긴다.
// 따로 한 번 더 그리지 않고(뒤집은 껍질 · 화면 윤곽선 없이) 셰이더 몇 줄이라 가볍다. 괴물의 프레임 셰이더와 이어 붙인다(chain).

import * as THREE from 'three'

let gradient: THREE.DataTexture | null = null

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

/** Lambert 와 같은 인자로 툰 재질 + 먹선 */
export function toonMat(p: THREE.MeshToonMaterialParameters = {}, ink = 0.7): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ gradientMap: toonGradient(), ...p })
  addInk(m, ink)
  return m
}

/**
 * 먹선: 법선이 시선과 거의 수직(가장자리)인 곳을 어둡게. 이미 있는 onBeforeCompile(괴물의 프레임 셰이더 등)은 그대로 부르고 덧붙인다.
 * 빛을 받은 뒤 · 톤 매핑 뒤 마지막에 곱한다
 */
export function addInk(mat: THREE.Material, strength = 0.7): void {
  if (mat.userData.ink) return
  mat.userData.ink = strength
  const prev = mat.onBeforeCompile
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r)
    sh.uniforms.uInk = { value: strength }
    sh.fragmentShader = 'uniform float uInk;\n' + sh.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
      {
        float nv = abs( dot( normalize( normal ), normalize( vViewPosition ) ) );
        float ink = 1.0 - smoothstep( 0.16, 0.42, nv );
        gl_FragColor.rgb *= 1.0 - ink * uInk;
      }`,
    )
  }
  const key = mat.customProgramCacheKey.bind(mat)
  mat.customProgramCacheKey = () => `${key()}|ink`
}
