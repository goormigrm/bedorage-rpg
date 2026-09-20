// 전설 벼리기 (2026-09-20 요청): 희귀 다섯을 대장장이에게 주면 고른 부위의 물건 하나가 나온다 — 전설 30% · 신화 2%.
// 그리고 **다음 막으로 가는 문**: 막 보스를 쓰러뜨리면 보스가 섰던 자리에 문이 열린다.
import { describe, expect, it } from 'vitest'
import { BTN_USE, CMD_FORGE, Input } from '../src/core/input'
import { GameMap } from '../src/core/map'
import { ACTS, AREAS, actBossQuest, areaLayout, buildAreaMap, townNpcs } from '../src/core/world'
import { createState, gateOpen, step } from '../src/core/sim'
import { DROP_TABLE, FORGE_NEED, forgeIlvl, forgeMaterials, forgePrice, gearScore, rollItem, Item, SLOT_COUNT } from '../src/core/items'
import { makeRng } from '../src/core/rng'
import { GameState } from '../src/core/state'
import { areaDef } from '../src/core/world'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })
const TOWN = ACTS[0].town

function world(seed: number) {
  const maps = new Map<number, GameMap>()
  return (id: number): GameMap => {
    let m = maps.get(id)
    if (!m) {
      m = buildAreaMap(seed, id)
      maps.set(id, m)
    }
    return m
  }
}

function game(seed = 61) {
  const mapOf = world(seed)
  const s = createState({ seed, chars: ['chim'] }, mapOf)
  const run = (n: number, inp: Input = idle()) => {
    for (let t = 0; t < n; t++) step(s, mapOf, [t === 0 ? inp : idle()])
  }
  return { s, mapOf, run }
}

/** 가방에 희귀 n 개를 넣는다 */
function fillRares(s: GameState, n: number, ilvl = 14): void {
  const p = s.players[0]
  const rng = makeRng(99)
  p.bag.length = 0
  for (let i = 0; i < n; i++) p.bag.push(rollItem(rng, 90000 + i, ilvl, p.weapon, 'goldchest', 0, 2))
}

/** 대장장이 곁에 세운다 */
function atSmith(s: GameState): void {
  const p = s.players[0]
  const n = townNpcs(p.area).find((x) => x.id === 'smith')!
  p.x = n.x + 10
  p.y = n.y + 10
  p.btnPrev = 0
}

describe('전설 벼리기', () => {
  it('희귀 다섯 + 골드를 쓰고 고른 부위의 물건 하나가 나온다', () => {
    const { s, run } = game()
    const p = s.players[0]
    run(2)
    fillRares(s, 6)
    atSmith(s)
    p.gold = 9999
    const ilvl = forgeIlvl(p.bag, forgeMaterials(p.bag).slice(0, FORGE_NEED))
    const price = forgePrice(ilvl)
    const gold0 = p.gold
    step(s, (id) => buildAreaMap(61, id), [{ ...idle(), buttons: BTN_USE, cmd: CMD_FORGE, arg: 2 }])
    // 희귀 다섯이 사라지고 하나가 들어왔다 (6 - 5 + 1)
    expect(p.bag.length).toBe(2)
    expect(gold0 - p.gold).toBe(price)
    const made = p.bag[p.bag.length - 1]
    expect(made.slot).toBe(2)
    expect(made.rarity).toBeGreaterThanOrEqual(2)
    expect(made.ilvl).toBe(ilvl)
  })

  it('희귀가 넷뿐이거나 골드가 모자라면 아무 일도 없다', () => {
    const { s, run } = game(62)
    const p = s.players[0]
    run(2)
    fillRares(s, 4)
    atSmith(s)
    p.gold = 9999
    step(s, (id) => buildAreaMap(62, id), [{ ...idle(), buttons: BTN_USE, cmd: CMD_FORGE, arg: 0 }])
    expect(p.bag.length).toBe(4)
    expect(p.gold).toBe(9999)
    // 골드가 없으면
    fillRares(s, 5)
    p.gold = 1
    step(s, (id) => buildAreaMap(62, id), [{ ...idle(), buttons: BTN_USE, cmd: CMD_FORGE, arg: 0 }])
    expect(p.bag.length).toBe(5)
  })

  it('전설이 나올 확률은 30% 안팎이다 (배율표)', () => {
    const t = DROP_TABLE.forge
    expect(t[3]).toBeCloseTo(0.3, 5)
    expect(t[4]).toBeCloseTo(0.02, 5)
    // 일반 · 마법은 나오지 않는다 — 재료가 통째로 사라지지 않게
    expect(t[0] + t[1]).toBe(0)
    // 실제로 굴려 봐도 그쯤이다
    const rng = makeRng(5)
    let leg = 0
    const N = 4000
    for (let i = 0; i < N; i++) if (rollItem(rng, i, 14, 'rifle', 'forge').rarity >= 3) leg++
    expect(leg / N).toBeGreaterThan(0.26)
    expect(leg / N).toBeLessThan(0.38)
  })

  it('재료는 싼 것부터 쓰고, 아이템 레벨은 재료 평균 + 1 이다', () => {
    const rng = makeRng(3)
    const bag: Item[] = []
    for (const lv of [20, 10, 30, 12, 14, 16]) bag.push(rollItem(rng, lv, lv, 'rifle', 'goldchest', 0, 2))
    const mats = forgeMaterials(bag).slice(0, FORGE_NEED)
    expect(mats.length).toBe(5)
    // 가장 비싼 것(레벨 30)은 남는다
    expect(mats.some((i) => bag[i].ilvl === 30)).toBe(false)
    expect(forgeIlvl(bag, mats)).toBe(Math.round((20 + 10 + 12 + 14 + 16) / 5) + 1)
  })
})

