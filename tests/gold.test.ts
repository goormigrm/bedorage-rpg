// 돈 쓸 곳 (2026-09-25 사용자: "돈을 쓸 곳이 도박꾼밖에 없는데 돈 쓸 곳을 더 만들어 줘, 돈으로 가방 크기를 늘리거나").
// 가방 칸 늘리기(상인) · 보관함 칸 늘리기(관리인) · 진열 새로 받기(상인) · 도박 10연 · 한꺼번에 보관.
// 모두 sim 명령이다 — 창은 CMD_* 만 보내고 sim 이 모두의 화면에서 똑같이 처리한다(DESIGN 2장 3).
import { describe, expect, it } from 'vitest'
import { BTN_USE, CMD_BAGUP, CMD_GAMBLE, CMD_SHOPNEW, CMD_STASHUP, CMD_STASH_PUT, CMD_STASH_TAKE, Input } from '../src/core/input'
import { GameMap } from '../src/core/map'
import { buildAreaMap, townNpcs } from '../src/core/world'
import { createState, step } from '../src/core/sim'
import { BAG_MAX, BAG_SIZE, BAG_STEP, Item, STASH_MAX, STASH_SIZE, STASH_STEP, bagUpPrice, gamblePrice, rollItem, shopNewPrice, stashUpPrice } from '../src/core/items'
import { makeRng } from '../src/core/rng'
import { GameState } from '../src/core/state'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })

function game(seed = 91) {
  const maps = new Map<number, GameMap>()
  const mapOf = (id: number): GameMap => {
    let m = maps.get(id)
    if (!m) {
      m = buildAreaMap(seed, id)
      maps.set(id, m)
    }
    return m
  }
  const s = createState({ seed, chars: ['chim'] }, mapOf)
  for (let t = 0; t < 3; t++) step(s, mapOf, [idle()])
  const cmd = (c: number, a: number) => step(s, mapOf, [{ ...idle(), buttons: BTN_USE, cmd: c, arg: a }])
  return { s, cmd }
}

/** 그 NPC 곁에 세운다 (마을 명령은 곁에 있어야 듣는다) */
function at(s: GameState, npc: 'merchant' | 'stash' | 'gambler'): void {
  const p = s.players[0]
  const n = townNpcs(p.area).find((x) => x.id === npc)!
  p.x = n.x + 10
  p.y = n.y + 10
  p.btnPrev = 0
}

/** 가방을 n개로 채운다 (lk 를 주면 그만큼 잠근다) */
function fill(s: GameState, n: number, locked = 0): void {
  const p = s.players[0]
  const rng = makeRng(5)
  p.bag.length = 0
  for (let i = 0; i < n; i++) {
    const it: Item = rollItem(rng, 9000 + i, 10, p.weapon, 'chest', 0, 0)
    if (i < locked) it.lk = 1
    p.bag.push(it)
  }
}

describe('가방 칸 늘리기 (상인)', () => {
  it('골드를 내면 여섯 칸 늘고, 값은 갈수록 비싸다', () => {
    const { s, cmd } = game()
    const p = s.players[0]
    at(s, 'merchant')
    expect(p.bagMax).toBe(BAG_SIZE)
    const price = bagUpPrice(p.bagMax)
    p.gold = price
    cmd(CMD_BAGUP, 0)
    expect(p.bagMax).toBe(BAG_SIZE + BAG_STEP)
    expect(p.gold).toBe(0)
    // 다음 칸은 더 비싸다
    expect(bagUpPrice(p.bagMax)).toBeGreaterThan(price)
  })

  it('돈이 모자라거나 상인 곁이 아니면 그대로', () => {
    const { s, cmd } = game()
    const p = s.players[0]
    at(s, 'merchant')
    p.gold = bagUpPrice(p.bagMax) - 1
    cmd(CMD_BAGUP, 0)
    expect(p.bagMax).toBe(BAG_SIZE)
    // 보관함 곁에서는 상인 일을 못 한다
    at(s, 'stash')
    p.gold = 999999
    cmd(CMD_BAGUP, 0)
    expect(p.bagMax).toBe(BAG_SIZE)
  })

  it('끝까지 늘리면 멈춘다', () => {
    const { s, cmd } = game()
    const p = s.players[0]
    at(s, 'merchant')
    p.gold = 999999
    for (let i = 0; i < 20; i++) cmd(CMD_BAGUP, 0)
    expect(p.bagMax).toBe(BAG_MAX)
    expect(bagUpPrice(p.bagMax)).toBe(0)
  })

  it('늘린 칸만큼 더 줍고 더 산다 (가방 한도가 칸 수를 따른다)', () => {
    const { s, cmd } = game()
    const p = s.players[0]
    at(s, 'merchant')
    fill(s, BAG_SIZE)
    p.gold = 999999
    const shopUid = s.shop[0].uid
    cmd(999, 0) // 아무 일도 없는 명령 (가방이 꽉 찼다)
    expect(p.bag.length).toBe(BAG_SIZE)
    cmd(CMD_BAGUP, 0)
    expect(p.bagMax).toBe(BAG_SIZE + BAG_STEP)
    // 이제 상인에게서 살 자리가 있다
    cmd(6 /* CMD_BUY */, 0)
    expect(p.bag.length).toBe(BAG_SIZE + 1)
    expect(p.bag.some((it) => it.uid === shopUid)).toBe(true)
  })
})

