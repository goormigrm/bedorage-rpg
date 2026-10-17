// 총잡이 괴물 (2026-10-17 사용자: "몬스터들도 다양한 총을 사용하고 레벨에 맞게 총의 연사속도나 데미지를 조정해서 총쏘는 몬스터를 추가해줘")
import { describe, expect, it } from 'vitest'
import { Input } from '../src/core/input'
import { GameMap, TILE, TILE_FLOOR, buildMap } from '../src/core/map'
import { makeMonster } from '../src/core/dungeon'
import { createState, step } from '../src/core/sim'
import { MONSTER_LIST, gunBurst, gunCooldown, levelPow } from '../src/core/monsters'
import { ACTS } from '../src/core/world'
import { COUNTDOWN_TICKS, GameState, MS_CHASE, MS_RECOVER } from '../src/core/state'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })
const kindOf = (id: string) => MONSTER_LIST.findIndex((d) => d.id === id)
const GUNS = ['gunner', 'hunter', 'trooper', 'sniper'].map(kindOf)

/** 벽 없이 가로로 트인 줄 (사람 · 총잡이를 세운다) */
function lane(map: GameMap, len: number): { tx: number; ty: number } {
  for (let ty = 2; ty < map.h - 2; ty++)
    for (let tx = 2; tx < map.w - len - 2; tx++) {
      let ok = true
      for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = 0; dx < len && ok; dx++) if (map.tiles[(ty + dy) * map.w + tx + dx] !== TILE_FLOOR) ok = false
      if (ok) return { tx, ty }
    }
  throw new Error('no lane')
}

/** 총잡이 하나가 오른쪽 150px 에서 사람을 노린다 — 첫 공격 한 번(예고 → 연발 → 쉼)에 나간 탄 · 쏜 소리 수 */
function volley(id: string, lvl: number): { shots: number; events: number; cd: number; dmg: number } {
  const map = buildMap('ruins', 1, 81)
  const s: GameState = createState({ area: 22, seed: 81, chars: ['chim'], noMonsters: true }, map)
  for (let i = 0; i < COUNTDOWN_TICKS + 1; i++) step(s, map, [idle()])
  const { tx, ty } = lane(map, 6)
  const p = s.players[0]
  p.x = (tx + 0.5) * TILE
  p.y = (ty + 0.5) * TILE
  const m = makeMonster(s, kindOf(id), p.x + 150, p.y, 1, 1, levelPow(lvl), lvl)
  m.st = MS_CHASE
  m.target = 0
  m.los = 1
  s.monsters.push(m)
  s.monstersTotal = 1
  let shots = 0
  let events = 0
  let dmg = 0
  let fired = false
  for (let t = 0; t < 300; t++) {
    p.invuln = 99
    p.hp = p.maxHp
    m.x = p.x + 150
    m.y = p.y
    const before = new Set(s.mshots.map((q) => q.id))
    step(s, map, [idle()])
    for (const q of s.mshots)
      if (!before.has(q.id)) {
        shots++
        dmg = q.dmg
      }
    events += s.events.filter((e) => e.type === 'mshot' && e.m === m.id).length
    if (events > 0) fired = true
    if (fired && m.st === MS_RECOVER) break
  }
  return { shots, events, cd: m.cd, dmg }
}

describe('총잡이 괴물', () => {
  it('넷 모두 총을 들고 원거리로 쏜다 · 막마다 무리 틀에 들어 있다', () => {
    for (const k of GUNS) {
      expect(k).toBeGreaterThan(15)
      expect(MONSTER_LIST[k].attack).toBe('ranged')
      expect(MONSTER_LIST[k].gun).toBeTruthy()
    }
    const inAct = (k: number) => ACTS.findIndex((a) => a.packs.some((pk) => pk.groups.some((g) => g[0] === k)))
    expect(GUNS.map(inAct)).toEqual([0, 1, 2, 3])
    for (const a of ACTS) expect(a.packs.reduce((w, pk) => w + pk.w, 0)).toBeCloseTo(1, 5)
  })

  it('산탄총은 한 번에 다섯 발 · 소총 · 저격총은 한 발', () => {
    expect(volley('hunter', 10).shots).toBe(5)
    expect(volley('gunner', 3).shots).toBe(1)
    expect(volley('sniper', 26).shots).toBe(1)
  })

  it('기관단총은 끊어 쏜다 — 레벨이 오를수록 한 번에 더 많이', () => {
    const lo = volley('trooper', 1)
    const hi = volley('trooper', 25)
    expect(lo.events).toBe(3)
    expect(hi.events).toBe(5)
    expect(hi.events).toBe(gunBurst(MONSTER_LIST[kindOf('trooper')], 25))
    // 소총수도 13레벨부터 두 발
    expect(volley('gunner', 13).events).toBe(2)
  })

  it('레벨이 오르면 연사가 빨라지고(쉬는 틱 ↓) 피해가 세진다', () => {
    const def = MONSTER_LIST[kindOf('sniper')]
    expect(gunCooldown(def, 30)).toBeLessThan(gunCooldown(def, 1) * 0.7)
    const lo = volley('gunner', 1)
    const hi = volley('gunner', 20)
    expect(hi.cd).toBeLessThan(lo.cd)
    expect(hi.dmg).toBeGreaterThan(lo.dmg)
  })
})
