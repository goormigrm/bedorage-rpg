// 퀘스트 전설 보상 부위 고르기 · 상인 진열 시간 재입고 (2026-10-17 RPG 기능 후보 — 사용자: "권고대로 결정하고 계속 진행")
import { describe, expect, it } from 'vitest'
import { CMD_QUEST, EMPTY_INPUT } from '../src/core/input'
import { QUEST_PICK, SHOP_RESTOCK_TICKS, SLOT_COUNT, SLOT_RING, emptySheet, sanitizeSheet } from '../src/core/items'
import { createState, step, warpPlayer } from '../src/core/sim'
import { ACTS, QUESTS, buildAreaMap, townNpcs } from '../src/core/world'

function atElder(quests: number[]) {
  const sheet = sanitizeSheet({ ...emptySheet(), level: 10, quests })
  const town = ACTS[0].town
  const map = buildAreaMap(5, town)
  const s = createState({ area: town, seed: 5, chars: ['chim'], sheets: [sheet] }, () => map)
  const p = s.players[0]
  const elder = townNpcs(town).find((n) => n.id === 'elder')!
  p.x = elder.x
  p.y = elder.y + 20
  return { s, map, p }
}

describe('퀘스트 전설 보상 — 부위를 골라 받는다', () => {
  const lq = QUESTS.findIndex((d) => d.legend && d.act === 0)
  it('고른 부위의 전설이 가방에 든다', () => {
    const q = new Array(32).fill(0)
    q[lq] = 2
    const { s, map, p } = atElder(q)
    const bag0 = p.bag.length
    step(s, map, [{ ...EMPTY_INPUT, cmd: CMD_QUEST, arg: QUEST_PICK + lq * SLOT_COUNT + SLOT_RING }])
    step(s, map, [{ ...EMPTY_INPUT }])
    expect(p.quests[lq]).toBe(3)
    expect(p.bag.length).toBe(bag0 + 1)
    const it = p.bag[p.bag.length - 1]!
    expect(it.slot).toBe(SLOT_RING)
    expect(it.rarity).toBeGreaterThanOrEqual(3)
  })
  it('전설 보상이 아닌 퀘스트는 부위 고르기로 받을 수 없다 · 이루지 않은 퀘스트도', () => {
    const gq = QUESTS.findIndex((d) => !d.legend && d.act === 0)
    const q = new Array(32).fill(0)
    q[gq] = 2
    q[lq] = 1
    const { s, map, p } = atElder(q)
    step(s, map, [{ ...EMPTY_INPUT, cmd: CMD_QUEST, arg: QUEST_PICK + gq * SLOT_COUNT }])
    step(s, map, [{ ...EMPTY_INPUT, cmd: CMD_QUEST, arg: QUEST_PICK + lq * SLOT_COUNT }])
    step(s, map, [{ ...EMPTY_INPUT }])
    expect(p.quests[gq]).toBe(2)
    expect(p.quests[lq]).toBe(1)
    expect(QUEST_PICK + (QUESTS.length - 1) * SLOT_COUNT + SLOT_COUNT - 1).toBeLessThan(256)
  })
})

describe('상인 진열 — 시간이 지나면 마을에 들어설 때 새로', () => {
  it('10분 전에는 그대로 · 지나면 새 진열 + 알림', () => {
    const { s, map, p } = atElder(new Array(32).fill(0))
    const mapOf = () => map
    const uids = () => s.shop.map((it) => it?.uid).join(',')
    const first = uids()
    warpPlayer(s, mapOf, 0, 1)
    warpPlayer(s, mapOf, 0, ACTS[0].town)
    expect(uids()).toBe(first)
    s.tick += SHOP_RESTOCK_TICKS
    warpPlayer(s, mapOf, 0, 1)
    warpPlayer(s, mapOf, 0, ACTS[0].town)
    expect(uids()).not.toBe(first)
    expect(s.events.some((e) => e.type === 'shopRestock' && e.p === p.id)).toBe(true)
  })
})