describe('보관함 칸 늘리기 (관리인)', () => {
  it('스무 칸씩 늘고 끝에서 멈춘다', () => {
    const { s, cmd } = game()
    const p = s.players[0]
    at(s, 'stash')
    expect(p.stashMax).toBe(STASH_SIZE)
    p.gold = stashUpPrice(p.stashMax)
    cmd(CMD_STASHUP, 0)
    expect(p.stashMax).toBe(STASH_SIZE + STASH_STEP)
    expect(p.gold).toBe(0)
    p.gold = 999999
    for (let i = 0; i < 20; i++) cmd(CMD_STASHUP, 0)
    expect(p.stashMax).toBe(STASH_MAX)
    expect(stashUpPrice(p.stashMax)).toBe(0)
  })
})

describe('상인 진열 새로 받기', () => {
  it('골드를 내면 열 가지가 새것으로 바뀐다', () => {
    const { s, cmd } = game()
    const p = s.players[0]
    at(s, 'merchant')
    const before = s.shop.map((it) => it.uid)
    p.gold = shopNewPrice(p.level) - 1
    cmd(CMD_SHOPNEW, 0)
    expect(s.shop.map((it) => it.uid)).toEqual(before) // 돈이 모자라면 그대로
    p.gold = shopNewPrice(p.level)
    cmd(CMD_SHOPNEW, 0)
    expect(s.shop.length).toBe(10)
    expect(s.shop.some((it) => before.includes(it.uid))).toBe(false)
    expect(p.gold).toBe(0)
  })
})

describe('도박꾼 10연', () => {
  it('한 번에 열 개를 뽑고 값도 열 배다 · 무엇이 나왔는지 알린다', () => {
    const { s, cmd } = game()
    const p = s.players[0]
    at(s, 'gambler')
    p.bag.length = 0
    const one = gamblePrice(p.level)
    p.gold = one * 10
    cmd(CMD_GAMBLE, 0 + 16) // 무기 칸 · 10연
    expect(p.bag.length).toBe(10)
    expect(p.gold).toBe(0)
    expect(p.bag.every((it) => it.slot === 0)).toBe(true)
    const ev = s.events.find((e) => e.type === 'gamble')
    expect(ev && ev.type === 'gamble' ? ev.n : 0).toBe(10)
    expect(ev && ev.type === 'gamble' ? ev.uids.length : 0).toBe(10)
    expect(ev && ev.type === 'gamble' ? ev.gold : 0).toBe(one * 10)
  })

  it('돈이나 자리가 모자라면 되는 데까지만 뽑는다', () => {
    const { s, cmd } = game()
    const p = s.players[0]
    at(s, 'gambler')
    p.bag.length = 0
    p.gold = gamblePrice(p.level) * 3 + 5
    cmd(CMD_GAMBLE, 1 + 16)
    expect(p.bag.length).toBe(3)
    expect(p.gold).toBe(5)
    // 자리가 한 칸이면 하나만
    fill(s, p.bagMax - 1)
    p.gold = 999999
    cmd(CMD_GAMBLE, 2 + 16)
    expect(p.bag.length).toBe(p.bagMax)
  })

  it('한 번 뽑기는 그대로 하나', () => {
    const { s, cmd } = game()
    const p = s.players[0]
    at(s, 'gambler')
    p.bag.length = 0
    p.gold = 999999
    cmd(CMD_GAMBLE, 3)
    expect(p.bag.length).toBe(1)
    expect(p.bag[0].slot).toBe(3)
  })
})

describe('한꺼번에 보관 · 꺼내기', () => {
  it('가방을 통째로 보관함에 넣되 잠근 것은 남는다', () => {
    const { s, cmd } = game()
    const p = s.players[0]
    at(s, 'stash')
    fill(s, 10, 3)
    p.stash.length = 0
    cmd(CMD_STASH_PUT, 200)
    expect(p.bag.length).toBe(3)
    expect(p.bag.every((it) => it.lk === 1)).toBe(true)
    expect(p.stash.length).toBe(7)
  })

  it('보관함 자리가 모자라면 되는 데까지만 넣는다', () => {
    const { s, cmd } = game()
    const p = s.players[0]
    at(s, 'stash')
    fill(s, 10)
    const rng = makeRng(9)
    p.stash = Array.from({ length: p.stashMax - 4 }, (_, i) => rollItem(rng, 7000 + i, 8, p.weapon, 'chest', 0, 0))
    cmd(CMD_STASH_PUT, 200)
    expect(p.stash.length).toBe(p.stashMax)
    expect(p.bag.length).toBe(6)
  })

  it('한꺼번에 꺼내기는 가방이 차는 데까지', () => {
    const { s, cmd } = game()
    const p = s.players[0]
    at(s, 'stash')
    const rng = makeRng(11)
    p.bag.length = 0
    p.stash = Array.from({ length: 40 }, (_, i) => rollItem(rng, 6000 + i, 8, p.weapon, 'chest', 0, 0))
    cmd(CMD_STASH_TAKE, 200)
    expect(p.bag.length).toBe(BAG_SIZE)
    expect(p.stash.length).toBe(40 - BAG_SIZE)
  })
})
