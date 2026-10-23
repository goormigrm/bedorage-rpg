// 1인칭 이동 (2026-10-24): 시선 기준 자유 방향을 ×100 정수로 싣고 판이 길이 1로 나눈다 — 8방향과 같은 빠르기 · 직렬화 그대로
import { describe, expect, it } from 'vitest'
import { INPUT_BYTES, Input, readInput, writeInput } from '../src/core/input'
import { buildMap } from '../src/core/map'
import { createState, step } from '../src/core/sim'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })

function walk(mx: number, my: number, ticks = 30): { dx: number; dy: number } {
  const map = buildMap('crypt', 1, 81)
  const s = createState({ area: 4, seed: 81, chars: ['chim'], noMonsters: true }, map)
  s.objects = []
  for (let t = 0; t < 3; t++) step(s, map, [idle()])
  const p = s.players[0]
  const x0 = p.x
  const y0 = p.y
  for (let t = 0; t < ticks; t++) step(s, map, [{ ...idle(), mx, my }])
  return { dx: p.x - x0, dy: p.y - y0 }
}

describe('1인칭 자유 방향 이동', () => {
  it('×100 방향은 그 쪽으로 · 빠르기는 8방향과 같다', () => {
    const a = walk(87, 50) // 30°
    const b = walk(1, 0)
    expect(Math.atan2(a.dy, a.dx)).toBeCloseTo(Math.atan2(50, 87), 1)
    expect(Math.hypot(a.dx, a.dy)).toBeCloseTo(Math.hypot(b.dx, b.dy), 0)
    // 대각 8방향(-1 · 0 · 1)도 예전 그대로
    const c = walk(1, 1)
    expect(Math.hypot(c.dx, c.dy)).toBeCloseTo(Math.hypot(b.dx, b.dy), 0)
  })

  it('직렬화(1바이트)를 그대로 지난다', () => {
    const v = new DataView(new ArrayBuffer(INPUT_BYTES))
    writeInput(v, 0, { ...idle(), mx: -71, my: 71 })
    const r = readInput(v, 0)
    expect([r.mx, r.my]).toEqual([-71, 71])
  })
})
