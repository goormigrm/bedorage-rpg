// 아이템 점수 · 레벨 올리기 · 강화 이어받기 (2026-10-24 사용자: "신화가 전설보다 낮게 재진다 · 아이템 레벨을 올릴 수단이 없다 ·
// 강화된 것을 재료로 쓰면 더 좋은 게 있어야")
import { describe, expect, it } from 'vitest'
import { CMD_RELEVEL, CMD_UPGRADE, Input } from '../src/core/input'
import { createState, step } from '../src/core/sim'
import { buildAreaMap, townNpcs } from '../src/core/world'
import { Item, SLOT_WEAPON, emptySheet, itemScore, relevel, relevelPrice, rollItem, upgradeMaterials, upgradeResult } from '../src/core/items'
import { makeRng } from '../src/core/rng'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })
const avgScore = (rarity: number, ilvl: number, slot: number) => {
  const rng = makeRng(rarity * 100 + ilvl + slot)
  let sum = 0
  for (let i = 0; i < 400; i++) sum += itemScore(rollItem(rng, i, ilvl, 'smg', 'chest', 0, rarity, slot))
  return sum / 400
}

describe('아이템 점수는 실제 값으로', () => {
  it('같은 레벨 평균 전설은 레벨 + 6 (예전 눈금) · 신화는 그보다 크게 높다', () => {
    for (const slot of [0, 1, 3]) {
      expect(avgScore(3, 30, slot)).toBeGreaterThan(34.5)
      expect(avgScore(3, 30, slot)).toBeLessThan(37.5)
      expect(avgScore(4, 30, slot)).toBeGreaterThan(avgScore(3, 30, slot) + 6)
    }
    // 신화 20 무기는 전설 24 보다 낫다 (예전 점수로는 29 대 30 — 전설이 높게 재졌다)
    expect(avgScore(4, 20, SLOT_WEAPON)).toBeGreaterThan(avgScore(3, 24, SLOT_WEAPON))
  })

  it('강화 · 레벨이 오르면 점수도 오른다', () => {
    const it0: Item = rollItem(makeRng(3), 1, 20, 'smg', 'chest', 0, 3, SLOT_WEAPON)
    const up = { ...it0, up: 2 }
    expect(itemScore(up)).toBeGreaterThan(itemScore(it0) + 3)
    const hi = { ...it0, aff: it0.aff.slice() }
    relevel(hi, 30)
    expect(hi.ilvl).toBe(30)
    expect(itemScore(hi)).toBeGreaterThan(itemScore(it0) + 8)
  })
})

describe('아이템 레벨 올리기 (대장장이)', () => {
  it('옵션은 굴린 정도 그대로 새 레벨 크기로 — 피해(6 + 0.8 × 레벨): 20 레벨에서 최대 22 → 30 레벨 최대 30 · 반쯤 굴린 11 → 15', () => {
    const it: Item = { uid: 1, slot: SLOT_WEAPON, wt: 0, rarity: 3, ilvl: 20, aff: [0, 22, 0, 11] }
    relevel(it, 30)
    expect(it.aff[1]).toBe(30)
    expect(it.aff[3]).toBe(15)
    // 낮추지는 않는다
    relevel(it, 10)
    expect(it.ilvl).toBe(30)
  })

  it('대장장이 곁에서 골드를 내면 지금 난이도의 내 레벨까지 · 이미 그 레벨이면 아무 일 없다', () => {
    const seed = 71
    const map = buildAreaMap(seed, 0)
    const s = createState({ seed, chars: ['chim'], sheets: [{ ...emptySheet(), level: 25, gold: 1e6 }] }, map)
    const p = s.players[0]
    const n = townNpcs(0).find((q) => q.id === 'smith')!
    p.x = n.x + 30
    p.y = n.y
    const cmd = (c: number, arg: number) => step(s, map, [{ ...idle(), cmd: c, arg }])
    p.bag.length = 0
    p.bag.push({ uid: 900, slot: 3, wt: -1, rarity: 4, ilvl: 12, aff: [0, 10, 5, 40], bt: 0 })
    const price = relevelPrice(p.bag[0], 25)
    const g0 = p.gold
    cmd(CMD_RELEVEL, 0)
    expect(p.bag[0].ilvl).toBe(25)
    expect(g0 - p.gold).toBe(price)
    const g1 = p.gold
    cmd(CMD_RELEVEL, 0)
    expect(p.gold).toBe(g1)
  })
})

describe('강화 이어받기', () => {
  const ring = (uid: number, up = 0): Item => ({ uid, slot: 3, wt: -1, rarity: 3, ilvl: 20, aff: [0, 10], bt: 0, up })

  it('더 높이 강화된 재료의 단계를 이어받는다 — 한 단계만 오를 때는 강화된 재료를 아낀다', () => {
    const target = ring(1)
    expect(upgradeResult(target, [ring(2, 3)])).toBe(3)
    expect(upgradeResult(target, [ring(2)])).toBe(1)
    // +1 짜리 재료는 이어받아도 +1 이라 싼 것(+0)부터 쓴다 · +3 은 앞으로
    const bag = [target, ring(2, 1), ring(3)]
    expect(upgradeMaterials(bag, [], target)[0]).toBe(2)
    const bag2 = [target, ring(2), ring(3, 3)]
    expect(upgradeMaterials(bag2, [], target)[0]).toBe(2)
  })

  it('대장장이 강화: +3 반지를 녹여 새 반지가 +0 → +3', () => {
    const seed = 72
    const map = buildAreaMap(seed, 0)
    const s = createState({ seed, chars: ['chim'], sheets: [{ ...emptySheet(), level: 25, gold: 1e6 }] }, map)
    const p = s.players[0]
    const n = townNpcs(0).find((q) => q.id === 'smith')!
    p.x = n.x + 30
    p.y = n.y
    p.bag.length = 0
    p.bag.push(ring(10), ring(11, 3))
    step(s, map, [{ ...idle(), cmd: CMD_UPGRADE, arg: 0 }])
    expect(p.bag.length).toBe(1)
    expect(p.bag[0].uid).toBe(10)
    expect(p.bag[0].up).toBe(3)
  })
})
