// 전리품 · 경제 (GUIDE 9장 — D3): 물약(3) · 상자 · 금빛 상자 · 항아리(쏘면 깨짐) · 제단 · 지역마다 물건 배치.
import { describe, expect, it } from 'vitest'
import { BTN_FIRE, BTN_POTION, BTN_USE, Input } from '../src/core/input'
import { GameMap, buildMap } from '../src/core/map'
import { createState, step } from '../src/core/sim'
import { OBJ_CHEST, OBJ_GOLDCHEST, OBJ_SHRINE, OBJ_URN, SHRINE_TICKS } from '../src/core/state'
import { buildAreaMap, townNpcs } from '../src/core/world'
import { CMD_BUY, CMD_GAMBLE, CMD_POTUP, CMD_REROLL, CMD_SELL, CMD_STASH_PUT, CMD_STASH_TAKE } from '../src/core/input'
import { buyPrice, emptySheet, itemValue, potUpPrice } from '../src/core/items'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })

function field(seed = 61) {
  const map = buildMap('crypt', 1, seed)
  const s = createState({ area: 4, seed, chars: ['chim'], noMonsters: true }, map)
  s.objects = []
  const run = (n: number, inp: Input = idle()) => {
    for (let t = 0; t < n; t++) step(s, map, [inp])
  }
  return { s, map, run }
}

