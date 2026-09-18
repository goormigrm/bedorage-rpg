// 달리기(Shift). 기력을 써서 빨라진다.
//
// 규칙:
//   - 움직이는 동안에만, 기력이 남아 있을 때만 빨라진다 (SPRINT_MUL 배).
//   - 달리는 동안에는 기력이 차지 않는다 — 안 그러면 회복(22/60)이 소모(30/60)를 거의 상쇄해 무한히 달린다.
//   - 정조준(우클릭) 중에는 달리지 않는다. 구르기 중에도 영향이 없다(구르기 속도가 따로 있다).
//   - 구르기는 Space 그대로다. Shift 는 더 이상 구르기가 아니다.

import { describe, expect, it } from 'vitest'
import { BTN_ADS, BTN_DASH, BTN_FIRE, BTN_SPRINT, Input } from '../src/core/input'
import { TILE, TILE_FLOOR, buildMap } from '../src/core/map'
import { createState, hashState, step } from '../src/core/sim'
import { DASH_COST, GameState, SPRINT_COST, SPRINT_MIN, SPRINT_MUL, STAMINA_MAX, STAMINA_REGEN } from '../src/core/state'

/** 가로로 넓게 뚫린 복도. 벽에 막혀 거리 비교가 흐려지지 않게 한다 */
function scene() {
  const map = buildMap('yard', 1, 7)
  for (let ty = 1; ty < map.h - 1; ty++) for (let tx = 1; tx < map.w - 1; tx++) map.tiles[ty * map.w + tx] = TILE_FLOOR
  map.sandbagIdx.length = 0
  const state = createState({ seed: 3, targetKills: 5, chars: ['chim', 'jupeol'] }, map)
  state.phase = 'playing'
  state.phaseTimer = 0
  const [a, b] = state.players
  a.x = 3 * TILE
  a.y = 12 * TILE + TILE / 2
  a.alive = true
  a.invuln = 0
  // 상대는 멀리 (탄에 맞아 다리를 다치면 속도가 달라진다)
  b.x = 34 * TILE
  b.y = 3 * TILE
  b.alive = true
  return { map, state, a, b }
}

const IDLE: Input = { mx: 0, my: 0, aim: 0, buttons: 0, char: 0 }
const RIGHT = (buttons = 0): Input => ({ mx: 1, my: 0, aim: 0, buttons, char: 0 })

/** ticks 동안 오른쪽으로 이동한 거리 */
function runFor(s: ReturnType<typeof scene>, buttons: number, ticks: number): number {
  const x0 = s.a.x
  for (let t = 0; t < ticks; t++) step(s.state, s.map, [RIGHT(buttons), IDLE])
  return s.a.x - x0
}

