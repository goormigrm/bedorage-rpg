// 3막 잠긴 지하도 (D6): 방패병 정면 막기 · 산성 웅덩이 · 강령술사 일으키기 · 관리인 내려찍기·방패병 부르기 · 3막 이동.
import { describe, expect, it } from 'vitest'
import { BTN_FIRE, CMD_QUEST, Input } from '../src/core/input'
import { GameMap, TILE, TILE_FLOOR, buildMap, rayBlocked } from '../src/core/map'
import { GUARD, MONSTER_LIST, RAISE, WARDEN } from '../src/core/monsters'
import { makeMonster } from '../src/core/dungeon'
import { createState, step } from '../src/core/sim'
import { GameState, MS_CHASE, MS_RECOVER, MS_WINDUP, Monster, ZONE_ACID } from '../src/core/state'
import { ACTS, QUESTS, areaDef, buildAreaMap, townNpcs } from '../src/core/world'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })
const kind = (id: string) => MONSTER_LIST.findIndex((d) => d.id === id)

/** 가로로 len 칸, 세 줄이 모두 바닥인 곳의 왼쪽 끝 (타일) */
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

/** 3막 맵 하나에 사람 하나와 몬스터 하나만 — 사람은 왼쪽 끝, 몬스터는 gap 칸 오른쪽 */
function duel(id: string, mapId: 'ruins' | 'sewer' | 'rite', gap: number, seed = 71) {
  const map = buildMap(mapId, 1, seed)
  const s = createState({ area: 22, seed, chars: ['chim'] }, map)
  const { tx, ty } = lane(map, gap + 2)
  const p = s.players[0]
  p.x = (tx + 0.5) * TILE
  p.y = (ty + 0.5) * TILE
  const m = makeMonster(s, kind(id), (tx + 0.5 + gap) * TILE, (ty + 0.5) * TILE, 900, 1, 100, 20)
  m.st = MS_CHASE
  s.monsters.length = 0
  s.monsters.push(m)
  s.monstersTotal = 1
  const run = (n: number, input: (t: number) => Input = () => idle(), each?: (s: GameState) => void) => {
    for (let t = 0; t < n; t++) {
      step(s, map, [input(t)])
      each?.(s)
    }
  }
  return { s, map, p, m, run }
}

