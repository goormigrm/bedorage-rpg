// 역할 (2026-09-19 사용자 "탱 · 딜 · 힐로 확실히 나눠서") · 근접 캐릭터 둘(철면란 고기 바이올린 · 우재란 장검) · 산탄 하향.
// 역할 효과는 던전에서만 — 투기장은 그대로.
import { describe, expect, it } from 'vitest'
import { CHARACTERS, CHARACTER_LIST, CharacterId } from '../src/core/characters'
import { BTN_FIRE, CMD_EQUIP, Input } from '../src/core/input'
import { TILE, TILE_FLOOR, buildMap, GameMap } from '../src/core/map'
import { makeMonster } from '../src/core/dungeon'
import { createState, step } from '../src/core/sim'
import { COUNTDOWN_TICKS, GameState, MS_CHASE } from '../src/core/state'
import { Item, SLOT_WEAPON, WEAPON_IDS, emptySheet } from '../src/core/items'
import { WEAPONS } from '../src/core/weapons'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })
const fire = (): Input => ({ ...idle(), buttons: BTN_FIRE, aim: 0, aimDist: 30 })

function weaponItem(id: string): Item {
  return { uid: 1, slot: SLOT_WEAPON, rarity: 0, ilvl: 1, wt: WEAPON_IDS.indexOf(id as never), aff: [], price: 1 } as unknown as Item
}

function ready(chars: CharacterId[], mode: 'dungeon' | 'arena' = 'dungeon', bag: Item[][] = []): { s: GameState; map: GameMap; o: { x: number; y: number } } {
  const map = buildMap('crypt', 1, 31)
  const s = createState({ area: 4, seed: 31, chars, mode, noMonsters: true, sheets: chars.map((_, i) => ({ ...emptySheet(), bag: bag[i] ?? [] })) }, map)
  for (let i = 0; i < COUNTDOWN_TICKS + 1; i++) step(s, map, chars.map(() => idle()))
  let o = { x: 0, y: 0 }
  search: for (let ty = 4; ty < map.h - 4; ty++) {
    for (let tx = 4; tx < map.w - 16; tx++) {
      let ok = true
      for (let k = -1; k <= 12 && ok; k++) for (let dy = -2; dy <= 2; dy++) if (map.tiles[(ty + dy) * map.w + tx + k] !== TILE_FLOOR) ok = false
      if (ok) {
        o = { x: tx * TILE + 20, y: ty * TILE + 20 }
        break search
      }
    }
  }
  s.players.forEach((p, i) => {
    p.x = o.x
    p.y = o.y + i * 30
  })
  return { s, map, o }
}

