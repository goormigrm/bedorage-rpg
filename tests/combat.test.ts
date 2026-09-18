// 전투 규칙: 치명타(약점) · 쓰러짐과 부활 · 혼자일 때 쓰러짐 · 총소리가 무리를 깨움(소음기 예외) · 회복 구슬.
import { describe, expect, it } from 'vitest'
import { radToAngle } from '../src/core/fixedmath'
import { BTN_FIRE, BTN_USE, Input } from '../src/core/input'
import { TILE, TILE_FLOOR, buildMap, GameMap } from '../src/core/map'
import { makeMonster } from '../src/core/dungeon'
import { createState, step } from '../src/core/sim'
import { CharacterId } from '../src/core/characters'
import { COUNTDOWN_TICKS, GameState, MS_CHASE, MS_SLEEP, REVIVE_TICKS, SOLO_BLEED_TICKS } from '../src/core/state'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })

/** 몬스터 없는 판 + 카운트다운 끝 */
function arena(chars: CharacterId[], seed = 7): { s: GameState; map: GameMap } {
  const map = buildMap('crypt', 1, seed)
  const s = createState({ seed, chars, noMonsters: true }, map)
  for (let i = 0; i < COUNTDOWN_TICKS + 1; i++) step(s, map, chars.map(idle))
  return { s, map }
}

/** (x,y) 에서 오른쪽으로 n 칸이 비어 있는 곳 */
function openRow(map: GameMap, n: number): { x: number; y: number } {
  for (let ty = 3; ty < map.h - 3; ty++) {
    for (let tx = 3; tx < map.w - n - 3; tx++) {
      let ok = true
      for (let k = -1; k <= n && ok; k++) for (let dy = -1; dy <= 1; dy++) if (map.tiles[(ty + dy) * map.w + tx + k] !== TILE_FLOOR) ok = false
      if (ok) return { x: tx * TILE + 16, y: ty * TILE + 16 }
    }
  }
  throw new Error('빈 줄이 없다')
}

describe('치명타 (약점)', () => {
  it('커서가 약점 위면 치명타, 비껴 있으면 보통', () => {
    for (const aimOnWeak of [true, false]) {
      const { s, map } = arena(['chim'])
      const p = s.players[0]
      const o = openRow(map, 8)
      p.x = o.x
      p.y = o.y
      const m = makeMonster(s, 0, o.x + 6 * TILE, o.y, 99, 10) // 체력 넉넉히
      m.st = MS_CHASE
      m.cd = 9999
      s.monsters.push(m)
      const dist = m.x - p.x
      const input: Input = { mx: 0, my: 0, aim: radToAngle(0), buttons: BTN_FIRE, char: 0, aimDist: Math.round((aimOnWeak ? dist : dist + 30) / 4) }
      let crit = 0
      let hit = 0
      for (let t = 0; t < 40; t++) {
        step(s, map, [input])
        for (const e of s.events) if (e.type === 'mhit') {
          hit++
          if (e.crit) crit++
        }
        m.x = o.x + 6 * TILE // 넉백으로 밀려도 제자리
        m.y = o.y
      }
      expect(hit).toBeGreaterThan(0)
      if (aimOnWeak) expect(crit).toBe(hit)
      else expect(crit).toBe(0)
    }
  })
})

