// 거대한 막 보스 · 웨이포인트 저장 (2026-09-24)
import { describe, expect, it } from 'vitest'
import { sanitizeSheet, emptySheet } from '../src/core/items'
import { TILE } from '../src/core/map'
import { bodyR } from '../src/core/monsters'
import { circleHitsWall, moveCircle } from '../src/core/physics'
import { makeRng, rand } from '../src/core/rng'
import { createState } from '../src/core/sim'
import { WAYPOINTS, actBossQuest, buildAreaMap, wpBit } from '../src/core/world'

describe('거대한 몸은 벽을 넘지 않는다', () => {
  for (const area of [9, 18, 27, 34]) {
    it(`보스 방 ${area}: 몸 반지름으로 아무렇게나 돌진해도 맵 안 · 벽 밖`, () => {
      // 사용자: "도살자가 돌진하다 벽 밖으로 나가거나 맵에서 없어진다" — 큰 원이 얇은 테두리 벽을 넘어 튀어 나갔다
      const map = buildAreaMap(7, area)
      const s = createState({ area, seed: 7, chars: ['chim'] }, map)
      const boss = s.monsters.find((m) => bodyR(m) > TILE)!
      const r = bodyR(boss)
      const rng = makeRng(99 + area)
      let x = boss.x
      let y = boss.y
      for (let run = 0; run < 60; run++) {
        const a = rand(rng) * Math.PI * 2
        for (let t = 0; t < 40; t++) {
          const q = moveCircle(map, x, y, r, Math.cos(a) * 10, Math.sin(a) * 10)
          x = q.x
          y = q.y
          expect(x).toBeGreaterThan(TILE)
          expect(y).toBeGreaterThan(TILE)
          expect(x).toBeLessThan(map.pw - TILE)
          expect(y).toBeLessThan(map.ph - TILE)
          expect(circleHitsWall(map, x, y, r * 0.5)).toBe(false)
        }
      }
    })
  }
})

describe('웨이포인트 저장', () => {
  it('보스 방 넷(뒤쪽 비트)도 저장에서 지워지지 않는다', () => {
    // 사용자: "4막 보스를 깬 뒤 방을 다시 만들었는데 찍어 둔 웨이포인트가 없다" — 16비트로 잘라 거미 둥지 · 관리인의 방 · 심연의 옥좌가 지워졌다
    expect(WAYPOINTS.length).toBeGreaterThan(16)
    const all = (1 << WAYPOINTS.length) - 1
    const sh = sanitizeSheet({ ...emptySheet(), wps: all, twps: [all, all, all] })
    expect(sh.wps).toBe(all)
    expect(sh.twps?.[2]).toBe(all)
  })
  it('예전 저장에서 지워진 보스 방 웨이포인트는 잡은 보스로 되살린다', () => {
    const quests = new Array(32).fill(0)
    for (let a = 0; a < 4; a++) quests[actBossQuest(a)] = 3
    const sheet = sanitizeSheet({ ...emptySheet(), level: 30, wps: 0xffff, quests })
    const map = buildAreaMap(3, 0)
    const s = createState({ area: 0, seed: 3, chars: ['chim'], sheets: [sheet] }, map)
    for (const room of [9, 18, 27, 34]) expect(s.players[0].wps & wpBit(room)).not.toBe(0)
  })
})
