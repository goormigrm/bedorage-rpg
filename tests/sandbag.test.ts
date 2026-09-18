// 모래주머니 엄폐 규칙 검증.
//
// 규칙(DESIGN 3.5): 탄은 모래주머니에 막힌다. 단 두 경우에만 넘어간다.
//   1) 쏘는 사람이 모래주머니에 붙어 있을 때(COVER_DIST 이내) — **기대고 있는 그 자루만** 넘어간다
//   2) 그 탄이 상대의 머리를 정확히 겨눈 탄일 때 — 붙어 있지 않아도, 거리에 상관없이 넘어간다
// 그래서 "붙어 있는 쪽은 마음대로 때리고, 밖에 있는 쪽은 정확한 헤드샷으로만 반격할 수 있다".
//
// 2026-09-06 제보로 두 가지를 좁혔다.
//   - COVER_DIST 가 46 이던 때는 **두 칸 떨어진 대각선**도 붙은 것으로 쳤다 → 방향에 따라 탄이 그냥 넘어갔다.
//   - 엄폐 중이면 맵의 **모든** 모래주머니를 통과했다 → 멀리 있는 자루도 뚫렸다.

import { describe, expect, it } from 'vitest'
import { ANGLE_STEPS, radToAngle } from '../src/core/fixedmath'
import { BTN_ADS, BTN_FIRE, Input } from '../src/core/input'
import { COVER_DIST, TILE, TILE_FLOOR, TILE_SANDBAG, buildMap, nearSandbag } from '../src/core/map'
import { createState, step } from '../src/core/sim'
import { GameState, PLAYER_RADIUS } from '../src/core/state'
import { HEAD_FRAC } from '../src/core/weapons'

const IDLE: Input = { mx: 0, my: 0, aim: 0, buttons: 0, char: 0 }

/**
 * 가로로 뚫린 복도 한가운데에 모래주머니 한 줄을 세우고 양쪽에 한 명씩 세운다.
 * A(0)는 모래주머니 **바로 뒤**, B(1)는 멀리.
 */
function scene(gapA: number, gapB: number) {
  const map = buildMap('yard', 1, 7)
  const ty = 12
  // 복도를 깨끗이 비운다
  for (let tx = 1; tx < map.w - 1; tx++) {
    for (let dy = -2; dy <= 2; dy++) map.tiles[(ty + dy) * map.w + tx] = TILE_FLOOR
  }
  const wallTx = 20
  for (let dy = -2; dy <= 2; dy++) map.tiles[(ty + dy) * map.w + wallTx] = TILE_SANDBAG
  // createState 가 map.sandbagIdx 로 모래주머니를 되살리므로 손댄 뒤에는 색인도 다시 만든다
  map.sandbagIdx.length = 0
  for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === TILE_SANDBAG) map.sandbagIdx.push(i)
  const state = createState({ seed: 3, targetKills: 5, chars: ['chim', 'uwon'] }, map)
  const y = ty * TILE + TILE / 2
  const wallX = wallTx * TILE + TILE / 2
  const [a, b] = state.players
  a.x = wallX - gapA
  a.y = y
  b.x = wallX + gapB
  b.y = y
  a.alive = true
  b.alive = true
  a.invuln = 0
  b.invuln = 0
  a.aliveTicks = 999
  b.aliveTicks = 999
  return { map, state, a, b, wallX, y }
}

/**
 * 모래주머니 한 칸만 두고, 쏘는 사람을 그 칸에서 dist 만큼(각도 ang) 떨어뜨린다.
 * "몇 칸 떨어졌을 때 붙은 것으로 치는가" 를 방향별로 보기 위한 장면.
 */
function lone(dist: number, ang: number) {
  const map = buildMap('yard', 1, 7)
  for (let ty = 1; ty < map.h - 1; ty++) for (let tx = 1; tx < map.w - 1; tx++) map.tiles[ty * map.w + tx] = TILE_FLOOR
  const stx = 20
  const sty = 12
  map.tiles[sty * map.w + stx] = TILE_SANDBAG
  map.sandbagIdx.length = 0
  for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === TILE_SANDBAG) map.sandbagIdx.push(i)
  const state = createState({ seed: 3, targetKills: 5, chars: ['chim', 'uwon'] }, map)
  state.phase = 'playing'
  state.phaseTimer = 0
  const cx = stx * TILE + TILE / 2
  const cy = sty * TILE + TILE / 2
  const [a, b] = state.players
  a.x = cx + Math.cos(ang) * dist
  a.y = cy + Math.sin(ang) * dist
  a.alive = true
  a.invuln = 0
  a.aliveTicks = 999
  // 상대는 멀리 치워 둔다 (머리 조준 규칙이 끼어들지 않게)
  b.x = 60
  b.y = 60
  b.alive = true
  return { map, state, a, cx, cy, idx: sty * map.w + stx }
}

