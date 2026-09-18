// 후라이팬 방어 규칙.
//
// 2026-09-05 이전에는 막는 동안에도 기력이 계속 차서, 승빠덕이 **정면으로 서서 막기만 해도**
// 15초 동안 총알을 다 튕겨 내며 살아남았다(사람이 쓰면 사실상 무적).
// 그래서 **막은 직후에는 잠깐 기력이 차지 않게** 했다. 기력 한 통(피해 181)까지만 막을 수 있고,
// 계속 쏘면 방어가 결국 뚫린다. 머리 판정도 막지 못하게 해 봤지만 그러면 방어가 아예 무의미해져서 넣지 않았다
// (사람이든 봇이든 상대 한가운데를 겨누므로 대부분의 명중이 머리 판정이다). `tools/melee.ts` 로 다시 잴 수 있다.

import { describe, expect, it } from 'vitest'
import { radToAngle } from '../src/core/fixedmath'
import { BTN_ADS, BTN_FIRE, Input } from '../src/core/input'
import { TILE_FLOOR, buildMap } from '../src/core/map'
import { createState, step } from '../src/core/sim'
import { CHARACTERS } from '../src/core/characters'
import { BLOCK_CHANCE, BLOCK_COST, BLOCK_LOCK_TICKS, COUNTDOWN_TICKS, STAMINA_MAX, STAMINA_REGEN } from '../src/core/state'

const IDLE: Input = { mx: 0, my: 0, aim: 0, buttons: 0, char: 0 }

/** 승빠덕(0)이 총잡이(1)를 마주 보고 서 있는 복도 */
function scene(gap: number, gunner: 'chim' | 'jupeol' = 'chim') {
  const map = buildMap('yard', 1, 11)
  const ty = 14
  for (let tx = 1; tx < map.w - 1; tx++) for (let dy = -2; dy <= 2; dy++) map.tiles[(ty + dy) * map.w + tx] = TILE_FLOOR
  map.sandbagIdx.length = 0
  const state = createState({ seed: 5, targetKills: 9, chars: ['seungwoo', gunner] }, map)
  const [pan, gun] = state.players
  const y = ty * 32 + 16
  pan.x = 300
  pan.y = y
  pan.invuln = 0
  pan.aliveTicks = 999
  gun.x = 300 + gap
  gun.y = y
  gun.invuln = 0
  gun.aliveTicks = 999
  // 카운트다운 동안에는 아무도 못 쏘므로 건너뛴다
  for (let i = 0; i < COUNTDOWN_TICKS + 2; i++) step(state, map, [IDLE, IDLE])
  const aimAtPan = radToAngle(Math.atan2(pan.y - gun.y, pan.x - gun.x))
  const aimAtGun = radToAngle(Math.atan2(gun.y - pan.y, gun.x - pan.x))
  return { map, state, pan, gun, aimAtPan, aimAtGun }
}

/** 총잡이만 쏜다. 승빠덕은 상대를 보고 가만히 서 있는다(= 막는다) */
function fireAt(s: ReturnType<typeof scene>, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    const inputs: Input[] = [
      { ...IDLE, aim: s.aimAtGun },
      { mx: 0, my: 0, aim: s.aimAtPan, buttons: BTN_FIRE | BTN_ADS, char: 0 },
    ]
    step(s.state, s.map, inputs)
    if (!s.pan.alive) break
  }
}

