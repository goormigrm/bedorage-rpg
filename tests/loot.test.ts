// 전리품 · 경제 (GUIDE 9장 — D3): 체력 구슬(물약은 없앴다) · 상자 · 금빛 상자 · 항아리(쏘면 깨짐) · 제단 · 지역마다 물건 배치.
import { describe, expect, it } from 'vitest'
import { BTN_FIRE, BTN_POTION, BTN_USE, Input } from '../src/core/input'
import { GameMap, buildMap } from '../src/core/map'
import { createState, step } from '../src/core/sim'
import { OBJ_CHEST, OBJ_GOLDCHEST, OBJ_SHRINE, OBJ_URN, SHRINE_TICKS } from '../src/core/state'
import { buildAreaMap, townNpcs } from '../src/core/world'
import { CMD_BUY, CMD_GAMBLE, CMD_SELL, CMD_STASH_PUT, CMD_STASH_TAKE, CMD_UPGRADE } from '../src/core/input'
import { Item, LEG_FOCUS, LEG_GOLD, LEG_UNDYING, buyPrice, emptySheet, itemValue } from '../src/core/items'
import { CMD_EQUIP } from '../src/core/input'
import { makeMonster } from '../src/core/dungeon'
import { EA_FAST, EA_UNIQUE, GOBLIN, GOBLIN_KIND } from '../src/core/monsters'
import { MS_CHASE, MS_RECOVER, Monster } from '../src/core/state'
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
  it('물약(3)은 없다 — 회복은 체력 구슬: 정예는 하나 확정 · 우두머리는 체력 25% 가 줄 때마다 큰 구슬 (2026-09-19)', () => {
    const { s, map, run } = field()
    const p = s.players[0]
    p.hp = 50
    run(1, { ...idle(), buttons: BTN_POTION })
    run(200)
    expect(p.hp).toBe(50)
    // 괴물을 앞(+x)에 붙잡아 두고 쏜다
    const hold = (m: Monster) => {
      m.st = MS_RECOVER
      m.t = 999
      m.x = p.x + 70
      m.y = p.y
    }
    const shoot = (m: Monster, until: () => boolean) => {
      for (let t = 0; t < 900 && !until(); t++) {
        step(s, map, [{ ...idle(), buttons: t % 2 ? BTN_FIRE : 0, aim: 0, aimDist: 15 }])
        hold(m)
      }
    }
    // 정예: 쓰러지면 구슬 하나는 반드시
    const e = makeMonster(s, 0, p.x + 70, p.y, 901, 0.3, 100, 1)
    e.elite = EA_FAST
    s.monsters.push(e)
    s.monstersTotal++
    const g0 = s.globes.length
    shoot(e, () => e.hp <= 0)
    expect(e.hp).toBeLessThanOrEqual(0)
    expect(s.globes.length).toBeGreaterThanOrEqual(g0 + 1)
    // 우두머리: 쓰러지기 전에도 체력 25% 가 줄면 큰 구슬(35%)
    s.globes.length = 0
    const u = makeMonster(s, 0, p.x + 70, p.y, 902, 30, 100, 5)
    u.elite = EA_UNIQUE
    s.monsters.push(u)
    s.monstersTotal++
    shoot(u, () => u.hp < u.maxHp * 0.7)
    expect(u.hp).toBeGreaterThan(0)
    expect(u.hp).toBeLessThan(u.maxHp * 0.75)
    expect(s.globes.some((g) => g.heal === 35)).toBe(true)
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

  it('지역마다 상자·항아리가 놓이고, 비워라 퀘스트의 굴과 보스 방 앞에는 금빛 상자가 있다 (같은 시드면 같다)', () => {
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

  it('마을 NPC: 곁에서만 거래한다 — 팔기 · 사기 · 강화 · 도박 · 보관함', () => {
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
    // 도박꾼: 고른 칸의 아이템
    at('gambler')
    cmd(CMD_GAMBLE, 3)
    expect(p.bag.length).toBe(1)
    expect(p.bag[0].slot).toBe(3)
    // 대장장이: 강화 — 같은 부위 · 같은 등급을 (단계 + 1)개 녹인다 (옵션 다시 굴리기는 없앴다 — 2026-09-19)
    at('smith')
    const keep = p.bag.slice()
    const ring = (uid: number, rarity = 1): Item => ({ uid, slot: 3, wt: -1, rarity, ilvl: 5, aff: [0, 10], bt: 0 })
    p.bag.length = 0
    p.bag.push(ring(501), ring(502), ring(503), ring(504, 2))
    const g2 = p.gold
    cmd(CMD_UPGRADE, 0) // +0 → +1: 같은 등급 반지 하나를 녹인다
    expect(p.bag.find((i) => i.uid === 501)?.up).toBe(1)
    expect(p.bag.length).toBe(3)
    expect(p.gold).toBeLessThan(g2)
    // +1 → +2 는 재료 둘 — 같은 등급(마법)은 하나뿐이고 희귀 반지는 재료가 안 된다
    cmd(CMD_UPGRADE, p.bag.findIndex((i) => i.uid === 501))
    expect(p.bag.find((i) => i.uid === 501)?.up).toBe(1)
    expect(p.bag.length).toBe(3)
    p.bag.length = 0
    p.bag.push(...keep)
    // 보관함: 넣고 꺼낸다
    at('stash')
    cmd(CMD_STASH_PUT, 0)
    expect(p.stash.length).toBe(1)
    expect(p.bag.length).toBe(0)
    cmd(CMD_STASH_TAKE, 0)
    expect(p.bag.length).toBe(1)
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

  // 2026-09-24 사용자: "보물 고블린은 실제 만나기도 전에 도망갔다고 뜬다 — 목격된 뒤에 도망가게"
  it('보물 고블린: 깨어 있어도 들키기 전(멀리 · 안 보임)에는 제자리 · 시계가 돌지 않는다 → 보이는 곳에서 마주치면 그때부터 도망', () => {
    const { s, run } = field(67)
    const p = s.players[0]
    const g = makeMonster(s, GOBLIN_KIND, p.x + GOBLIN.seen + 200, p.y, 9997, 1)
    g.st = MS_CHASE
    s.monsters.push(g)
    const x0 = g.x
    let gone = false
    for (let t = 0; t < GOBLIN.escape + 120 && !gone; t++) {
      p.x = g.x - GOBLIN.seen - 200
      run(1)
      gone = s.events.some((e) => e.type === 'goblinGone')
    }
    expect(gone).toBe(false)
    expect(g.hp).toBeGreaterThan(0)
    expect(g.seen ?? 0).toBe(0)
    expect(Math.abs(g.x - x0)).toBeLessThan(2)
    // 가까이(보이는 곳) — 들킨다 · 도망친다
    p.x = g.x - 150
    p.y = g.y
    run(60)
    expect(g.seen).toBe(1)
    expect(Math.hypot(g.x - p.x, g.y - p.y)).toBeGreaterThan(150)
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
      // 성문 밖으로 나가면(성문 곁에서 F) 따라온다
      const gate = areaLayout(0, mapOf(0)).exits[0]
      p.x = gate.x
      p.y = gate.y
      p.exitLock = 0
      p.btnPrev = 0
      step(s, mapOf, [{ ...idle(), buttons: BTN_USE }, idle()])
      for (let t = 0; t < 400; t++) step(s, mapOf, [idle(), idle()])
      expect(merc.area).toBe(1)
      return hashState(s)
    }
    expect(play()).toBe(play())
  })
})
