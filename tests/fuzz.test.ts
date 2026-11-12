// 무작위 명령 퍼징 (2026-11-12 버그 검사): 아무 입력 · 아무 명령 · 아무 인자를 아무 때나 넣어도 예외 · NaN 이 없고 불변식이 지켜지며,
// 같은 시드로 두 번 돌리면 해시가 같다. 락스텝이라 손댄 손님이 조건 밖 명령을 보내도 모두의 판에서 같은 결과여야 하고 판이 깨지면 안 된다.
import { describe, expect, it } from 'vitest'
import { makeRng, rand, randInt } from '../src/core/rng'
import { createState, dropPlayer, hashState, joinPlayer, snapshot, step, warpPlayer } from '../src/core/sim'
import { GameState } from '../src/core/state'
import { AREAS } from '../src/core/world'
import { ALL_CHARS, fuzzInput, hopSpot, invariants, richSheet, world } from './_fuzz'

const N = Number(process.env.FUZZ_TICKS ?? 1000)
const GO = AREAS.filter((a) => !a.retired).map((a) => a.id)

interface Opt {
  tier?: number
  deathRule?: 0 | 1 | 2
  /** 이 틱에 판을 JSON 으로 주고받은 사본(난입 · 리싱크가 받는 것)으로 갈아탄다 */
  swapAt?: number
}

function fuzz(seed: number, ticks: number, o: Opt = {}): { s: GameState; hashes: number[] } {
  const mapOf = world(31)
  const r = makeRng(seed)
  const chars = [0, 1, 2, 3].map(() => ALL_CHARS[randInt(r, 0, ALL_CHARS.length)])
  const levels = [3, 14, 30, 30]
  let s = createState({ seed, chars, tier: o.tier ?? 0, deathRule: o.deathRule ?? 0, sheets: chars.map((c, i) => richSheet(c, levels[i], 4, seed + i)) }, mapOf)
  const hashes: number[] = []
  for (let t = 0; t < ticks; t++) {
    if (t % 97 === 0) hopSpot(s, mapOf, r, randInt(r, 0, 4))
    if (t % 211 === 0) warpPlayer(s, mapOf, randInt(r, 0, 4), GO[randInt(r, 0, GO.length)])
    // 나갔다 들어오기 (자리 비움 · 난입)
    if (t % 617 === 300) dropPlayer(s, 3)
    if (t % 617 === 500) joinPlayer(s, mapOf, 3, ALL_CHARS[randInt(r, 0, ALL_CHARS.length)], 0, rand(r) < 0.5 ? richSheet(chars[3], 20, 2, seed + 10 + t) : undefined)
    if (t === o.swapAt) s = JSON.parse(JSON.stringify(snapshot(s))) as GameState
    const inputs = s.players.map(() => fuzzInput(r))
    try {
      step(s, mapOf, inputs)
    } catch (e) {
      throw new Error(`시드 ${seed} 틱 ${t}: ${(e as Error).stack}`)
    }
    if (t % 10 === 0) {
      const bad = invariants(s)
      if (bad.length) throw new Error(`시드 ${seed} 틱 ${t}: ${bad.slice(0, 8).join(' · ')}`)
    }
    if (t % 100 === 99) hashes.push(hashState(s))
  }
  return { s, hashes }
}

describe('무작위 명령 퍼징', () => {
  const seeds = (process.env.FUZZ_SEEDS ?? '11,12,13').split(',').map(Number)
  for (const seed of seeds) {
    it(`시드 ${seed}: 예외 · NaN 없음 · 불변식 · 두 번 돌려 해시 같음`, () => {
      const o: Opt = { tier: seed % 3, deathRule: (seed % 3) as 0 | 1 | 2 }
      const a = fuzz(seed, N, o)
      const b = fuzz(seed, N, o)
      expect(b.hashes).toEqual(a.hashes)
    })
  }

  it('JSON 으로 주고받은 판(난입 · 리싱크)으로 이어 돌려도 같은 해시', () => {
    const a = fuzz(21, N)
    const b = fuzz(21, N, { swapAt: Math.floor(N / 2) + 7 })
    expect(b.hashes).toEqual(a.hashes)
  })
})
