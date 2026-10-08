// 근접 치명타 · 집중 (2026-10-08 사용자: "근접 공격은 크리티컬이 없어? 에임을 올려놓고 공격해도 발동이 안 한다")
import { describe, expect, it } from 'vitest'
import { BTN_FIRE, Input } from '../src/core/input'
import { GameMap, TILE, TILE_FLOOR, buildMap } from '../src/core/map'
import { MONSTER_LIST } from '../src/core/monsters'
import { makeMonster } from '../src/core/dungeon'
import { createState, step } from '../src/core/sim'
import { MS_CHASE } from '../src/core/state'

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

/** 철면란 하나 · 구울 하나 (오른쪽 1.5칸) — 구울은 움직이지 않게 붙잡아 둔다. aimDist(4px 단위)가 구울 위면 조준선이 금색 */
function swing(aimDist: number) {
  const map = buildMap('ruins', 1, 81)
  const s = createState({ area: 22, seed: 81, chars: ['cheolmyeon'] }, map)
  const { tx, ty } = lane(map, 4)
  const p = s.players[0]
  p.x = (tx + 0.5) * TILE
  p.y = (ty + 0.5) * TILE
  const mx = p.x + 48
  const m = makeMonster(s, MONSTER_LIST.findIndex((d) => d.id === 'ghoul'), mx, p.y, 900, 1, 100, 20)
  m.st = MS_CHASE
  m.maxHp = m.hp = 100000
  s.monsters.length = 0
  s.monsters.push(m)
  s.monstersTotal = 1
  p.focus = 0
  let crit = 0
  let hits = 0
  let dmg = 0
  for (let t = 0; t < 120; t++) {
    step(s, map, [{ ...idle(), buttons: BTN_FIRE, aim: 0, aimDist }])
    m.x = mx
    m.y = p.y
    m.kx = m.ky = 0
    m.cd = 999
    for (const e of s.events)
      if (e.type === 'mhit' && e.m === m.id) {
        hits++
        dmg += e.dmg
        if (e.crit) crit++
      }
  }
  return { crit, hits, dmg, focus: p.focus }
}

describe('근접 치명타', () => {
  it('커서를 괴물 위(금색)에 두고 휘두르면 치명타 · 피해가 크다 — 커서가 비면 보통', () => {
    const on = swing(12)
    const off = swing(0)
    expect(on.hits).toBeGreaterThan(2)
    expect(on.crit).toBe(on.hits)
    expect(off.crit).toBe(0)
    expect(on.dmg / on.hits).toBeGreaterThan((off.dmg / off.hits) * 1.3)
  })
  it('근접으로 맞혀도 집중이 찬다 (치명타면 더)', () => {
    const on = swing(12)
    const off = swing(0)
    expect(off.focus).toBeGreaterThan(2 * 2 + 3)
    expect(on.focus).toBeGreaterThan(off.focus)
  })
})
