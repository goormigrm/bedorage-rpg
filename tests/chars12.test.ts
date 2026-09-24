// 나머지 여섯 캐릭터의 스킬 (D7): 반사광 · 레드카펫 · 킹의 분노 · 훈수 · 꼬꼬꼬 · 켠왕 · 덫 · 앙코르.
import { describe, expect, it } from 'vitest'
import { BTN_DASH, BTN_SKILL1, BTN_SKILL2, BTN_ULT, Input } from '../src/core/input'
import { TILE, TILE_FLOOR, buildMap, GameMap } from '../src/core/map'
import { makeMonster } from '../src/core/dungeon'
import { createState, step } from '../src/core/sim'
import { CharacterId, PLAYABLE } from '../src/core/characters'
import { CHAR_SKILLS, FX_CARPET, FX_KENWANG, FX_REFLECT, TREE_ACTIVE } from '../src/core/skills'
import { COUNTDOWN_TICKS, GameState, MS_CHASE, MS_RECOVER, ZONE_TRAP } from '../src/core/state'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })
const press = (buttons: number, aim = 0, aimDist = 0, mx = 0): Input => ({ ...idle(), buttons, aim, aimDist, mx })

function ready(c: CharacterId, seed = 17): { s: GameState; map: GameMap; o: { x: number; y: number } } {
  const map = buildMap('crypt', 1, seed)
  const s = createState({ area: 4, seed, chars: [c], noMonsters: true }, map)
  for (let i = 0; i < COUNTDOWN_TICKS + 1; i++) step(s, map, [idle()])
  let o = { x: 0, y: 0 }
  search: for (let ty = 4; ty < map.h - 4; ty++) {
    for (let tx = 4; tx < map.w - 16; tx++) {
      let ok = true
      for (let k = -2; k <= 12 && ok; k++) for (let dy = -3; dy <= 3; dy++) if (map.tiles[(ty + dy) * map.w + tx + k] !== TILE_FLOOR) ok = false
      if (ok) {
        o = { x: tx * TILE + 16, y: ty * TILE + 16 }
        break search
      }
    }
  }
  s.players[0].x = o.x
  s.players[0].y = o.y
  s.players[0].focus = 100
  return { s, map, o }
}

/** 때리는 구울 하나 (받는 피해를 재는 시험용) */
function biter(s: GameState, o: { x: number; y: number }) {
  const m = makeMonster(s, 0, o.x + 26, o.y, 1, 1)
  m.hp = m.maxHp = 99999
  m.st = MS_CHASE
  s.monsters.push(m)
  return m
}

/** 구울에게 n 대 맞을 때까지 돌린다. 한 대씩 받은 피해를 돌려준다 */
function takeHits(s: GameState, map: GameMap, p: { hp: number; invuln: number }, n: number): number[] {
  const out: number[] = []
  let prev = p.hp
  for (let t = 0; t < 60 * 30 && out.length < n; t++) {
    p.invuln = 0
    step(s, map, [idle()])
    if (p.hp < prev) {
      out.push(prev - p.hp)
      prev = p.hp
    } else prev = p.hp
  }
  return out
}

function dummy(s: GameState, x: number, y: number, hp = 5000) {
  const m = makeMonster(s, 0, x, y, 1, 1)
  m.hp = m.maxHp = hp
  m.st = MS_RECOVER
  m.t = 99999
  s.monsters.push(m)
  return m
}

