// 2026-10-25 검토: 전설 효과가 줍는 사람과 상관없이 무작위라 근접 셋에게 관통 탄띠 · 회복 스킬 없는 캐릭터에게 은총이 나왔다
import { describe, expect, it } from 'vitest'
import { CHARACTERS, CharacterId } from '../src/core/characters'
import { LEG_AMMO, LEG_GRACE, LEGENDS, rollItem } from '../src/core/items'
import { makeRng } from '../src/core/rng'
import { legFor } from '../src/core/sim'
import { WEAPONS } from '../src/core/weapons'

describe('전설 효과는 주운 사람이 쓸 수 있는 것만', () => {
  it('근접 캐릭터에게 관통 탄띠 · 회복 스킬 없는 캐릭터에게 은총이 나오지 않는다 · 다른 효과는 고루 나온다', () => {
    for (const id of Object.keys(CHARACTERS) as CharacterId[]) {
      const p = { char: id, weapon: CHARACTERS[id].weapon }
      const ok = legFor(p)
      const rng = makeRng(7)
      const seen = new Set<number>()
      for (let i = 0; i < 400; i++) seen.add(rollItem(rng, i, 20, p.weapon, 'boss', 0, 3, -1, ok).leg!)
      if (WEAPONS[p.weapon].melee) expect(seen.has(LEG_AMMO)).toBe(false)
      if (!ok(LEG_GRACE)) expect(seen.has(LEG_GRACE)).toBe(false)
      for (let l = 0; l < LEGENDS.length; l++) if (ok(l)) expect(seen.has(l)).toBe(true)
    }
    // 힐러(매직란 — 응급처치 · 수술)는 은총을 쓸 수 있다 · 근접(철면란)은 관통 탄띠를 못 쓴다
    expect(legFor({ char: 'magic', weapon: CHARACTERS.magic.weapon })(LEG_GRACE)).toBe(true)
    expect(legFor({ char: 'cheolmyeon', weapon: CHARACTERS.cheolmyeon.weapon })(LEG_AMMO)).toBe(false)
  })
})

// 2026-10-25 검토: 세트 조각이 신화에만 있어 보통 한 바퀴에 0개 — 보스 전설(무기 빼고)의 일부를 세트 조각(신화)으로
describe('보스 전설의 세트 조각', () => {
  it('무기가 아닌 칸의 보스 전설 보상 중 일부는 세트 조각이고, 세트는 늘 신화 · 무기 칸은 세트가 아니다', () => {
    const rng = makeRng(11)
    let sets = 0
    for (let i = 0; i < 400; i++) {
      const it = rollItem(rng, i, 20, 'rifle', 'boss', 0, 3, 1)
      if (it.set !== undefined) {
        sets++
        expect(it.rarity).toBe(4)
      }
    }
    expect(sets).toBeGreaterThan(40)
    for (let i = 0; i < 100; i++) expect(rollItem(rng, 1000 + i, 20, 'rifle', 'boss', 0, 3, 0).set).toBeUndefined()
  })
})
