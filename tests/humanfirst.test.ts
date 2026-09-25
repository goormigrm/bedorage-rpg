// 보스는 사람이 먼저 · 보물 고블린은 사람이 보아야 (2026-09-25 사용자)
import { describe, expect, it } from 'vitest'
import { botInput, makeBot } from '../src/core/bot'
import { Input } from '../src/core/input'
import { GOBLIN, GOBLIN_KIND } from '../src/core/monsters'
import { createState, isHumanSeat, step } from '../src/core/sim'
import { buildAreaMap } from '../src/core/world'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })

describe('보스 방의 보스는 사람이 먼저', () => {
  it('봇(대장을 따라다니는 자리)이 쏘아도 안 맞은 보스는 다치지도 깨어 싸우지도 않는다 — 사람이 쏘면 시작', () => {
    const area = 9
    const map = buildAreaMap(6, area)
    // 자리 1 은 봇 (follow = 0)
    const s = createState({ area, seed: 6, chars: ['chim', 'dangun'], follow: [-1, 0] }, () => map)
    expect(isHumanSeat(s.players[0])).toBe(true)
    expect(isHumanSeat(s.players[1])).toBe(false)
    const boss = s.monsters.find((m) => m.kind === 3)!
    for (const m of s.monsters) if (m !== boss) m.hp = 0
    const hp0 = boss.hp
    const [me, bot] = s.players
    // 봇만 보스를 향해 쏜다 · 사람은 멀리서 가만히
    bot.x = boss.x - 150
    bot.y = boss.y
    me.x = boss.x - 380
    me.y = boss.y + 200
    for (let t = 0; t < 120; t++) {
      me.hp = me.maxHp
      bot.hp = bot.maxHp
      step(s, () => map, [idle(), { ...idle(), buttons: 1, aimDist: 150 }])
    }
    expect(boss.hp).toBe(hp0)
    expect(boss.hitTick).toBeLessThan(0)
    // 사람이 쏜다 → 다친다 · 이제부터 싸움
    me.x = boss.x - 150
    me.y = boss.y
    for (let t = 0; t < 60 && boss.hp === hp0; t++) step(s, () => map, [{ ...idle(), buttons: 1, aimDist: 150 }, idle()])
    expect(boss.hp).toBeLessThan(hp0)
    expect(boss.hitTick).toBeGreaterThanOrEqual(0)
  })

  it('봇 동료는 안 맞은 보스를 노리지 않고 · 봇이 사람 자리를 몰 때(계측 도구 · 영상 자동 조종)는 사람처럼 먼저 친다', () => {
    const area = 9
    const map = buildAreaMap(6, area)
    const run = (follow: number): number => {
      const s = createState({ area, seed: 6, chars: ['chim', 'dangun'], follow: [-1, follow] }, () => map)
      const boss = s.monsters.find((m) => m.kind === 3)!
      for (const m of s.monsters) if (m !== boss) m.hp = 0
      const [me, bot] = s.players
      bot.x = boss.x - 200
      bot.y = boss.y
      me.x = boss.x - 380
      me.y = boss.y + 200
      const mem = makeBot(9)
      for (let t = 0; t < 240 && boss.hitTick < 0; t++) {
        me.hp = me.maxHp
        bot.hp = bot.maxHp
        step(s, () => map, [idle(), botInput(s, map, 1, mem, 'normal')])
      }
      return boss.hitTick
    }
    // 봇 동료 (follow = 0) — 4초를 곁에 두어도 보스는 그대로
    expect(run(0)).toBeLessThan(0)
    // 사람 자리를 모는 봇 (follow = -1) — 보스를 친다
    expect(run(-1)).toBeGreaterThanOrEqual(0)
  })
})

describe('보물 고블린은 사람이 보아야 들킨다', () => {
  it('봇이 곁에 있어도 사람이 멀면 시계가 돌지 않는다 · 사람이 보면 goblinSeen', () => {
    // 고블린이 나오는 지역을 찾는다
    for (let seed = 1; seed < 80; seed++) {
      const area = 1
      const map = buildAreaMap(seed, area)
      const s = createState({ area, seed, chars: ['chim', 'dangun'], follow: [-1, 0] }, () => map)
      const g = s.monsters.find((m) => m.kind === GOBLIN_KIND)
      if (!g) continue
      for (const m of s.monsters) if (m !== g) m.hp = 0
      const [me, bot] = s.players
      bot.x = g.x + 60
      bot.y = g.y
      me.x = g.x + GOBLIN.seen + 400
      me.y = g.y
      g.st = 1
      for (let t = 0; t < 60; t++) step(s, () => map, [idle(), idle()])
      expect(g.seen ?? 0).toBe(0)
      me.x = g.x + 80
      me.y = g.y
      let seen = false
      for (let t = 0; t < 30 && !seen; t++) {
        step(s, () => map, [idle(), idle()])
        seen = s.events.some((e) => e.type === 'goblinSeen')
      }
      expect(seen).toBe(true)
      return
    }
    throw new Error('고블린이 나오는 판을 못 찾았다')
  })
})
