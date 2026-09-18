// 정예 접두 능력: 빠름 · 단단함 · 폭발 · 분열 · 흡혈. 층이 깊으면 둘.
import { describe, expect, it } from 'vitest'
import { Input } from '../src/core/input'
import { buildMap, GameMap } from '../src/core/map'
import { affixCount, makeMonster } from '../src/core/dungeon'
import { emptySheet } from '../src/core/items'
import { AFFIX_TUNE, EA_SPLIT, EA_STOUT, EA_UNIQUE, EA_VAMP, EA_VOLATILE } from '../src/core/monsters'
import { createState, step } from '../src/core/sim'
import { COUNTDOWN_TICKS, GameState, MS_CHASE, SimEvent, ZONE_FUSE } from '../src/core/state'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })
const fire = (): Input => ({ ...idle(), buttons: 1, aim: 0, aimDist: 15 })
/** 접두 능력 수 (1 = 정예 표시, 64 = 우두머리 표시는 빼고) */
const bits = (e: number) => {
  let n = 0
  for (let b = (e & ~EA_UNIQUE) >> 1; b; b >>= 1) n += b & 1
  return n
}

/** 혼자 · 카운트다운 끝 · 몬스터 없음 */
function setup(seed = 41): { s: GameState; map: GameMap } {
  const map = buildMap('crypt', 1, seed)
  const s = createState({ area: 4, seed, chars: ['chim'] }, map)
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
  it('지역 레벨이 낮으면 능력 하나, 12 부터 둘, 22 부터 셋', () => {
    expect([1, 11, 12, 21, 22, 30].map(affixCount)).toEqual([1, 1, 2, 2, 3, 3])
    const seed = 42
    const map = buildMap('crypt', 1, seed)
    const low = createState({ area: 4, seed, chars: ['chim'] }, map)
    const e1 = low.monsters.filter((m) => m.elite && !(m.elite & EA_UNIQUE))
    expect(e1.length).toBeGreaterThan(2)
    for (const m of e1) expect(bits(m.elite)).toBe(1)
    // 레벨 15 파티는 1막에서도 지역 레벨이 12 로 따라 올라온다 → 둘
    const high = createState({ area: 4, seed, chars: ['chim'], sheets: [{ ...emptySheet(), level: 15 }] }, map)
    const e2 = high.monsters.filter((m) => m.elite && !(m.elite & EA_UNIQUE))
    for (const m of e2) expect(bits(m.elite)).toBe(2)
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
