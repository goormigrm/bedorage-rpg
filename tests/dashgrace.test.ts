// 던전 구르기 끝의 무적 유예 (2026-09-25 — 0.167초 → 0.25초 · 투기장 · 승빠란은 그대로)
import { describe, expect, it } from 'vitest'
import { CharacterId } from '../src/core/characters'
import { BTN_DASH, Input } from '../src/core/input'
import { buildMap } from '../src/core/map'
import { createState, step } from '../src/core/sim'
import { DASH_GRACE, DASH_TICKS, UWON } from '../src/core/state'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })

/** 구르기를 한 번 누른 뒤 다치지 않는 틱 수 */
function safeTicks(char: CharacterId, mode: 'dungeon' | 'arena'): number {
  const map = buildMap('crypt', 1, 61)
  const s = createState({ area: 4, seed: 61, chars: [char, 'chim'], noMonsters: true, mode }, map)
  s.objects = []
  const run = (a: Input, b: Input = idle()) => step(s, map, [a, b])
  for (let t = 0; t < 400 && s.phase !== 'playing'; t++) run(idle())
  const p = s.players[0]
  for (let t = 0; t < 200; t++) run(idle())
  p.invuln = 0
  run({ ...idle(), mx: 1, buttons: BTN_DASH })
  expect(p.dashTimer).toBeGreaterThan(0)
  let n = 1
  while (p.invuln > 0 || p.dashTimer > 0) {
    run(idle())
    n++
  }
  return n
}

describe('구르기 무적', () => {
  it('던전: 구르기 + 유예 5틱 (합쳐 0.25초) · 투기장과 승빠란은 구르기만 · 우원란은 패시브(24) 그대로', () => {
    const base = safeTicks('chim', 'arena')
    expect(Math.abs(base - DASH_TICKS)).toBeLessThanOrEqual(1)
    expect(safeTicks('chim', 'dungeon')).toBe(base + DASH_GRACE)
    expect(safeTicks('oknyang', 'dungeon')).toBe(base + DASH_GRACE)
    expect(safeTicks('seungwoo', 'dungeon')).toBe(base)
    expect(safeTicks('uwon', 'dungeon')).toBe(base + UWON.invulnAfterDash)
  })
})
