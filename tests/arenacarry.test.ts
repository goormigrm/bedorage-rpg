// 2026-10-25 검토: 던전에서 키운 기록(장비 · 스킬 · 능력치)이 투기장 판 · 다시 하기에 그대로 들어가는가
import { describe, expect, it } from 'vitest'
import { Item, LEG_BLOOD, LEG_FOCUS, SLOT_ARMOR, SLOT_WEAPON, ST_CDR, ST_DMG, ST_HP, WEAPON_IDS, Sheet, emptySheet, sanitizeSheet } from '../src/core/items'
import { buildMap } from '../src/core/map'
import { autoAttr, createState, recalc, step } from '../src/core/sim'
import { COUNTDOWN_TICKS } from '../src/core/state'
import { BTN_FIRE, BTN_SKILL2, Input } from '../src/core/input'
import { atan2A } from '../src/core/fixedmath'
import { playerSheet } from '../src/game/save'

const it0 = (o: Partial<Item> & { slot: number; uid: number }): Item => ({ wt: -1, rarity: 4, ilvl: 30, aff: [], ...o }) as Item
const idle: Input = { mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 }

function richSheet(): Sheet {
  const a = { char: 'chim' as const, level: 30, attr: [0, 0, 0, 0] }
  autoAttr(a)
  return sanitizeSheet({
    ...emptySheet(),
    level: 30,
    equip: [it0({ uid: 11, slot: SLOT_WEAPON, wt: WEAPON_IDS.indexOf('rifle'), rarity: 3, leg: LEG_FOCUS, aff: [ST_DMG, 30] }), null, it0({ uid: 13, slot: SLOT_ARMOR, aff: [ST_HP, 100] }), null, null],
    // 패시브 6(총기 숙련) 7(강인함) 9(정신 집중)
    build: { r: [5, 5, 3, 1, 0, 5, 3, 3, 0, 3], m3: [1, 2, 1, 0, 0, 1, 1, 0, 0, 0], m5: [2, 1, 0, 0, 0, 1, 0, 0, 0, 0], s: [2, 0, 3, 1] },
    attr: a.attr,
    mlv: 20,
    mst: [5, 5, 5, 5],
    quests: Array(32).fill(3),
    wps: 0x3ff,
    potMax: 6,
    bagMax: 40,
    stash: [it0({ uid: 98, slot: SLOT_ARMOR, aff: [ST_HP, 7] })],
  })
}
const arena = (sheets: (Sheet | undefined)[], chars = ['chim', 'magic'] as const, seed = 7) =>
  createState({ seed, chars: [...chars], mode: 'arena', targetKills: 50, sheets }, buildMap('yard', 2, seed))

describe('던전 기록 → 투기장', () => {
  it('판 시작부터 트리 패시브 · 전설 집중이 걸린다 (recalc 값과 같다)', () => {
    const p = arena([richSheet(), undefined]).players[0]
    const q = structuredClone(p)
    recalc(q)
    expect([p.st[ST_DMG], p.st[ST_HP], p.st[ST_CDR], p.maxHp]).toEqual([q.st[ST_DMG], q.st[ST_HP], q.st[ST_CDR], q.maxHp])
    expect(p.hp).toBe(p.maxHp)
  })

  it('다시 하기 기록(playerSheet)으로 만든 판은 빌드 · 능력치 · 숙련 · 퀘스트 · 창고를 잃지 않는다', () => {
    const a = arena([richSheet(), undefined]).players[0]
    const b = arena([playerSheet(a), undefined], undefined, 8).players[0]
    const pick = (p: typeof a) => ({ build: p.build, attr: p.attr, mlv: p.mlv, mst: p.mst, quests: p.quests, wps: p.wps, stash: p.stash.length, potMax: p.potMax, bagMax: p.bagMax, st: p.st, maxHp: p.maxHp })
    expect(pick(b)).toEqual(pick(a))
  })

  it('피의 갈증은 투기장에서 적을 맞혀도 회복한다', () => {
    const sh = sanitizeSheet({ ...emptySheet(), level: 30, equip: [it0({ uid: 1, slot: SLOT_WEAPON, wt: WEAPON_IDS.indexOf('smg'), rarity: 3, leg: LEG_BLOOD }), null, null, null, null] })
    const s = createState({ seed: 7, chars: ['dangun', 'magic'], mode: 'arena', targetKills: 50, sheets: [sh, emptySheet()] }, buildMap('yard', 2, 7))
    const map = buildMap('yard', 2, 7)
    for (let t = 0; t < COUNTDOWN_TICKS + 1; t++) step(s, map, [idle, idle])
    const [p, e] = s.players
    p.hp = 50
    const hp0 = e.hp
    for (let t = 0; t < 40; t++) {
      e.x = p.x + 60
      e.y = p.y
      step(s, map, [{ ...idle, aim: atan2A(e.y - p.y, e.x - p.x), aimDist: 60, buttons: BTN_FIRE }, idle])
    }
    expect(e.hp).toBeLessThan(hp0)
    expect(p.hp).toBeGreaterThan(50)
  })

  it('통천란 덫은 투기장에서 적 플레이어가 밟으면 터진다', () => {
    const map = buildMap('yard', 2, 7)
    const s = createState({ seed: 7, chars: ['tongdak', 'magic'], mode: 'arena', targetKills: 50, sheets: [emptySheet(), emptySheet()] }, map)
    for (let t = 0; t < COUNTDOWN_TICKS + 1; t++) step(s, map, [idle, idle])
    const [p, e] = s.players
    e.x = p.x + 80
    e.y = p.y
    const aim = atan2A(e.y - p.y, e.x - p.x)
    step(s, map, [{ ...idle, aim, aimDist: 80, buttons: BTN_SKILL2 }, idle])
    const traps = () => s.zones.filter((z) => z.kind === 4).length
    expect(traps()).toBe(1)
    const z = s.zones[0]
    const hp0 = e.hp
    // 덫 위로 걸어 들어온다
    for (let t = 0; t < 60; t++) {
      e.x = z.x
      e.y = z.y
      step(s, map, [{ ...idle, aim }, idle])
    }
    expect(traps()).toBe(0)
    expect(e.hp).toBeLessThan(hp0)
  })
})
