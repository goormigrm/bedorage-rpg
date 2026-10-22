// 2026-10-22 사용자: "몹들이 굳이 근처를 안 가더라도 소리를 듣고 다 몰려오게" · "탱커한테 맞으면 몹들이 어그로가 끌려서 공격"
import { describe, expect, it } from 'vitest'
import { BTN_FIRE, Input } from '../src/core/input'
import { GameMap, TILE, TILE_FLOOR, buildMap } from '../src/core/map'
import { MONSTER_LIST } from '../src/core/monsters'
import { makeMonster } from '../src/core/dungeon'
import { BOSS_CUT_TICKS, RUSH_LEFT, createState, step } from '../src/core/sim'
import { AREAS, areaLayout, buildAreaMap } from '../src/core/world'
import { MS_CHASE, MS_SLEEP } from '../src/core/state'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })

function lane(map: GameMap, len: number): { tx: number; ty: number } {
  for (let ty = 2; ty < map.h - 2; ty++)
    for (let tx = 2; tx < map.w - len - 2; tx++) {
      let ok = true
      for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = 0; dx < len && ok; dx++) if (map.tiles[(ty + dy) * map.w + tx + dx] !== TILE_FLOOR) ok = false
      if (ok) return { tx, ty }
    }
  throw new Error('no lane')
}

const ghoul = MONSTER_LIST.findIndex((d) => d.id === 'ghoul')

describe('괴물 어그로', () => {
  it('탱커(철면란)에게 맞은 괴물은 가까운 딜러를 두고 탱커를 노린다', () => {
    const map = buildMap('ruins', 1, 91)
    const s = createState({ area: 22, seed: 91, chars: ['cheolmyeon', 'chim'] }, map)
    const { tx, ty } = lane(map, 6)
    const [tank, dps] = s.players
    tank.x = (tx + 0.5) * TILE
    tank.y = (ty + 0.5) * TILE
    dps.x = tank.x + 4 * TILE
    dps.y = tank.y
    const m = makeMonster(s, ghoul, tank.x + 48, tank.y, 900, 1, 100, 20)
    m.st = MS_CHASE
    m.maxHp = m.hp = 100000
    m.target = dps.id
    s.monsters.length = 0
    s.monsters.push(m)
    s.monstersTotal = 1
    for (let t = 0; t < 40; t++) step(s, map, [{ ...idle(), buttons: BTN_FIRE, aim: 0, aimDist: 12 }, idle()])
    expect(m.hp).toBeLessThan(m.maxHp)
    expect(m.target).toBe(tank.id)
    expect(m.taunt).toBeGreaterThan(0)
  })

  it('총소리는 12칸 떨어진 잠든 무리도 깨운다 (예전 7칸)', () => {
    const map = buildMap('ruins', 1, 92)
    const s = createState({ area: 22, seed: 92, chars: ['chim'] }, map)
    const { tx, ty } = lane(map, 3)
    const p = s.players[0]
    p.x = (tx + 0.5) * TILE
    p.y = (ty + 0.5) * TILE
    const m = makeMonster(s, ghoul, p.x, p.y + 12 * TILE, 777, 1, 100, 20)
    m.st = MS_SLEEP
    s.monsters.length = 0
    s.monsters.push(m)
    s.monstersTotal = 1
    for (let t = 0; t < 30; t++) step(s, map, [{ ...idle(), buttons: BTN_FIRE, aim: 0 }])
    expect(m.st).not.toBe(MS_SLEEP)
  })

  // 2026-10-22 사용자: "남은 괴물 찾으러 다니는 거 귀찮아 — 25% 이하가 남으면 플레이어에게 몰려들어 공격"
  it('남은 괴물이 25% 이하면 잠든 무리까지 모두 깨어 몰려온다 (그 위에서는 그대로 잔다)', () => {
    const map = buildAreaMap(93, 1)
    const s = createState({ area: 1, seed: 93, chars: ['chim'] }, map)
    const total = s.monstersTotal
    expect(total).toBeGreaterThan(20)
    const asleep = () => s.monsters.filter((m) => m.hp > 0 && m.st === MS_SLEEP).length
    // 30% 남김 — 아직 몰려오지 않는다 (멀리 있는 무리는 잔다)
    s.monsters = s.monsters.slice(0, Math.ceil(total * 0.3))
    for (let t = 0; t < 61; t++) step(s, map, [idle()])
    expect(asleep()).toBeGreaterThan(0)
    expect(s.events.some((e) => e.type === 'rush')).toBe(false)
    // 25% 아래로 — 30틱 안에 모두 깨어 쫓는다
    s.monsters = s.monsters.slice(0, Math.floor(total * RUSH_LEFT) - 1)
    let rushed = false
    for (let t = 0; t < 31; t++) {
      step(s, map, [idle()])
      if (s.events.some((e) => e.type === 'rush')) rushed = true
    }
    expect(rushed).toBe(true)
    expect(asleep()).toBe(0)
  })

  // 2026-10-22 사용자: "보스방에서 보스로 강제 시야 전환될 때 다른 졸개 몬스터들은 정지"
  it('막 보스가 깨는 틱에 등장 장면(bossCut) — 그동안 다른 괴물은 제자리', () => {
    const area = AREAS.find((a) => a.boss !== undefined)!.id
    const map = buildAreaMap(94, area)
    const s = createState({ area, seed: 94, chars: ['chim'] }, map)
    const boss = s.monsters.find((m) => MONSTER_LIST[m.kind].boss)!
    expect(boss.st).toBe(MS_SLEEP)
    const p = s.players[0]
    const spot = areaLayout(area, map).special
    // 보스에게서 8칸 — 총소리(16칸)로 깨운다 · 곁에 깨어 쫓는 졸개 하나
    p.x = spot.x
    p.y = spot.y + 8 * TILE
    const g = makeMonster(s, ghoul, p.x + 6 * TILE, p.y, 555, 1, 100, 20)
    g.st = MS_CHASE
    g.maxHp = g.hp = 100000
    s.monsters.push(g)
    let cut = false
    for (let t = 0; t < 20 && !cut; t++) {
      step(s, map, [{ ...idle(), buttons: BTN_FIRE, aim: 256 }])
      cut = s.events.some((e) => e.type === 'bossCut' && e.m === boss.id)
    }
    expect(cut).toBe(true)
    expect(g.hold).toBeGreaterThan(BOSS_CUT_TICKS - 5)
    const at = { x: g.x, y: g.y }
    for (let t = 0; t < 60; t++) step(s, map, [idle()])
    expect(Math.hypot(g.x - at.x, g.y - at.y)).toBeLessThan(1)
    for (let t = 0; t < BOSS_CUT_TICKS; t++) step(s, map, [idle()])
    expect(Math.hypot(g.x - at.x, g.y - at.y)).toBeGreaterThan(8)
  })
})
