// 가방 살림 (2026-09-20 요청): 등급별 정렬 · 상점 한꺼번에 팔기 · 잠금(팔기·버리기·재료에서 빼기).
import { describe, expect, it } from 'vitest'
import { BTN_USE, CMD_DROP, CMD_LOCK, CMD_SELL_ALL, CMD_SORT, Input } from '../src/core/input'
import { GameMap, buildMap } from '../src/core/map'
import { buildAreaMap, townNpcs } from '../src/core/world'
import { createState, step } from '../src/core/sim'
import { Item, forgeMaterials, isJunk, itemValue, rollItem, sortItems, upgradeMaterials } from '../src/core/items'
import { makeRng } from '../src/core/rng'
import { GameState } from '../src/core/state'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })

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

function game(seed = 81) {
  const mapOf = world(seed)
  const s = createState({ seed, chars: ['chim'] }, mapOf)
  for (let t = 0; t < 3; t++) step(s, mapOf, [idle()])
  const cmd = (c: number, a: number) => step(s, mapOf, [{ ...idle(), buttons: BTN_USE, cmd: c, arg: a }])
  return { s, mapOf, cmd }
}

/** 등급을 골라 가방을 채운다 */
function fill(s: GameState, rarities: number[]): void {
  const p = s.players[0]
  const rng = makeRng(17)
  p.bag.length = 0
  rarities.forEach((r, i) => p.bag.push(rollItem(rng, 80000 + i, 10 + i, p.weapon, 'goldchest', 0, r)))
  p.bag.forEach((it, i) => (it.rarity = rarities[i]))
}

function atMerchant(s: GameState): void {
  const p = s.players[0]
  const n = townNpcs(p.area).find((x) => x.id === 'merchant')!
  p.x = n.x + 10
  p.y = n.y + 10
  p.btnPrev = 0
}

describe('정렬', () => {
  it('등급이 높은 것부터 — 같으면 부위 · 아이템 레벨 순 (어디서 돌려도 같은 차례)', () => {
    const rng = makeRng(3)
    const list: Item[] = [0, 3, 1, 4, 2, 2].map((r, i) => {
      const it = rollItem(rng, 100 + i, 10 + i, 'rifle', 'goldchest', 0, 0)
      it.rarity = r
      return it
    })
    const out = sortItems(list)
    expect(out.map((it) => it.rarity)).toEqual([4, 3, 2, 2, 1, 0])
    // 두 번 돌려도 같다
    expect(sortItems(list).map((it) => it.uid)).toEqual(out.map((it) => it.uid))
    // 원본은 그대로
    expect(list[0].rarity).toBe(0)
  })

  it('가방 정렬 명령이 실제로 가방을 줄 세운다', () => {
    const { s, cmd } = game()
    fill(s, [0, 3, 1, 4, 2])
    cmd(CMD_SORT, 0)
    expect(s.players[0].bag.map((it) => it.rarity)).toEqual([4, 3, 2, 1, 0])
  })
})

describe('한꺼번에 팔기', () => {
  it('잡템(일반 · 마법)만 판다', () => {
    const { s, cmd } = game(82)
    const p = s.players[0]
    fill(s, [0, 1, 2, 3, 4])
    atMerchant(s)
    p.gold = 0
    const junkGold = p.bag.filter(isJunk).reduce((g, it) => g + itemValue(it), 0)
    cmd(CMD_SELL_ALL, 0)
    expect(p.bag.map((it) => it.rarity)).toEqual([2, 3, 4])
    expect(p.gold).toBe(junkGold)
  })

  it('전부 팔기는 잠근 것을 남긴다', () => {
    const { s, cmd } = game(83)
    const p = s.players[0]
    fill(s, [0, 2, 3, 4])
    atMerchant(s)
    p.gold = 0
    // 전설(3)을 잠근다
    const legIdx = p.bag.findIndex((it) => it.rarity === 3)
    cmd(CMD_LOCK, legIdx)
    expect(p.bag[legIdx].lk).toBe(1)
    atMerchant(s)
    cmd(CMD_SELL_ALL, 1)
    expect(p.bag.length).toBe(1)
    expect(p.bag[0].rarity).toBe(3)
    expect(p.gold).toBeGreaterThan(0)
  })

  it('상인 곁이 아니면 팔리지 않는다', () => {
    const { s, cmd } = game(84)
    const p = s.players[0]
    fill(s, [0, 1, 2])
    p.x += 900
    p.gold = 0
    cmd(CMD_SELL_ALL, 1)
    expect(p.bag.length).toBe(3)
    expect(p.gold).toBe(0)
  })
})

describe('잠금', () => {
  it('잠근 것은 버려지지도, 강화·벼리기 재료가 되지도 않는다', () => {
    const { s, cmd } = game(85)
    const p = s.players[0]
    fill(s, [2, 2, 2])
    cmd(CMD_LOCK, 0)
    // 버리기
    cmd(CMD_DROP, 0)
    expect(p.bag.length).toBe(3)
    // 재료
    expect(forgeMaterials(p.bag).includes(0)).toBe(false)
    expect(p.bag[0].rarity).toBe(2)
    const target = p.bag[1]
    expect(upgradeMaterials(p.bag, p.stash, target).includes(0)).toBe(false)
    // 한 번 더 누르면 풀린다
    cmd(CMD_LOCK, 0)
    expect(p.bag[0].lk).toBeUndefined()
    cmd(CMD_DROP, 0)
    expect(p.bag.length).toBe(2)
  })
})

void buildMap
