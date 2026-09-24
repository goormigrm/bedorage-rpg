// 성장·전리품: 스마트 루트 · 개인 전리품 · 줍기 · 장착 명령 · 버리기(선물) · 경험치 공유 · 레벨업 · 소실 규칙 · 세이브 검사.
import { describe, expect, it } from 'vitest'
import { BTN_USE, CMD_AUTOPICK, CMD_DROP, CMD_EQUIP, Input } from '../src/core/input'
import { buildMap } from '../src/core/map'
import { makeMonster } from '../src/core/dungeon'
import { createState, step } from '../src/core/sim'
import { makeRng } from '../src/core/rng'
import {
  AUTOPICK_ALL, BAG_SIZE, BASE_TYPES, Item, LootSource, RARITY_MYTHIC, SLOT_ARMOR, SLOT_RING, SLOT_WEAPON, ST_DMG, ST_HP, WEAPON_IDS, computeStats, emptySheet, itemName,
  lootLevelMul, pickRarity, rollItem, sanitizeSheet, xpNeed,
} from '../src/core/items'
import { COUNTDOWN_TICKS, MS_CHASE } from '../src/core/state'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })
const cmd = (c: number, arg: number): Input => ({ ...idle(), cmd: c, arg })

function ready(chars: ('chim' | 'magic' | 'cheolmyeon')[], sheets?: ReturnType<typeof emptySheet>[], deathRule: 0 | 1 | 2 = 0) {
  const map = buildMap('crypt', 1, 9)
  const s = createState({ area: 4, seed: 9, chars, noMonsters: true, sheets, deathRule }, map)
  for (let i = 0; i < COUNTDOWN_TICKS + 1; i++) step(s, map, chars.map(idle))
  return { s, map }
}

/** 몬스터 하나를 p 옆에 두고 쓰러뜨린다 (한 방 체력) */
function killNear(s: ReturnType<typeof ready>['s'], map: ReturnType<typeof ready>['map'], by: number, kind = 0): void {
  const p = s.players[by]
  const m = makeMonster(s, kind, p.x + 40, p.y, 900 + s.tick, 0.01)
  m.st = MS_CHASE
  m.cd = 999
  s.monsters.push(m)
  m.hp = 1
  // 직접 쓰러뜨리는 대신 탄 한 발로 — 경로 전체를 탄다
  const aim = 0
  step(s, map, s.players.map((_, i) => (i === by ? { ...idle(), buttons: 1, aim, aimDist: 10 } : idle())))
  for (let t = 0; t < 20 && m.hp > 0; t++) step(s, map, s.players.map(idle))
}

