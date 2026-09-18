// 정예 접두 능력: 빠름 · 단단함 · 폭발 · 분열 · 흡혈. 층이 깊으면 둘.
import { describe, expect, it } from 'vitest'
import { Input } from '../src/core/input'
import { buildMap, GameMap } from '../src/core/map'
import { floorSeed, makeMonster } from '../src/core/dungeon'
import { AFFIX_TUNE, EA_SPLIT, EA_STOUT, EA_VAMP, EA_VOLATILE } from '../src/core/monsters'
import { createState, enterFloor, step } from '../src/core/sim'
import { COUNTDOWN_TICKS, GameState, MS_CHASE, SimEvent, ZONE_FUSE } from '../src/core/state'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })
const fire = (): Input => ({ ...idle(), buttons: 1, aim: 0, aimDist: 15 })
const bits = (e: number) => {
  let n = 0
  for (let b = e >> 1; b; b >>= 1) n += b & 1
  return n
}

/** 혼자 · 카운트다운 끝 · 몬스터 없음 */
function setup(seed = 41): { s: GameState; map: GameMap } {
  const map = buildMap('crypt', 1, seed)
  const s = createState({ seed, chars: ['chim'] }, map)
  for (let i = 0; i < COUNTDOWN_TICKS + 1; i++) step(s, map, [idle()])
  s.monsters = []
  s.players[0].invuln = 0
  return { s, map }
}

function addElite(s: GameState, affix: number, dx: number) {
  const p = s.players[0]
  const m = makeMonster(s, 0, p.x + dx, p.y, 500, 1)
  m.elite = 1 | affix
  m.st = MS_CHASE
  m.cd = 999 // 먼저 때리지 않게
  s.monsters.push(m)
  return m
}

function run(s: GameState, map: GameMap, input: Input, ticks: number, until?: (ev: SimEvent[]) => boolean): SimEvent[] {
  const all: SimEvent[] = []
  for (let t = 0; t < ticks; t++) {
    step(s, map, [input])
    all.push(...s.events)
    if (until?.(s.events)) break
  }
  return all
}

describe('정예 접두 능력', () => {
  it('1~2층 정예는 능력 하나, 3층부터 둘', () => {
    const seed = 42
    const map = { m: buildMap('crypt', 1, seed) }
    const s = createState({ seed, chars: ['chim'], floors: 4 }, map.m)
    const e1 = s.monsters.filter((m) => m.elite)
    expect(e1.length).toBeGreaterThan(2)
    for (const m of e1) expect(bits(m.elite)).toBe(1)
    map.m = buildMap('crypt', 1, floorSeed(seed, 3))
    enterFloor(s, map.m, 3, seed)
    const e3 = s.monsters.filter((m) => m.elite)
    expect(e3.length).toBeGreaterThan(2)
    for (const m of e3) expect(bits(m.elite)).toBe(2)
  })

  it('단단함: 같은 한 발에 받는 피해가 0.6배', () => {
    const dmgOf = (affix: number) => {
      const { s, map } = setup()
      const m = addElite(s, affix, 60)
      m.hp = m.maxHp = 100000
      const ev = run(s, map, fire(), 1).concat(run(s, map, idle(), 30))
      return ev.filter((e) => e.type === 'mhit').reduce((a, e) => a + (e.type === 'mhit' ? e.dmg : 0), 0)
    }
    const plain = dmgOf(0)
    const stout = dmgOf(EA_STOUT)
    expect(plain).toBeGreaterThan(0)
    expect(stout).toBe(Math.max(1, Math.round(plain * AFFIX_TUNE.stout)))
  })

  it('폭발: 죽은 자리에 예고 원 → 1초 뒤 터져 가까운 사람이 다친다 (몬스터는 안 다친다)', () => {
    const { s, map } = setup()
    const m = addElite(s, EA_VOLATILE, 50)
    m.hp = 1
    const bystander = addElite(s, 0, -40)
    bystander.hp = bystander.maxHp = 5000
    run(s, map, fire(), 20, (ev) => ev.some((e) => e.type === 'mdeath'))
    const fuse = s.zones.find((z) => z.kind === ZONE_FUSE)
    expect(fuse).toBeTruthy()
    const hp0 = s.players[0].hp
    const ev = run(s, map, idle(), AFFIX_TUNE.fuseTicks + 2)
    expect(ev.some((e) => e.type === 'boom')).toBe(true)
    expect(s.players[0].hp).toBeLessThan(hp0)
    expect(bystander.hp).toBe(5000)
    expect(s.zones.some((z) => z.kind === ZONE_FUSE)).toBe(false)
  })

  it('분열: 죽으면 깨어 있는 구울 셋이 나오고 층 몬스터 수에 더해진다', () => {
    const { s, map } = setup()
    const m = addElite(s, EA_SPLIT, 50)
    m.hp = 1
    const total = s.monstersTotal
    run(s, map, fire(), 20, (ev) => ev.some((e) => e.type === 'mdeath'))
    const kids = s.monsters.filter((q) => q.id !== m.id)
    expect(kids.length).toBe(AFFIX_TUNE.splitN)
    for (const k of kids) {
      expect(k.st).toBe(MS_CHASE)
      expect(k.elite).toBe(0)
      expect(k.maxHp).toBeLessThan(m.maxHp)
    }
    expect(s.monstersTotal).toBe(total + AFFIX_TUNE.splitN)
  })

  it('흡혈: 때린 피해의 절반만큼 회복한다', () => {
    const { s, map } = setup()
    const m = addElite(s, EA_VAMP, 26)
    m.cd = 0
    m.hp = Math.round(m.maxHp / 2)
    s.players[0].hp = s.players[0].maxHp = 5000
    const hp0 = m.hp
    const ev = run(s, map, idle(), 240, (e) => e.some((x) => x.type === 'hurt'))
    const hurt = ev.find((e) => e.type === 'hurt')
    expect(hurt && hurt.type === 'hurt' && hurt.by).toBe(m.id)
    const dmg = hurt && hurt.type === 'hurt' ? hurt.dmg : 0
    expect(m.hp).toBe(Math.min(m.maxHp, hp0 + Math.round(dmg * AFFIX_TUNE.vamp)))
  })
})