describe('전리품 · 경제', () => {
  it('물약(3): 한 칸을 써서 3초에 걸쳐 최대 체력 35% 를 채운다 · 곧바로 또 마시지는 못한다', () => {
    const { s, run } = field()
    const p = s.players[0]
    p.hp = Math.round(p.maxHp * 0.3)
    const hp0 = p.hp
    const n0 = p.potions
    run(1, { ...idle(), buttons: BTN_POTION })
    expect(p.potions).toBe(n0 - 1)
    run(1)
    run(1, { ...idle(), buttons: BTN_POTION })
    expect(p.potions).toBe(n0 - 1)
    run(190)
    expect(p.hp).toBeGreaterThanOrEqual(hp0 + Math.round(p.maxHp * 0.35) - 2)
  })

  it('상자: F 로 열면 주인 몫의 골드·아이템이 쏟아지고, 다시 열리지 않는다', () => {
    const { s, run } = field()
    const p = s.players[0]
    s.objects.push({ id: 1, kind: OBJ_CHEST, x: p.x + 20, y: p.y, used: false, v: 0 })
    s.objects.push({ id: 2, kind: OBJ_GOLDCHEST, x: p.x - 20, y: p.y, used: false, v: 0 })
    const d0 = s.drops.length
    run(1, { ...idle(), buttons: BTN_USE })
    run(1)
    run(1, { ...idle(), buttons: BTN_USE })
    expect(s.objects.every((o) => o.used)).toBe(true)
    const mine = s.drops.slice(d0).filter((d) => d.owner === 0)
    expect(mine.some((d) => d.gold > 0)).toBe(true)
    // 금빛 상자는 아이템 셋 이상, 그중 하나는 희귀 이상
    const items = mine.filter((d) => d.item)
    expect(items.length).toBeGreaterThanOrEqual(4)
    expect(items.some((d) => d.item!.rarity >= 2)).toBe(true)
  })

  it('항아리는 쏘면 깨진다', () => {
    const { s, run } = field()
    const p = s.players[0]
    s.objects.push({ id: 3, kind: OBJ_URN, x: p.x + 70, y: p.y, used: false, v: 0 })
    run(1, { ...idle(), buttons: BTN_FIRE, aim: 0, aimDist: 18 })
    run(20)
    expect(s.objects[0].used).toBe(true)
  })

  it('제단: F 로 30초 축복 (전투 = 피해 +25%)', () => {
    const { s, run } = field()
    const p = s.players[0]
    s.objects.push({ id: 4, kind: OBJ_SHRINE, x: p.x + 20, y: p.y, used: false, v: 0 })
    run(1, { ...idle(), buttons: BTN_USE })
    expect(p.shrine).toBe(0)
    expect(p.shrineT).toBeGreaterThan(SHRINE_TICKS - 5)
    run(SHRINE_TICKS + 5)
    expect(p.shrineT).toBe(0)
  })

  it('지역마다 상자·항아리가 놓이고, 막다른 굴과 보스 방 앞에는 금빛 상자가 있다 (같은 시드면 같다)', () => {
    const count = (area: number, seed: number) => {
      const map: GameMap = buildAreaMap(seed, area)
      const s = createState({ area, seed, chars: ['chim'] }, map)
      return s.objects.map((o) => `${o.kind}@${o.x},${o.y}`)
    }
    for (const area of [1, 4, 6]) {
      const a = count(area, 62)
      expect(a).toEqual(count(area, 62))
      expect(a.filter((k) => k.startsWith(`${OBJ_CHEST}@`)).length).toBeGreaterThanOrEqual(1)
      expect(a.filter((k) => k.startsWith(`${OBJ_URN}@`)).length).toBeGreaterThanOrEqual(4)
    }
    expect(count(2, 62).some((k) => k.startsWith(`${OBJ_GOLDCHEST}@`))).toBe(true)
    expect(count(8, 62).some((k) => k.startsWith(`${OBJ_GOLDCHEST}@`))).toBe(true)
  })

  it('마을 NPC: 곁에서만 거래한다 — 팔기 · 사기 · 물약 칸 · 다시 굴리기 · 도박 · 보관함', () => {
    const seed = 63
    const map = buildAreaMap(seed, 0)
    const s = createState({ seed, chars: ['chim'], sheets: [{ ...emptySheet(), level: 5, gold: 5000 }] }, map)
    const p = s.players[0]
    const at = (id: string) => {
      const n = townNpcs(0).find((q) => q.id === id)!
      p.x = n.x + 30
      p.y = n.y
    }
    const cmd = (c: number, arg: number) => step(s, map, [{ ...idle(), cmd: c, arg }])
    // 멀리서는 안 된다
    const shop0 = s.shop.length
    cmd(CMD_BUY, 0)
    expect(s.shop.length).toBe(shop0)
    // 상인: 사고 → 팔고 → 물약 칸
    at('merchant')
    const price = buyPrice(s.shop[0])
    cmd(CMD_BUY, 0)
    expect(s.shop.length).toBe(shop0 - 1)
    expect(p.gold).toBe(5000 - price)
    const it = p.bag[0]
    const g1 = p.gold
    cmd(CMD_SELL, 0)
    expect(p.bag.length).toBe(0)
    expect(p.gold).toBe(g1 + itemValue(it))
    const pm = p.potMax
    const pp = potUpPrice(pm)
    cmd(CMD_POTUP, 0)
    expect(p.potMax).toBe(pm + 1)
    // 도박꾼: 고른 칸의 아이템
    at('gambler')
    cmd(CMD_GAMBLE, 3)
    expect(p.bag.length).toBe(1)
    expect(p.bag[0].slot).toBe(3)
    // 대장장이: 옵션 하나가 바뀐다 (골드가 든다)
    at('smith')
    const before = JSON.stringify(p.bag[0].aff)
    const g2 = p.gold
    for (let k = 0; k < 6 && JSON.stringify(p.bag[0].aff) === before; k++) cmd(CMD_REROLL, 0)
    if (p.bag[0].aff.length > 0) {
      expect(JSON.stringify(p.bag[0].aff)).not.toBe(before)
      expect(p.gold).toBeLessThan(g2)
    }
    // 보관함: 넣고 꺼낸다
    at('stash')
    cmd(CMD_STASH_PUT, 0)
    expect(p.stash.length).toBe(1)
    expect(p.bag.length).toBe(0)
    cmd(CMD_STASH_TAKE, 0)
    expect(p.bag.length).toBe(1)
    void pp
  })
})
