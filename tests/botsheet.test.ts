// 봇 자리의 기록 (2026-09-20): 봇은 **방장에 맞춰** 들어온다 — 레벨 · 그 레벨의 장비 · 스킬 · 능력치.
// 전에는 레벨만 맞고 맨몸이라 "껐다 다시 켜면 봇이 너무 약했다".
import { describe, expect, it } from 'vitest'
import { botSheet, gearLevelOf } from '../src/core/botsheet'
import { Item, SLOT_COUNT, SLOT_WEAPON, attrFree } from '../src/core/items'
import { freePoints } from '../src/core/skills'

describe('봇 기록 (방장에 맞춘 한 벌)', () => {
  it('모든 칸에 그 레벨짜리 장비를 낀다 (마법 등급 이상)', () => {
    const s = botSheet('chim', 20, 20, 1234)
    expect(s.level).toBe(20)
    expect(s.equip.filter((e) => e).length).toBe(SLOT_COUNT)
    for (const it of s.equip) {
      expect(it!.rarity).toBeGreaterThanOrEqual(1)
      expect(it!.ilvl).toBe(20)
    }
    // 제 무기를 든다
    expect(s.equip[SLOT_WEAPON]!.wt).toBeGreaterThanOrEqual(0)
  })

  it('스킬 포인트와 능력치를 남김없이 찍는다', () => {
    const s = botSheet('cheolmyeon', 30, 30, 555, [], 4)
    expect(freePoints(30, s.build!, 4)).toBe(0)
    expect(attrFree(30, s.attr!)).toBe(0)
  })

  it('1레벨도 맨몸이 아니다 — 그리고 같은 값을 넣으면 늘 같은 한 벌 (락스텝)', () => {
    const a = botSheet('magic', 1, 1, 77)
    expect(a.equip.filter((e) => e).length).toBe(SLOT_COUNT)
    const b = botSheet('magic', 1, 1, 77)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    // 자리가 다르면 다른 한 벌
    expect(JSON.stringify(botSheet('magic', 1, 1, 77 + 977))).not.toBe(JSON.stringify(a))
  })
})

describe('템 수준', () => {
  it('방장이 낀 것들의 평균 아이템 레벨을 따른다 (세 칸도 안 꼈으면 레벨)', () => {
    const empty = { level: 12, equip: [null, null, null, null, null] }
    expect(gearLevelOf(empty)).toBe(12)
    const worn = {
      level: 12,
      equip: [8, 10, 12, 10, null].map((iv, slot) => (iv === null ? null : ({ uid: slot, slot, rarity: 1, ilvl: iv, aff: [] } as unknown as Item))),
    }
    expect(gearLevelOf(worn)).toBe(10)
    expect(gearLevelOf(undefined)).toBe(1)
  })
})
