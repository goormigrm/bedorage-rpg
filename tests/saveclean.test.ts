// 소켓 · 룬(v1.7.0)을 뺀 뒤(2026-10-17 사용자) 예전 세이브의 흔적을 지운다
import { describe, expect, it } from 'vitest'
import { SLOT_ARMOR, emptySheet, sanitizeSheet } from '../src/core/items'

describe('예전 세이브 정리', () => {
  it('아이템의 소켓(so) · 룬(rn)과 룬 주머니(runes)가 빠진다 — 아이템은 그대로', () => {
    const old = { ...emptySheet(), runes: [3, 1], bag: [{ uid: 5, slot: SLOT_ARMOR, wt: -1, rarity: 1, ilvl: 10, aff: [5, 20], so: 2, rn: [0] }] }
    const sh = sanitizeSheet(old) as unknown as Record<string, unknown> & { bag: Record<string, unknown>[] }
    expect(sh.runes).toBeUndefined()
    expect(sh.bag.length).toBe(1)
    expect(sh.bag[0].so).toBeUndefined()
    expect(sh.bag[0].rn).toBeUndefined()
    expect(sh.bag[0].aff).toEqual([5, 20])
  })
})
