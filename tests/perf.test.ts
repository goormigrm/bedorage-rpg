// 성능 회귀 방지. 시뮬레이션(결정론 core)이 60Hz 를 여유 있게 감당하는지 본다.
// 렌더링(Three.js·전장의 안개)은 브라우저에서만 잴 수 있어 여기서는 다루지 않는다.

import { describe, expect, it } from 'vitest'
import { botInput, makeBot } from '../src/core/bot'
import { CharacterId } from '../src/core/characters'
import { Input } from '../src/core/input'
import { buildMap } from '../src/core/map'
import { createState, step } from '../src/core/sim'

const CHARS: CharacterId[] = ['cheolmyeon', 'chim', 'dangun', 'magic']
const idle: Input = { mx: 0, my: 0, aim: 0, buttons: 0, char: 0 }

function bench(label: string, ticks: number, withBots: boolean, scale: 1 | 2 | 4): number {
  const map = buildMap('yard', scale, 7)
  const state = createState({ seed: 5, targetKills: 9999, chars: CHARS }, map)
  const bots = CHARS.map((_, i) => makeBot(i + 1))
  const t0 = performance.now()
  for (let t = 0; t < ticks; t++) {
    const inputs: Input[] = withBots
      ? bots.map((b, i) => botInput(state, map, i, b, 'hard'))
      : [idle, idle, idle, idle]
    step(state, map, inputs)
  }
  const ms = performance.now() - t0
  // eslint-disable-next-line no-console
  console.log(`[perf] ${label}: ${ms.toFixed(0)}ms / ${ticks}틱 → 틱당 ${(ms / ticks).toFixed(3)}ms`)
  return ms / ticks
}

describe('성능', () => {
  it('4인 · 4배 맵 · 봇 4명(최악) 1분치가 실시간보다 훨씬 빠르다', () => {
    const perTick = bench('4인 4배맵 + 봇AI 4', 3600, true, 4)
    // 60Hz = 틱당 16.6ms 예산. 3ms 를 넘으면 저사양에서 위험하다
    expect(perTick).toBeLessThan(3)
  })

  it('4인 대전(봇 없음) 시뮬은 예산의 1% 수준이다', () => {
    const perTick = bench('4인 4배맵 (입력만)', 3600, false, 4)
    expect(perTick).toBeLessThan(0.5)
  })

  it('2인 기본 맵은 더 가볍다', () => {
    const perTick = bench('2인 기본맵 + 봇AI', 3600, true, 1)
    expect(perTick).toBeLessThan(2)
  })
})
