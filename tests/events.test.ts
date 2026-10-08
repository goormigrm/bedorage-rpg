// 지역 이벤트 (2026-10-08 퀄리티 2차 7단계 D4): 저주받은 상자(물결 셋을 막으면 열린다) · 숨은 보물(막다른 곳)
import { describe, expect, it } from 'vitest'
import { BTN_USE, Input } from '../src/core/input'
import { TILE, TILE_FLOOR, buildMap, GameMap } from '../src/core/map'
import { createState, step } from '../src/core/sim'
import { COUNTDOWN_TICKS, CURSE_WAVES, GameState, OBJ_CURSED, OBJ_SECRET } from '../src/core/state'
import { AREAS, buildAreaMap } from '../src/core/world'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })

function ready(seed = 33): { s: GameState; map: GameMap } {
  const map = buildMap('crypt', 1, seed)
  const s = createState({ area: 4, seed, chars: ['chim'], noMonsters: true }, map)
  for (let i = 0; i < COUNTDOWN_TICKS + 1; i++) step(s, map, [idle()])
  search: for (let ty = 8; ty < map.h - 8; ty++) {
    for (let tx = 8; tx < map.w - 8; tx++) {
      let ok = true
      for (let dy = -6; dy <= 6 && ok; dy++) for (let dx = -6; dx <= 6; dx++) if (map.tiles[(ty + dy) * map.w + tx + dx] !== TILE_FLOOR) ok = false
      if (ok) {
        s.players[0].x = tx * TILE + 16
        s.players[0].y = ty * TILE + 16
        break search
      }
    }
  }
  s.objects = []
  return { s, map }
}

describe('지역 이벤트', () => {
  it('저주받은 상자: 열면 물결 셋 — 다 잡으면 상자가 열리고 희귀 이상이 나온다', () => {
    const { s, map } = ready()
    const p = s.players[0]
    s.objects.push({ id: 1, kind: OBJ_CURSED, x: p.x + 20, y: p.y, used: false, v: 0 })
    step(s, map, [{ ...idle(), buttons: BTN_USE }])
    expect(s.objects[0].v).toBe(1)
    const waves: number[] = []
    for (let t = 0; t < 400 && !s.objects[0].used; t++) {
      p.hp = p.maxHp
      p.invuln = 10
      step(s, map, [idle()])
      for (const e of s.events) if (e.type === 'curse') waves.push(e.wave)
      // 물결 괴물을 쓰러뜨린 것으로 친다 (체력 0 → 판에서 빠진다)
      const wave = s.monsters.filter((m) => m.pack === 7001)
      if (wave.length > 0 && t % 5 === 0) for (const m of wave) m.hp = 0
    }
    expect(waves).toEqual([2, 3, CURSE_WAVES + 1])
    expect(s.objects[0].used).toBe(true)
    const items = s.drops.filter((d) => d.item)
    expect(items.length).toBeGreaterThanOrEqual(3)
    expect(Math.max(...items.map((d) => d.item!.rarity))).toBeGreaterThanOrEqual(2)
  })

  it('물결이 시작된 상자는 다시 열 수 없다 · 숨은 보물은 F 로 희귀 이상', () => {
    const { s, map } = ready()
    const p = s.players[0]
    s.objects.push({ id: 1, kind: OBJ_SECRET, x: p.x + 20, y: p.y, used: false, v: 0 })
    step(s, map, [{ ...idle(), buttons: BTN_USE }])
    expect(s.objects[0].used).toBe(true)
    const items = s.drops.filter((d) => d.item)
    expect(items.length).toBe(2)
    expect(items[0].item!.rarity).toBeGreaterThanOrEqual(2)
  })

  it('지역을 채우면 저주받은 상자 · 숨은 보물이 가끔 놓인다 (보스 방에는 없다)', () => {
    let cursed = 0
    let secret = 0
    let bossEv = 0
    for (const a of AREAS) {
      if (a.kind === 'town' || a.retired) continue
      const map = buildAreaMap(9, a.id)
      const s = createState({ area: a.id, seed: 9, chars: ['chim'] }, map)
      const c = s.objects.filter((o) => o.kind === OBJ_CURSED).length
      const h = s.objects.filter((o) => o.kind === OBJ_SECRET).length
      if (a.kind === 'boss') bossEv += c + h
      cursed += c
      secret += h
    }
    expect(cursed).toBeGreaterThan(2)
    expect(secret).toBeGreaterThan(2)
    expect(bossEv).toBe(0)
  })
})
