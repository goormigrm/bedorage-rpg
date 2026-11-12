// 캐릭터 · 무기 메시 수 상한 (2026-11-12 그래픽 최종): 부품을 정점 색으로 구워 묶음마다 메시 하나로 그린다 —
// 디테일을 더하다가 묶음 밖에 메시를 따로 붙이면 그리기 호출(그림자까지 둘)이 다시 늘어난다. 전에는 캐릭터 한 명이 21 ~ 36개였다
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { CHARACTERS } from '../src/core/characters'
import { WEAPONS } from '../src/core/weapons'

// 얼굴 그림 캔버스 흉내 (그림 내용은 보지 않는다)
const g = globalThis as unknown as { document?: unknown }
if (!g.document) {
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? {} : k === 'measureText' ? () => ({ width: 10 }) : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}), set: () => true })
  g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, style: {} }), createElementNS: () => ({ style: {} }) }
}
const { buildCharacter, buildGun } = await import('../src/render3d/character3d')

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh)
  })
  return out
}

describe('캐릭터 · 무기 메시 수', () => {
  it('캐릭터 한 명은 메시 9개 안 (다리 둘 · 몸 · 가려진 윤곽 · 머리 장식 · 모자 글자 · 팔 · 무기 1 ~ 2)', () => {
    for (const def of Object.values(CHARACTERS)) {
      const rig = buildCharacter(def)
      expect(meshes(rig.root).length, def.id).toBeLessThanOrEqual(9)
      // 신화 장비를 다 껴도 장식 메시는 넷까지 (무기 빛 1 · 장식 몸 1 + 빛 1 · 여유 1)
      const base = meshes(rig.root).length
      rig.setWeapon(rig.weapon, 0, 4)
      rig.setGear(4, 4)
      expect(meshes(rig.root).length - base, def.id).toBeLessThanOrEqual(4)
      rig.setGear(0, 0)
      rig.setWeapon(rig.weapon, 0, 0)
      expect(meshes(rig.root).length, def.id).toBe(base)
    }
  })
  it('무기는 등급마다 메시 3개 안 · 총구 자리가 있다 · 정점 색이 있다', () => {
    for (const w of Object.values(WEAPONS)) {
      for (const r of [0, 1, 2, 3, 4]) {
        const b = buildGun(w, 0.42, 0, r)
        const ms = meshes(b.group)
        expect(ms.length, `${w.id} ${r}`).toBeLessThanOrEqual(3)
        expect(ms.length).toBeGreaterThan(0)
        for (const m of ms) expect(m.geometry.getAttribute('color'), w.id).toBeTruthy()
        expect(b.tip.position.z, w.id).toBeGreaterThan(0.1)
      }
    }
  })
})
