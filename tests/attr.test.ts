// 능력치 (C 창 — 2026-09-19): 레벨마다 3점 · 힘 · 민첩 · 활력 · 정신 · 추천대로 분배(6:4) · 되돌리기는 마을에서 · 세이브 검사.
import { describe, expect, it } from 'vitest'
import { ATTR_REC } from '../src/core/characters'
import { CMD_ATTR, Input } from '../src/core/input'
import { buildMap } from '../src/core/map'
import { ATTR_PER_LEVEL, ST_CRIT, ST_DMG, ST_RATE, attrFree, emptySheet, sanitizeSheet } from '../src/core/items'
import { createState, step } from '../src/core/sim'
import { COUNTDOWN_TICKS } from '../src/core/state'
import { ACTS, buildAreaMap } from '../src/core/world'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })
const cmd = (arg: number): Input => ({ ...idle(), cmd: CMD_ATTR, arg })

function ready(level: number, area = 4) {
  const map = area === ACTS[0].town ? buildAreaMap(5, area) : buildMap('crypt', 1, 5)
  const s = createState({ area, seed: 5, chars: ['chim'], noMonsters: true, sheets: [{ ...emptySheet(), level }] }, map)
  for (let i = 0; i < COUNTDOWN_TICKS + 1; i++) step(s, map, [idle()])
  return { s, map, p: s.players[0] }
}

describe('능력치 (C)', () => {
  it('레벨마다 3점 — 힘에 한 점이면 피해 +0.8% · 민첩이면 연사 · 치명타가 오른다', () => {
    const { s, map, p } = ready(5)
    expect(attrFree(p.level, p.attr)).toBe(4 * ATTR_PER_LEVEL)
    const dmg0 = p.st[ST_DMG]
    step(s, map, [cmd(0)])
    expect(p.attr).toEqual([1, 0, 0, 0])
    expect(p.st[ST_DMG]).toBeCloseTo(dmg0 + 0.8)
    const r0 = p.st[ST_RATE]
    const c0 = p.st[ST_CRIT]
    step(s, map, [cmd(1)])
    expect(p.st[ST_RATE]).toBeCloseTo(r0 + 0.4)
    expect(p.st[ST_CRIT]).toBeCloseTo(c0 + 0.8)
    expect(attrFree(p.level, p.attr)).toBe(12 - 2)
  })

  it('추천대로 분배: 남은 포인트를 추천 둘에 6:4 로 · 포인트가 없으면 더 못 올린다', () => {
    const { s, map, p } = ready(11)
    step(s, map, [cmd(10)])
    const [a, b] = ATTR_REC.chim
    expect(attrFree(p.level, p.attr)).toBe(0)
    expect(p.attr[a] + p.attr[b]).toBe(30)
    expect(p.attr[a]).toBe(18)
    expect(p.attr[b]).toBe(12)
    const before = [...p.attr]
    step(s, map, [cmd(2)])
    expect(p.attr).toEqual(before)
  })

  it('되돌리기는 마을에서만 (무료)', () => {
    const f = ready(6)
    step(f.s, f.map, [cmd(10)])
    step(f.s, f.map, [cmd(99)])
    expect(attrFree(f.p.level, f.p.attr)).toBe(0)
    const t = ready(6, ACTS[0].town)
    step(t.s, t.map, [cmd(10)])
    step(t.s, t.map, [cmd(99)])
    expect(t.p.attr).toEqual([0, 0, 0, 0])
  })

  it('세이브: 레벨이 준 포인트보다 많이 찍힌 능력치는 되돌린다', () => {
    expect(sanitizeSheet({ ...emptySheet(), level: 3, attr: [2, 2, 2, 0] }).attr).toEqual([2, 2, 2, 0])
    expect(sanitizeSheet({ ...emptySheet(), level: 3, attr: [5, 5, 0, 0] }).attr).toEqual([0, 0, 0, 0])
    expect(sanitizeSheet({ ...emptySheet(), level: 3, attr: [-3, 'x', 1] }).attr).toEqual([0, 0, 1, 0])
  })
})
