// 정예 새 능력 (2026-10-08 퀄리티 2차 6단계 F4): 서리 · 화염 · 보호막 · 순간이동
import { describe, expect, it } from 'vitest'
import { BTN_SKILL2, Input } from '../src/core/input'
import { TILE, TILE_FLOOR, buildMap, GameMap } from '../src/core/map'
import { createState, step } from '../src/core/sim'
import { COUNTDOWN_TICKS, GameState, MS_CHASE, ZONE_ACID, ZONE_FUSE } from '../src/core/state'
import { makeMonster } from '../src/core/dungeon'
import { EA_FIRE, EA_FROST, EA_SHIELD, ELITE_AFFIXES, affixNames, shieldUp } from '../src/core/monsters'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })

function ready(seed = 21): { s: GameState; map: GameMap } {
  const map = buildMap('crypt', 1, seed)
  const s = createState({ area: 4, seed, chars: ['magic'], noMonsters: true }, map)
  for (let i = 0; i < COUNTDOWN_TICKS + 1; i++) step(s, map, [idle()])
  search: for (let ty = 6; ty < map.h - 6; ty++) {
    for (let tx = 6; tx < map.w - 6; tx++) {
      let ok = true
      for (let dy = -5; dy <= 5 && ok; dy++) for (let dx = -5; dx <= 5; dx++) if (map.tiles[(ty + dy) * map.w + tx + dx] !== TILE_FLOOR) ok = false
      if (ok) {
        s.players[0].x = tx * TILE + 16
        s.players[0].y = ty * TILE + 16
        break search
      }
    }
  }
  s.players[0].focus = 100
  return { s, map }
}

function elite(s: GameState, bits: number, dx = 70) {
  const p = s.players[0]
  const m = makeMonster(s, 0, p.x + dx, p.y, 960, 10)
  m.elite = 1 | bits
  m.st = MS_CHASE
  m.cd = 9999
  s.monsters.push(m)
  return m
}

describe('정예 새 능력', () => {
  it('아홉 가지 · 이름표에 나온다', () => {
    expect(ELITE_AFFIXES.length).toBe(9)
    expect(affixNames(1 | EA_FROST | EA_SHIELD)).toMatch(/서리/)
  })

  it('보호막: 막이 서 있는 동안은 범위 스킬에 맞아도 다치지 않는다', () => {
    const { s, map } = ready()
    const m = elite(s, EA_SHIELD, 50)
    // 막이 서는 틱까지 기다린다 (틱 · 괴물 번호로 정해진다)
    // (판의 틱은 step 끝에 오른다 — 이번 step 안에서는 지금 틱)
    for (let t = 0; t < 600 && !(shieldUp(s.tick, m) && shieldUp(s.tick + 2, m)); t++) step(s, map, [idle()])
    const hp = m.hp
    step(s, map, [{ ...idle(), buttons: BTN_SKILL2 }])
    expect(m.hp).toBe(hp)
  })

  it('서리: 표적이 가까우면 둘레에 얼음 폭발 예고(‰ 피해 · 느려짐)를 깐다', () => {
    const { s, map } = ready()
    elite(s, EA_FROST)
    let frost = false
    for (let t = 0; t < 500 && !frost; t++) {
      s.players[0].hp = s.players[0].maxHp
      step(s, map, [idle()])
      frost = s.zones.some((z) => z.kind === ZONE_FUSE && (z.pm ?? 0) > 0 && (z.slow ?? 0) > 0)
    }
    expect(frost).toBe(true)
  })

  it('화염: 움직이는 동안 발밑에 불 웅덩이를 남긴다', () => {
    const { s, map } = ready()
    elite(s, EA_FIRE, 260)
    let fire = false
    for (let t = 0; t < 200 && !fire; t++) {
      s.players[0].hp = s.players[0].maxHp
      step(s, map, [idle()])
      fire = s.zones.some((z) => z.kind === ZONE_ACID)
    }
    expect(fire).toBe(true)
  })
})