describe('전리품 개편 (2026-09-19 — 희귀·전설은 정예·보스에서만 · 신화 · 옵션 이름 · 강화)', () => {
  it('어디서 나왔나에 따라 등급이 막힌다: 졸개는 일반·마법만 · 정예는 전설까지 · 신화는 우두머리·보스와 도박만', () => {
    const rng = makeRng(11)
    const top = (src: LootSource) => {
      let t = 0
      for (let i = 0; i < 20000; i++) t = Math.max(t, pickRarity(rng, src))
      return t
    }
    expect(top('normal')).toBe(1)
    expect(top('chest')).toBe(1)
    expect(top('elite')).toBe(3)
    expect(top('boss')).toBe(RARITY_MYTHIC)
    // 난이도 보너스는 희귀 이상의 몫만 늘린다
    let rare0 = 0
    let rare1 = 0
    for (let i = 0; i < 20000; i++) {
      if (pickRarity(rng, 'elite') >= 2) rare0++
      if (pickRarity(rng, 'elite', 0.16) >= 2) rare1++
    }
    expect(rare1).toBeGreaterThan(rare0 * 1.5)
  })

  it('이름은 옵션에서 짓는다: 일반 = 바탕 · 마법 = 앞말 + 바탕 · 희귀 = ~의 + 앞말 + 바탕 · 전설 = 「효과」 · 강화 +N', () => {
    const ring = (rarity: number, aff: number[], extra: Partial<Item> = {}): Item => ({ uid: 1, slot: SLOT_RING, wt: -1, rarity, ilvl: 5, aff, bt: 0, ...extra })
    expect(itemName(ring(0, [0, 5]))).toBe('구리 반지')
    expect(itemName(ring(1, [0, 5, 4, 12]))).toBe('치명적인 구리 반지')
    expect(itemName(ring(2, [0, 5, 4, 12, 5, 30]))).toBe('생명의 치명적인 구리 반지')
    expect(itemName(ring(3, [0, 5, 4, 12, 5, 30, 1, 4], { leg: 5 }))).toBe('「광란」 구리 반지')
    expect(itemName(ring(1, [0, 5, 4, 12], { up: 2 }))).toBe('+2 치명적인 구리 반지')
    // 강화는 옵션 값에 단계마다 +10%
    const st = computeStats(1, [null, null, null, ring(1, [0, 10], { up: 2 }), null])
    expect(st[ST_DMG]).toBe(12)
  })

  it('세이브: 신화(옵션 다섯) · 바탕 종류 · 강화 단계가 살아남는다', () => {
    const it: Item = { uid: 7, slot: SLOT_WEAPON, wt: 2, rarity: RARITY_MYTHIC, ilvl: 20, aff: [0, 30, 1, 20, 2, 20, 3, 25, 4, 40], leg: 3, up: 4 }
    const s = sanitizeSheet({ ...emptySheet(), bag: [it, { uid: 8, slot: SLOT_RING, wt: -1, rarity: 2, ilvl: 5, aff: [1, 5], bt: 1 }] })
    expect(s.bag.length).toBe(2)
    expect(s.bag[0].up).toBe(4)
    expect(s.bag[0].rarity).toBe(RARITY_MYTHIC)
    expect(s.bag[1].bt).toBe(1)
  })
})

describe('아이템 굴리기', () => {
  it('같은 시드면 같은 아이템, 무기는 85% 가 내 무기 (스마트 루트)', () => {
    const a = rollItem(makeRng(5), 1, 5, 'rifle')
    const b = rollItem(makeRng(5), 1, 5, 'rifle')
    expect(a).toEqual(b)
    const rng = makeRng(77)
    let weapons = 0
    let mine = 0
    for (let i = 0; i < 4000; i++) {
      const it = rollItem(rng, i, 5, 'shotgun')
      if (it.slot !== SLOT_WEAPON) continue
      weapons++
      if (WEAPON_IDS[it.wt] === 'shotgun') mine++
    }
    expect(mine / weapons).toBeGreaterThan(0.8)
    expect(mine / weapons).toBeLessThan(0.95)
  })

  it('등급이 높을수록 옵션이 많고, 능력치에 더해진다 — 방어구·장신구는 바탕 종류의 기본 옵션 하나가 늘 붙는다', () => {
    const rng = makeRng(3)
    const counts = [0, 0, 0, 0, 0]
    for (let i = 0; i < 6000; i++) {
      const it = rollItem(rng, i, 10, 'rifle', 'boss')
      counts[it.rarity]++
      const n = it.aff.length / 2
      if (it.slot === SLOT_WEAPON) expect(n).toBe([0, 2, 3, 4, 5][it.rarity])
      else {
        // 첫 옵션 = 바탕 종류의 기본 옵션 · 칸마다 붙을 수 있는 옵션 종류가 달라(갑옷은 3종) 모자랄 수 있다
        expect(it.bt).toBeGreaterThanOrEqual(0)
        expect(it.aff[0]).toBe(BASE_TYPES[it.slot][it.bt!].imp)
        expect(n).toBeLessThanOrEqual(it.rarity + 1)
        expect(n).toBeGreaterThanOrEqual(Math.min(it.rarity + 1, 3))
      }
    }
    expect(counts[1]).toBeGreaterThan(counts[3])
    expect(counts[3]).toBeGreaterThan(0)
    expect(counts[RARITY_MYTHIC]).toBeGreaterThan(0)
    const armor: Item = { uid: 1, slot: SLOT_ARMOR, wt: -1, rarity: 1, ilvl: 5, aff: [5, 40] }
    const st = computeStats(3, [null, null, armor, null, null])
    expect(st[ST_HP]).toBe(40 + 2 * 6)
    expect(st[ST_DMG]).toBeCloseTo(2 * 1.5)
  })

  it('깨진 세이브는 걸러진다', () => {
    const s = sanitizeSheet({ level: 999, xp: -5, gold: 'x', equip: [{ uid: 1, slot: 3, rarity: 9 }], bag: new Array(99).fill({ uid: 2, slot: 1, wt: -1, rarity: 1, ilvl: 3, aff: [5, 10] }) })
    expect(s.level).toBe(30)
    expect(s.xp).toBe(0)
    expect(s.gold).toBe(0)
    expect(s.equip.every((e) => e === null)).toBe(true)
    expect(s.bag.length).toBe(BAG_SIZE)
  })
})

