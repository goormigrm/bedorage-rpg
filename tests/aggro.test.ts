// 2026-10-22 사용자: "몹들이 굳이 근처를 안 가더라도 소리를 듣고 다 몰려오게" · "탱커한테 맞으면 몹들이 어그로가 끌려서 공격"
import { describe, expect, it } from 'vitest'
import { BTN_FIRE, Input } from '../src/core/input'
import { GameMap, TILE, TILE_FLOOR, buildMap } from '../src/core/map'
import { MONSTER_LIST } from '../src/core/monsters'
import { makeMonster } from '../src/core/dungeon'
import { createState, step } from '../src/core/sim'
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
})
