// 도형 굽기 (2026-11-12 그래픽 최종): 캐릭터 · 무기를 도형 수십 개로 조립하면 부품마다 그리기 호출 하나(그림자까지 둘)였다 —
// 캐릭터 한 명이 메시 21 ~ 36개. 색을 정점에 칠해 **같은 재질 하나**로 합치면 부품을 아무리 더해도 호출은 묶음(머리 장식 · 팔 · 다리 · 무기) 수만큼이다.
// 그래서 디테일(손가락 · 소매 끝 · 신발 밑창 · 총의 조준기 · 탄창)을 호출 수를 줄이면서 더할 수 있다.

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _c = new THREE.Color()
const UP = new THREE.Vector3(0, 1, 0)

export const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

/** 도형을 제자리로 (자리 · 회전 · 크기) — 합치기 전에 정점에 바로 구워 넣는다 */
export function at<T extends THREE.BufferGeometry>(g: T, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): T {
  g.applyMatrix4(_m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz)))
  return g
}

/** 정점 색을 조금 바꾸는 함수: 양수 = 흰색 쪽으로 · 음수 = 어둡게 (머리카락 윤기 띠 · 옷 그늘) */
export type Tint = (x: number, y: number, z: number) => number

/** 색을 칠한 도형을 모아 메시 하나로 */
export class Bake {
  private list: THREE.BufferGeometry[] = []

  get empty(): boolean {
    return this.list.length === 0
  }

  add(g: THREE.BufferGeometry, color: number, tint?: Tint): this {
    // mergeGeometries 는 모두 색인이 있거나 모두 없어야 한다 — 없는 것(돌출 · 다면체)에 차례대로 색인을 붙인다
    const pos = g.getAttribute('position')
    if (!g.index) {
      const idx = new Uint16Array(pos.count)
      for (let i = 0; i < pos.count; i++) idx[i] = i
      g.setIndex(new THREE.BufferAttribute(idx, 1))
    }
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k)
    _c.set(color)
    const col = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      let r = _c.r
      let gg = _c.g
      let b = _c.b
      const k = tint ? tint(pos.getX(i), pos.getY(i), pos.getZ(i)) : 0
      if (k > 0) {
        r += (1 - r) * k
        gg += (1 - gg) * k
        b += (1 - b) * k
      } else if (k < 0) {
        r *= 1 + k
        gg *= 1 + k
        b *= 1 + k
      }
      col[i * 3] = r
      col[i * 3 + 1] = gg
      col[i * 3 + 2] = b
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    this.list.push(g)
    return this
  }

  geometry(): THREE.BufferGeometry {
    const g = mergeGeometries(this.list, false)!
    for (const s of this.list) s.dispose()
    this.list = []
    return g
  }

  mesh(mat: THREE.Material, shadow = true): THREE.Mesh {
    const m = new THREE.Mesh(this.geometry(), mat)
    m.castShadow = shadow
    return m
  }
}

export function ball(r: number, x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx, ws = 12, hs = 8): THREE.BufferGeometry {
  return at(new THREE.SphereGeometry(r, ws, hs), x, y, z, 0, 0, 0, sx, sy, sz)
}

/** 두 점을 잇는 막대 (a 쪽 반지름 r0 · b 쪽 r1) */
export function limb(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1 = r0, seg = 8): THREE.BufferGeometry {
  const d = b.clone().sub(a)
  const len = d.length()
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1)
  g.translate(0, len / 2, 0)
  g.applyQuaternion(_q.setFromUnitVectors(UP, d.normalize()))
  g.translate(a.x, a.y, a.z)
  return g
}

/** 바닥과 나란한 고리 (y 높이 · 반지름 rr · 굵기 tube). a0 ~ a1 = 구(SphereGeometry)의 phi 와 같은 각 — 머리카락 끝의 도톰한 단 */
export function hoop(rr: number, tube: number, y: number, phi0 = 0, phiLen = Math.PI * 2, seg = 28): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(rr, tube, 6, seg, phiLen)
  // 고리의 각 a 는 (cos a, sin a) — 구의 phi 는 (-cos phi, sin phi) 라 a = π - phi. 눕히면(x 축 +90°) xy 의 y 가 z 로 간다
  g.rotateZ(Math.PI - phi0 - phiLen)
  g.rotateX(Math.PI / 2)
  g.translate(0, y, 0)
  return g
}

/**
 * 옆모습을 그려 두께만큼 밀어낸 판 (총의 개머리판 · 몸통 · 탄창 · 손잡이 — 상자로는 못 내는 기울기와 곡선).
 * pts = [z0, y0, z1, y1, …] (앞 = +z · 위 = +y) · w = 두께(x) · bevel = 모서리 깎기
 */
export function slab(pts: number[], w: number, bevel = 0.004, x = 0): THREE.BufferGeometry {
  const sh = new THREE.Shape()
  for (let i = 0; i < pts.length; i += 2) {
    if (i === 0) sh.moveTo(pts[i], pts[i + 1])
    else sh.lineTo(pts[i], pts[i + 1])
  }
  sh.closePath()
  const b = Math.min(bevel, w * 0.3)
  const depth = Math.max(0.0005, w - b * 2)
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 1, steps: 1, curveSegments: 4 })
  g.translate(0, 0, -depth / 2)
  // 그린 면(xy)의 x 를 앞(+z)으로 · 민 방향(z)을 옆(x)으로
  g.rotateY(-Math.PI / 2)
  if (x) g.translate(x, 0, 0)
  return g
}
