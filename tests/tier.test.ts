// 난이도 (D7 — GUIDE 5장): 보통 · 악몽 · 지옥. 같은 세계, 지역 레벨 +10/+20 · 체력 · 정예 능력 · 전리품 · 난이도별 퀘스트 · 열림 조건.
import { describe, expect, it } from 'vitest'
import { emptySheet, sanitizeSheet } from '../src/core/items'
import { EA_UNIQUE, ELITE_AFFIXES, TIERS, levelPow, tierOf, xpGapMul } from '../src/core/monsters'
import { createState } from '../src/core/sim'
import { ACTS, QUESTS, actBossQuest, areaLevel, buildAreaMap, tierOpen, tierQuests } from '../src/core/world'

const affixes = (e: number) => ELITE_AFFIXES.filter((a) => e & a.bit).length

describe('난이도', () => {
  it('악몽·지옥은 같은 지역을 레벨 +10/+20 · 체력을 더 올려 채운다', () => {
    const seed = 91
    const map = buildAreaMap(seed, 4)
    const hp = [0, 1, 2].map((tier) => {
      const s = createState({ seed, chars: ['chim'], area: 4, tier }, map)
      expect(s.tier).toBe(tier)
      expect(s.monsters.every((m) => m.lvl === areaLevel(4, tier))).toBe(true)
      return s.monsters.reduce((a, m) => a + m.maxHp, 0)
    })
    expect(areaLevel(4, 1)).toBe(areaLevel(4, 0) + TIERS[1].lvl)
    expect(hp[1]).toBeGreaterThan(hp[0] * 1.5)
    expect(hp[2]).toBeGreaterThan(hp[1] * 1.3)
  })

  it('보통은 몬스터 피해가 레벨 보정의 0.75배 — 악몽·지옥은 그대로 (2026-09-19 "보통인데 꽤 어렵다")', () => {
    const seed = 93
    const map = buildAreaMap(seed, 4)
    const avgPow = (tier: number) => {
      const ms = createState({ seed, chars: ['chim'], area: 4, tier }, map).monsters.filter((m) => !m.elite)
      return ms.reduce((a, m) => a + m.pow, 0) / ms.length
    }
    const lv = areaLevel(4, 0)
    expect(avgPow(0)).toBeCloseTo(Math.round(levelPow(lv) * 0.75), 0)
    expect(avgPow(1)).toBeCloseTo(levelPow(areaLevel(4, 1)), 0)
    expect(TIERS[0].pow).toBeLessThan(TIERS[1].pow)
  })

  it('지옥의 우두머리는 접두 능력이 더 붙는다', () => {
    const seed = 92
    const map = buildAreaMap(seed, 3)
    const uniq = (tier: number) => createState({ seed, chars: ['chim'], area: 3, tier }, map).monsters.find((m) => m.elite & EA_UNIQUE)!
    expect(affixes(uniq(2).elite)).toBeGreaterThan(affixes(uniq(0).elite))
    expect(tierOf(9)).toBe(TIERS[2])
  })

  it('열림: 보통의 심연의 군주를 이루면 악몽, 악몽의 군주를 이루면 지옥 · 퀘스트는 난이도마다 따로', () => {
    const last = actBossQuest(ACTS.length - 1)
    const sh = emptySheet()
    expect(tierOpen(sh, 0)).toBe(true)
    expect(tierOpen(sh, 1)).toBe(false)
    sh.quests = QUESTS.map(() => 3)
    expect(tierOpen(sh, 1)).toBe(true)
    expect(tierOpen(sh, 2)).toBe(false)
    sh.tq = [[], QUESTS.map((_, i) => (i === last ? 2 : 0))]
    expect(tierOpen(sh, 2)).toBe(true)
    // 악몽 판은 악몽 퀘스트로 시작한다 (보통을 다 끝냈어도 악몽 1막부터)
    expect(tierQuests(sh, 1)[0]).toBe(0)
    expect(tierQuests(sh, 0)[0]).toBe(3)
    // 세이브 검사를 지나도 남는다
    const back = sanitizeSheet(JSON.parse(JSON.stringify(sh)))
    expect(back.tq?.[1]?.[last]).toBe(2)
  })
})

// 2026-09-24 사용자: "30 레벨인데 1 레벨 던전으로 갔는데 피가 많이 닳는다 · 레벨 차이가 나면 경험치도 거의 안 받게"
describe('지역 레벨 고정 · 레벨 차이 경험치', () => {
  it('높은 레벨이 낮은 지역에 가도 괴물은 지역 레벨 그대로 (파티 레벨을 따라 오르지 않는다)', () => {
    const seed = 94
    const map = buildAreaMap(seed, 1)
    const hi = { ...emptySheet(), level: 30 }
    const s = createState({ seed, chars: ['chim', 'cheolmyeon'], area: 1, sheets: [hi, hi] }, map)
    expect(s.players[0].level).toBe(30)
    expect(s.monsters.length).toBeGreaterThan(0)
    expect(s.monsters.every((m) => m.lvl === areaLevel(1, 0))).toBe(true)
    expect(areaLevel(1, 0)).toBe(1)
  })

  it('괴물보다 5 레벨 위까지는 그대로 · 그 위로 한 레벨마다 15% 씩 줄어 12 위부터 5%', () => {
    expect(xpGapMul(10, 10)).toBe(1)
    expect(xpGapMul(5, 20)).toBe(1)
    expect(xpGapMul(15, 10)).toBe(1)
    expect(xpGapMul(16, 10)).toBeCloseTo(0.85)
    expect(xpGapMul(20, 10)).toBeCloseTo(0.25)
    expect(xpGapMul(22, 10)).toBeCloseTo(0.05)
    expect(xpGapMul(30, 1)).toBeCloseTo(0.05)
  })
})
