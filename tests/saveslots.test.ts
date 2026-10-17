// 세이브 칸 셋 (2026-10-17 사용자: "캐릭터를 30레벨 다 찍고 나면 다시 1레벨부터 친구랑 하고 싶을 수도 — 3개의 슬롯을")
import { describe, expect, it } from 'vitest'
import { emptySheet } from '../src/core/items'

describe('세이브 칸 셋', () => {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  }

  it('예전 세이브는 칸 1 · 칸마다 캐릭터 · 보관함이 따로 · 고른 칸을 기억한다', async () => {
    const save = await import('../src/game/save')
    mem.clear()
    mem.set('brpg.save.v1', JSON.stringify({ v: 1, chars: { cheolmyeon: { ...emptySheet(), level: 30 } }, stash: [{ uid: 7, slot: 3, wt: -1, rarity: 2, ilvl: 20, aff: [] }], updated: 1 }))
    expect(save.activeSlot()).toBe(1)
    expect(save.levelOf('cheolmyeon')).toBe(30)
    expect(save.sheetOf('cheolmyeon').stash?.length).toBe(1)
    save.setActiveSlot(2)
    expect(save.activeSlot()).toBe(2)
    // 칸 2: 모두 1레벨 · 보관함 비었음
    expect(save.levelOf('cheolmyeon')).toBe(1)
    expect(save.sheetOf('cheolmyeon').stash?.length ?? 0).toBe(0)
    expect(save.slotSummary(1)).toEqual({ top: '철면란', level: 30, count: 1 })
    expect(save.slotSummary(2)).toBeNull()
    // 이상한 칸 번호는 받지 않는다
    save.setActiveSlot(9)
    expect(save.activeSlot()).toBe(2)
  })

  it('판의 기록은 판을 연 칸에 적힌다 · 칸 비우기는 그 칸만', async () => {
    const save = await import('../src/game/save')
    const p = { char: 'cheolmyeon', level: 4, xp: 10, gold: 50, equip: [null, null, null, null, null], bag: [], bagMax: 30, gpity: 0, stats: undefined, stashMax: 30, stash: [], wps: 0, potMax: 4, build: undefined, attr: [0, 0, 0, 0], mlv: 0, mxp: 0, mst: [0, 0, 0, 0], riftBest: 0, quests: [] }
    save.commitSheet(p as never, 0, [], 2)
    expect(save.loadSave(2).chars.cheolmyeon?.level).toBe(4)
    expect(save.loadSave(1).chars.cheolmyeon?.level).toBe(30)
    save.clearSlot(2)
    expect(save.slotSummary(2)).toBeNull()
    expect(save.slotSummary(1)?.level).toBe(30)
    // 비우기 전 것은 백업 열쇠에 한 벌
    expect(JSON.parse(mem.get('brpg.save.v1.s2.bak')!).chars.cheolmyeon.level).toBe(4)
  })
})
