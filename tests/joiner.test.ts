// 시청자 이름 괴물 추첨 (2026-09-26 — 선착순에서 추첨으로)
import { describe, expect, it } from 'vitest'
import { JOIN_MAX, JOIN_TTL, Joiner, WIN_COOL, addJoiner, drawJoiner } from '../src/game/stream'

/** 같은 순서가 나오는 가짜 난수 */
function seq(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

describe('시청자 이름 괴물 추첨', () => {
  it('100명이 참여하면 먼저 온 사람도 뒤에 온 사람도 뽑힌다 (선착순일 때는 앞의 40명이 빠졌다)', () => {
    const pool: Joiner[] = []
    for (let i = 0; i < 100; i++) addJoiner(pool, `v${i}`, i * 10)
    expect(pool.length).toBe(100)
    const wins = new Map<string, number>()
    const rand = seq(7)
    const got: number[] = []
    for (let k = 0; k < 40; k++) got.push(Number(drawJoiner(pool, wins, 2000, rand)!.slice(1)))
    expect(new Set(got).size).toBe(40)
    expect(got.some((n) => n < 40)).toBe(true)
    expect(got.some((n) => n >= 60)).toBe(true)
    expect(pool.length).toBe(60)
  })

  it('한 사람은 한 번만 후보 · 다시 쓰면 시간만 새로 · 15분 지나면 빠진다', () => {
    const pool: Joiner[] = []
    addJoiner(pool, 'a', 0)
    addJoiner(pool, 'a', 1000)
    expect(pool).toEqual([{ nick: 'a', at: 1000 }])
    expect(drawJoiner(pool, new Map(), 1000 + JOIN_TTL)).toBeUndefined()
    expect(pool.length).toBe(0)
  })

  it('방금 당첨된 사람은 다른 후보가 있으면 뒤로 · 혼자면 다시 뽑힌다 · 10분 지나면 똑같이', () => {
    const wins = new Map<string, number>([['a', 0]])
    const pool: Joiner[] = [
      { nick: 'a', at: 0 },
      { nick: 'b', at: 0 },
    ]
    expect(drawJoiner(pool, wins, 100, () => 0)).toBe('b')
    expect(drawJoiner(pool, wins, 200, () => 0)).toBe('a')
    const later = new Map<string, number>([['a', 0]])
    const pool2: Joiner[] = [
      { nick: 'a', at: WIN_COOL },
      { nick: 'b', at: WIN_COOL },
    ]
    expect(drawJoiner(pool2, later, WIN_COOL, () => 0)).toBe('a')
  })

  it('후보는 JOIN_MAX 까지 — 넘치면 가장 오래된 사람부터', () => {
    const pool: Joiner[] = []
    for (let i = 0; i <= JOIN_MAX; i++) addJoiner(pool, `v${i}`, i)
    expect(pool.length).toBe(JOIN_MAX)
    expect(pool.some((j) => j.nick === 'v0')).toBe(false)
  })
})