describe('쓰러짐 · 부활', () => {
  it('체력 0 이면 쓰러지고, 동료가 곁에서 F 를 누르면 일어난다', () => {
    const { s, map } = arena(['chim', 'magic'])
    const [a, b] = s.players
    b.x = a.x + 30
    b.y = a.y
    a.invuln = 0
    // 몬스터 한 마리가 계속 때리게 하는 대신 직접 체력을 깎고 한 번 맞게 한다
    const m = makeMonster(s, 0, a.x - 30, a.y, 99, 1)
    m.st = MS_CHASE
    m.target = 0
    s.monsters.push(m)
    a.hp = 5
    let downed = false
    for (let t = 0; t < 120 && !downed; t++) {
      step(s, map, [idle(), idle()])
      downed = a.downed
    }
    expect(downed).toBe(true)
    s.monsters.length = 0
    const help: Input = { ...idle(), buttons: BTN_USE }
    for (let t = 0; t < REVIVE_TICKS + 2; t++) step(s, map, [idle(), help])
    expect(a.downed).toBe(false)
    expect(a.alive).toBe(true)
    expect(a.hp).toBeGreaterThan(0)
    expect(b.revives).toBe(1)
  })

  it('혼자면 금방 숨이 끊기고, 입구에서 다시 일어난다 (죽음 규칙 없음)', () => {
    const { s, map } = arena(['chim'])
    const p = s.players[0]
    p.hp = 0
    p.downed = true
    p.downTimer = 60 * 12
    let died = -1
    let back = -1
    for (let t = 0; t < 600; t++) {
      step(s, map, [idle()])
      for (const e of s.events) {
        if (e.type === 'death' && died < 0) died = t
        if (e.type === 'respawn' && back < 0) back = t
      }
    }
    expect(died).toBeGreaterThanOrEqual(0)
    expect(died).toBeLessThanOrEqual(SOLO_BLEED_TICKS + 2)
    expect(back).toBeGreaterThan(died)
    expect(Math.hypot(p.x - s.entryX, p.y - s.entryY)).toBeLessThan(3 * TILE)
  })

  it('하드코어: 죽으면 탈락, 모두 탈락하면 전멸', () => {
    const map = buildMap('crypt', 1, 4)
    const s = createState({ seed: 4, chars: ['chim'], deathRule: 2 }, map)
    for (let i = 0; i < COUNTDOWN_TICKS + 1; i++) step(s, map, [idle()])
    s.players[0].hp = 0
    s.players[0].downed = true
    s.players[0].downTimer = 1
    for (let t = 0; t < 400; t++) step(s, map, [idle()])
    expect(s.players[0].out).toBe(true)
    expect(s.players[0].alive).toBe(false)
    expect(s.phase).toBe('over')
    expect(s.winner).toBe(1)
  })
})

describe('총소리', () => {
  it('총을 쏘면 근처 잠든 무리가 벽 너머에서도 깬다 — 소음기 권총은 안 깨운다', () => {
    for (const [char, wakes] of [['chim', true], ['dangun', false]] as const) {
      const { s, map } = arena([char])
      const p = s.players[0]
      // 뒤쪽 5칸에 잠든 무리 (시야·거리로는 안 깬다 — 등 뒤 · 11칸 밖이 아니어도 소리 때문에만 깨는지 보려고 벽 너머 효과는 시야 판정이 막게 둔다)
      const m = makeMonster(s, 0, p.x, p.y, 42, 1)
      m.x = p.x - 5 * TILE
      m.y = p.y
      m.st = MS_SLEEP
      s.monsters.push(m)
      // 시야로 깨는 것을 막으려고 몬스터의 무리 확인 주기를 넘기지 않게 한 틱만 쏜다
      const fire: Input = { ...idle(), buttons: BTN_FIRE, aim: radToAngle(0) }
      step(s, map, [fire])
      expect(m.st !== MS_SLEEP).toBe(wakes)
    }
  })
})

describe('회복 구슬', () => {
  it('밟으면 회복하고, 가까운 동료도 조금 받는다', () => {
    const { s, map } = arena(['chim', 'magic'])
    const [a, b] = s.players
    b.x = a.x + 60
    b.y = a.y
    a.hp = 50
    b.hp = 50
    s.globes.push({ id: 1, x: a.x, y: a.y, ttl: 600 })
    step(s, map, [idle(), idle()])
    expect(s.globes.length).toBe(0)
    expect(a.hp).toBeGreaterThan(50 + a.maxHp * 0.2)
    expect(b.hp).toBeGreaterThan(50)
    expect(b.hp - 50).toBeLessThan(a.hp - 50)
  })
})
