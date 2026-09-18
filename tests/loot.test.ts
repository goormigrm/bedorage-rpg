// 전리품 · 경제 (GUIDE 9장 — D3): 물약(3) · 상자 · 금빛 상자 · 항아리(쏘면 깨짐) · 제단 · 지역마다 물건 배치.
import { describe, expect, it } from 'vitest'
import { BTN_FIRE, BTN_POTION, BTN_USE, Input } from '../src/core/input'
import { GameMap, buildMap } from '../src/core/map'
import { createState, step } from '../src/core/sim'
import { OBJ_CHEST, OBJ_GOLDCHEST, OBJ_SHRINE, OBJ_URN, SHRINE_TICKS } from '../src/core/state'
import { buildAreaMap, townNpcs } from '../src/core/world'
import { CMD_BUY, CMD_GAMBLE, CMD_POTUP, CMD_REROLL, CMD_SELL, CMD_STASH_PUT, CMD_STASH_TAKE } from '../src/core/input'
import { LEG_FOCUS, LEG_GOLD, LEG_UNDYING, buyPrice, emptySheet, itemValue, potUpPrice } from '../src/core/items'
import { CMD_EQUIP } from '../src/core/input'
import { makeMonster } from '../src/core/dungeon'
import { GOBLIN, GOBLIN_KIND } from '../src/core/monsters'
import { MS_CHASE } from '../src/core/state'
import { BTN_DASH, BTN_SKILL1, CMD_HIRE, CMD_SKILL_MOD, CMD_SKILL_SLOT, CMD_SKILL_UP } from '../src/core/input'
import { freePoints, nodeCd, nodePow, slotNode } from '../src/core/skills'
import { hashState, mercPrice } from '../src/core/sim'
import { areaLayout } from '../src/core/world'

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

  it('전설 고유 효과: 낀 전설의 효과가 켜진다 (피의 갈증 · 황금 손 · 불굴 · 집중)', () => {
    const { s, map, run } = field(64)
    const p = s.players[0]
    const leg = (n: number, slot: number) => ({ uid: 700 + n, slot, wt: -1, rarity: 3, ilvl: 5, aff: [5, 10], leg: n })
    p.bag.push(leg(LEG_GOLD, 3), leg(LEG_UNDYING, 2), leg(LEG_FOCUS, 1))
    for (let k = 0; k < 3; k++) step(s, map, [{ ...idle(), cmd: CMD_EQUIP, arg: 0 }])
    expect(p.legs & (1 << LEG_GOLD)).not.toBe(0)
    expect(p.legs & (1 << LEG_UNDYING)).not.toBe(0)
    // 황금 손: 골드 1.5배
    const g0 = p.gold
    s.drops.push({ id: 1, owner: 0, x: p.x, y: p.y, item: null, gold: 10, pot: 0, ttl: 999, lock: 0 })
    run(2)
    expect(p.gold).toBe(g0 + 15)
    // 불굴: 체력이 30% 아래로 떨어지면 무적
    s.monsters = []
    p.hp = p.maxHp * 0.35
    p.invuln = 0
    const m = makeMonster(s, 0, p.x + 26, p.y, 800, 1, 400)
    m.st = MS_CHASE
    s.monsters.push(m)
    for (let t = 0; t < 200 && p.legCd === 0; t++) run(1)
    expect(p.legCd).toBeGreaterThan(0)
    expect(p.alive && !p.downed).toBe(true)
  })

  it('보물 고블린: 도망치며 골드를 흘리고, 20초가 지나면 사라진다', () => {
    const { s, run } = field(65)
    const p = s.players[0]
    const g = makeMonster(s, GOBLIN_KIND, p.x + 120, p.y, 9997, 1)
    g.st = MS_CHASE
    s.monsters.push(g)
    const d0 = Math.hypot(g.x - p.x, g.y - p.y)
    run(200)
    expect(Math.hypot(g.x - p.x, g.y - p.y)).toBeGreaterThan(d0)
    expect(s.drops.some((d) => d.owner === -1 && d.gold > 0)).toBe(true)
    let gone = false
    for (let t = 0; t < GOBLIN.escape && !gone; t++) {
      run(1)
      gone = s.events.some((e) => e.type === 'goblinGone')
    }
    expect(gone).toBe(true)
    expect(s.monsters.some((q) => q.kind === GOBLIN_KIND)).toBe(false)
  })
})

