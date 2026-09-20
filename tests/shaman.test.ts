// 버섯 주술사 (2026-09-20 제보): "포자 늪 정예 주술사가 체력 차고 복제 늘어나 4명이 때려도 한 마리가 안 죽는다".
// 원인은 **자기 자신을 고치고 있던 것** — 정예는 체력 배수라 초당 회복이 파티 화력을 넘겼다.
import { describe, expect, it } from 'vitest'
import { Input } from '../src/core/input'
import { GameMap, buildMap } from '../src/core/map'
import { makeMonster, affixSkip } from '../src/core/dungeon'
import { createState, step } from '../src/core/sim'
import { EA_SPLIT, EA_STOUT, ELITE, MONSTER_LIST } from '../src/core/monsters'
import { COUNTDOWN_TICKS, GameState, MS_CHASE } from '../src/core/state'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })
const SHAMAN = MONSTER_LIST.findIndex((d) => d.id === 'shaman')
const GHOUL = MONSTER_LIST.findIndex((d) => d.id === 'ghoul')

function ready(seed = 5): { s: GameState; map: GameMap } {
  const map = buildMap('swamp', 1, seed)
  const s = createState({ area: 14, seed, chars: ['chim'], noMonsters: true }, map)
  for (let i = 0; i < COUNTDOWN_TICKS + 1; i++) step(s, map, [idle()])
  return { s, map }
}

/** 깨어 있는 몬스터 하나 (치유 대상이 되려면 잠들어 있으면 안 된다) */
function awake(s: GameState, kind: number, x: number, y: number, hp: number): ReturnType<typeof makeMonster> {
  const m = makeMonster(s, kind, x, y, 1, 1)
  m.maxHp = 1000
  m.hp = hp
  m.st = MS_CHASE
  m.target = 0
  s.monsters.push(m)
  return m
}

describe('버섯 주술사', () => {
  it('자기 자신은 고치지 못한다 (예전에는 정예가 제 체력을 초당 10% 씩 채워 안 죽었다)', () => {
    const { s, map } = ready()
    const p = s.players[0]
    const sh = awake(s, SHAMAN, p.x + 200, p.y, 300)
    // 고칠 동료가 하나는 있어야 주문을 쓴다
    awake(s, GHOUL, p.x + 220, p.y, 400)
    const hp0 = sh.hp
    for (let t = 0; t < 60 * 20; t++) step(s, map, [idle()])
    expect(sh.hp).toBeLessThanOrEqual(hp0)
  })

  it('다른 주술사도 고치지 못한다 — 둘이 서로 살리는 고리가 없다', () => {
    const { s, map } = ready(6)
    const p = s.players[0]
    const a = awake(s, SHAMAN, p.x + 200, p.y, 300)
    const b = awake(s, SHAMAN, p.x + 240, p.y, 300)
    awake(s, GHOUL, p.x + 220, p.y, 400)
    for (let t = 0; t < 60 * 20; t++) step(s, map, [idle()])
    expect(a.hp).toBeLessThanOrEqual(300)
    expect(b.hp).toBeLessThanOrEqual(300)
  })

  it('다친 동료는 그대로 고친다 (먼저 잡아야 하는 역할은 남는다)', () => {
    const { s, map } = ready(7)
    const p = s.players[0]
    awake(s, SHAMAN, p.x + 200, p.y, 300)
    const g = awake(s, GHOUL, p.x + 220, p.y, 100)
    for (let t = 0; t < 60 * 20; t++) step(s, map, [idle()])
    expect(g.hp).toBeGreaterThan(100)
  })

  it('정예가 되어도 체력은 2.5배까지 · 단단함과 분열은 붙지 않는다', () => {
    expect(MONSTER_LIST[SHAMAN].eliteHp).toBe(2.5)
    expect(MONSTER_LIST[SHAMAN].eliteHp! < ELITE.hp).toBe(true)
    expect(affixSkip(SHAMAN) & EA_STOUT).toBe(EA_STOUT)
    expect(affixSkip(SHAMAN) & EA_SPLIT).toBe(EA_SPLIT)
    // 구울 같은 보통 몬스터는 그대로 다 붙는다
    expect(affixSkip(GHOUL)).toBe(0)
  })
})
