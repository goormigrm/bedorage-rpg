// 3막 잠긴 지하도 (D6): 방패병 정면 막기 · 산성 웅덩이 · 강령술사 일으키기 · 3막 이동 (관리인 패턴은 boss.test.ts).
import { describe, expect, it } from 'vitest'
import { BTN_FIRE, BTN_SKILL2, CMD_QUEST, Input } from '../src/core/input'
import { GameMap, TILE, TILE_FLOOR, buildMap } from '../src/core/map'
import { GUARD, MONSTER_LIST, RAISE, TIERS } from '../src/core/monsters'
import { makeMonster } from '../src/core/dungeon'
import { CharacterId } from '../src/core/characters'
import { createState, step } from '../src/core/sim'
import { GameState, MS_CHASE, MS_RECOVER, Monster, ZONE_ACID } from '../src/core/state'
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
function duel(id: string, mapId: 'ruins' | 'sewer' | 'rite', gap: number, seed = 71, char: CharacterId = 'chim') {
  const map = buildMap(mapId, 1, seed)
  const s = createState({ area: 22, seed, chars: [char] }, map)
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
  it('방패병: 정면에서 쏜 탄은 방패에 막혀 일부만(보통 60% · 악몽·지옥 40%) — 등 뒤에서 쏘면 제대로 들어간다', () => {
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
    // 보통 판: 정면은 TIERS[0].guard(0.6)만 들어간다 (2026-09-19 보통을 쉽게 — 악몽·지옥은 GUARD.mult 0.4)
    expect(back.lost).toBeGreaterThan(front.lost * 1.5)
    expect(Math.abs(front.lost / back.lost - TIERS[0].guard)).toBeLessThan(0.1)
    expect(GUARD.mult).toBeLessThan(0.5)
    expect(TIERS[1].guard).toBe(GUARD.mult)
  })

  it('관통 저격(옥냥란 E)은 던전에서 방패를 뚫는다 — 막히지 않고 제 피해가 들어간다', () => {
    const g = duel('shield', 'ruins', 5, 71, 'oknyang')
    const m: Monster = g.m
    m.maxHp = m.hp = 5000
    g.p.cd[1] = 0
    g.p.focus = 100
    let blocks = 0
    g.run(
      40,
      (t) => ({ ...idle(), buttons: t < 2 ? BTN_SKILL2 : 0, aim: 0, aimDist: 15 }),
      (s) => {
        m.st = MS_RECOVER
        m.t = 999
        m.aim = 512 // 사람 쪽(−x)을 본다 — 방패 정면
        m.x = g.p.x + 5 * TILE
        blocks += s.events.filter((e) => e.type === 'mblock').length
      },
    )
    expect(g.p.cd[1]).toBeGreaterThan(0)
    expect(blocks).toBe(0)
    expect(m.maxHp - m.hp).toBeGreaterThan(200)
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

  // 관리인 패턴(앞뒤 휘두르기 · 내려찍기 · 충격파 십자 · 방패병 · 여진)은 tests/boss.test.ts

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
