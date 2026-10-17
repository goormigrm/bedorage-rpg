// 던전 구조물 = 모래주머니 (2026-10-17 사용자: "벽이 아닌 구조물은 모양은 그대로지만 모래주머니처럼 — 가까이 붙어 있으면 나는 안 맞고 상대를 쏠 수 있고,
// 멀리서 쏘면 부서지다가 없어지고, 헤드샷이면 통과")
import { describe, expect, it } from 'vitest'
import { BTN_FIRE, Input } from '../src/core/input'
import { GameMap, TILE, TILE_CRATE, TILE_FLOOR, buildMap, nearSandbag, rayCast } from '../src/core/map'
import { makeMonster } from '../src/core/dungeon'
import { createState, step } from '../src/core/sim'
import { MONSTER_LIST, levelPow } from '../src/core/monsters'
import { buildAreaMap } from '../src/core/world'
import { COUNTDOWN_TICKS, GameState, MS_CHASE } from '../src/core/state'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })
const shoot = (): Input => ({ ...idle(), buttons: BTN_FIRE })

/** 가로로 트인 줄 끝(오른쪽)에 구조물 한 칸 — 사람은 줄 왼쪽 끝에서 오른쪽을 본다 */
function range(cover: boolean): { map: GameMap; s: GameState; crate: number; tx: number; ty: number } {
  const map = buildMap('ruins', 1, 81)
  const len = 12
  let at: { tx: number; ty: number } | null = null
  for (let ty = 2; ty < map.h - 2 && !at; ty++)
    for (let tx = 2; tx < map.w - len - 2 && !at; tx++) {
      let ok = true
      for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = 0; dx < len && ok; dx++) if (map.tiles[(ty + dy) * map.w + tx + dx] !== TILE_FLOOR) ok = false
      if (ok) at = { tx, ty }
    }
  if (!at) throw new Error('no lane')
  const crate = at.ty * map.w + at.tx + len - 1
  map.tiles[crate] = TILE_CRATE
  if (cover) map.crateIdx = [crate]
  const s = createState({ area: 22, seed: 81, chars: ['chim'], noMonsters: true }, map)
  for (let i = 0; i < COUNTDOWN_TICKS + 1; i++) step(s, map, [idle()])
  return { map, s, crate, ...at }
}

function fire(s: GameState, map: GameMap, ticks: number): boolean {
  let broke = false
  for (let t = 0; t < ticks && !broke; t++) {
    s.players[0].aim = 0
    step(s, map, [shoot()])
    broke = s.events.some((e) => e.type === 'break')
  }
  return broke
}

describe('던전 구조물 = 모래주머니', () => {
  it('멀리서 쏘면 깎이다 부서져 바닥이 된다', () => {
    const { map, s, crate, tx, ty } = range(true)
    s.players[0].x = (tx + 0.5) * TILE
    s.players[0].y = (ty + 0.5) * TILE
    for (let t = 0; t < 30; t++) step(s, map, [shoot()])
    expect(s.cover?.[s.players[0].area]?.[crate]).toBeLessThan(1000) // 깎였다
    expect(map.tiles[crate]).toBe(TILE_CRATE) // 아직 서 있다
    expect(fire(s, map, 3000)).toBe(true)
    expect(map.tiles[crate]).toBe(TILE_FLOOR)
    expect(s.cover?.[s.players[0].area]?.[crate]).toBe(0)
  })

  it('붙어서 쏘면 내 탄은 넘어가고 구조물은 멀쩡하다', () => {
    const { map, s, crate } = range(true)
    const cx = (crate % map.w) * TILE
    s.players[0].x = cx - 20 // 구조물 가장자리에서 20px (엄폐 거리 28 안)
    s.players[0].y = (Math.floor(crate / map.w) + 0.5) * TILE
    expect(nearSandbag(map, s.players[0].x, s.players[0].y)).toBe(true)
    fire(s, map, 200)
    expect(s.cover?.[s.players[0].area]?.[crate]).toBeUndefined()
    expect(map.tiles[crate]).toBe(TILE_CRATE)
  })

  it('헤드샷(약점 조준) 탄은 넘어간다 · 투기장 상자는 예전처럼 늘 막는다', () => {
    const { map, crate } = range(true)
    const y = (Math.floor(crate / map.w) + 0.5) * TILE
    const x0 = (crate % map.w) * TILE - 200
    const x1 = (crate % map.w) * TILE + 60
    expect(rayCast(map, x0, y, x1, y, 'bullet', false).blocked).toBe(true)
    expect(rayCast(map, x0, y, x1, y, 'bullet', true).blocked).toBe(false)
    delete map.crateIdx
    expect(rayCast(map, x0, y, x1, y, 'bullet', true).blocked).toBe(true)
    expect(nearSandbag(map, x1 - 70, y)).toBe(false)
  })

  it('투기장 · 마을처럼 구조물이 꺼진 맵에서는 쏴도 부서지지 않는다', () => {
    const { map, s, crate, tx, ty } = range(false)
    s.players[0].x = (tx + 0.5) * TILE
    s.players[0].y = (ty + 0.5) * TILE
    expect(fire(s, map, 600)).toBe(false)
    expect(map.tiles[crate]).toBe(TILE_CRATE)
    expect(s.cover).toBeUndefined()
  })

  it('괴물 탄도 구조물을 깎는다', () => {
    const { map, s, crate } = range(true)
    const y = (Math.floor(crate / map.w) + 0.5) * TILE
    const p = s.players[0]
    p.x = (crate % map.w) * TILE - 150
    p.y = y
    const m = makeMonster(s, MONSTER_LIST.findIndex((d) => d.id === 'gunner'), (crate % map.w) * TILE + 120, y, 1, 1, levelPow(20), 20)
    m.st = MS_CHASE
    m.target = 0
    m.los = 1
    s.monsters.push(m)
    s.monstersTotal = 1
    for (let t = 0; t < 400 && !s.cover; t++) {
      p.invuln = 99
      p.hp = p.maxHp
      m.x = (crate % map.w) * TILE + 120
      m.y = y
      step(s, map, [idle()])
    }
    expect(s.cover?.[p.area]?.[crate]).toBeLessThan(1000)
  })

  it('맵을 새로 만들어도(재접속 · 리싱크) 부서진 구조물은 판대로 바닥', () => {
    const { map, s, crate, tx, ty } = range(true)
    s.players[0].x = (tx + 0.5) * TILE
    s.players[0].y = (ty + 0.5) * TILE
    expect(fire(s, map, 3000)).toBe(true)
    map.tiles[crate] = TILE_CRATE // 시드로 다시 만든 맵처럼
    step(s, map, [idle()])
    expect(map.tiles[crate]).toBe(TILE_FLOOR)
  })

  it('던전 지역 맵은 구조물이 켜져 있고 마을은 꺼져 있다', () => {
    expect(buildAreaMap(81, 0).crateIdx).toBeUndefined() // 1막 마을
    const dungeon = [1, 2, 3, 4, 5, 6].map((a) => buildAreaMap(81, a)).find((m) => (m.crateIdx?.length ?? 0) > 0)
    expect(dungeon).toBeDefined()
    for (const i of dungeon!.crateIdx!) expect(dungeon!.tiles[i]).toBe(TILE_CRATE)
  })
})
