// 큰 소품 묶음을 구역으로 나누기 (2026-10-24 최적화 — world3d chunkInstances): 인스턴스 · 색은 그대로 · 작은 묶음은 그대로
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { chunkInstances } from '../src/render3d/world3d'

function grid(n: number, tris: number): { group: THREE.Group; mesh: THREE.InstancedMesh } {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris * 9), 3))
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial(), n)
  const m4 = new THREE.Matrix4()
  for (let k = 0; k < n; k++) {
    // 40 × 40 칸에 고르게 → 12칸 구역 넷 × 넷
    mesh.setMatrixAt(k, m4.makeTranslation((k % 20) * 2 + 0.5, 0, Math.floor(k / 20) * 2 + 0.5))
    mesh.setColorAt(k, new THREE.Color(k / n, 0, 0))
  }
  const group = new THREE.Group()
  group.add(mesh)
  return { group, mesh }
}

describe('큰 소품 묶음은 구역으로 나눈다', () => {
  it('인스턴스 수 · 색이 그대로이고 구역마다 하나씩', () => {
    const { group, mesh } = grid(400, 300)
    expect(chunkInstances([mesh])).toBe(16)
    const parts = group.children as THREE.InstancedMesh[]
    expect(parts.includes(mesh)).toBe(false)
    expect(parts.reduce((a, p) => a + p.count, 0)).toBe(400)
    const reds = new Set<number>()
    const c = new THREE.Color()
    for (const p of parts) for (let j = 0; j < p.count; j++) reds.add(Math.round(p.getColorAt(j, c) && c.r * 400))
    expect(reds.size).toBe(400)
    expect(parts.every((p) => p.boundingSphere !== null)).toBe(true)
  })

  it('삼각형이 적은 묶음은 나누지 않는다 (그리기 호출만 는다)', () => {
    const { group, mesh } = grid(400, 30)
    expect(chunkInstances([mesh])).toBe(0)
    expect(group.children).toEqual([mesh])
  })
})
