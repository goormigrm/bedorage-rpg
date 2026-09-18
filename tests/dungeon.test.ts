// 던전 층: 배치 · 결정론 · 봇 파티가 실제로 층을 정리해 나가는지 · 틱 비용.
import { describe, expect, it } from 'vitest'
import { botInput, makeBot } from '../src/core/bot'
import { CharacterId } from '../src/core/characters'
import { Input } from '../src/core/input'
import { TILE, TILE_FLOOR, buildMap } from '../src/core/map'
import { MONSTER_LIST } from '../src/core/monsters'
import { createState, hashState, snapshot, step } from '../src/core/sim'
import { GameState, MS_SLEEP } from '../src/core/state'
import { GameMap } from '../src/core/map'

const PARTY: CharacterId[] = ['cheolmyeon', 'chim', 'magic', 'oknyang']

function run(seed: number, chars: CharacterId[], ticks: number, onTick?: (s: GameState) => void): { state: GameState; map: GameMap; hashes: number[] } {
  const map = buildMap('crypt', 1, seed)
  const state = createState({ seed, chars }, map)
  const bots = chars.map((_, i) => makeBot(seed * 31 + i))
  const hashes: number[] = []
  for (let t = 0; t < ticks; t++) {
    const inputs: Input[] = chars.map((_, i) => botInput(state, map, i, bots[i], 'hard'))
    step(state, map, inputs)
    onTick?.(state)
    if (state.tick % 300 === 0) hashes.push(hashState(state))
    if (state.phase === 'over') break
  }
  return { state, map, hashes }
}

describe('던전 배치', () => {
  it('입구에서 먼 곳에 무리가 잠들어 있고, 모두 바닥 위에 있다', () => {
    for (const seed of [1, 2, 3, 77]) {
      const map = buildMap('crypt', 1, seed)
      const s = createState({ seed, chars: ['chim'] }, map)
      expect(s.monsters.length).toBeGreaterThan(50)
      expect(s.monstersTotal).toBe(s.monsters.length)
      for (const m of s.monsters) {
        expect(m.st).toBe(MS_SLEEP)
        const tx = Math.floor(m.x / TILE)
        const ty = Math.floor(m.y / TILE)
        expect(map.tiles[ty * map.w + tx]).toBe(TILE_FLOOR)
        // 입구 바로 앞에는 없다
        expect(Math.hypot(m.x - s.entryX, m.y - s.entryY)).toBeGreaterThan(8 * TILE)
      }
      // 무리가 여럿이고 원형이 섞여 있다
      expect(new Set(s.monsters.map((m) => m.pack)).size).toBeGreaterThan(10)
      // 보통 층에는 보스가 없다
      expect(new Set(s.monsters.map((m) => m.kind)).size).toBe(MONSTER_LIST.filter((d) => !d.boss).length)
    }
  })

  it('인원이 늘면 몬스터 체력이 는다 (4인 2.8배)', () => {
    const map = buildMap('crypt', 1, 5)
    const one = createState({ seed: 5, chars: ['chim'] }, map)
    const four = createState({ seed: 5, chars: PARTY }, map)
    expect(four.monsters[0].maxHp).toBe(Math.round(one.monsters[0].maxHp * 2.8))
  })
})

describe('결정론', () => {
  it('같은 시드 · 같은 입력이면 해시가 같다 (봇 파티 90초)', () => {
    const a = run(11, PARTY, 60 * 90)
    const b = run(11, PARTY, 60 * 90)
    expect(a.hashes.length).toBeGreaterThan(10)
    expect(a.hashes).toEqual(b.hashes)
  })

  it('스냅샷에서 이어 돌려도 같은 결과 (리싱크·난입과 같은 길)', () => {
    const seed = 21
    const map = buildMap('crypt', 1, seed)
    const state = createState({ seed, chars: PARTY }, map)
    const bots = PARTY.map((_, i) => makeBot(i + 1))
    const log: Input[][] = []
    for (let t = 0; t < 60 * 40; t++) {
      const inputs = PARTY.map((_, i) => botInput(state, map, i, bots[i], 'hard'))
      log.push(inputs)
      step(state, map, inputs)
    }
    const snap = snapshot(state)
    // 원본은 계속, 스냅샷은 같은 입력으로
    const map2 = buildMap('crypt', 1, seed)
    const copy = snapshot(snap)
    const more: Input[][] = []
    for (let t = 0; t < 60 * 20; t++) {
      const inputs = PARTY.map((_, i) => botInput(state, map, i, bots[i], 'hard'))
      more.push(inputs)
      step(state, map, inputs)
    }
    for (const inputs of more) step(copy, map2, inputs)
    expect(hashState(copy)).toBe(hashState(state))
    void log
  })
})

describe('봇 파티', () => {
  it('어려움 봇 넷이 3분 안에 몬스터를 절반 넘게 정리한다', () => {
    let downs = 0
    const { state } = run(3, PARTY, 60 * 180, (s) => {
      for (const e of s.events) if (e.type === 'down') downs++
    })
    const killed = state.monstersTotal - state.monsters.length
    expect(killed / state.monstersTotal).toBeGreaterThan(0.5)
    // 싸움이 실제로 일어났다 (한 번도 안 쓰러지면 몬스터가 안 싸운 것)
    expect(state.players.reduce((a, p) => a + p.dmgTaken, 0)).toBeGreaterThan(0)
    void downs
  })

  it('틱 비용: 4인 · 몬스터 가득 · 평균 1.5ms 이하', () => {
    const map = buildMap('crypt', 1, 9)
    const state = createState({ seed: 9, chars: PARTY }, map)
    const bots = PARTY.map((_, i) => makeBot(i + 7))
    // 모든 무리를 깨운 최악의 경우
    for (const m of state.monsters) m.st = 1
    let total = 0
    let worst = 0
    const N = 600
    for (let t = 0; t < N; t++) {
      const inputs = PARTY.map((_, i) => botInput(state, map, i, bots[i], 'hard'))
      const t0 = performance.now()
      step(state, map, inputs)
      const dt = performance.now() - t0
      total += dt
      worst = Math.max(worst, dt)
    }
    const avg = total / N
    console.log(`[perf] 몬스터 ${state.monstersTotal} 전부 깨움 · 평균 ${avg.toFixed(3)}ms · 최악 ${worst.toFixed(2)}ms`)
    expect(avg).toBeLessThan(1.5)
  })
})

describe('층 크기', () => {
  it('던전 층은 인원 배율을 받아도 원래 크기다 (4인 거울 확장 금지)', () => {
    const a = buildMap('crypt', 1, 3)
    const b = buildMap('crypt', 4, 3)
    expect(b.w).toBe(a.w)
    expect(b.h).toBe(a.h)
    const s = createState({ seed: 3, chars: PARTY }, b)
    expect(s.monsters.length).toBeLessThan(200)
  })
})
