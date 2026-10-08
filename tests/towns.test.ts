// 막마다 다른 마을 (2026-10-08 퀄리티 2차 7단계 D4): 자리가 모두 바닥이고 처음 자리에서 걸어서 닿는다 · 네 마을의 모양이 서로 다르다
import { describe, expect, it } from 'vitest'
import { TILE, TILE_FLOOR, walkField } from '../src/core/map'
import { MAPS } from '../src/core/maps'
import { ACTS, areaLayout, buildAreaMap, townNpcs } from '../src/core/world'

describe('막마다 다른 마을', () => {
  for (const act of ACTS) {
    it(`${act.name} — 자리가 바닥이고 모두 걸어서 닿는다`, () => {
      const map = buildAreaMap(7, act.town)
      const l = areaLayout(act.town, map)
      const tileOf = (x: number, y: number) => Math.floor(y / TILE) * map.w + Math.floor(x / TILE)
      const d = walkField(map, tileOf(l.spawn.x, l.spawn.y))
      const spots: [string, { x: number; y: number }][] = [
        ['웨이포인트', l.wp!],
        ...l.exits.map((e, i) => [`출구 ${i}`, e] as [string, { x: number; y: number }]),
        ...l.exits.map((e, i) => [`출구 ${i} 도착`, e.arrive] as [string, { x: number; y: number }]),
        ...l.portals.map((p, i) => [`포털 ${i}`, p] as [string, { x: number; y: number }]),
        ...townNpcs(act.town).map((n) => [n.id, n] as [string, { x: number; y: number }]),
      ]
      for (const [name, s] of spots) {
        const t = tileOf(s.x, s.y)
        expect(map.tiles[t], `${name} 이 바닥`).toBe(TILE_FLOOR)
        expect(Number.isFinite(d[t]), `${name} 에 걸어서 닿는다`).toBe(true)
      }
      // NPC 끼리 너무 붙지 않는다 (이름표 · F 가 겹치지 않게)
      const n = townNpcs(act.town)
      for (let i = 0; i < n.length; i++) for (let j = i + 1; j < n.length; j++) expect(Math.hypot(n[i].x - n[j].x, n[i].y - n[j].y), `${n[i].id} · ${n[j].id}`).toBeGreaterThan(3 * TILE)
      // 들판 문은 웨이포인트 곁
      const gate = l.exits.find((e) => e.gate)!
      expect(Math.hypot(gate.x - l.wp!.x, gate.y - l.wp!.y)).toBeLessThan(4 * TILE)
    })
  }

  it('네 마을의 배치가 서로 다르다', () => {
    const rows = ACTS.map((a) => MAPS[buildAreaMap(7, a.town).id].rows.join('\n'))
    expect(new Set(rows).size).toBe(4)
  })
})