describe('성장 · 전투 (D4)', () => {
  it('스킬 트리: 레벨마다 포인트 · 랭크를 올리면 위력이 오르고 · 3랭크 변형 · 배운 스킬을 1 칸에 건다', () => {
    const { s, run } = field(66)
    const p = s.players[0]
    p.level = 6
    const cmd = (c: number, arg: number) => run(1, { ...idle(), cmd: c, arg })
    expect(freePoints(p.level, p.build, p.spBonus)).toBe(5)
    cmd(CMD_SKILL_UP, 2)
    expect(p.build.r[2]).toBe(1)
    expect(slotNode(p, 3)).toBe(2)
    for (let k = 0; k < 2; k++) cmd(CMD_SKILL_UP, 0)
    expect(p.build.r[0]).toBe(3)
    expect(nodePow(p.build, 0)).toBeCloseTo(1.3)
    cmd(CMD_SKILL_MOD, 0 * 4 + 0 * 2 + 1)
    expect(p.build.m3[0]).toBe(2)
    expect(nodeCd(p.build, 0)).toBeCloseTo((1 - 0.08) * 0.8)
    // 칸 바꾸기: Q 에 배운 스킬을 걸면 원래 것은 1 칸으로
    cmd(CMD_SKILL_SLOT, 0 * 16 + 2)
    expect(p.build.s[0]).toBe(2)
    expect(p.build.s[2]).toBe(0)
    // 포인트가 없으면 못 올린다
    cmd(CMD_SKILL_UP, 6)
    cmd(CMD_SKILL_UP, 6)
    const r = p.build.r[6]
    cmd(CMD_SKILL_UP, 6)
    expect(p.build.r[6]).toBe(r)
    expect(freePoints(p.level, p.build, p.spBonus)).toBe(0)
  })

  it('집중: 총이 맞으면 차고, 스킬이 쓴다 · 모자라면 못 쓴다', () => {
    const { s, run } = field(67)
    const p = s.players[0]
    const m = makeMonster(s, 0, p.x + 70, p.y, 801, 50)
    m.st = MS_CHASE
    m.cd = 999
    s.monsters.push(m)
    p.focus = 10
    run(40, { ...idle(), buttons: BTN_FIRE, aim: 0, aimDist: 18 })
    expect(p.focus).toBeGreaterThan(10.5)
    p.focus = 0
    run(1, { ...idle(), buttons: BTN_SKILL1 })
    expect(p.cd[0]).toBe(0)
    p.focus = 100
    run(1, { ...idle(), buttons: BTN_SKILL1 })
    expect(p.cd[0]).toBeGreaterThan(0)
    expect(p.focus).toBeLessThan(100)
  })

  it('구르기는 두 번까지 모아 두고 쓴다 (던전)', () => {
    const { s, run } = field(68)
    const p = s.players[0]
    expect(p.dashCharges).toBe(2)
    run(1, { ...idle(), mx: 1, buttons: BTN_DASH })
    run(30, { ...idle(), mx: 1 })
    run(1, { ...idle(), mx: 1, buttons: BTN_DASH })
    expect(p.dashCharges).toBe(0)
    run(30, { ...idle(), mx: 1 })
    run(1, { ...idle(), mx: 1, buttons: BTN_DASH })
    expect(p.dashTimer).toBe(0)
    run(60 * 5)
    expect(p.dashCharges).toBe(2)
  })

  it('용병 대장: 골드를 내면 빈 자리에 용병이 앉아 나를 따라다닌다 (sim 안의 봇 — 두 번 돌려 같다)', () => {
    const play = () => {
      const seed = 69
      const maps = new Map<number, GameMap>()
      const mapOf = (id: number) => maps.get(id) ?? maps.set(id, buildAreaMap(seed, id)).get(id)!
      const s = createState({ seed, chars: ['chim', 'magic'], absent: [false, true], sheets: [{ ...emptySheet(), level: 4, gold: 2000 }] }, mapOf)
      const p = s.players[0]
      const cap = townNpcs(0).find((q) => q.id === 'captain')!
      p.x = cap.x + 30
      p.y = cap.y
      step(s, mapOf, [{ ...idle(), cmd: CMD_HIRE, arg: 1 }, idle()])
      const merc = s.players[1]
      expect(merc.merc).toBe(0)
      expect(merc.left).toBe(false)
      expect(p.gold).toBe(2000 - mercPrice(4))
      // 성문 밖으로 나가면 따라온다
      const gate = areaLayout(0, mapOf(0)).exits[0]
      p.x = gate.x
      p.y = gate.y
      p.exitLock = 0
      for (let t = 0; t < 400; t++) step(s, mapOf, [idle(), idle()])
      expect(merc.area).toBe(1)
      return hashState(s)
    }
    expect(play()).toBe(play())
  })
})