describe('달리기', () => {
  it('Shift 를 누르면 더 멀리 간다', () => {
    const walk = runFor(scene(), 0, 60)
    const sprint = runFor(scene(), BTN_SPRINT, 60)
    expect(walk).toBeGreaterThan(0)
    // 딱 SPRINT_MUL 배 (60틱이면 기력이 남는다)
    expect(sprint / walk).toBeCloseTo(SPRINT_MUL, 2)
  })

  it('달리는 동안 기력이 닳고, 그동안은 차지 않는다', () => {
    const s = scene()
    runFor(s, BTN_SPRINT, 30)
    // 회복이 섞이면 소모가 30틱치보다 작게 나온다
    expect(STAMINA_MAX - s.a.stamina).toBeCloseTo(SPRINT_COST * 30, 4)
  })

  it('기력이 떨어지면 더 이상 빨라지지 않는다', () => {
    const s = scene()
    // 한 통이면 약 3.3초. 6초를 달리면 중간에 바닥난다
    const far = runFor(s, BTN_SPRINT, 360)
    const walkOnly = runFor(scene(), 0, 360)
    // 앞부분만 빨랐으므로 걷기보다는 멀고, 계속 달린 것보다는 가깝다
    expect(far).toBeGreaterThan(walkOnly)
    expect(far).toBeLessThan(walkOnly * SPRINT_MUL)
  })

  it('바닥나면 SPRINT_MIN 만큼 찰 때까지 다시 못 달린다 (한 틱씩 달리는 꼼수 방지)', () => {
    const s = scene()
    // 바닥날 때까지 달린다 (한 통 / 틱당 소모 = 200틱)
    let guard = 0
    while (s.a.stamina > 0 && guard++ < 400) step(s.state, s.map, [RIGHT(BTN_SPRINT), IDLE])
    expect(s.a.stamina).toBe(0)
    // 계속 눌러도 문턱 아래에서는 달리지 않는다
    for (let t = 0; t < 20; t++) {
      step(s.state, s.map, [RIGHT(BTN_SPRINT), IDLE])
      expect(s.a.sprinting).toBe(false)
    }
    expect(s.a.stamina).toBeLessThan(SPRINT_MIN)
    // 문턱을 넘으면 다시 달린다
    while (s.a.stamina < SPRINT_MIN) step(s.state, s.map, [RIGHT(0), IDLE])
    step(s.state, s.map, [RIGHT(BTN_SPRINT), IDLE])
    expect(s.a.sprinting).toBe(true)
  })

  it('멈춰 있으면 달리지 않는다 (기력이 줄지 않는다)', () => {
    const s = scene()
    s.a.stamina = 50
    for (let t = 0; t < 30; t++) step(s.state, s.map, [{ ...IDLE, buttons: BTN_SPRINT }, IDLE])
    expect(s.a.sprinting).toBe(false)
    expect(s.a.stamina).toBeGreaterThan(50) // 오히려 회복된다
  })

  it('정조준 중에는 달리지 않는다', () => {
    const s = scene()
    runFor(s, BTN_SPRINT | BTN_ADS, 30)
    expect(s.a.sprinting).toBe(false)
    expect(s.a.stamina).toBe(STAMINA_MAX)
  })

  it('쏘면서도 달릴 수 있다 (기력만 든다)', () => {
    const s = scene()
    runFor(s, BTN_SPRINT | BTN_FIRE, 20)
    expect(s.a.sprinting).toBe(true)
    expect(s.a.shots).toBeGreaterThan(0)
  })

  it('구르기는 Space 그대로다 — Shift 로는 구르지 않는다', () => {
    const shift = scene()
    for (let t = 0; t < 5; t++) step(shift.state, shift.map, [RIGHT(BTN_SPRINT), IDLE])
    expect(shift.a.dashTimer).toBe(0)
    expect(shift.a.stamina).toBeGreaterThan(STAMINA_MAX - DASH_COST)

    const space = scene()
    step(space.state, space.map, [RIGHT(BTN_DASH), IDLE])
    expect(space.a.dashTimer).toBeGreaterThan(0)
    expect(space.a.stamina).toBeCloseTo(STAMINA_MAX - DASH_COST, 4)
  })

  it('구르는 동안에는 달리기가 끼어들지 않는다', () => {
    const s = scene()
    step(s.state, s.map, [RIGHT(BTN_DASH), IDLE])
    const before = s.a.stamina
    step(s.state, s.map, [RIGHT(BTN_SPRINT), IDLE])
    expect(s.a.dashTimer).toBeGreaterThan(0)
    expect(s.a.sprinting).toBe(false)
    expect(s.a.stamina).toBe(before) // 구르는 중에는 회복도 소모도 없다
  })

  it('결정론: 같은 입력이면 두 판의 해시가 같다', () => {
    const run = (): GameState => {
      const s = scene()
      for (let t = 0; t < 200; t++) {
        const on = t % 7 < 4 // 눌렀다 뗐다
        step(s.state, s.map, [RIGHT(on ? BTN_SPRINT : 0), IDLE])
      }
      return s.state
    }
    expect(hashState(run())).toBe(hashState(run()))
  })

  it('한 통으로 달리는 시간은 3초 남짓이다 (회복 속도와 균형)', () => {
    const seconds = STAMINA_MAX / SPRINT_COST / 60
    expect(seconds).toBeGreaterThan(2.5)
    expect(seconds).toBeLessThan(4)
    // 다 쓰고 나면 회복이 더 오래 걸려야 계속 달리지 못한다
    expect(STAMINA_MAX / STAMINA_REGEN / 60).toBeGreaterThan(seconds)
  })
})
