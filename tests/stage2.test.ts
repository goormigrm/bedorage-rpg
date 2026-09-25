// 사용자가 고른 개선 2단계 (2026-09-25): 퀘스트 길 안내 · 통계 · 업적
import { describe, expect, it } from 'vitest'
import { emptySheet, sanitizeSheet } from '../src/core/items'
import { ACHIEVEMENTS, achievedIds, bossBit, emptyStats, sanitizeStats } from '../src/core/stats'
import { ACTS, AREAS, QUESTS, areaPath, questGuide } from '../src/core/world'

describe('퀘스트 길 안내', () => {
  it('지역 사이 가장 짧은 길 (출구로 이어진 차례)', () => {
    const p = areaPath(0, 3)!
    expect(p[0]).toBe(0)
    expect(p[p.length - 1]).toBe(3)
    for (let i = 1; i < p.length; i++) {
      const a = AREAS[p[i - 1]]
      const b = AREAS[p[i]]
      expect(a.links.includes(b.id) || b.links.includes(a.id)).toBe(true)
    }
    expect(areaPath(5, 5)).toEqual([5])
  })
  it('보고할 것 → 촌장 · 진행 중 → 그 지역 · 안 맡은 것 → 촌장', () => {
    const q = new Array(32).fill(0)
    const town = ACTS[0].town
    // 아무것도 안 맡았다 → 촌장에게 받으러
    expect(questGuide(q, 2)).toMatchObject({ area: town, npc: 'elder' })
    // 첫 퀘스트를 맡았다 → 그 지역
    q[0] = 1
    expect(questGuide(q, 1)).toMatchObject({ area: QUESTS[0].area, quest: 0 })
    // 이뤘다 → 보고하러 촌장
    q[0] = 2
    expect(questGuide(q, 2)).toMatchObject({ area: town, npc: 'elder', label: '촌장에게 보고' })
    // 1막을 다 끝냈으면 1막에서 가리킬 곳이 없다
    QUESTS.forEach((d, i) => {
      if (d.act === 0) q[i] = 3
    })
    expect(questGuide(q, 1)).toBeNull()
  })
})

describe('통계 · 업적', () => {
  it('세이브를 오가도 남고 말이 안 되는 값은 자른다', () => {
    const s = { ...emptyStats(), kills: 1234, bosses: 0xffffff, gold: -5 }
    const sh = sanitizeSheet({ ...emptySheet(), stats: s })
    expect(sh.stats!.kills).toBe(1234)
    expect(sh.stats!.bosses).toBe(0xfff)
    expect(sh.stats!.gold).toBe(0)
    expect(sanitizeStats(undefined)).toEqual(emptyStats())
  })
  it('업적: 목표에 닿으면 이룬다', () => {
    const s = emptyStats()
    expect(achievedIds(s, 1).size).toBe(0)
    s.kills = 1000
    s.bosses = bossBit(0, 0) | bossBit(3, 1)
    s.legends = 1
    const got = achievedIds(s, 30)
    for (const id of ['hunt100', 'hunt1k', 'boss1', 'boss4', 'nightmare', 'legend1', 'lv30']) expect(got.has(id)).toBe(true)
    for (const id of ['hunt10k', 'boss2', 'hell', 'mythic1']) expect(got.has(id)).toBe(false)
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length)
  })
  it('판이 센다: 괴물 · 정예 · 막 보스(같은 지역 파티 모두)', async () => {
    const { buildAreaMap } = await import('../src/core/world')
    const { createState, step } = await import('../src/core/sim')
    const area = 9
    const map = buildAreaMap(4, area)
    const s = createState({ area, seed: 4, chars: ['chim', 'magic'] }, () => map)
    const boss = s.monsters.find((m) => m.kind === 3)!
    // 보스 체력을 1 로 줄이고 사람 0 이 쏘아 잡는다
    boss.hp = 1
    boss.hitTick = 0
    const p = s.players[0]
    p.x = boss.x - 90
    p.y = boss.y
    p.aim = 0
    for (let t = 0; t < 120 && boss.hp > 0; t++) step(s, () => map, [{ mx: 0, my: 0, aim: 0, buttons: 1, char: 0, aimDist: 90 }, { mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 }])
    expect(boss.hp).toBeLessThanOrEqual(0)
    for (const q of s.players) expect(q.stats.bosses & bossBit(0, 0)).not.toBe(0)
    expect(s.players[0].stats.kills).toBeGreaterThanOrEqual(1)
  })
})
