// 세트 아이템 (2026-09-25 사용자 고른 개선 7 — "두세 부위를 맞추면 추가 효과")
import { describe, expect, it } from 'vitest'
import { Item, SETS, ST_DMG, ST_DR, ST_HP, computeStats, emptySheet, forgeMaterials, itemColor, itemName, rollItem, sanitizeSheet, setCounts, SET_COLOR } from '../src/core/items'
import { makeRng } from '../src/core/rng'

const piece = (set: number, slot: number, uid: number): Item => ({ uid, slot, wt: -1, rarity: 3, ilvl: 20, aff: [], set })

describe('세트 아이템', () => {
  it('전설 자리의 일부가 세트 조각으로 떨어진다 (무기 · 상점 · 신화는 아니다)', () => {
    const rng = makeRng(8)
    let sets = 0
    let legs = 0
    for (let i = 0; i < 3000; i++) {
      const it = rollItem(rng, i, 20, 'rapier', 'boss', 0, 3)
      if (it.set !== undefined) {
        sets++
        expect(it.slot).not.toBe(0)
        expect(it.rarity).toBe(3)
        expect(it.leg).toBeUndefined()
        expect(SETS[it.set].slots).toContain(it.slot)
      } else if (it.rarity === 3) legs++
    }
    expect(sets / (sets + legs)).toBeGreaterThan(0.15)
    expect(sets / (sets + legs)).toBeLessThan(0.35)
    const shop = makeRng(9)
    for (let i = 0; i < 2000; i++) expect(rollItem(shop, i, 20, 'rapier', 'shop', 0, 3).set).toBeUndefined()
  })
  it('2부위 · 3부위 효과가 붙는다', () => {
    const s = SETS[0] // 순례자의 맹세: 투구 · 갑옷 · 목걸이
    // 같은 부위의 세트 아닌 것과 견준다 (투구 · 갑옷은 바탕 방어가 있다)
    const wear = (n: number, set: boolean): (Item | null)[] => {
      const e: (Item | null)[] = [null, null, null, null, null]
      for (let k = 0; k < n; k++) e[s.slots[k]] = set ? piece(0, s.slots[k], k + 1) : { ...piece(0, s.slots[k], k + 1), set: undefined }
      return e
    }
    expect(computeStats(1, wear(1, true))[ST_DR]).toBe(computeStats(1, wear(1, false))[ST_DR])
    expect(setCounts(wear(2, true))[0]).toBe(2)
    expect(computeStats(1, wear(2, true))[ST_DR]).toBe(computeStats(1, wear(2, false))[ST_DR] + 8)
    expect(computeStats(1, wear(2, true))[ST_HP]).toBe(computeStats(1, wear(2, false))[ST_HP])
    expect(computeStats(1, wear(3, true))[ST_HP]).toBe(computeStats(1, wear(3, false))[ST_HP] + 180)
    // 다른 세트는 섞여도 제 것만 센다 (1부위씩이면 효과 없음)
    const mix: (Item | null)[] = [null, piece(1, 1, 4), piece(0, 2, 5), null, null]
    const mixPlain: (Item | null)[] = [null, { ...piece(1, 1, 4), set: undefined }, { ...piece(0, 2, 5), set: undefined }, null, null]
    expect(computeStats(1, mix)[ST_DMG]).toBe(computeStats(1, mixPlain)[ST_DMG])
  })
  it('이름 · 색 · 세이브 · 재료에서 빠짐', () => {
    const it = piece(2, 3, 7)
    expect(itemName(it)).toContain('거미 여왕의 비단')
    expect(itemColor(it)).toBe(SET_COLOR)
    const sh = sanitizeSheet({ ...emptySheet(), bag: [it, { ...piece(0, 1, 8), set: 99 }] })
    expect(sh.bag.length).toBe(1)
    expect(sh.bag[0].set).toBe(2)
    const plain = { ...piece(0, 1, 9), set: undefined }
    expect(forgeMaterials([it, plain], [], 3)).toEqual([1])
  })
})
