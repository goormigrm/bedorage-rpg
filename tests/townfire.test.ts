// 대기실(마을)에서도 쏘기 · 스킬 (2026-10-09 사용자: "대기실에서도 스킬 및 좌클릭 할 수 있게 해줘").
// 예전에는 마을이 안전지대라 사격 · 정조준 · 스킬 · 궁극기 · 포털 단추를 모두 막았다. 이제 포털만 막는다 — 체력은 그대로 가득 찬다
import { describe, expect, it } from 'vitest'
import { BTN_FIRE, BTN_PORTAL, BTN_SKILL1, Input } from '../src/core/input'
import { createState, step } from '../src/core/sim'
import { ACTS, buildAreaMap, isTown } from '../src/core/world'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })

function inTown(buttons: number, ticks = 30) {
  const town = ACTS[0].town
  const map = buildAreaMap(5, town)
  const s = createState({ area: town, seed: 5, chars: ['chim'] }, () => map)
  const p = s.players[0]
  p.focus = 100
  p.cd = p.cd.map(() => 0)
  const seen = new Set<string>()
  for (let t = 0; t < ticks; t++) {
    step(s, map, [{ ...idle(), buttons }])
    for (const e of s.events) seen.add(e.type)
  }
  return { s, p, seen, town }
}

describe('대기실에서도 쏘기 · 스킬', () => {
  it('좌클릭(사격)이 된다', () => {
    const { p, seen, town } = inTown(BTN_FIRE)
    expect(isTown(p.area)).toBe(true)
    expect(p.area).toBe(town)
    expect(seen.has('fire')).toBe(true)
  })
  it('스킬이 된다', () => {
    const { seen } = inTown(BTN_SKILL1)
    expect(seen.has('skill')).toBe(true)
  })
  it('포털은 여전히 막는다 · 체력은 가득', () => {
    const { s, p } = inTown(BTN_PORTAL, 400)
    expect(s.portals.length).toBe(0)
    expect(p.hp).toBe(p.maxHp)
  })
})