describe('나머지 여섯 (D7)', () => {
  it('12명 모두 고를 수 있고, 제 Q·E·R 과 트리 다섯 칸이 있다', () => {
    expect(PLAYABLE.length).toBe(12)
    for (const c of PLAYABLE) {
      expect(TREE_ACTIVE[c]?.length).toBe(5)
      expect(TREE_ACTIVE[c][0]).toBe(CHAR_SKILLS[c][0])
      expect(TREE_ACTIVE[c][1]).toBe(CHAR_SKILLS[c][1])
    }
  })

  it('반사광(주펄): 받는 피해가 줄고, 때린 괴물이 되돌려 받는다', () => {
    const { s, map, o } = ready('jupeol')
    const p = s.players[0]
    const m = makeMonster(s, 0, o.x + 30, o.y, 1, 1)
    m.hp = m.maxHp = 5000
    m.st = MS_CHASE
    s.monsters.push(m)
    step(s, map, [press(BTN_SKILL2)])
    expect(p.fx[FX_REFLECT]).toBeGreaterThan(0)
    const hp0 = p.hp
    for (let t = 0; t < 120 && m.hp === 5000; t++) {
      m.x = o.x + 30
      m.y = o.y
      step(s, map, [idle()])
    }
    expect(m.hp).toBeLessThan(5000)
    expect(hp0 - p.hp).toBeLessThan(m.maxHp - m.hp)
  })

  it('레드카펫(우원): 구를 때마다 주변을 치고 구르기가 줄지 않는다', () => {
    const { s, map, o } = ready('uwon')
    const p = s.players[0]
    const m = dummy(s, o.x + 20, o.y)
    p.cd[2] = 0
    step(s, map, [press(BTN_ULT)])
    expect(p.fx[FX_CARPET]).toBeGreaterThan(0)
    const charges = p.dashCharges
    step(s, map, [press(BTN_DASH, 0, 0, 1)])
    expect(p.dashCharges).toBe(charges)
    expect(m.hp).toBeLessThan(5000)
  })

  it('킹의 분노(기열): 탄이 둘을 꿰뚫는다', () => {
    const { s, map, o } = ready('giyeol')
    const p = s.players[0]
    const a = dummy(s, o.x + 3 * TILE, o.y)
    const b = dummy(s, o.x + 5 * TILE, o.y)
    p.cd[2] = 0
    step(s, map, [press(BTN_ULT)])
    for (let t = 0; t < 40; t++) step(s, map, [press(1, 0, 20)])
    expect(a.hp).toBeLessThan(5000)
    expect(b.hp).toBeLessThan(5000)
  })

  it('고함(기열 — 딜러): 던전에서 앞 6칸을 치고 맞힌 괴물마다 뇌절 한 칸, 도발은 없다', () => {
    const { s, map, o } = ready('giyeol')
    const p = s.players[0]
    const ms = [2, 4, 5.5].map((k) => dummy(s, o.x + k * TILE, o.y))
    p.streak = 0
    p.cd[1] = 0
    step(s, map, [press(BTN_SKILL2)])
    expect(p.streak).toBe(3)
    for (const m of ms) {
      expect(m.hp).toBeLessThan(5000)
      expect(m.taunt).toBe(0)
    }
  })

  // 풍월란 (2026-09-20 바람 → 근성 탱커)
  it('훈수(풍월): 8칸 안 괴물이 나를 노리고 받는 피해가 는다', () => {
    const { s, map, o } = ready('pungwol')
    const p = s.players[0]
    const m = dummy(s, o.x + 5 * TILE, o.y)
    m.target = -1
    p.cd[0] = 0
    step(s, map, [press(BTN_SKILL1)])
    expect(m.target).toBe(p.id)
    expect(m.taunt).toBeGreaterThan(0)
    expect(m.vulnPct).toBeGreaterThanOrEqual(25)
  })

  it('꼬꼬꼬(풍월): 둘러싸여 있으면 때린 수만큼 체력을 회복한다', () => {
    const { s, map, o } = ready('pungwol')
    const p = s.players[0]
    const ms = [[1.5, 0], [-1.5, 0], [0, 1.5]].map(([dx, dy]) => dummy(s, o.x + dx * TILE, o.y + dy * TILE))
    p.hp = Math.round(p.maxHp * 0.4)
    const hp0 = p.hp
    p.cd[1] = 0
    step(s, map, [press(BTN_SKILL2)])
    expect(p.hp).toBeGreaterThan(hp0)
    for (const m of ms) expect(m.hp).toBeLessThan(5000)
  })

  it('켠왕(풍월): 던전에서 쓰러질 만큼 맞아도 한 번은 체력 1 로 버틴다', () => {
    const { s, map, o } = ready('pungwol')
    const p = s.players[0]
    biter(s, o)
    p.cd[2] = 0
    step(s, map, [press(BTN_ULT)])
    expect(p.fx[FX_KENWANG]).toBeGreaterThan(0)
    p.hp = 3
    const hits = takeHits(s, map, p, 1)
    expect(hits.length).toBe(1)
    expect(p.hp).toBe(1)
    expect(p.downed).toBe(false)
    // 한 번 버티면 켠왕은 끝난다
    expect(p.fx[FX_KENWANG]).toBe(0)
  })

  it('근성(풍월 패시브): 맞을수록 받는 피해가 줄고, 잠깐 안 맞으면 식는다', () => {
    const { s, map, o } = ready('pungwol')
    const p = s.players[0]
    p.hp = p.maxHp = 99999
    biter(s, o)
    const hits = takeHits(s, map, p, 6)
    expect(hits.length).toBe(6)
    expect(p.grit).toBeGreaterThan(0)
    expect(hits[hits.length - 1]).toBeLessThan(hits[0])
    // 더 안 맞으면 식는다
    for (const m of s.monsters) m.hp = 0
    for (let t = 0; t < 150; t++) step(s, map, [idle()])
    expect(p.grit).toBe(0)
  })

  it('덫(통천): 괴물이 밟으면 터지고 사라진다', () => {
    const { s, map, o } = ready('tongdak')
    const p = s.players[0]
    step(s, map, [press(BTN_SKILL2, 0, Math.round((5 * TILE) / 4))])
    const z = s.zones.find((q) => q.kind === ZONE_TRAP)!
    expect(z).toBeTruthy()
    const m = makeMonster(s, 0, z.x, z.y, 1, 1)
    m.hp = m.maxHp = 5000
    m.st = MS_RECOVER
    m.t = 99999
    s.monsters.push(m)
    step(s, map, [idle()])
    expect(s.zones.some((q) => q.kind === ZONE_TRAP)).toBe(false)
    expect(m.hp).toBeLessThan(5000)
    expect(m.stun).toBeGreaterThan(0)
    void p
    void o
  })

  it('앙코르(우재): 다른 스킬 대기가 끝나고 집중이 찬다', () => {
    const { s, map } = ready('juwoojae')
    const p = s.players[0]
    step(s, map, [press(BTN_SKILL2, 0, 20)])
    expect(p.cd[1]).toBeGreaterThan(0)
    p.focus = 0
    p.cd[2] = 0
    step(s, map, [press(BTN_ULT)])
    expect(p.cd[1]).toBe(0)
    expect(p.focus).toBe(100)
    void BTN_SKILL1
  })
})
