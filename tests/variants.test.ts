// 스킬 랭크 5 변형 (2026-10-08 퀄리티 2차 6단계 D1): 범위 공격 = 여진 · 불바다 / 강화 = 연장 · 나눔 / 회복 = 더 많이 · 보호
import { describe, expect, it } from 'vitest'
import { BTN_SKILL1, BTN_SKILL2, Input } from '../src/core/input'
import { TILE, TILE_FLOOR, buildMap, GameMap } from '../src/core/map'
import { createState, step } from '../src/core/sim'
import { CharacterId } from '../src/core/characters'
import { FX_GUARD, FX_PARTYDR, VARIANT_NAMES, modNames, variantKind } from '../src/core/skills'
import { COUNTDOWN_TICKS, GameState, MS_CHASE, ZONE_BURN } from '../src/core/state'
import { makeMonster } from '../src/core/dungeon'
import { LEG_ECHO } from '../src/core/items'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })

function ready(chars: CharacterId[], seed = 17): { s: GameState; map: GameMap } {
  const map = buildMap('crypt', 1, seed)
  const s = createState({ area: 4, seed, chars, noMonsters: true }, map)
  for (let i = 0; i < COUNTDOWN_TICKS + 1; i++) step(s, map, chars.map(idle))
  let o = { x: 0, y: 0 }
  search: for (let ty = 5; ty < map.h - 5; ty++) {
    for (let tx = 5; tx < map.w - 5; tx++) {
      let ok = true
      for (let dy = -4; dy <= 4 && ok; dy++) for (let dx = -4; dx <= 4; dx++) if (map.tiles[(ty + dy) * map.w + tx + dx] !== TILE_FLOOR) ok = false
      if (ok) {
        o = { x: tx * TILE + 16, y: ty * TILE + 16 }
        break search
      }
    }
  }
  s.players.forEach((p, i) => {
    p.x = o.x + i * 40
    p.y = o.y
    p.focus = 100
  })
  return { s, map }
}

/** 괴물 하나 (체력 넉넉 · 움직이지 않게) */
function dummy(s: GameState, x: number, y: number) {
  const m = makeMonster(s, 0, x, y, 950, 20)
  m.st = MS_CHASE
  m.cd = 9999
  s.monsters.push(m)
  return m
}

describe('스킬 랭크 5 변형', () => {
  it('갈래와 이름: 소독 화염은 범위 · 철벽은 강화 · 응급 처치는 회복 · 관통 저격은 사격', () => {
    expect(variantKind('flame')).toBe('blast')
    expect(variantKind('ironwall')).toBe('buff')
    expect(variantKind('firstaid')).toBe('heal')
    expect(variantKind('railshot')).toBe('shot')
    expect(modNames('flame', 1)).toEqual(VARIANT_NAMES.blast)
    expect(modNames('flame', 0)[0]).toMatch(/위력/)
  })

  it('범위 공격 · 여진: 0.6초 뒤 같은 자리에 한 번 더 (echo)', () => {
    const { s, map } = ready(['magic'])
    const p = s.players[0]
    p.build.r[1] = 5
    p.build.m5[1] = 1
    dummy(s, p.x + 40, p.y)
    step(s, map, [{ ...idle(), buttons: BTN_SKILL2 }])
    let echo = false
    for (let t = 0; t < 60 && !echo; t++) {
      step(s, map, [idle()])
      if (s.events.some((e) => e.type === 'aoe' && e.id === 'echo')) echo = true
    }
    expect(echo).toBe(true)
  })

  it('범위 공격 · 불바다: 3초 불타는 바닥 — 안의 괴물이 계속 다친다', () => {
    const { s, map } = ready(['magic'])
    const p = s.players[0]
    p.build.r[1] = 5
    p.build.m5[1] = 2
    const m = dummy(s, p.x + 40, p.y)
    step(s, map, [{ ...idle(), buttons: BTN_SKILL2 }])
    expect(s.zones.some((z) => z.kind === ZONE_BURN)).toBe(true)
    const hp1 = m.hp
    for (let t = 0; t < 100; t++) step(s, map, [idle()])
    expect(m.hp).toBeLessThan(hp1)
  })

  it('강화 · 연장: 이 스킬이 건 효과가 1.5배 오래 간다', () => {
    const base = ready(['cheolmyeon'])
    step(base.s, base.map, [{ ...idle(), buttons: BTN_SKILL1 }])
    const plain = base.s.players[0].fx[FX_GUARD]
    const { s, map } = ready(['cheolmyeon'])
    const p = s.players[0]
    p.build.r[0] = 5
    p.build.m5[0] = 1
    step(s, map, [{ ...idle(), buttons: BTN_SKILL1 }])
    expect(plain).toBeGreaterThan(0)
    // 랭크만큼 위력 · 시간이 늘지는 않는다 — 연장이 1.5배
    expect(p.fx[FX_GUARD]).toBeGreaterThanOrEqual(Math.round(plain * 1.45))
  })

  it('강화 · 나눔: 6칸 안 동료도 그 효과를 절반 시간', () => {
    const { s, map } = ready(['cheolmyeon', 'magic'])
    const p = s.players[0]
    const q = s.players[1]
    p.build.r[0] = 5
    p.build.m5[0] = 2
    step(s, map, [{ ...idle(), buttons: BTN_SKILL1 }, idle()])
    expect(q.fx[FX_GUARD]).toBeGreaterThan(0)
    expect(q.fx[FX_GUARD]).toBeLessThan(p.fx[FX_GUARD])
  })

  it('회복 · 더 많이(+40%) · 보호(받는 피해 -30% 4초)', () => {
    const heal = (v: number) => {
      const { s, map } = ready(['magic', 'chim'])
      const p = s.players[0]
      const q = s.players[1]
      p.build.r[0] = 5
      p.build.m5[0] = v
      q.hp = 1 // 최대 체력에 막히지 않게 (회복 25% × 치유 배율이 크다)
      const before = q.hp
      step(s, map, [{ ...idle(), buttons: BTN_SKILL1 }, idle()])
      return { gain: q.hp - before, guard: q.fx[FX_PARTYDR] }
    }
    const more = heal(1)
    const shield = heal(2)
    expect(more.gain).toBeGreaterThan(shield.gain * 1.3)
    expect(shield.guard).toBeGreaterThan(0)
  })

  it('스킬을 바꾸는 전설 — 메아리: 변형을 고르지 않아도 범위 스킬이 한 번 더 터진다', () => {
    const { s, map } = ready(['magic'])
    const p = s.players[0]
    p.legs |= 1 << LEG_ECHO
    dummy(s, p.x + 40, p.y)
    step(s, map, [{ ...idle(), buttons: BTN_SKILL2 }])
    let echo = false
    for (let t = 0; t < 60 && !echo; t++) {
      step(s, map, [idle()])
      if (s.events.some((e) => e.type === 'aoe' && e.id === 'echo')) echo = true
    }
    expect(echo).toBe(true)
  })
})
