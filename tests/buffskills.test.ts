// 돌진 · 도약 스킬은 버프 (2026-09-27 사용자: "돌진 관련 스킬들은 맵의 구조물 · 이동에 불편하고 범위도 작아 쓰기 어렵다 — 모두 버프형으로")
import { describe, expect, it } from 'vitest'
import { BTN_SKILL1, Input } from '../src/core/input'
import { TILE, TILE_FLOOR, buildMap, GameMap } from '../src/core/map'
import { createState, step } from '../src/core/sim'
import { CharacterId } from '../src/core/characters'
import { FX_PARTYDR, FX_SWIFT, SKILLS } from '../src/core/skills'
import { COUNTDOWN_TICKS, GameState } from '../src/core/state'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })

function ready(c: CharacterId, seed = 17): { s: GameState; map: GameMap; o: { x: number; y: number } } {
  const map = buildMap('crypt', 1, seed)
  const s = createState({ area: 4, seed, chars: [c], noMonsters: true }, map)
  for (let i = 0; i < COUNTDOWN_TICKS + 1; i++) step(s, map, [idle()])
  let o = { x: 0, y: 0 }
  search: for (let ty = 4; ty < map.h - 4; ty++) {
    for (let tx = 4; tx < map.w - 16; tx++) {
      let ok = true
      for (let k = -2; k <= 12 && ok; k++) for (let dy = -3; dy <= 3; dy++) if (map.tiles[(ty + dy) * map.w + tx + k] !== TILE_FLOOR) ok = false
      if (ok) {
        o = { x: tx * TILE + 16, y: ty * TILE + 16 }
        break search
      }
    }
  }
  s.players[0].x = o.x
  s.players[0].y = o.y
  s.players[0].focus = 100
  return { s, map, o }
}

describe('돌진 · 도약 스킬은 자리를 옮기지 않는 버프', () => {
  it.each([
    ['seungwoo', 'pancharge'],
    ['oknyang', 'catstep'],
    ['juwoojae', 'catwalk'],
  ] as [CharacterId, string][])('%s 의 Q(%s): 제자리 · 이동 +40% · 받는 피해 -30% · 설명에 돌진 · 도약이 없다', (c, id) => {
    const { s, map, o } = ready(c)
    const p = s.players[0]
    step(s, map, [{ ...idle(), buttons: BTN_SKILL1 }])
    expect(p.cd[0]).toBeGreaterThan(0)
    expect(p.dashTimer).toBe(0)
    for (let t = 0; t < 30; t++) step(s, map, [idle()])
    expect(Math.hypot(p.x - o.x, p.y - o.y)).toBeLessThan(2)
    expect(p.fx[FX_SWIFT]).toBeGreaterThan(0)
    expect(p.fx[FX_PARTYDR]).toBeGreaterThan(0)
    expect(SKILLS[id as keyof typeof SKILLS].desc).not.toMatch(/돌진|도약/)
  })

  it('버프 동안 같은 시간에 더 멀리 걷는다 (이동 +40%)', () => {
    const walk = (buff: boolean) => {
      const { s, map, o } = ready('seungwoo')
      const p = s.players[0]
      if (buff) step(s, map, [{ ...idle(), buttons: BTN_SKILL1 }])
      else step(s, map, [idle()])
      for (let t = 0; t < 40; t++) step(s, map, [{ ...idle(), mx: 1 }])
      return p.x - o.x
    }
    expect(walk(true)).toBeGreaterThan(walk(false) * 1.3)
  })

  it('고양이 걸음: 다음 두 발 피해 2배 · 승빠란 달군 후라이팬: 공격 속도 +40%', () => {
    const a = ready('oknyang')
    a.s.players[0].empowerShots = 0
    step(a.s, a.map, [{ ...idle(), buttons: BTN_SKILL1 }])
    expect(a.s.players[0].empowerShots).toBe(2)
    const b = ready('seungwoo')
    step(b.s, b.map, [{ ...idle(), buttons: BTN_SKILL1 }])
    expect(b.s.players[0].rateMul).toBeCloseTo(1.4)
  })
})