describe('후라이팬 방어', () => {
  it('맞고 있는 동안에는 기력이 차지 않는다', () => {
    const s = scene(300)
    s.pan.stamina = 60
    fireAt(s, 120)
    // 회복이 계속 됐다면 기력이 늘었어야 한다 (2.4배 회복이면 2초에 100 이상)
    expect(s.pan.stamina).toBeLessThan(60)
  })

  it('총알을 안 맞으면 기력이 다시 찬다', () => {
    const s = scene(300)
    s.pan.stamina = 20
    // 아무도 쏘지 않는 2초
    for (let i = 0; i < 120; i++) step(s.state, s.map, [{ ...IDLE, aim: s.aimAtGun }, { ...IDLE, aim: s.aimAtPan }])
    expect(s.pan.stamina).toBeGreaterThan(20 + STAMINA_REGEN * 60)
    expect(s.pan.stamina).toBeLessThanOrEqual(s.pan.staminaMax)
  })

  it('계속 쏘면 방어가 결국 뚫려 체력이 깎인다', () => {
    const s = scene(300)
    const hp0 = s.pan.hp
    fireAt(s, 600) // 10초
    // 절반만 막으므로 기력이 바닥나기 전에 체력이 먼저 깎여 죽는다
    expect(s.pan.hp).toBeLessThan(hp0)
    expect(s.pan.alive).toBe(false)
  })

  it('앞에서 온 탄도 BLOCK_CHANCE 만큼만 막는다', () => {
    // 기력을 계속 채워 "막을 수 있는데도 안 막히는" 비율만 본다
    let hits = 0
    let blocks = 0
    for (let seed = 1; seed <= 6; seed++) {
      const s = scene(300)
      s.state.rng.s = seed >>> 0
      for (let i = 0; i < 300; i++) {
        s.pan.stamina = s.pan.staminaMax // 기력 고갈 요인 제거
        const inputs: Input[] = [
          { ...IDLE, aim: s.aimAtGun },
          { mx: 0, my: 0, aim: s.aimAtPan, buttons: BTN_FIRE | BTN_ADS, char: 0 },
        ]
        step(s.state, s.map, inputs)
        for (const e of s.state.events) {
          if (e.type === 'hit' && e.p === 0) hits++
          if (e.type === 'block' && e.p === 0) blocks++
        }
        if (!s.pan.alive) break
      }
    }
    // 완전히 막힌 탄은 피해가 0 이라 hit 이벤트가 없다 → 총 명중 = 막은 것 + 아픈 것
    const total = hits + blocks
    expect(total).toBeGreaterThan(60)
    const ratio = blocks / total
    expect(ratio).toBeGreaterThan(BLOCK_CHANCE - 0.15)
    expect(ratio).toBeLessThan(BLOCK_CHANCE + 0.15)
  })

  it('막기는 기력을 쓰므로 무한하지 않다 — 기력이 0 이면 그대로 맞는다', () => {
    const s = scene(300)
    s.pan.stamina = 0
    const hp0 = s.pan.hp
    fireAt(s, 90)
    expect(s.pan.hp).toBeLessThan(hp0)
  })

  it('뒤에서 오는 탄은 막지 못한다', () => {
    const s = scene(300)
    s.pan.stamina = s.pan.staminaMax
    const hp0 = s.pan.hp
    // 상대를 등지고 선다
    for (let i = 0; i < 90; i++) {
      const inputs: Input[] = [
        { ...IDLE, aim: (s.aimAtGun + 512) & 1023 },
        { mx: 0, my: 0, aim: s.aimAtPan, buttons: BTN_FIRE | BTN_ADS, char: 0 },
      ]
      step(s.state, s.map, inputs)
    }
    expect(s.pan.hp).toBeLessThan(hp0)
    expect(s.pan.stamina).toBe(s.pan.staminaMax) // 기력은 한 톨도 안 썼다
  })

  it('상수가 뒤집히지 않았는지 — 잠금이 실제로 걸리고 막을 수 있는 양에 한계가 있다', () => {
    expect(BLOCK_LOCK_TICKS).toBeGreaterThan(0)
    expect(BLOCK_COST).toBeGreaterThan(0)
    expect(BLOCK_CHANCE).toBeGreaterThan(0)
    expect(BLOCK_CHANCE).toBeLessThanOrEqual(1)
    // 기력 한 통으로 막을 수 있는 몸통 피해량 (너무 크면 다시 무적이 된다). 승빠덕은 통이 150 이라 272 — 대신 막을 확률이 40%
    expect(STAMINA_MAX / BLOCK_COST).toBeLessThan(200)
    expect((CHARACTERS.seungwoo.staminaMax ?? STAMINA_MAX) / BLOCK_COST).toBeLessThan(300)
    expect(BLOCK_CHANCE).toBeLessThanOrEqual(0.4)
  })
})
