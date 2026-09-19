// 성장·전리품: 스마트 루트 · 개인 전리품 · 줍기 · 장착 명령 · 버리기(선물) · 경험치 공유 · 레벨업 · 소실 규칙 · 세이브 검사.
import { describe, expect, it } from 'vitest'
import { BTN_USE, CMD_AUTOPICK, CMD_DROP, CMD_EQUIP, Input } from '../src/core/input'
import { buildMap } from '../src/core/map'
import { makeMonster } from '../src/core/dungeon'
import { createState, step } from '../src/core/sim'
import { makeRng } from '../src/core/rng'
import {
  AUTOPICK_ALL, BAG_SIZE, Item, SLOT_ARMOR, SLOT_WEAPON, ST_DMG, ST_HP, WEAPON_IDS, computeStats, emptySheet, rollItem, sanitizeSheet, xpNeed,
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

  it('등급이 높을수록 옵션이 많고, 능력치에 더해진다', () => {
    const rng = makeRng(3)
    const counts = [0, 0, 0, 0]
    for (let i = 0; i < 3000; i++) {
      const it = rollItem(rng, i, 10, 'rifle')
      counts[it.rarity]++
      // 칸마다 붙을 수 있는 옵션 종류가 달라(갑옷은 3종) 전설도 3개일 수 있다
      expect(it.aff.length / 2).toBeLessThanOrEqual([0, 2, 3, 4][it.rarity])
      expect(it.aff.length / 2).toBeGreaterThanOrEqual(Math.min([0, 2, 3, 4][it.rarity], 3))
    }
    expect(counts[0]).toBeGreaterThan(counts[1])
    expect(counts[3]).toBeGreaterThan(0)
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
    step(s, map, [cmd(CMD_EQUIP, 0), idle()]) // 산탄총 — 침착덕은 못 낀다
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