/** 모래주머니를 향해 40틱 쏘고, 그 자루가 받은 피해를 돌려준다 */
function shootBag(scene: ReturnType<typeof lone>): number {
  const { map, state, a, cx, cy, idx } = scene
  const aim = radToAngle(Math.atan2(cy - a.y, cx - a.x)) & (ANGLE_STEPS - 1)
  const before = state.sandbags[idx] ?? 0
  for (let t = 0; t < 40; t++) {
    step(state, map, [{ mx: 0, my: 0, aim, buttons: BTN_FIRE, char: 0 }, IDLE])
  }
  return before - (state.sandbags[idx] ?? 0)
}

/** n 틱 동안 shooter 만 주어진 각도로 쏜다. 상대가 잃은 체력을 돌려준다 */
function shoot(state: GameState, map: ReturnType<typeof buildMap>, shooter: number, aim: number, ticks: number, ads = true): number {
  const victim = state.players[1 - shooter]
  const before = victim.hp
  const me = state.players[shooter]
  // 조준점은 상대 위 (헤드샷·머리 조준 관통은 커서가 상대 위에 있어야 난다)
  const aimDist = Math.min(255, Math.round(Math.hypot(victim.x - me.x, victim.y - me.y) / 4))
  for (let i = 0; i < ticks; i++) {
    const inputs: Input[] = [IDLE, IDLE]
    inputs[shooter] = { mx: 0, my: 0, aim, buttons: BTN_FIRE | (ads ? BTN_ADS : 0), char: 0, aimDist }
    // 맞는 쪽은 가만히 있는다
    step(state, map, inputs)
    if (!victim.alive) break
  }
  return before - victim.hp
}

describe('모래주머니 엄폐', () => {
  it('붙어 있는 사람의 탄은 (헤드샷이 아니어도) 넘어간다', () => {
    const { map, state, a, b, wallX } = scene(20, 260)
    expect(nearSandbag(map, a.x, a.y)).toBe(true)
    expect(a.x).toBeLessThan(wallX)
    // 몸통을 겨눈다 — 조준선이 상대 중심에서 벗어나게 살짝 틀어서
    const aim = bodyAim(a.x, a.y, b.x, b.y)
    expect(shoot(state, map, 0, aim, 200)).toBeGreaterThan(0)
  })

  it('붙어 있지 않은 사람의 몸통 사격은 모래주머니에 막힌다', () => {
    const { map, state, a, b } = scene(20, 260)
    expect(nearSandbag(map, b.x, b.y)).toBe(false)
    const aim = bodyAim(b.x, b.y, a.x, a.y)
    expect(shoot(state, map, 1, aim, 200)).toBe(0)
  })

  it('붙어 있지 않아도 머리를 정확히 겨눈 탄은 넘어간다', () => {
    const { map, state, a, b } = scene(20, 260)
    expect(nearSandbag(map, b.x, b.y)).toBe(false)
    // 상대 중심을 정확히 겨눈다
    const aim = radToAngle(Math.atan2(a.y - b.y, a.x - b.x))
    expect(shoot(state, map, 1, aim, 200)).toBeGreaterThan(0)
  })

  it('그래서 붙은 쪽이 유리하다 — 같은 상황에서 몸통 사격의 결과가 반대다', () => {
    const inCover = scene(20, 260)
    const outside = scene(20, 260)
    const hit = shoot(inCover.state, inCover.map, 0, bodyAim(inCover.a.x, inCover.a.y, inCover.b.x, inCover.b.y), 200)
    const blocked = shoot(outside.state, outside.map, 1, bodyAim(outside.b.x, outside.b.y, outside.a.x, outside.a.y), 200)
    expect(hit).toBeGreaterThan(0)
    expect(blocked).toBe(0)
  })

  it('두 칸 떨어지면 **어느 방향에서 쏴도** 막힌다', () => {
    // 예전에는 대각선일 때만 붙은 것으로 쳐서, 같은 거리인데 방향에 따라 탄이 넘어갔다
    for (let d = 0; d < 16; d++) {
      const ang = (d / 16) * Math.PI * 2
      const scene = lone(TILE * 2, ang)
      expect(nearSandbag(scene.map, scene.a.x, scene.a.y)).toBe(false)
      expect(shootBag(scene)).toBeGreaterThan(0)
    }
  })

  it('한 칸이면 어느 방향에서도 붙은 것으로 친다', () => {
    for (let d = 0; d < 16; d++) {
      const ang = (d / 16) * Math.PI * 2
      const scene = lone(TILE, ang)
      expect(nearSandbag(scene.map, scene.a.x, scene.a.y)).toBe(true)
      expect(shootBag(scene)).toBe(0) // 기댄 자루라 넘어간다
    }
  })

  it('엄폐 중이어도 멀리 있는 모래주머니는 막는다', () => {
    // 기댄 자루(w1)는 넘기고, 그 너머 다른 줄(w2)은 막아야 한다.
    // 예전에는 엄폐 중이면 맵의 모든 자루를 통과해서 먼 줄에 흠집도 안 났다.
    const t = twoWalls()
    expect(nearSandbag(t.map, t.a.x, t.a.y)).toBe(true)
    const dmg = shootWalls(t)
    expect(dmg.near).toBe(0) // 기댄 자루는 넘어간다
    expect(dmg.far).toBeGreaterThan(0) // 먼 자루는 막는다
  })

  it('붙는 기준은 COVER_DIST 다 — 조금만 떨어져도 막힌다', () => {
    const near = scene(COVER_DIST - 10, 260)
    const far = scene(COVER_DIST + 30, 260)
    expect(nearSandbag(near.map, near.a.x, near.a.y)).toBe(true)
    expect(nearSandbag(far.map, far.a.x, far.a.y)).toBe(false)
    expect(shoot(near.state, near.map, 0, bodyAim(near.a.x, near.a.y, near.b.x, near.b.y), 200)).toBeGreaterThan(0)
    expect(shoot(far.state, far.map, 0, bodyAim(far.a.x, far.a.y, far.b.x, far.b.y), 200)).toBe(0)
  })
})

