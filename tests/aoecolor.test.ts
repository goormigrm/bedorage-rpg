// 범위의 색 (2026-09-23 사용자: "적의 범위 공격은 빨강, 우리 편 힐 · 좋은 효과는 초록 — 초록 독을 좋은 범위로 착각하지 않게").
// 초록 고리는 sim 의 'allyfx' 이벤트로 그린다 — 동료를 고치는 스킬이 그 반경을 알려 주는지 본다.
import { describe, expect, it } from 'vitest'
import { BTN_SKILL1, Input } from '../src/core/input'
import { TILE, buildMap } from '../src/core/map'
import { createState, step } from '../src/core/sim'
import { CharacterId } from '../src/core/characters'
import { COUNTDOWN_TICKS } from '../src/core/state'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })

function cast(chars: CharacterId[]) {
  const map = buildMap('crypt', 1, 7)
  const s = createState({ area: 4, seed: 7, chars, noMonsters: true, mode: 'dungeon', targetKills: 3 }, map)
  for (let i = 0; i < COUNTDOWN_TICKS + 1; i++) step(s, map, chars.map(idle))
  step(s, map, chars.map((_, i) => (i === 0 ? { ...idle(), buttons: BTN_SKILL1 } : idle())))
  return { s }
}

describe('동료를 고치는 범위는 초록 고리(allyfx)로 알린다', () => {
  it('매직덕 응급 처치: 6칸 · 통천덕 치킨 나눔: 7칸', () => {
    for (const [c, r] of [['magic', 6], ['tongdak', 7]] as const) {
      const { s } = cast([c])
      const fx = s.events.filter((e) => e.type === 'allyfx')
      expect(fx.length, c).toBe(1)
      expect(fx[0].type === 'allyfx' && fx[0].r).toBe(r * TILE)
    }
  })

  it('공격 스킬은 초록 고리를 내지 않는다 — 침착덕 관통탄', () => {
    const { s } = cast(['chim'])
    expect(s.events.some((e) => e.type === 'allyfx')).toBe(false)
  })
})
