// 나머지 여섯 캐릭터의 스킬 (D7): 반사광 · 레드카펫 · 킹의 분노 · 태풍 · 덫 · 앙코르.
import { describe, expect, it } from 'vitest'
import { BTN_DASH, BTN_SKILL1, BTN_SKILL2, BTN_ULT, Input } from '../src/core/input'
import { TILE, TILE_FLOOR, buildMap, GameMap } from '../src/core/map'
import { makeMonster } from '../src/core/dungeon'
import { createState, step } from '../src/core/sim'
import { CharacterId, PLAYABLE } from '../src/core/characters'
import { CHAR_SKILLS, FX_CARPET, FX_REFLECT, TREE_ACTIVE } from '../src/core/skills'
import { COUNTDOWN_TICKS, GameState, MS_CHASE, MS_RECOVER, ZONE_TRAP, ZONE_VORTEX } from '../src/core/state'

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

  it('태풍(풍월): 커서 지점 소용돌이가 괴물을 끌어당기며 친다', () => {
    const { s, map, o } = ready('pungwol')
    const p = s.players[0]
    const m = makeMonster(s, 0, o.x + 6 * TILE + 60, o.y, 1, 1)
    m.hp = m.maxHp = 5000
    m.st = MS_RECOVER
    m.t = 99999
    s.monsters.push(m)
    p.cd[2] = 0
    step(s, map, [press(BTN_ULT, 0, Math.round((6 * TILE) / 4))])
    const z = s.zones.find((q) => q.kind === ZONE_VORTEX)!
    expect(z).toBeTruthy()
    const d0 = Math.hypot(m.x - z.x, m.y - z.y)
    for (let t = 0; t < 90; t++) step(s, map, [idle()])
    expect(Math.hypot(m.x - z.x, m.y - z.y)).toBeLessThan(d0)
    expect(m.hp).toBeLessThan(5000)
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
