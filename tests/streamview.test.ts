// 방송 개선 ③ 말풍선 양 · ⑤ 방송 글자 크기 (2026-10-17): 설정이 없거나 이상하면 지금과 똑같이(보통 · 1배)
import { describe, expect, it } from 'vitest'
import { BUBBLE_FLOW, bubbleFlow, loadStreamCfg, saveStreamCfg } from '../src/game/stream'

describe('말풍선 양 · 방송 글자 크기 설정', () => {
  // 브라우저 저장소 흉내
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  }
  it('처음엔 보통 · 보스전 그대로 · 글자 1배 (예전과 같은 0.3초 · 12줄 · 8초)', () => {
    const c = loadStreamCfg()
    expect(c.bubbleAmount).toBe('normal')
    expect(c.bubbleBossLess).toBe(false)
    expect(c.textScale).toBe(1)
    expect(bubbleFlow(c, true)).toEqual({ gap: 300, max: 12, wait: 8000 })
  })
  it('고른 값은 저장되고 · 이상한 값은 기본으로', () => {
    const c = loadStreamCfg()
    c.bubbleAmount = 'many'
    c.textScale = 1.5
    saveStreamCfg(c)
    expect(loadStreamCfg().bubbleAmount).toBe('many')
    expect(loadStreamCfg().textScale).toBe(1.5)
    mem.set('brpg.chzzk.cfg', JSON.stringify({ bubbleAmount: 'toString', textScale: 7 }))
    expect(loadStreamCfg().bubbleAmount).toBe('normal')
    expect(loadStreamCfg().textScale).toBe(1)
  })
  it('보스전 적게를 켜면 보스와 싸우는 동안만 적게', () => {
    const c = { bubbleAmount: 'many' as const, bubbleBossLess: true }
    expect(bubbleFlow(c, false)).toBe(BUBBLE_FLOW.many)
    expect(bubbleFlow(c, true)).toBe(BUBBLE_FLOW.few)
  })
})
