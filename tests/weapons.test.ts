// 무기 (2026-09-19): 재장전 없음 · 저격 조준경 없음(관통) · 계열 변형 무기 · 유탄 폭발 · 지속 DPS 범위.
import { describe, expect, it } from 'vitest'
import { BTN_FIRE, CMD_EQUIP, CMD_UNEQUIP, Input } from '../src/core/input'
import { TILE, TILE_FLOOR, buildMap, GameMap } from '../src/core/map'
import { makeMonster } from '../src/core/dungeon'
import { createState, step } from '../src/core/sim'
import { CharacterId } from '../src/core/characters'
import { COUNTDOWN_TICKS, GameState, MS_RECOVER } from '../src/core/state'
import { Item, SLOT_WEAPON, VARIANT_ILVL, WEAPON_IDS, emptySheet, rollItem } from '../src/core/items'
import { WEAPONS, WeaponId, familyOf, weaponDps } from '../src/core/weapons'
import { makeRng } from '../src/core/rng'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })
const fire = (): Input => ({ ...idle(), buttons: BTN_FIRE, aim: 0, aimDist: 30 })
const cmd = (c: number, arg: number): Input => ({ ...idle(), cmd: c, arg })

function ready(c: CharacterId, bag: Item[] = [], seed = 31): { s: GameState; map: GameMap; o: { x: number; y: number } } {
  const map = buildMap('crypt', 1, seed)
  const sheet = { ...emptySheet(), bag }
  const s = createState({ area: 4, seed, chars: [c], noMonsters: true, sheets: [sheet] }, map)
  for (let i = 0; i < COUNTDOWN_TICKS + 1; i++) step(s, map, [idle()])
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
  s.players[0].x = o.x
  s.players[0].y = o.y
  return { s, map, o }
}

function dummy(s: GameState, x: number, y: number) {
  const m = makeMonster(s, 0, x, y, 1, 1)
  m.hp = m.maxHp = 99999
  m.st = MS_RECOVER
  m.t = 99999
  s.monsters.push(m)
  return m
}

const weapon = (id: WeaponId, ilvl = 10): Item => ({ uid: 500 + WEAPON_IDS.indexOf(id), slot: SLOT_WEAPON, wt: WEAPON_IDS.indexOf(id), rarity: 1, ilvl, aff: [] })

describe('무기 (2026-09-19)', () => {
  it('재장전이 없다: 꾹 누르면 발사 간격마다 끝없이 쏜다', () => {
    for (const c of ['cheolmyeon', 'chim', 'oknyang'] as CharacterId[]) {
      const { s, map } = ready(c)
      const p = s.players[0]
      const w = WEAPONS[p.weapon]
      const shots0 = p.shots
      for (let t = 0; t < 600; t++) step(s, map, [fire()])
      const volleys = (p.shots - shots0) / w.pellets
      // 600틱 동안 거의 발사 간격마다 (끊김 없이)
      expect(volleys).toBeGreaterThanOrEqual(Math.floor(600 / w.fireInterval) - 1)
      expect(p.reloadTimer).toBe(0)
    }
  })

  it('저격총: 조준경·한 방·개머리판이 없고, 탄이 하나를 더 꿰뚫는다', () => {
    const w = WEAPONS.sniper
    expect(w.scope ?? false).toBe(false)
    expect(w.lethalAds ?? false).toBe(false)
    expect(w.bash).toBeUndefined()
    const { s, map, o } = ready('oknyang')
    const a = dummy(s, o.x + 3 * TILE, o.y)
    const b = dummy(s, o.x + 5 * TILE, o.y)
    for (let t = 0; t < 30; t++) step(s, map, [fire()])
    expect(a.hp).toBeLessThan(99999)
    expect(b.hp).toBeLessThan(99999)
  })

  it('변형 무기: 같은 계열이면 끼고, 끼면 그 총으로 쏜다 · 벗으면 기본 무기', () => {
    const { s, map } = ready('chim', [weapon('crossbow'), weapon('doublebarrel')])
    const p = s.players[0]
    expect(p.weapon).toBe('rifle')
    step(s, map, [cmd(CMD_EQUIP, 1)]) // 더블배럴 — 소총 캐릭터는 못 낀다
    expect(p.equip[SLOT_WEAPON]).toBeNull()
    step(s, map, [cmd(CMD_EQUIP, 0)]) // 석궁
    expect(p.weapon).toBe('crossbow')
    step(s, map, [cmd(CMD_UNEQUIP, SLOT_WEAPON)])
    expect(p.weapon).toBe('rifle')
  })

  it('유탄발사기: 맞은 자리 둘레의 괴물도 다친다', () => {
    const { s, map, o } = ready('cheolmyeon', [weapon('launcher')])
    step(s, map, [cmd(CMD_EQUIP, 0)])
    expect(s.players[0].weapon).toBe('launcher')
    const a = dummy(s, o.x + 5 * TILE, o.y)
    const side = dummy(s, o.x + 5 * TILE + 10, o.y + 45)
    for (let t = 0; t < 80; t++) step(s, map, [fire()])
    expect(a.hp).toBeLessThan(99999)
    expect(side.hp).toBeLessThan(99999)
  })

  it('변형은 아이템 레벨 6 부터 떨어진다 · 스마트 루트는 내 계열', () => {
    const count = (ilvl: number) => {
      const rng = makeRng(9)
      let fam = 0
      let variant = 0
      let weapons = 0
      for (let i = 0; i < 3000; i++) {
        const it = rollItem(rng, i, ilvl, 'rifle')
        if (it.slot !== SLOT_WEAPON) continue
        weapons++
        const id = WEAPON_IDS[it.wt]
        if (WEAPONS[id].family === 'rifle') fam++
        if (id === 'crossbow') variant++
      }
      return { fam: fam / weapons, variant: variant / weapons }
    }
    expect(count(VARIANT_ILVL - 1).variant).toBeLessThan(0.03)
    expect(count(20).variant).toBeGreaterThan(0.3)
    expect(count(20).fam).toBeGreaterThan(0.8)
  })

  it('밸런스: 모든 무기의 한 마리 지속 DPS 가 1.4~2.6 · 계열마다 기본과 변형', () => {
    for (const id of Object.keys(WEAPONS) as WeaponId[]) {
      const w = WEAPONS[id]
      expect(w.magSize).toBe(0)
      expect(w.reloadTicks).toBe(0)
      expect(weaponDps(w)).toBeGreaterThan(1.4)
      expect(weaponDps(w)).toBeLessThan(2.6)
      expect(familyOf(id).length).toBe(2)
    }
  })
})
