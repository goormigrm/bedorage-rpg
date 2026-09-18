// 저격총 2026-09-05 개편: 조준경으로 맞히면 한 방, 스치면 체력 10, 조준경 없이는 개머리판(10, 재장전 중에도), 탄 6.
import { describe, expect, it } from 'vitest'
import { BTN_ADS, BTN_FIRE, Input } from '../src/core/input'
import { TILE_FLOOR, buildMap } from '../src/core/map'
import { createState, step } from '../src/core/sim'
import { COUNTDOWN_TICKS, PLAYER_RADIUS } from '../src/core/state'
import { SNIPER_GRAZE_FRAC, WEAPONS } from '../src/core/weapons'
import { radToAngle } from '../src/core/fixedmath'

const IDLE: Input = { mx: 0, my: 0, aim: 0, buttons: 0, char: 0 }

/** 옥냥덕(0)이 침착덕(1)을 오른쪽(+x)에 두고 마주 본다. dy 로 상대를 위아래로 비껴 놓을 수 있다 */
function scene(gap: number, dy = 0) {
  const map = buildMap('yard', 1, 21)
  const ty = 14
  for (let tx = 1; tx < map.w - 1; tx++) for (let d = -3; d <= 3; d++) map.tiles[(ty + d) * map.w + tx] = TILE_FLOOR
  map.sandbagIdx.length = 0
  const state = createState({ seed: 7, targetKills: 9, chars: ['oknyang', 'chim'] }, map)
  const [sn, tg] = state.players
  const y = ty * 32 + 16
  sn.x = 300
  sn.y = y
  sn.invuln = 0
  sn.aliveTicks = 999
  tg.x = 300 + gap
  tg.y = y + dy
  tg.invuln = 0
  tg.aliveTicks = 999
  for (let i = 0; i < COUNTDOWN_TICKS + 2; i++) step(state, map, [IDLE, IDLE])
  // 조준은 언제나 정확히 +x (수평선). dy 만큼 비껴 놓으면 탄이 그만큼 벗어나 지나간다
  const aimRight = radToAngle(0)
  const aimLeft = radToAngle(Math.PI)
  return { map, state, sn, tg, aimRight, aimLeft }
}

function shoot(s: ReturnType<typeof scene>, buttons: number, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    step(s.state, s.map, [
      { mx: 0, my: 0, aim: s.aimRight, buttons, char: 0 },
      { ...IDLE, aim: s.aimLeft },
    ])
  }
}

describe('저격총', () => {
  it('탄창은 6발', () => {
    expect(WEAPONS.sniper.magSize).toBe(6)
  })

  it('조준경으로 정중앙을 맞히면 체력이 얼마든 한 방', () => {
    const s = scene(320)
    s.tg.hp = s.tg.maxHp
    shoot(s, BTN_FIRE | BTN_ADS, 40)
    expect(s.tg.alive).toBe(false)
    expect(s.sn.ammo).toBe(WEAPONS.sniper.magSize - 1)
  })

  it('조준경 탄이 가장자리를 스치면 죽지 않고 체력 10 이 남는다', () => {
    // 상대를 반지름의 85% 만큼 위로 비껴 놓으면 수평 탄이 바깥 30% 를 스친다 (탄퍼짐 0.4° = 320px 에서 약 2px)
    const s = scene(320, Math.round(PLAYER_RADIUS * 0.85))
    expect(PLAYER_RADIUS * 0.85).toBeGreaterThan(PLAYER_RADIUS * SNIPER_GRAZE_FRAC)
    shoot(s, BTN_FIRE | BTN_ADS, 40)
    expect(s.tg.alive).toBe(true)
    expect(s.tg.hp).toBe(10)
  })

  it('조준경 없이 쏘면 총알이 아니라 개머리판 — 가까운 적에게 10, 탄은 안 쓴다', () => {
    const s = scene(40)
    const hp0 = s.tg.hp
    shoot(s, BTN_FIRE, 3)
    expect(s.tg.hp).toBe(hp0 - WEAPONS.sniper.bash!.damage)
    expect(s.sn.ammo).toBe(WEAPONS.sniper.magSize)
    expect(s.state.bullets.length).toBe(0)
  })

  it('개머리판은 멀면 안 닿는다', () => {
    const s = scene(200)
    const hp0 = s.tg.hp
    shoot(s, BTN_FIRE, 3)
    expect(s.tg.hp).toBe(hp0)
  })

  it('재장전 중에도 개머리판은 된다', () => {
    const s = scene(40)
    s.sn.ammo = 0
    // 조준경으로 쏘려다 탄이 없어 재장전이 시작된다
    shoot(s, BTN_FIRE | BTN_ADS, 1)
    expect(s.sn.reloadTimer).toBeGreaterThan(0)
    const hp0 = s.tg.hp
    shoot(s, BTN_FIRE, 3)
    expect(s.sn.reloadTimer).toBeGreaterThan(0)
    expect(s.tg.hp).toBe(hp0 - WEAPONS.sniper.bash!.damage)
  })
})
