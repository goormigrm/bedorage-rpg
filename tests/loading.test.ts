// 지역을 옮긴 직후 화면이 덮여 있는 동안(BTN_LOADING) — 보이지 않는 채로 맞지 않게 (2026-10-23 사용자: "첫 진입 끊김으로 죽을 뻔")
import { describe, expect, it } from 'vitest'
import { BTN_FIRE, BTN_LOADING, Input } from '../src/core/input'
import { GameMap } from '../src/core/map'
import { createState, step, warpPlayer } from '../src/core/sim'
import { COUNTDOWN_TICKS } from '../src/core/state'
import { ACTS, buildAreaMap } from '../src/core/world'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0 })

function party() {
  const maps = new Map<number, GameMap>()
  const mapOf = (id: number) => maps.get(id) ?? maps.set(id, buildAreaMap(5, id)).get(id)!
  const s = createState({ seed: 5, chars: ['chim', 'magic'], area: ACTS[0].town }, mapOf)
  for (let i = 0; i < COUNTDOWN_TICKS + 1; i++) step(s, mapOf, [idle(), idle()])
  // 2번 자리는 1번을 따라다니는 봇
  s.players[1].follow = 0
  for (let i = 0; i < 2; i++) warpPlayer(s, mapOf, i, 1)
  return { s, mapOf }
}

describe('화면 덮임 보호', () => {
  it('덮여 있는 동안은 보호가 이어지고, 걷힌 뒤 1.5초 남는다 · 따라다니는 봇은 쏘지 않는다', () => {
    const { s, mapOf } = party()
    const [me, bot] = s.players
    const shots0 = bot.shots
    // 4초 동안 덮개 (보통 보호는 1.5초)
    for (let t = 0; t < 240; t++) step(s, mapOf, [{ ...idle(), buttons: BTN_LOADING }, { ...idle(), buttons: BTN_FIRE }])
    expect(me.invuln).toBeGreaterThan(80)
    expect(bot.invuln).toBeGreaterThan(80)
    expect(bot.shots).toBe(shots0)
    // 둘레의 잠든 괴물은 덮인 동안 아무도 깨지 않았다 (봇도 쏘지 않았고, 가까이 있어도 알아채지 못한다)
    expect(s.monsters.filter((m) => m.st !== 0 && m.hp > 0 && Math.hypot(m.x - me.x, m.y - me.y) < 12 * 32).length).toBe(0)
    // 걷힌 뒤: 1.5초 남았다가 풀린다
    for (let t = 0; t < 95; t++) step(s, mapOf, [idle(), idle()])
    expect(me.invuln).toBe(0)
  })

  it('들어선 지 12초가 지나면 덮임 신호로 보호를 붙들 수 없다 (남은 1.5초는 흘러 14초에 0)', () => {
    const { s, mapOf } = party()
    for (let t = 0; t < 60 * 14; t++) step(s, mapOf, [{ ...idle(), buttons: BTN_LOADING }, idle()])
    expect(s.players[0].invuln).toBe(0)
  })
})