describe('역할 · 근접 캐릭터 (2026-09-19)', () => {
  it('12명 모두 역할이 있고 탱커 · 딜러 · 힐러가 고루 있다', () => {
    const roles = CHARACTER_LIST.map((c) => c.role)
    // 2026-09-19 기열란 탱커 → 딜러, 2026-09-20 풍월란 딜러 → 탱커 (탱 3 · 딜 6 · 힐 3)
    expect(roles.filter((r) => r === 'tank').length).toBe(3)
    expect(roles.filter((r) => r === 'heal').length).toBe(3)
    expect(roles.filter((r) => r === 'dps').length).toBe(6)
    expect(CHARACTERS.cheolmyeon.role).toBe('tank')
    expect(CHARACTERS.seungwoo.role).toBe('tank')
    expect(CHARACTERS.pungwol.role).toBe('tank')
    expect(CHARACTERS.giyeol.role).toBe('dps')
    expect(CHARACTERS.chim.role).toBe('dps')
    expect(CHARACTERS.dangun.role).toBe('dps')
    expect(CHARACTERS.magic.role).toBe('heal')
  })

  it('탱커: 던전에서만 최대 체력 +30% (투기장은 그대로)', () => {
    const d = ready(['cheolmyeon'])
    const a = ready(['cheolmyeon'], 'arena')
    expect(d.s.players[0].maxHp).toBe(Math.round(CHARACTERS.cheolmyeon.maxHp * 1.3))
    expect(a.s.players[0].maxHp).toBe(CHARACTERS.cheolmyeon.maxHp)
  })

  it('철면란 = 고기 바이올린(근접) · 우재란 = 장검(근접) — 옛 기관총 · 소총 아이템은 새 계열로 바뀐다', () => {
    expect(CHARACTERS.cheolmyeon.weapon).toBe('violin')
    expect(CHARACTERS.juwoojae.weapon).toBe('rapier')
    expect(WEAPONS.violin.melee && WEAPONS.rapier.melee).toBe(true)
    // 장검은 바이올린보다 멀리 · 좁게 닿는다
    expect(WEAPONS.rapier.meleeRange!).toBeGreaterThan(WEAPONS.violin.meleeRange!)
    expect(WEAPONS.rapier.meleeArc!).toBeLessThan(WEAPONS.violin.meleeArc!)
    const { s, map } = ready(['cheolmyeon', 'juwoojae'], 'dungeon', [[weaponItem('launcher')], [weaponItem('crossbow')]])
    expect(WEAPON_IDS[s.players[0].bag[0].wt]).toBe('cello')
    expect(WEAPON_IDS[s.players[1].bag[0].wt]).toBe('katana')
    step(s, map, [{ ...idle(), cmd: CMD_EQUIP, arg: 0 }, { ...idle(), cmd: CMD_EQUIP, arg: 0 }])
    expect(s.players[0].weapon).toBe('cello')
    expect(s.players[1].weapon).toBe('katana')
  })

  it('장검: 3칸 앞의 괴물을 찌른다 (후라이팬은 닿지 않는 거리)', () => {
    const { s, map, o } = ready(['juwoojae'])
    const m = makeMonster(s, 0, o.x + 95, o.y, 1, 1)
    m.hp = m.maxHp = 99999
    s.monsters.push(m)
    for (let t = 0; t < 40; t++) step(s, map, [fire()])
    expect(m.hp).toBeLessThan(99999)
  })

  it('딜러는 무기 피해 +20% · 힐러는 -20% (던전) — 스킬 피해에는 곱하지 않는다', () => {
    const hitOnce = (c: CharacterId) => {
      const { s, map, o } = ready([c])
      s.players[0].weapon = 'rifle'
      const m = makeMonster(s, 0, o.x + 4 * TILE, o.y, 1, 1)
      m.hp = m.maxHp = 99999
      s.monsters.push(m)
      for (let t = 0; t < 30 && m.hp === 99999; t++) step(s, map, [fire()])
      return 99999 - m.hp
    }
    const dps = hitOnce('chim')
    const heal = hitOnce('magic')
    const tank = hitOnce('seungwoo') // 뇌절(연속 명중 가산)이 없는 탱커
    expect(dps / tank).toBeCloseTo(1.2, 1)
    expect(heal / tank).toBeCloseTo(0.8, 1)
  })

  it('힐러의 기운: 2초 안에 곁의 동료 체력이 찬다 (던전)', () => {
    const { s, map } = ready(['magic', 'chim'])
    const ally = s.players[1]
    ally.hp = 50
    for (let t = 0; t < 130; t++) step(s, map, [idle(), idle()])
    expect(ally.hp).toBeGreaterThan(50)
  })

  it('탱커는 괴물이 먼저 노린다: 조금 더 멀어도 탱커를 고른다', () => {
    const { s, map, o } = ready(['chim', 'cheolmyeon'])
    const [dps, tank] = s.players
    // 딜러는 왼쪽 100px, 탱커는 오른쪽 150px — 괴물이 탱커 쪽으로 가면 딜러와는 멀어진다
    dps.x = o.x - 100
    dps.y = o.y
    tank.x = o.x + 150
    tank.y = o.y
    const m = makeMonster(s, 0, o.x, o.y, 1, 1)
    m.st = MS_CHASE
    s.monsters.push(m)
    for (let t = 0; t < 40; t++) step(s, map, [idle(), idle()])
    expect(m.target).toBe(tank.id)
  })

  it('산탄총 하향: 한 알 10 · 투기장은 배율로 예전(12 × 1.08)의 ±10% 안', () => {
    expect(WEAPONS.shotgun.damage).toBe(10)
    const now = WEAPONS.shotgun.damage * WEAPONS.shotgun.pvp!
    expect(Math.abs(now - 12 * 1.08) / (12 * 1.08)).toBeLessThan(0.1)
  })
})
