// 모바일 자동 조준: 보이는 적을 겨누되 즉시 홱 돌지 않는다. 벽 뒤는 겨누지 않는다.

import { describe, expect, it } from 'vitest'
import { ANGLE_STEPS, angleDiff, radToAngle } from '../src/core/fixedmath'
import { buildMap } from '../src/core/map'
import { createState } from '../src/core/sim'
import { AUTO_AIM_BIAS, AUTO_AIM_SWAY, LocalInput } from '../src/game/localInput'
import { TouchControls } from '../src/game/touch'

/** sample() 이 보는 최소한만 흉내 낸 터치 조작 */
function stubTouch(move = { x: 0, y: 0 }): TouchControls {
  return {
    move,
    ads: false,
    reload: false,
    firing: false,
    takeDash: () => false,
    takeSwap: () => false,
    takeMenu: () => false,
  } as unknown as TouchControls
}

const noRenderer = { screenToWorld: () => ({ x: 0, y: 0 }) }

function setup() {
  const map = buildMap('yard', 1, 42)
  const state = createState({ seed: 1, targetKills: 5, chars: ['chim', 'jupeol'] }, map)
  const input = new LocalInput()
  input.touch = stubTouch()
  return { map, state, input }
}

/** 두 사람을 한 줄로 세운다. 사이에 벽이 없는 자리를 맵에서 찾는다 */
function placeInSight(map: ReturnType<typeof buildMap>, state: ReturnType<typeof createState>, gap: number): boolean {
  const [a, b] = state.players
  for (const s of map.spawns) {
    a.x = s.x
    a.y = s.y
    b.x = s.x + gap
    b.y = s.y
    if (map.tiles[Math.floor(b.y / 32) * map.w + Math.floor(b.x / 32)] === 0) {
      let clear = true
      for (let i = 1; i < 10; i++) {
        const x = a.x + (gap * i) / 10
        if (map.tiles[Math.floor(a.y / 32) * map.w + Math.floor(x / 32)] !== 0) clear = false
      }
      if (clear) return true
    }
  }
  return false
}

describe('모바일 자동 조준', () => {
  it('보이는 적 쪽으로 조준이 돌아간다', () => {
    const { map, state, input } = setup()
    expect(placeInSight(map, state, 120)).toBe(true)
    const want = radToAngle(Math.atan2(state.players[1].y - state.players[0].y, state.players[1].x - state.players[0].x))
    let aim = 0
    for (let i = 0; i < 120; i++) {
      aim = input.sample(noRenderer, state.players[0].x, state.players[0].y, { state, map, me: 0 }).aim
    }
    // 정확히가 아니라 **일부러 넣은 오차** 안에서 겨눈다 (사람은 정중앙을 그렇게 잡지 못한다)
    expect(Math.abs(angleDiff(aim, want))).toBeLessThanOrEqual(AUTO_AIM_BIAS + AUTO_AIM_SWAY + 2)
  })

  it('자동 조준은 일부러 흔들린다 — 오래 겨눠도 정중앙에 붙어 있지 않다', () => {
    const { map, state, input } = setup()
    expect(placeInSight(map, state, 240)).toBe(true)
    const want = radToAngle(Math.atan2(state.players[1].y - state.players[0].y, state.players[1].x - state.players[0].x))
    let sum = 0
    let n = 0
    for (let i = 0; i < 600; i++) {
      const aim = input.sample(noRenderer, state.players[0].x, state.players[0].y, { state, map, me: 0 }).aim
      if (i >= 60) {
        sum += Math.abs(angleDiff(aim, want))
        n++
      }
    }
    // 평균 오차가 머리 판정(0.28r ≈ 240px 에서 약 0.9° ≈ 2.7단계)보다 훨씬 커야 한다
    expect(sum / n).toBeGreaterThan(6)
    // 그래도 표적 근처는 맞다 (치우침 + 흔들림 한도 안)
    expect(sum / n).toBeLessThan(AUTO_AIM_BIAS + AUTO_AIM_SWAY)
  })

  it('한 틱에 홱 돌지 않는다 (조준 속도 제한)', () => {
    const { map, state, input } = setup()
    expect(placeInSight(map, state, 120)).toBe(true)
    const first = input.sample(noRenderer, state.players[0].x, state.players[0].y, { state, map, me: 0 }).aim
    // 처음 한 틱에 돌 수 있는 각도는 제한되어 있다 (1024 단계에서 16 = 약 5.6°)
    expect(Math.abs(angleDiff(first, 0))).toBeLessThanOrEqual(16)
  })

  it('벽 뒤에 있는 적은 겨누지 않는다', () => {
    const { map, state, input } = setup()
    const [a, b] = state.players
    // 맵 밖(테두리 벽 너머)에 두면 절대 보이지 않는다
    a.x = map.spawns[0].x
    a.y = map.spawns[0].y
    b.x = 8
    b.y = 8
    let aim = 0
    for (let i = 0; i < 60; i++) {
      aim = input.sample(noRenderer, a.x, a.y, { state, map, me: 0 }).aim
    }
    // 움직이지도 않았으니 처음 각도 그대로
    expect(aim).toBe(0)
  })

  it('적이 없으면 가는 쪽을 본다', () => {
    const { map, state, input } = setup()
    const a = state.players[0]
    const b = state.players[1]
    a.x = map.spawns[0].x
    a.y = map.spawns[0].y
    b.x = 8
    b.y = 8
    input.touch = stubTouch({ x: 0, y: 1 }) // 화면 아래로 민다
    let aim = 0
    for (let i = 0; i < 200; i++) {
      aim = input.sample(noRenderer, a.x, a.y, { state, map, me: 0 }).aim
    }
    expect(aim).toBeGreaterThan(0)
    expect(aim).toBeLessThan(ANGLE_STEPS)
  })

  it('죽은 적은 겨누지 않는다', () => {
    const { map, state, input } = setup()
    expect(placeInSight(map, state, 120)).toBe(true)
    state.players[1].alive = false
    state.players[1].hp = 0
    let aim = 0
    for (let i = 0; i < 60; i++) {
      aim = input.sample(noRenderer, state.players[0].x, state.players[0].y, { state, map, me: 0 }).aim
    }
    expect(aim).toBe(0)
  })
})