describe('전리품 · 성장 (sim)', () => {
  it('쓰러뜨리면 가까운 파티원 모두 경험치·골드를 받고, 전리품은 사람마다 따로 (주인만 줍는다)', () => {
    const { s, map } = ready(['chim', 'magic'])
    const [a, b] = s.players
    b.x = a.x + 60
    b.y = a.y
    // 부푼 시체(2)는 터진다 — 이 시험은 전리품이 목적이라 죽지 않게 (죽어 있으면 줍지 못해 운에 따라 실패했다)
    a.invuln = b.invuln = 1e9
    // 자동 줍기는 끈다 — 선 자리에서 발밑 아이템을 다 주워 버리면 아래의 F 줍기를 볼 수 없다 (자동 줍기는 따로 본다)
    step(s, map, [cmd(CMD_AUTOPICK, 0), cmd(CMD_AUTOPICK, 0)])
    for (let k = 0; k < 60; k++) killNear(s, map, 0, 2)
    expect(a.xpGain).toBeGreaterThan(0)
    expect(b.xpGain).toBe(a.xpGain)
    // 전리품은 사람마다 따로 굴린다: 골드는 각자 자기 몫을 자석(2칸)으로 줍고, 아이템은 각자 몫으로 바닥에 (자동 줍기를 껐다)
    expect(a.goldGain).toBeGreaterThan(0)
    expect(b.goldGain).toBeGreaterThan(0)
    expect(s.drops.some((d) => d.owner === 0 && d.item)).toBe(true)
    expect(s.drops.some((d) => d.owner === 1 && d.item)).toBe(true)
    // 아이템: 자동 줍기를 끄면 F 로 (기본은 밟으면 줍는다 — 아래 자동 줍기 시험)
    expect(a.autoPick).toBe(0)
    const it = s.drops.find((d) => d.owner === 0 && d.item)!
    a.x = it.x
    a.y = it.y
    const bag0 = a.bag.length
    for (let t = 0; t < 20; t++) step(s, map, [idle(), idle()])
    expect(a.bag.length).toBe(bag0)
    step(s, map, [{ ...idle(), buttons: BTN_USE }, idle()])
    expect(a.bag.length).toBe(bag0 + 1)
    // 남의 전리품 위에서 F 를 눌러도 줍지 않는다
    const other = s.drops.find((d) => d.owner === 1 && d.item)
    if (other) {
      a.x = other.x
      a.y = other.y
      step(s, map, [idle(), idle()])
      step(s, map, [{ ...idle(), buttons: BTN_USE }, idle()])
      expect(s.drops.some((d) => d.id === other.id)).toBe(true)
    }
  })

  it('자동 줍기: 기본은 모든 등급 · 켠 등급의 내 아이템만 밟으면 줍는다 — 버려진 것(주인 -1)은 F · 가방이 차면 알린다', () => {
    const { s, map } = ready(['chim'])
    const a = s.players[0]
    expect(a.autoPick).toBe(AUTOPICK_ALL)
    const put = (uid: number, rarity: number, owner: number, dx: number) =>
      s.drops.push({ id: 9000 + uid, owner, x: a.x + dx, y: a.y, item: { uid, slot: SLOT_WEAPON, wt: 0, rarity, ilvl: 3, aff: [] }, gold: 0, pot: 0, ttl: 6000, lock: 0 })
    // 자석: 2칸(64px) 안의 내 아이템 · 골드는 끌려와 줍는다, 그 밖은 그대로 (2026-09-19)
    put(90, 1, 0, 55)
    put(91, 1, 0, 110)
    s.drops.push({ id: 9500, owner: 0, x: a.x, y: a.y - 50, item: null, gold: 30, pot: 0, ttl: 6000, lock: 0 })
    const gold0 = a.gold
    for (let t = 0; t < 30; t++) step(s, map, [idle()])
    expect(a.bag.map((i) => i.uid)).toEqual([90])
    expect(a.gold).toBe(gold0 + 30)
    expect(s.drops.some((d) => d.item?.uid === 91)).toBe(true)
    a.bag.length = 0
    s.drops = s.drops.filter((d) => d.item?.uid !== 91)
    // 희귀 · 전설만 켠다
    step(s, map, [cmd(CMD_AUTOPICK, (1 << 2) | (1 << 3))])
    put(1, 0, 0, 0) // 일반 — 끔
    put(2, 1, 0, 3) // 마법 — 끔
    put(3, 2, 0, -3) // 희귀 — 켬
    put(4, 3, -1, 2) // 전설이지만 버려진 것 — 자동으로는 안 줍는다
    for (let t = 0; t < 5; t++) step(s, map, [idle()])
    expect(a.bag.map((i) => i.uid)).toEqual([3])
    expect(s.drops.filter((d) => d.item).map((d) => d.item!.uid).sort()).toEqual([1, 2, 4])
    // 버려진 것은 F 로 (가장 가까운 것부터)
    s.drops = s.drops.filter((d) => d.item?.uid === 4)
    step(s, map, [{ ...idle(), buttons: BTN_USE }])
    expect(a.bag.some((i) => i.uid === 4)).toBe(true)
    // 가방이 가득이면 줍지 않고 알린다
    while (a.bag.length < BAG_SIZE) a.bag.push({ uid: 100 + a.bag.length, slot: SLOT_WEAPON, wt: 0, rarity: 0, ilvl: 1, aff: [] })
    put(5, 3, 0, 0)
    let warned = false
    for (let t = 0; t < 130; t++) {
      step(s, map, [idle()])
      if (s.events.some((e) => e.type === 'bagFull' && e.p === 0)) warned = true
    }
    expect(warned).toBe(true)
    expect(s.drops.some((d) => d.item?.uid === 5)).toBe(true)
  })

  it('레벨이 오르면 체력이 가득 차고 강해진다', () => {
    const { s, map } = ready(['chim'])
    const p = s.players[0]
    const hp0 = p.maxHp
    p.hp = 10
    p.xp = xpNeed(1) - 1
    killNear(s, map, 0, 0)
    expect(p.level).toBe(2)
    expect(p.maxHp).toBeGreaterThan(hp0)
    expect(p.hp).toBe(p.maxHp)
    expect(s.events.length >= 0).toBe(true)
  })

  it('장착 명령: 무기는 내 무기 종류만 · 끼면 능력치가 바뀐다 · 버리면 동료가 줍는다', () => {
    const sheet = emptySheet()
    const rifle: Item = { uid: 11, slot: SLOT_WEAPON, wt: WEAPON_IDS.indexOf('rifle'), rarity: 2, ilvl: 5, aff: [0, 20] }
    const shotgun: Item = { uid: 12, slot: SLOT_WEAPON, wt: WEAPON_IDS.indexOf('shotgun'), rarity: 2, ilvl: 5, aff: [0, 20] }
    sheet.bag = [shotgun, rifle]
    const { s, map } = ready(['chim', 'magic'], [sheet, emptySheet()])
    const [a, b] = s.players
    const d0 = a.st[ST_DMG]
    step(s, map, [cmd(CMD_EQUIP, 0), idle()]) // 산탄총 — 침착란은 못 낀다
    expect(a.equip[SLOT_WEAPON]).toBeNull()
    step(s, map, [cmd(CMD_EQUIP, 1), idle()]) // 소총
    expect(a.equip[SLOT_WEAPON]?.uid).toBe(11)
    expect(a.st[ST_DMG]).toBeGreaterThan(d0)
    // 버리면 누구나 보이는 것이 되고, 잠시 뒤 동료가 밟으면 줍는다
    step(s, map, [cmd(CMD_DROP, 0), idle()])
    const d = s.drops.find((x) => x.item?.uid === 12)!
    expect(d.owner).toBe(-1)
    b.x = d.x
    b.y = d.y
    for (let t = 0; t < 120; t++) step(s, map, [idle(), idle()])
    step(s, map, [idle(), { ...idle(), buttons: BTN_USE }])
    expect(b.bag.some((it) => it.uid === 12)).toBe(true)
  })

  it('죽음 규칙 "소실": 죽으면 경험치 10% · 골드 20% 를 잃는다', () => {
    const sheet = { ...emptySheet(), level: 3, xp: 200, gold: 100 }
    const { s, map } = ready(['chim'], [sheet], 1)
    const p = s.players[0]
    p.hp = 0
    p.downed = true
    p.downTimer = 1
    for (let t = 0; t < 5; t++) step(s, map, [idle()])
    expect(p.alive).toBe(false)
    expect(p.xp).toBe(200 - Math.round(xpNeed(3) * 0.1))
    expect(p.gold).toBe(80)
  })
})