describe('템 수준', () => {
  it('맨몸은 0 · 강화와 등급이 올라가면 는다', () => {
    expect(gearScore([])).toBe(0)
    expect(gearScore(new Array(SLOT_COUNT).fill(null))).toBe(0)
    const rng = makeRng(8)
    const plain = Array.from({ length: SLOT_COUNT }, (_, k) => rollItem(rng, k, 20, 'rifle', 'chest', 0, 0, k))
    const fine = plain.map((it) => ({ ...it, rarity: 3, up: 3 }))
    expect(gearScore(plain)).toBeGreaterThan(0)
    expect(gearScore(fine)).toBeGreaterThan(gearScore(plain))
  })
})

describe('다음 막으로 가는 문', () => {
  it('막 보스 지역에만 있고, 보스를 잡기 전에는 열리지 않는다', () => {
    const bosses = AREAS.filter((a) => a.gate !== undefined)
    expect(bosses.length).toBe(ACTS.length - 1)
    for (const a of bosses) {
      // 문은 다음 막의 마을로 간다
      expect(AREAS[a.gate!].kind).toBe('town')
      expect(AREAS[a.gate!].act).toBe(a.act + 1)
      expect(gateOpen(a, { quests: [] })).toBe(false)
      const q: number[] = []
      q[actBossQuest(a.act)] = 2
      expect(gateOpen(a, { quests: q })).toBe(true)
    }
    // 마을·들판에는 문이 없다
    expect(AREAS[TOWN].gate).toBeUndefined()
  })

  it('문은 보스가 섰던 자리에 서고, F 로 다음 막 마을로 건너간다', () => {
    const seed = 71
    const mapOf = world(seed)
    const s = createState({ seed, chars: ['chim'], area: 9 }, mapOf)
    const p = s.players[0]
    step(s, mapOf, [idle()])
    const def = areaDef(p.area)
    expect(def.gate).toBe(10)
    const l = areaLayout(p.area, mapOf(p.area))
    // 보스 자리 = 문 자리
    p.x = l.special!.x
    p.y = l.special!.y
    p.exitLock = 0
    p.btnPrev = 0
    // 아직 보스를 안 잡았으면 안 넘어간다
    step(s, mapOf, [{ ...idle(), buttons: BTN_USE }])
    expect(p.area).toBe(9)
    // 보스를 잡은 것으로 하면 넘어간다
    p.quests[actBossQuest(def.act)] = 2
    p.btnPrev = 0
    p.x = l.special!.x
    p.y = l.special!.y
    step(s, mapOf, [{ ...idle(), buttons: BTN_USE }])
    expect(p.area).toBe(10)
  })
})
