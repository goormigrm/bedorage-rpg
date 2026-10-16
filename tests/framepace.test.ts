// 그리기 횟수 맞추기 (2026-10-17 — game/ticker.ts shouldDraw): 판은 1초에 60번 — 고주사율 모니터에서는 신호를 고르게 건너뛴다
import { describe, expect, it } from 'vitest'
import { shouldDraw } from '../src/game/ticker'

/** hz 모니터에서 1초 동안 그리는 횟수와 그리기 간격들 (신호 간격은 정확하다고 본다) */
function run(hz: number) {
  const iv = 1000 / hz
  let last = -1e9
  let draws = 0
  const gaps = new Set<number>()
  for (let k = 0; k < hz; k++) {
    const t = k * iv
    if (!shouldDraw(t - last, iv)) continue
    if (last > -1e8) gaps.add(Math.round((t - last) / iv))
    last = t
    draws++
  }
  return { draws, gaps: [...gaps] }
}

describe('그리기 횟수 맞추기', () => {
  it('60Hz 이하는 신호마다 그린다', () => {
    expect(run(60).draws).toBe(60)
    expect(run(50).draws).toBe(50)
    expect(run(75).draws).toBe(75)
  })
  it('고주사율은 고르게 건너뛴다 (간격이 한 가지)', () => {
    expect(run(120)).toEqual({ draws: 60, gaps: [2] })
    expect(run(144)).toEqual({ draws: 72, gaps: [2] })
    expect(run(240)).toEqual({ draws: 60, gaps: [4] })
    expect(run(165).gaps).toEqual([3])
  })
})
