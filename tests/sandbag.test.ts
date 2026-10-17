// 모래주머니 모양 (2026-10-17 사용자: 덕코프 모래주머니처럼) — 자루 더미가 한 칸 · 허리 높이 안에 있고, 줄을 따라 눕는다
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { GameMap, TILE_FLOOR, TILE_SANDBAG } from '../src/core/map'
import { SANDBAG_H, sandbagRot, sandbagStackGeometry } from '../src/render3d/world3d'

function line(cells: [number, number][]): GameMap {
  const w = 8
  const h = 8
  const tiles = new Uint8Array(w * h).fill(TILE_FLOOR)
  for (const [x, y] of cells) tiles[y * w + x] = TILE_SANDBAG
  return { w, h, tiles } as unknown as GameMap
}
const mod = (a: number, m: number) => ((a % m) + m) % m

describe('모래주머니', () => {
  it('자루 더미는 한 칸 안 · 허리 높이 안팎 (어느 방향으로 돌려도)', () => {
    const g = sandbagStackGeometry()
    for (const rot of [0, Math.PI / 4, Math.PI / 2]) {
      const b = new THREE.Box3().setFromBufferAttribute(g.clone().rotateY(rot).getAttribute('position') as THREE.BufferAttribute)
      expect(b.min.y).toBeGreaterThanOrEqual(-0.01)
      expect(b.max.y).toBeLessThan(SANDBAG_H + 0.1)
      expect(b.max.y).toBeGreaterThan(SANDBAG_H - 0.1)
      for (const v of [b.min.x, b.max.x, b.min.z, b.max.z]) expect(Math.abs(v)).toBeLessThan(0.62)
    }
  })

  it('줄을 따라 눕는다: 가로 0 · 세로 90° · 대각선 ±45° (반 바퀴 섞임은 같은 방향)', () => {
    expect(mod(sandbagRot(line([[2, 3], [3, 3], [4, 3]]), 3, 3), Math.PI)).toBeCloseTo(0)
    expect(mod(sandbagRot(line([[3, 2], [3, 3], [3, 4]]), 3, 3), Math.PI)).toBeCloseTo(Math.PI / 2)
    expect(mod(sandbagRot(line([[2, 2], [3, 3], [4, 4]]), 3, 3), Math.PI)).toBeCloseTo(mod(-Math.PI / 4, Math.PI))
    expect(mod(sandbagRot(line([[4, 2], [3, 3], [2, 4]]), 3, 3), Math.PI)).toBeCloseTo(Math.PI / 4)
  })
})
