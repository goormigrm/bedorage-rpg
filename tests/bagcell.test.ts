// 가방 칸 이름 (2026-10-08 사용자: "아이템 창에서 일반 아이템의 이름이 안 보인다" → 같은 날 "부위 이름으로") — 등급과 상관없이 칸에 부위 이름
import { describe, expect, it } from 'vitest'
import { Item, SLOT_WEAPON, WEAPON_IDS, rollItem } from '../src/core/items'
import { makeRng } from '../src/core/rng'
import { cellHtml } from '../src/ui/inventory'

const tagOf = (it: Item): string => /<b>([^<]*)<\/b>/.exec(cellHtml(it, ''))?.[1] ?? ''

describe('가방 칸 이름', () => {
  it('칸 이름은 부위 이름 — 무기 · 투구 · 갑옷 · 반지 · 목걸이 (2026-10-08 사용자: "판금 · 은 · 순례자 이렇게 표시되는 건 알맞지 않다")', () => {
    const rifle: Item = { uid: 1, slot: SLOT_WEAPON, wt: WEAPON_IDS.indexOf('rifle'), rarity: 0, ilvl: 3, aff: [] }
    expect(tagOf(rifle)).toBe('무기')
    expect(tagOf({ ...rifle, wt: WEAPON_IDS.indexOf('violin') })).toBe('무기')
    const names = ['무기', '투구', '갑옷', '반지', '목걸이']
    for (let slot = 1; slot < 5; slot++) expect(tagOf({ uid: 2, slot, wt: -1, rarity: 4, ilvl: 20, aff: [], bt: 0 })).toBe(names[slot])
    // 세트도 부위 이름 (세트는 칸의 "세트" 표시로 가른다)
    expect(tagOf({ uid: 3, slot: 1, wt: -1, rarity: 4, ilvl: 20, aff: [], set: 0 })).toBe('투구')
    expect(cellHtml({ uid: 3, slot: 1, wt: -1, rarity: 4, ilvl: 20, aff: [], set: 0 }, '')).toContain('setp')
  })

  it('어떤 등급 · 부위든 칸 이름이 비지 않는다', () => {
    const rng = makeRng(42)
    for (let i = 0; i < 400; i++) {
      const it = rollItem(rng, i, 1 + (i % 30), 'rifle', 'chest')
      expect(tagOf(it), JSON.stringify(it)).not.toBe('')
    }
  })
})
