// 4막 심연 (D6): 그림자 순간이동 · 포격 악마 불덩이 · 심연의 군주(분노 단계 · 불꽃 고리 · 불비 · 그림자) · 4막 이동 · 웨이포인트 16비트.
import { describe, expect, it } from 'vitest'
import { CMD_QUEST, Input } from '../src/core/input'
import { GameMap, TILE, TILE_FLOOR, buildMap } from '../src/core/map'
import { BLINK, DEMON_FUSE, MONSTER_LIST } from '../src/core/monsters'
import { makeMonster } from '../src/core/dungeon'
import { createState, step } from '../src/core/sim'
import { GameState, MS_CHASE, ZONE_FUSE } from '../src/core/state'
import { ACTS, AREAS, QUESTS, WAYPOINTS, buildAreaMap, townNpcs } from '../src/core/world'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })
const kind = (id: string) => MONSTER_LIST.findIndex((d) => d.id === id)

function lane(map: GameMap, len: number): { tx: number; ty: number } {
  for (let ty = 2; ty < map.h - 2; ty++) {
    for (let tx = 2; tx < map.w - len - 2; tx++) {
      let ok = true
      for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = 0; dx < len && ok; dx++) if (map.tiles[(ty + dy) * map.w + tx + dx] !== TILE_FLOOR) ok = false
      if (ok) return { tx, ty }
    }
  }
  throw new Error('no lane')
}

function duel(id: string, gap: number, seed = 81) {
  const map = buildMap('maze', 1, seed)
  const s = createState({ area: 31, seed, chars: ['chim'] }, map)
  const { tx, ty } = lane(map, gap + 2)
  const p = s.players[0]
  p.x = (tx + 0.5) * TILE
  p.y = (ty + 0.5) * TILE
  p.maxHp = p.hp = 9999
  const m = makeMonster(s, kind(id), (tx + 0.5 + gap) * TILE, (ty + 0.5) * TILE, 900, 1, 100, 27)
  m.st = MS_CHASE
  s.monsters.length = 0
  s.monsters.push(m)
  s.monstersTotal = 1
  const run = (n: number, each?: (s: GameState) => void) => {
    for (let t = 0; t < n; t++) {
      step(s, map, [idle()])
      each?.(s)
    }
  }
  return { s, map, p, m, run }
}

describe('4막 심연 (D6)', () => {
  it('그림자: 떨어진 표적의 등 뒤로 순간이동한다 (예고 뒤)', () => {
    const g = duel('shade', 6)
    let blink: { x0: number; x: number } | null = null
    g.run(120, (s) => {
      g.p.hp = g.p.maxHp
      const e = s.events.find((q) => q.type === 'blink')
      if (e && e.type === 'blink' && !blink) blink = { x0: e.x0, x: e.x }
    })
    expect(blink).not.toBeNull()
    const b = blink as unknown as { x0: number; x: number }
    // 오른쪽에서 다가오다가 사람(왼쪽)의 왼쪽 등 뒤로 나타났다
    expect(b.x0).toBeGreaterThan(g.p.x)
    expect(b.x).toBeLessThan(g.p.x + 5)
    expect(BLINK.behind).toBeGreaterThan(0)
  })

  it('포격 악마: 떨어질 자리에 폭발 예고(원이 차오른다) → 터진다', () => {
    const g = duel('demon', 7)
    let fuse = false
    let hurt = false
    g.run(300, (s) => {
      fuse ||= s.zones.some((z) => z.kind === ZONE_FUSE && z.max === DEMON_FUSE)
      hurt ||= g.p.hp < g.p.maxHp
    })
    expect(fuse).toBe(true)
    expect(hurt).toBe(true)
  })

  // 심연의 군주 패턴(불꽃 고리 · 불비 · 심연 광선 · 그림자 · 지옥불 · 분노 단계)은 tests/boss.test.ts

  it('관리인을 쓰러뜨리면 촌장이 4막 심연의 문으로 · 웨이포인트는 16비트 안', () => {
    const seed = 83
    const maps = new Map<number, GameMap>()
    const mapOf = (id: number) => maps.get(id) ?? maps.set(id, buildAreaMap(seed, id)).get(id)!
    const s = createState({ seed, chars: ['chim'], area: ACTS[2].town }, mapOf)
    const p = s.players[0]
    for (let i = 0; i < QUESTS.length; i++) if (QUESTS[i].act < 2) p.quests[i] = 3
    p.quests[QUESTS.findIndex((q) => q.act === 2 && q.area === 27)] = 2
    const elder = townNpcs(ACTS[2].town).find((n) => n.id === 'elder')!
    p.x = elder.x + 30
    p.y = elder.y
    step(s, mapOf, [{ ...idle(), cmd: CMD_QUEST, arg: 103 }])
    expect(p.area).toBe(ACTS[3].town)
    expect(WAYPOINTS.length).toBeLessThanOrEqual(16)
    expect(ACTS.length).toBe(4)
    // 막마다 퀘스트 넷, 지역 번호 = 배열 자리
    for (let act = 0; act < 4; act++) expect(QUESTS.filter((q) => q.act === act).length).toBe(4)
    AREAS.forEach((a, i) => expect(a.id).toBe(i))
  })
})