/**
 * 복도에 모래주머니 줄을 둘 세운다(20칸·26칸). A 는 앞 줄에 붙어 서서 뒷 줄 쪽으로 쏜다.
 * 상대는 사선 밖으로 치워 둔다 — 머리 조준 규칙(거리 무관 관통)이 끼어들면 판정이 흐려진다.
 */
function twoWalls() {
  const map = buildMap('yard', 1, 7)
  const ty = 12
  for (let tx = 1; tx < map.w - 1; tx++) for (let dy = -2; dy <= 2; dy++) map.tiles[(ty + dy) * map.w + tx] = TILE_FLOOR
  const w1 = 20
  const w2 = 26
  for (let dy = -2; dy <= 2; dy++) {
    map.tiles[(ty + dy) * map.w + w1] = TILE_SANDBAG
    map.tiles[(ty + dy) * map.w + w2] = TILE_SANDBAG
  }
  map.sandbagIdx.length = 0
  for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === TILE_SANDBAG) map.sandbagIdx.push(i)
  const state = createState({ seed: 3, targetKills: 5, chars: ['chim', 'uwon'] }, map)
  state.phase = 'playing'
  state.phaseTimer = 0
  const y = ty * TILE + TILE / 2
  const [a, b] = state.players
  a.x = w1 * TILE + TILE / 2 - 20
  a.y = y
  a.alive = true
  a.invuln = 0
  a.aliveTicks = 999
  b.x = 60
  b.y = 60
  b.alive = true
  return { map, state, a, nearIdx: ty * map.w + w1, farIdx: ty * map.w + w2 }
}

/** 앞·뒤 두 줄이 각각 받은 피해 */
function shootWalls(t: ReturnType<typeof twoWalls>): { near: number; far: number } {
  const n0 = t.state.sandbags[t.nearIdx] ?? 0
  const f0 = t.state.sandbags[t.farIdx] ?? 0
  for (let i = 0; i < 60; i++) {
    step(t.state, t.map, [{ mx: 0, my: 0, aim: 0, buttons: BTN_FIRE | BTN_ADS, char: 0 }, IDLE])
  }
  return {
    near: n0 - (t.state.sandbags[t.nearIdx] ?? 0),
    far: f0 - (t.state.sandbags[t.farIdx] ?? 0),
  }
}

/**
 * 상대 몸통을 겨누는 각도. 조준선이 중심에서 머리 판정 범위(0.28r)보다는 멀고
 * 몸 반지름보다는 가깝게 지나가도록 살짝 튼다.
 */
function bodyAim(sx: number, sy: number, tx: number, ty: number): number {
  const d = Math.hypot(tx - sx, ty - sy)
  const offset = PLAYER_RADIUS * (HEAD_FRAC + 1) * 0.5 // 머리 범위 밖, 몸 안
  const base = Math.atan2(ty - sy, tx - sx)
  const a = radToAngle(base + Math.asin(Math.min(0.9, offset / d)))
  return a & (ANGLE_STEPS - 1)
}
