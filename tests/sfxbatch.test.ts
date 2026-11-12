// 몰아 도는 틱의 소리 (2026-11-12): 프레임이 밀려 tick() 이 여러 걸음을 한꺼번에 돌면 그 소리가 모두 같은 순간에 예약된다 —
// 같은 묶음(소리 시계 12ms 안)에서는 앞 걸음이 이미 낸 소리(종류 · 사람)를 다시 내지 않고, 남의 소리 몫도 이어 쓴다.
// 제때 도는 판(한 틱 16.7ms 씩)과 한 걸음 안의 겹침은 그대로다. Web Audio 는 만들지 않는다 (총소리 함수만 센다).
import { beforeAll, describe, expect, it } from 'vitest'
import type { GameState } from '../src/core/state'

type Fake = { onEvents: (e: unknown[], s: GameState, lp: number) => void; ctx: unknown; gun: (...a: unknown[]) => void; bus: unknown; tone: unknown }
let Sfx: new () => Fake
beforeAll(async () => {
  ;(globalThis as unknown as { window: unknown }).window ??= { addEventListener() {}, removeEventListener() {} }
  Sfx = (await import('../src/audio/sfx')).Sfx as unknown as new () => Fake
})

function make(): { sfx: Fake; clock: { t: number }; shots: number[] } {
  const sfx = new Sfx()
  const clock = { t: 10 }
  sfx.ctx = { state: 'running', get currentTime() { return clock.t } }
  const shots: number[] = []
  sfx.gun = (_w, _s, mine) => void shots.push(mine ? 1 : 0)
  sfx.bus = () => ({ node: {}, t0: 0 })
  sfx.tone = () => {}
  return { sfx, clock, shots }
}
const players = Array.from({ length: 8 }, () => ({ x: 0, y: 0, alive: true, fx: [] }))
const st = { mode: 'arena', phase: 'playing', phaseTimer: 0, players, monsters: [] } as unknown as GameState
const fire = (p: number) => ({ type: 'fire', p, weapon: 'smg', x: 0, y: 0 })

describe('몰아 도는 틱의 소리', () => {
  it('같은 순간에 다시 불리면 앞 걸음이 낸 같은 사람의 총소리는 다시 내지 않는다', () => {
    const { sfx, shots } = make()
    sfx.onEvents([fire(0)], st, 0)
    sfx.onEvents([fire(0)], st, 0)
    sfx.onEvents([fire(0), fire(1)], st, 0)
    expect(shots).toEqual([1, 0])
  })

  it('한 틱(16.7ms)씩 제때 돌면 모두 낸다 · 한 걸음 안의 겹침도 그대로', () => {
    const { sfx, clock, shots } = make()
    sfx.onEvents([fire(0), fire(0)], st, 0)
    clock.t += 1 / 60
    sfx.onEvents([fire(0)], st, 0)
    clock.t += 1 / 60
    sfx.onEvents([fire(0)], st, 0)
    expect(shots.length).toBe(4)
  })

  it('남의 소리 몫(한 번에 6개)은 묶음 안에서 이어 쓴다', () => {
    const { sfx, clock, shots } = make()
    sfx.onEvents([fire(1), fire(2), fire(3), fire(4)], st, 0)
    sfx.onEvents([fire(5), fire(6), fire(7)], st, 0)
    expect(shots.length).toBe(6)
    // 다음 틱에는 몫이 다시 찬다
    clock.t += 1 / 60
    sfx.onEvents([fire(5), fire(6), fire(7)], st, 0)
    expect(shots.length).toBe(9)
  })
})
