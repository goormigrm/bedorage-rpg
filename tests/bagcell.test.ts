// 가방 칸 이름 (2026-10-08 사용자: "아이템 창에서 일반 아이템의 이름이 안 보인다") — 등급과 상관없이 칸에 바탕 이름이 보인다
import { describe, expect, it } from 'vitest'
import { Item, SLOT_WEAPON, WEAPON_IDS, rollItem } from '../src/core/items'
import { makeRng } from '../src/core/rng'
import { cellHtml } from '../src/ui/inventory'

const tagOf = (it: Item): string => /<b>([^<]*)<\/b>/.exec(cellHtml(it, ''))?.[1] ?? ''

describe('가방 칸 이름', () => {
  it('일반 무기도 무기 이름이 보인다 (예전엔 빈칸)', () => {
    const rifle: Item = { uid: 1, slot: SLOT_WEAPON, wt: WEAPON_IDS.indexOf('rifle'), rarity: 0, ilvl: 3, aff: [] }
    expect(tagOf(rifle)).toBe('소총')
    // 여러 낱말 무기는 끝말 — "고기 바이올린" · "고기 첼로" 가 칸에서 구분되게
    expect(tagOf({ ...rifle, wt: WEAPON_IDS.indexOf('violin') })).toBe('바이올린')
    expect(tagOf({ ...rifle, wt: WEAPON_IDS.indexOf('cello') })).toBe('첼로')
  })

  it('어떤 등급 · 부위든 칸 이름이 비지 않는다', () => {
    const rng = makeRng(42)
    for (let i = 0; i < 400; i++) {
      const it = rollItem(rng, i, 1 + (i % 30), 'rifle', 'chest')
      expect(tagOf(it), JSON.stringify(it)).not.toBe('')
    }
  })
})
