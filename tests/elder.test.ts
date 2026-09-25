// 촌장 퀘스트는 모든 야영지에서 공유 (2026-09-25 사용자: "1막을 끝내고 2막 야영지로 가면 1막 퀘스트 보상을 받으러 1막 야영지로 다시 가야 한다")
import { describe, expect, it } from 'vitest'
import { CMD_QUEST, EMPTY_INPUT } from '../src/core/input'
import { emptySheet, sanitizeSheet } from '../src/core/items'
import { createState, step } from '../src/core/sim'
import { ACTS, QUESTS, actBossQuest, buildAreaMap, elderMarks, townNpcs } from '../src/core/world'

describe('촌장 퀘스트는 모든 야영지에서', () => {
  it('2막 야영지 촌장에게 1막 퀘스트 보상을 받는다', () => {
    const quests = new Array(32).fill(0)
    const bq = actBossQuest(0)
    quests[bq] = 2 // 도살자를 쓰러뜨렸다 — 보고 전
    const sheet = sanitizeSheet({ ...emptySheet(), level: 12, quests })
    const town2 = ACTS[1].town
    const map = buildAreaMap(5, town2)
    const s = createState({ area: town2, seed: 5, chars: ['chim'], sheets: [sheet] }, () => map)
    const p = s.players[0]
    const elder = townNpcs(town2).find((n) => n.id === 'elder')!
    p.x = elder.x
    p.y = elder.y + 20
    const gold0 = p.gold
    step(s, map, [{ ...EMPTY_INPUT, cmd: CMD_QUEST, arg: bq }])
    step(s, map, [{ ...EMPTY_INPUT }])
    expect(p.quests[bq]).toBe(3)
    expect(p.gold).toBe(gold0 + (QUESTS[bq].gold ?? 0))
  })
  it('촌장 머리 표시: 아직 못 간 막의 퀘스트로는 "!" 가 뜨지 않는다', () => {
    const q = new Array(32).fill(0)
    QUESTS.forEach((d, i) => {
      if (d.act === 0) q[i] = 3
    })
    // 1막을 다 끝내면 2막이 열린다 → 2막 퀘스트로 "!"
    expect(elderMarks(q).offer).toBe(true)
    // 1막 퀘스트를 하나도 안 끝냈어도 "!" 는 1막 것 때문 — 1막을 다 맡고(1) 보스를 안 잡았으면 못 간 막의 0 은 세지 않는다
    const q2 = new Array(32).fill(0)
    QUESTS.forEach((d, i) => {
      if (d.act === 0) q2[i] = 1
    })
    expect(elderMarks(q2)).toEqual({ report: false, offer: false })
  })
})