describe('3막 잠긴 지하도 (D6)', () => {
  it('방패병: 정면에서 쏜 탄은 방패에 막혀 40% 만 — 등 뒤에서 쏘면 제대로 들어간다', () => {
    const shoot = (facing: number) => {
      const g = duel('shield', 'ruins', 5)
      const m: Monster = g.m
      m.maxHp = m.hp = 5000
      let blocks = 0
      g.run(
        90,
        () => ({ ...idle(), buttons: BTN_FIRE, aim: 0, aimDist: 15 }),
        (s) => {
          // 돌지도 공격하지도 않게 붙잡아 둔다 (방향만 본다)
          m.st = MS_RECOVER
          m.t = 999
          m.aim = facing
          m.x = g.p.x + 5 * TILE
          blocks += s.events.filter((e) => e.type === 'mblock').length
        },
      )
      return { lost: m.maxHp - m.hp, blocks }
    }
    const front = shoot(512) // 사람 쪽(−x)을 본다
    const back = shoot(0) // 등을 보인다
    expect(front.blocks).toBeGreaterThan(0)
    expect(back.blocks).toBe(0)
    expect(back.lost).toBeGreaterThan(front.lost * 2)
    expect(GUARD.mult).toBeLessThan(0.5)
  })

  it('산성 토사꾼: 예고 때 정한 자리(사람 발밑)에 웅덩이 — 서 있으면 계속 다친다', () => {
    const g = duel('spitter', 'sewer', 5)
    g.p.maxHp = g.p.hp = 5000
    let zoneAt = -1
    g.run(240, undefined, (s) => {
      if (zoneAt < 0 && s.zones.some((z) => z.kind === ZONE_ACID)) zoneAt = s.tick
    })
    expect(zoneAt).toBeGreaterThan(0)
    const z = g.s.zones.find((q) => q.kind === ZONE_ACID) ?? null
    // 웅덩이는 사람 발밑 근처에 떨어졌다 (사람은 가만히 있었다)
    if (z) expect(Math.hypot(z.x - g.p.x, z.y - g.p.y)).toBeLessThan(40)
    expect(g.p.hp).toBeLessThan(5000)
  })

  it('강령술사: 곁에 사람이 보이면 구울 둘을 일으킨다 (무리 상한까지)', () => {
    const g = duel('necro', 'rite', 5)
    g.p.invuln = 1e9
    let summoned = false
    g.run(300, undefined, (s) => {
      summoned ||= s.events.some((e) => e.type === 'summon')
      g.p.invuln = 1e9
    })
    expect(summoned).toBe(true)
    const ghouls = g.s.monsters.filter((m) => m.kind === 0 && m.pack === g.m.pack && m.hp > 0)
    expect(ghouls.length).toBeGreaterThanOrEqual(RAISE.n)
    expect(ghouls.length).toBeLessThanOrEqual(RAISE.max)
  })

  it('관리인: 멀면 방패병을 부르고, 가까우면 둘레를 내려찍는다(예고 뒤 원 안의 사람이 다친다)', () => {
    const seed = 72
    const map = buildAreaMap(seed, 27)
    const s = createState({ area: 27, seed, chars: ['chim'] }, map)
    const w = s.monsters.find((m) => MONSTER_LIST[m.kind].special === 'warden')!
    expect(w).toBeTruthy()
    const p = s.players[0]
    p.maxHp = p.hp = 99999
    // 곁의 무리는 치운다 (관리인만 본다)
    for (const m of s.monsters) if (m !== w) m.hp = 0
    const spot = (d: number) => {
      // 관리인에게서 d 떨어진, 막히지 않은 바닥
      for (let k = 0; k < 64; k++) {
        const a = (k / 64) * Math.PI * 2
        const x = w.x + Math.cos(a) * d
        const y = w.y + Math.sin(a) * d
        if (map.tiles[Math.floor(y / TILE) * map.w + Math.floor(x / TILE)] === TILE_FLOOR && !rayBlocked(map, w.x, w.y, x, y)) return { x, y }
      }
      return { x: w.x - d, y: w.y }
    }
    // 멀리: 부르기
    let called = 0
    const far = spot(WARDEN.slamR + 120)
    for (let t = 0; t < 60 * 8 && called === 0; t++) {
      p.x = far.x
      p.y = far.y
      p.invuln = 99
      step(s, map, [idle()])
      if (s.events.some((e) => e.type === 'summon')) called = s.monsters.filter((m) => m.kind === kind('shield') && m.hp > 0).length
    }
    expect(called).toBeGreaterThanOrEqual(WARDEN.guards)
    // 가까이: 내려찍기
    for (const m of s.monsters) if (m !== w) m.hp = 0
    const near = spot(70)
    let slammed = false
    let before = p.hp
    for (let t = 0; t < 60 * 12 && !slammed; t++) {
      p.x = near.x
      p.y = near.y
      p.invuln = 0
      const wasSlam = w.st === MS_WINDUP && w.mode === 2
      before = p.hp
      step(s, map, [idle()])
      if (wasSlam && w.st !== MS_WINDUP) slammed = s.events.some((e) => e.type === 'boom' && e.r === WARDEN.slamR)
      for (const m of s.monsters) if (m !== w) m.hp = 0
    }
    expect(slammed).toBe(true)
    expect(p.hp).toBeLessThan(before)
  })

  it('거미 여왕을 쓰러뜨리면 촌장이 3막 수문 야영지로 보낸다', () => {
    const seed = 73
    const maps = new Map<number, GameMap>()
    const mapOf = (id: number) => maps.get(id) ?? maps.set(id, buildAreaMap(seed, id)).get(id)!
    const s = createState({ seed, chars: ['chim'], area: ACTS[1].town }, mapOf)
    const p = s.players[0]
    p.quests[3] = 3
    const queenQ = QUESTS.findIndex((q) => q.act === 1 && q.goal === 'kill' && q.area === 18)
    p.quests[queenQ] = 2
    const elder = townNpcs(ACTS[1].town).find((n) => n.id === 'elder')!
    p.x = elder.x + 30
    p.y = elder.y
    step(s, mapOf, [{ ...idle(), cmd: CMD_QUEST, arg: 102 }])
    expect(p.area).toBe(ACTS[2].town)
    expect(areaDef(p.area).act).toBe(2)
    expect(s.act).toBe(2)
  })
})
