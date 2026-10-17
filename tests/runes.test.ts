// 소켓 · 룬 (2026-10-17 RPG 기능 후보 — 사용자: "권고대로 결정하고 계속 진행")
import { describe, expect, it } from 'vitest'
import { CMD_RUNE, CMD_SELL_ALL, CMD_SOCKET, EMPTY_INPUT } from '../src/core/input'
import {
  Item, RUNES, RUNE_UP, RUNE_UP_N, runeUpPrice, upgradeMaterials, SLOT_AMULET, SLOT_ARMOR, SLOT_HELM, SLOT_RING, SLOT_WEAPON, ST_DMG, ST_HP, computeStats, emptySheet, rollItem, runeFor, sanitizeSheet, socketMax, socketPrice,
} from '../src/core/items'
import { makeRng } from '../src/core/rng'
import { createState, step } from '../src/core/sim'
import { ACTS, buildAreaMap, townNpcs } from '../src/core/world'

describe('떨어질 때 소켓', () => {
  it('무기 · 투구 · 갑옷에만 · 상한 안 · 꽤 자주 (일반 35% 안팎)', () => {
    const rng = makeRng(7)
    let sockets = 0
    let normals = 0
    for (let i = 0; i < 4000; i++) {
      const it = rollItem(rng, 1000 + i, 10, 'rifle', 'normal')
      if (it.so) {
        expect([SLOT_WEAPON, SLOT_HELM, SLOT_ARMOR]).toContain(it.slot)
        expect(it.so).toBeGreaterThanOrEqual(1)
        expect(it.so).toBeLessThanOrEqual(socketMax(it))
      }
      if (it.rarity === 0 && it.slot !== SLOT_RING && it.slot !== SLOT_AMULET) {
        normals++
        if (it.so) sockets++
      }
    }
    expect(sockets / normals).toBeGreaterThan(0.25)
    expect(sockets / normals).toBeLessThan(0.45)
  })
  it('상한: 일반 3 · 희귀 2 · 전설 1 · 투구 2 · 반지 0', () => {
    const base = (slot: number, rarity: number): Item => ({ uid: 1, slot, wt: -1, rarity, ilvl: 10, aff: [] })
    expect(socketMax(base(SLOT_ARMOR, 0))).toBe(3)
    expect(socketMax(base(SLOT_ARMOR, 2))).toBe(2)
    expect(socketMax(base(SLOT_WEAPON, 3))).toBe(1)
    expect(socketMax(base(SLOT_HELM, 0))).toBe(2)
    expect(socketMax(base(SLOT_RING, 0))).toBe(0)
  })
})

describe('룬', () => {
  it('지역 레벨이 낮으면 앞의 룬만', () => {
    for (let r = 0; r < 1; r += 0.05) expect(RUNES[runeFor(1, r)].lv).toBeLessThanOrEqual(1)
    const seen = new Set<number>()
    for (let r = 0; r < 1; r += 0.01) seen.add(runeFor(30, r))
    expect(seen.size).toBe(RUNES.length)
  })
  it('박은 룬은 부위에 맞는 능력이 된다 (무기 = 피해 · 갑옷 = 체력)', () => {
    const w: Item = { uid: 1, slot: SLOT_WEAPON, wt: 0, rarity: 0, ilvl: 5, aff: [], so: 1 }
    const a: Item = { uid: 2, slot: SLOT_ARMOR, wt: -1, rarity: 0, ilvl: 5, aff: [], so: 1 }
    const eq = [w, null, a, null, null]
    const st0 = computeStats(5, eq)
    const st1 = computeStats(5, [{ ...w, rn: [0] }, null, { ...a, rn: [0] }, null, null])
    expect(st1[ST_DMG] - st0[ST_DMG]).toBe(RUNES[0].w[1])
    expect(st1[ST_HP] - st0[ST_HP]).toBe(RUNES[0].a[1])
  })
  it('저장: 룬 주머니 · 소켓을 지킨다 · 소켓보다 많이 박힌 것은 버린다', () => {
    const good: Item = { uid: 3, slot: SLOT_WEAPON, wt: 0, rarity: 0, ilvl: 5, aff: [], so: 2, rn: [1] }
    const bad: Item = { uid: 4, slot: SLOT_ARMOR, wt: -1, rarity: 0, ilvl: 5, aff: [], so: 1, rn: [0, 1] }
    const sh = sanitizeSheet({ ...emptySheet(), runes: [2, 0, 1], bag: [good, bad] })
    expect(sh.runes?.slice(0, 3)).toEqual([2, 0, 1])
    expect(sh.runes?.length).toBe(RUNES.length)
    expect(sh.bag.map((b) => b.uid)).toEqual([3])
  })
})

/** 마을 대장장이 곁에 선 사람 하나 (낀 갑옷 · 골드 · 룬) */
function atSmith(armor: Item, gold: number, runes: number[]) {
  const town = ACTS[0].town
  const map = buildAreaMap(5, town)
  const equip: (Item | null)[] = [null, null, armor, null, null]
  const sheet = sanitizeSheet({ ...emptySheet(), level: 10, gold, equip, runes })
  const s = createState({ area: town, seed: 5, chars: ['chim'], sheets: [sheet] }, () => map)
  const p = s.players[0]
  const smith = townNpcs(town).find((n) => n.id === 'smith')!
  p.x = smith.x
  p.y = smith.y + 20
  return { s, map, p }
}

