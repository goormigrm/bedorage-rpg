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

// 표정 (2026-11-13 2차): 미리 구운 얼굴 그림을 바꿔 끼운다 — 같은 눈 · 입이 되는 표정은 한 장을 같이 쓰고, 안 구워진 표정은 평소 얼굴
describe('캐릭터 표정', () => {
  it('표정마다 그림이 다르고(쓰러짐은 누구나) · 같은 얼굴이 되는 표정은 한 장 · 안 구운 표정은 평소 얼굴', async () => {
    const { bodyTexture, peekBodyTexture } = await import('../src/render3d/faceTexture')
    for (const def of Object.values(CHARACTERS)) {
      const normal = bodyTexture(def)
      const rig = buildCharacter(def)
      const body = meshes(rig.root).find((m) => (m.material as THREE.MeshToonMaterial).map === normal)!
      expect(body, def.id).toBeTruthy()
      const map = () => (body.material as THREE.MeshToonMaterial).map
      // 아직 안 구웠다 → 평소 얼굴 그대로 (그 자리에서 굽느라 멈칫하지 않는다)
      if (!peekBodyTexture(def, 'down')) {
        rig.setFace('down')
        expect(map(), def.id).toBe(normal)
      }
      const down = bodyTexture(def, 'down')
      expect(down, def.id).not.toBe(normal)
      const rig2 = buildCharacter(def)
      const body2 = meshes(rig2.root).find((m) => (m.material as THREE.MeshToonMaterial).map === normal)!
      rig2.setFace('down')
      expect((body2.material as THREE.MeshToonMaterial).map, def.id).toBe(down)
      rig2.setFace('normal')
      expect((body2.material as THREE.MeshToonMaterial).map, def.id).toBe(normal)
      // 웃는 눈 + 활짝 웃는 입인 캐릭터의 기쁜 얼굴은 평소 얼굴과 같은 그림
      if (def.look.eyes === 'happy' && def.look.mouth === 'grin') expect(bodyTexture(def, 'joy'), def.id).toBe(normal)
    }
  })
})
