// 봇 자리의 기록 (2026-09-20): 봇은 **방장에 맞춰** 들어온다 — 레벨 · 그 레벨의 장비 · 스킬 · 능력치.
// 전에는 레벨만 맞고 맨몸이라 "껐다 다시 켜면 봇이 너무 약했다".
import { describe, expect, it } from 'vitest'
import { botSheet, botSpendCmd, gearLevelOf } from '../src/core/botsheet'
import { createState, step } from '../src/core/sim'
import { ACTS, buildAreaMap } from '../src/core/world'
import type { Input } from '../src/core/input'
import { Item, MASTERY_CAP, SLOT_COUNT, SLOT_WEAPON, attrFree, masteryFree } from '../src/core/items'
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

// 2026-10-09 사용자: "봇들도 나의 레벨과 맞춰지는데 그 레벨에 맞게 능력치 분배 및 스킬 레벨도 올라가게 되어 있어?"
// — 판을 시작할 때는 다 찍었지만, 게임 중에 레벨이 오르면 능력치만 쓰고 스킬 포인트 · 숙련은 남겨 두었다
describe('봇은 게임 중에 레벨이 올라도 포인트를 다 쓴다', () => {
  const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0 })
  /** 봇 자리 하나로 판을 열고 경험치를 몰아 준 뒤, session botFor 처럼 봇이 고른 명령을 한 틱에 하나씩 보낸다 */
  function levelUp(to: number, mlvXp = 0) {
    const town = ACTS[0].town
    const map = buildAreaMap(5, town)
    const sheet = botSheet('magic', 3, 3, 99)
    const s = createState({ area: town, seed: 5, chars: ['magic'], sheets: [sheet] }, () => map)
    const p = s.players[0]
    // 경험치는 괴물을 잡을 때 들어온다 — 여기서는 레벨을 바로 올린다 (포인트만 생긴다 — gainXp 와 같다)
    p.level = to
    if (mlvXp) p.mlv = mlvXp
    for (let t = 0; t < 200; t++) {
      const c = botSpendCmd(p)
      step(s, map, [c ? { ...idle(), cmd: c.cmd, arg: c.arg } : idle()])
    }
    return p
  }
  it('3 → 15 레벨: 능력치 · 스킬 포인트가 남지 않는다 · 스킬 랭크가 오른다', () => {
    const p = levelUp(15)
    expect(attrFree(p.level, p.attr)).toBe(0)
    expect(freePoints(p.level, p.build, p.spBonus)).toBe(0)
    expect(p.build.r.reduce((a, b) => a + b, 0)).toBeGreaterThan(botSheet('magic', 3, 3, 99).build!.r.reduce((a, b) => a + b, 0) + 10)
  })
  it('만렙 뒤 숙련도 고르게 쓴다', () => {
    const p = levelUp(30, 6)
    expect(masteryFree(p.mlv, p.mst)).toBe(0)
    expect(Math.max(...p.mst) - Math.min(...p.mst)).toBeLessThanOrEqual(1)
  })
  it('판을 시작할 때 방장의 숙련 레벨을 고르게 나눠 든다 (30 레벨 전에는 없다)', () => {
    const s = botSheet('chim', 30, 30, 1, [], 0, 9)
    expect(s.mlv).toBe(9)
    expect(s.mst!.reduce((a, b) => a + b, 0)).toBe(9)
    expect(Math.max(...s.mst!) - Math.min(...s.mst!)).toBeLessThanOrEqual(1)
    expect(Math.max(...s.mst!)).toBeLessThanOrEqual(MASTERY_CAP)
    expect(botSheet('chim', 20, 20, 1, [], 0, 9).mlv).toBe(0)
  })
})