describe('구멍 뚫기 · 룬 박기 (명령)', () => {
  it('대장장이가 골드로 소켓 하나 · 상한에서 멈춘다', () => {
    const armor: Item = { uid: 9, slot: SLOT_ARMOR, wt: -1, rarity: 2, ilvl: 10, aff: [] }
    const { s, map, p } = atSmith(armor, 100000, [])
    const g0 = p.gold
    const price = socketPrice(p.equip[SLOT_ARMOR]!)
    step(s, map, [{ ...EMPTY_INPUT, cmd: CMD_SOCKET, arg: SLOT_ARMOR }])
    step(s, map, [{ ...EMPTY_INPUT }])
    expect(p.equip[SLOT_ARMOR]!.so).toBe(1)
    expect(p.gold).toBe(g0 - price)
    for (let k = 0; k < 4; k++) {
      step(s, map, [{ ...EMPTY_INPUT, cmd: CMD_SOCKET, arg: SLOT_ARMOR }])
      step(s, map, [{ ...EMPTY_INPUT }])
    }
    expect(p.equip[SLOT_ARMOR]!.so).toBe(2) // 희귀 상한
  })
  it('룬 주머니의 룬을 빈 소켓에 — 소켓이 차면 더 박히지 않는다', () => {
    const armor: Item = { uid: 9, slot: SLOT_ARMOR, wt: -1, rarity: 0, ilvl: 10, aff: [], so: 1 }
    const { s, map, p } = atSmith(armor, 0, [3])
    const hp0 = p.st[ST_HP]
    step(s, map, [{ ...EMPTY_INPUT, cmd: CMD_RUNE, arg: SLOT_ARMOR * 8 + 0 }])
    step(s, map, [{ ...EMPTY_INPUT }])
    expect(p.equip[SLOT_ARMOR]!.rn).toEqual([0])
    expect(p.runes[0]).toBe(2)
    expect(p.st[ST_HP] - hp0).toBe(RUNES[0].a[1])
    expect(s.events.length).toBeGreaterThanOrEqual(0)
    step(s, map, [{ ...EMPTY_INPUT, cmd: CMD_RUNE, arg: SLOT_ARMOR * 8 + 0 }])
    step(s, map, [{ ...EMPTY_INPUT }])
    expect(p.equip[SLOT_ARMOR]!.rn).toEqual([0])
    expect(p.runes[0]).toBe(2)
  })
  it('대장장이 룬 합치기: 같은 룬 셋 → 다음 룬 하나 · 골드', () => {
    const armor: Item = { uid: 9, slot: SLOT_ARMOR, wt: -1, rarity: 0, ilvl: 10, aff: [] }
    const { s, map, p } = atSmith(armor, 1000, [RUNE_UP_N + 1])
    step(s, map, [{ ...EMPTY_INPUT, cmd: CMD_RUNE, arg: RUNE_UP + 0 }])
    step(s, map, [{ ...EMPTY_INPUT }])
    expect(p.runes.slice(0, 2)).toEqual([1, 1])
    expect(p.gold).toBe(1000 - runeUpPrice(0))
    // 셋이 안 되면 그대로 · 마지막 룬은 합칠 수 없다
    step(s, map, [{ ...EMPTY_INPUT, cmd: CMD_RUNE, arg: RUNE_UP + 0 }])
    step(s, map, [{ ...EMPTY_INPUT, cmd: CMD_RUNE, arg: RUNE_UP + RUNES.length - 1 }])
    step(s, map, [{ ...EMPTY_INPUT }])
    expect(p.runes.slice(0, 2)).toEqual([1, 1])
  })
  it('바닥의 룬을 주우면 주머니로 (가방 칸을 차지하지 않는다)', () => {
    const armor: Item = { uid: 9, slot: SLOT_ARMOR, wt: -1, rarity: 0, ilvl: 10, aff: [] }
    const { s, map, p } = atSmith(armor, 0, [])
    s.drops.push({ id: s.nextDropId++, owner: p.id, x: p.x + 4, y: p.y, item: null, gold: 0, pot: 0, rn: 2, ttl: 600, lock: 0 })
    const bag0 = p.bag.length
    let got = false
    for (let t = 0; t < 30 && !got; t++) {
      step(s, map, [{ ...EMPTY_INPUT }])
      got = s.events.some((e) => e.type === 'runeGet' && e.r === 2)
    }
    expect(got).toBe(true)
    expect(p.runes[2]).toBe(1)
    expect(p.bag.length).toBe(bag0)
  })
})

describe('룬이 박힌 것은 잃지 않게', () => {
  it('한꺼번에 팔기 · 강화 재료에서 빠진다', () => {
    const armor: Item = { uid: 9, slot: SLOT_ARMOR, wt: -1, rarity: 0, ilvl: 10, aff: [] }
    const { s, map, p } = atSmith(armor, 0, [])
    const merchant = townNpcs(ACTS[0].town).find((n) => n.id === 'merchant')!
    p.x = merchant.x
    p.y = merchant.y + 20
    const plain: Item = { uid: 21, slot: SLOT_ARMOR, wt: -1, rarity: 0, ilvl: 10, aff: [] }
    const runed: Item = { uid: 22, slot: SLOT_ARMOR, wt: -1, rarity: 0, ilvl: 10, aff: [], so: 1, rn: [0] }
    expect(upgradeMaterials([plain, runed], [], { ...armor, uid: 99 }).length).toBe(1)
    p.bag = [plain, runed]
    step(s, map, [{ ...EMPTY_INPUT, cmd: CMD_SELL_ALL, arg: 1 }])
    step(s, map, [{ ...EMPTY_INPUT }])
    expect(p.bag.map((b) => b.uid)).toEqual([22])
  })
})