// 2026-09-24 사용자: "저렙 구간에서도 전설 · 희귀가 너무 쉽게 나온다 — 드랍 확률을 더 낮게"
describe('희귀 이상은 낮은 레벨일수록 드물다', () => {
  it('정예: 아이템 레벨 2 는 희귀 이상 5% 안팎 · 전설 0.5% 안팎 — 레벨 20 은 희귀 이상 12% 안팎', () => {
    const rng = makeRng(21)
    const N = 40000
    const rate = (ilvl: number, min: number) => {
      let n = 0
      for (let i = 0; i < N; i++) if (pickRarity(rng, 'elite', 0, ilvl) >= min) n++
      return n / N
    }
    const low = rate(2, 2)
    const lowLeg = rate(2, 3)
    const high = rate(20, 2)
    expect(low).toBeLessThan(0.07)
    expect(lowLeg).toBeLessThan(0.01)
    expect(high).toBeGreaterThan(0.09)
    expect(high).toBeLessThan(0.15)
    expect(lootLevelMul(1)).toBeCloseTo(0.4)
    expect(lootLevelMul(13)).toBe(1)
  })

  it('도박 · 상점은 레벨로 줄지 않는다 (값을 치른다)', () => {
    const rng = makeRng(22)
    let a = 0
    let b = 0
    for (let i = 0; i < 20000; i++) {
      if (pickRarity(rng, 'gamble', 0, 1) >= 2) a++
      if (pickRarity(rng, 'gamble', 0, 30) >= 2) b++
    }
    expect(Math.abs(a - b) / 20000).toBeLessThan(0.02)
  })
})
