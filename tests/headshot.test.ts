// 헤드샷 = "쏠 때 커서가 상대 위에 있었고" + "탄 궤적이 정중앙을 지났다".
//
// 2026-09-05 제보: 궤적만 보던 때는 상대 뒤쪽 먼 곳을 겨눠도 선상에 머리가 걸리면 헤드샷이었다.
// 원했던 것은 **에임(커서)과 상대 위치가 일치했을 때**다. 그래서 입력에 조준 거리(aimDist)를 실어
// 조준점을 만들고, 그 조준점이 올라가 있던 적(headTarget)을 정중앙으로 맞혔을 때만 머리로 친다.

import { describe, expect, it } from 'vitest'
import { BTN_ADS, BTN_FIRE, INPUT_BYTES, Input, readInput, writeInput } from '../src/core/input'
import { TILE, TILE_FLOOR, buildMap } from '../src/core/map'
import { createState, step } from '../src/core/sim'
import { PLAYER_RADIUS } from '../src/core/state'
import { HEAD_AIM_FRAC, PART_BODY, PART_HEAD } from '../src/core/weapons'

const IDLE: Input = { mx: 0, my: 0, aim: 0, buttons: 0, char: 0 }

/** 빈 복도. A 가 왼쪽, B 가 오른쪽 같은 높이 (조준 각도 0 = 정확히 B 의 정중앙) */
function scene(gap: number) {
  const map = buildMap('yard', 1, 7)
  for (let ty = 1; ty < map.h - 1; ty++) for (let tx = 1; tx < map.w - 1; tx++) map.tiles[ty * map.w + tx] = TILE_FLOOR
  map.sandbagIdx.length = 0
  const state = createState({ seed: 3, targetKills: 9, chars: ['chim', 'jupeol'] }, map)
  state.phase = 'playing'
  state.phaseTimer = 0
  const [a, b] = state.players
  a.x = 6 * TILE
  a.y = 12 * TILE + TILE / 2
  b.x = a.x + gap
  b.y = a.y
  for (const p of [a, b]) {
    p.alive = true
    p.invuln = 0
    p.aliveTicks = 999
  }
  return { map, state, a, b }
}

/** A 가 각도 0 으로 정조준 사격. 첫 명중의 부위를 돌려준다 */
function firstHitPart(s: ReturnType<typeof scene>, aimDist: number): number {
  for (let t = 0; t < 120; t++) {
    const inputs: Input[] = [{ mx: 0, my: 0, aim: 0, buttons: BTN_FIRE | BTN_ADS, char: 0, aimDist }, IDLE]
    step(s.state, s.map, inputs)
    for (const e of s.state.events) if (e.type === 'hit' && e.p === 1) return e.part
  }
  return -1
}

describe('헤드샷은 커서가 상대 위에 있을 때만', () => {
  it('커서를 상대 위에 올리고 정중앙을 맞히면 머리', () => {
    const s = scene(200)
    expect(firstHitPart(s, Math.round(200 / 4))).toBe(PART_HEAD)
  })

  it('같은 궤적이라도 커서가 상대 뒤쪽 먼 곳에 있으면 몸통', () => {
    const s = scene(200)
    // 상대 너머 400px 를 겨눈다 — 선상에 머리가 걸리지만 커서는 상대 위가 아니다
    expect(firstHitPart(s, Math.round(600 / 4))).toBe(PART_BODY)
  })

  it('커서가 상대 앞쪽에 있어도(못 미쳐도) 몸통', () => {
    const s = scene(200)
    expect(firstHitPart(s, Math.round(80 / 4))).toBe(PART_BODY)
  })

  it('조준점이 없으면(거리 0) 헤드샷이 나지 않는다', () => {
    const s = scene(200)
    expect(firstHitPart(s, 0)).toBe(PART_BODY)
  })

  it('"상대 위" 의 기준은 HEAD_AIM_FRAC — 반지름의 그 비율 안쪽', () => {
    const inside = scene(200)
    const outside = scene(200)
    const ok = 200 + PLAYER_RADIUS * HEAD_AIM_FRAC - 4
    const no = 200 + PLAYER_RADIUS * HEAD_AIM_FRAC + 8
    expect(firstHitPart(inside, Math.round(ok / 4))).toBe(PART_HEAD)
    expect(firstHitPart(outside, Math.round(no / 4))).toBe(PART_BODY)
  })

  it('커서가 상대 위면 탄퍼짐으로 빗겨 맞아도 머리 (금색이면 헤드샷)', () => {
    // 지향 사격(퍼짐 6.5°)으로 여러 발 — 맞은 탄은 전부 머리여야 한다
    const s = scene(160)
    const aimDist = Math.round(160 / 4)
    let hits = 0
    let heads = 0
    for (let t = 0; t < 240; t++) {
      const inputs: Input[] = [{ mx: 0, my: 0, aim: 0, buttons: BTN_FIRE, char: 0, aimDist }, IDLE]
      step(s.state, s.map, inputs)
      for (const e of s.state.events) if (e.type === 'hit' && e.p === 1) {
        hits++
        if (e.part === PART_HEAD) heads++
      }
      s.b.hp = 200
      s.b.alive = true
    }
    expect(hits).toBeGreaterThan(3)
    expect(heads).toBe(hits)
  })

  it('산탄총은 커서가 상대 위여도 정중앙을 지나는 탄만 머리', () => {
    const map = buildMap('yard', 1, 7)
    for (let ty = 1; ty < map.h - 1; ty++) for (let tx = 1; tx < map.w - 1; tx++) map.tiles[ty * map.w + tx] = TILE_FLOOR
    map.sandbagIdx.length = 0
    const state = createState({ seed: 5, targetKills: 9, chars: ['magic', 'jupeol'] }, map)
    state.phase = 'playing'
    state.phaseTimer = 0
    const [a, b] = state.players
    a.x = 6 * TILE
    a.y = 12 * TILE + TILE / 2
    b.x = a.x + 120
    b.y = a.y
    for (const p of [a, b]) {
      p.alive = true
      p.invuln = 0
      p.aliveTicks = 999
    }
    let hits = 0
    let heads = 0
    for (let t = 0; t < 300; t++) {
      const inputs: Input[] = [{ mx: 0, my: 0, aim: 0, buttons: BTN_FIRE, char: 0, aimDist: Math.round(120 / 4) }, IDLE]
      step(state, map, inputs)
      for (const e of state.events) if (e.type === 'hit' && e.p === 1) {
        hits++
        if (e.part === PART_HEAD) heads++
      }
      b.hp = 200
      b.alive = true
    }
    expect(hits).toBeGreaterThan(10)
    expect(heads).toBeGreaterThan(0)
    expect(heads).toBeLessThan(hits) // 전부 머리는 아니다
  })

  it('입력 직렬화에 조준 거리가 실린다 (7바이트)', () => {
    expect(INPUT_BYTES).toBe(7)
    const v = new DataView(new ArrayBuffer(INPUT_BYTES))
    writeInput(v, 0, { mx: 1, my: -1, aim: 700, buttons: 5, char: 2, aimDist: 123 })
    const back = readInput(v, 0)
    expect(back.aimDist).toBe(123)
    expect(back.aim).toBe(700)
    // 생략하면 0
    writeInput(v, 0, { mx: 0, my: 0, aim: 0, buttons: 0, char: 0 })
    expect(readInput(v, 0).aimDist).toBe(0)
  })
})
