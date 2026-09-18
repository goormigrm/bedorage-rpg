// 동료 봇 AI (협동). 매 틱 Input 을 만든다. sim 과 같은 결정론 규칙(전용 Rng · fixedmath)을 따른다.
// 덕의 PvP 봇을 대신한다: 표적은 몬스터, 이끄는 사람(0번)을 따라다니고, 쓰러진 동료를 일으킨다.
// 이끄는 사람이 없으면(0번 자신이거나 모두 봇) 가장 가까운 몬스터를 찾아 던전을 스스로 돈다 — 자동 시험·방 지키기용.
//
// 봇의 기억(BotMemory)은 상태 밖이라 P2P 에서는 호스트가 봇 입력을 만들어 보낸다(덕 DESIGN 8.6 그대로).

import { angleDiff, atan2A, cosA, sinA, len } from './fixedmath'
import { BTN_ADS, BTN_DASH, BTN_FIRE, BTN_RELOAD, BTN_USE, Input } from './input'
import { GameMap, TILE, rayBlocked } from './map'
import { MONSTER_LIST } from './monsters'
import { Rng, makeRng, rand, randSigned } from './rng'
import { GameState, MS_SLEEP, MS_WINDUP, Monster, PlayerState, isActive } from './state'
import { WEAPONS, WeaponId } from './weapons'
import { flowField, flowStep } from './flow'

export type Difficulty = 'easy' | 'normal' | 'hard'

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: '쉬움',
  normal: '보통',
  hard: '어려움',
}

interface DiffDef {
  aimErr: number
  wobble: number
  turnRate: number
  fireChance: number
  dodge: number
}

const deg = (d: number) => Math.round((d / 360) * 1024)

const DIFFS: Record<Difficulty, DiffDef> = {
  easy: { aimErr: deg(12), wobble: deg(8), turnRate: 0.12, fireChance: 0.5, dodge: 0.1 },
  normal: { aimErr: deg(7), wobble: deg(5), turnRate: 0.2, fireChance: 0.8, dodge: 0.35 },
  hard: { aimErr: deg(4), wobble: deg(3), turnRate: 0.32, fireChance: 0.95, dodge: 0.7 },
}

/** 무기별로 서고 싶은 거리 (px) */
const PREFERRED_RANGE: Record<WeaponId, number> = {
  pistol: 200,
  smg: 170,
  rifle: 240,
  shotgun: 100,
  sniper: 330,
  mg: 190,
  pan: 30,
}

export interface BotMemory {
  rng: Rng
  aim: number
  wobbleBias: number
  wobbleTimer: number
  /** 노리는 몬스터 id (-1 없음) */
  target: number
  /** 표적이 보이는가 (레이캐스트는 몇 틱에 한 번) */
  seen: boolean
  seenTick: number
  strafeDir: number
  strafeTimer: number
  /** 같은 자리에 오래 있으면 옆으로 비킨다 */
  stuckX: number
  stuckY: number
  stuckTicks: number
  /** 덕 봇과의 호환 (세션이 켠다) — 협동에서는 캐릭터를 바꾸지 않는다 */
  swap: boolean
}

export function makeBot(seed: number, opts: { swap?: boolean } = {}): BotMemory {
  return {
    rng: makeRng(seed),
    aim: 0,
    wobbleBias: 0,
    wobbleTimer: 0,
    target: -1,
    seen: false,
    seenTick: -1000,
    strafeDir: 1,
    strafeTimer: 0,
    stuckX: 0,
    stuckY: 0,
    stuckTicks: 0,
    swap: opts.swap ?? false,
  }
}

/** 월드 방향 → 8방향 입력 */
function toDir8(out: Input, fx: number, fy: number): void {
  const l = len(fx, fy)
  if (l < 0.001) {
    out.mx = 0
    out.my = 0
    return
  }
  const nx = fx / l
  const ny = fy / l
  out.mx = nx > 0.38 ? 1 : nx < -0.38 ? -1 : 0
  out.my = ny > 0.38 ? 1 : ny < -0.38 ? -1 : 0
}

/** (x,y) 에서 목표점으로 가는 방향 — 보이고 가까우면 곧장, 아니면 흐름장 */
function pathDir(state: GameState, map: GameMap, x: number, y: number, gx: number, gy: number): { x: number; y: number } {
  const d = len(gx - x, gy - y)
  if (d < 5 * TILE && !rayBlocked(map, x, y, gx, gy)) return { x: gx - x, y: gy - y }
  const field = flowField(map, Math.floor(gy / TILE) * map.w + Math.floor(gx / TILE))
  const s = flowStep(map, field, x, y)
  if (!s) return { x: gx - x, y: gy - y }
  void state
  return { x: s.x - x, y: s.y - y }
}

function findMonster(state: GameState, id: number): Monster | null {
  for (const m of state.monsters) if (m.id === id && m.hp > 0) return m
  return null
}

/** 이끄는 사람: 0번(방장·혼자 하기의 나). 내가 0번이거나 0번이 못 움직이면 없음 → 스스로 던전을 돈다 */
function leaderOf(state: GameState, me: PlayerState): PlayerState | null {
  const p0 = state.players[0]
  if (me.id === 0 || !p0 || !isActive(p0)) return null
  return p0
}

export function botInput(state: GameState, map: GameMap, idx: number, mem: BotMemory, diffId: Difficulty = 'normal'): Input {
  const diff = DIFFS[diffId]
  const me = state.players[idx]
  const out: Input = { mx: 0, my: 0, aim: mem.aim & 1023, buttons: 0, char: 0, aimDist: 0 }
  if (!me || !me.alive || me.left || me.downed || state.phase !== 'playing') return out
  const w = WEAPONS[me.weapon]
  const tick = state.tick

  // 1) 쓰러진 동료가 가까우면 일으키러 간다 (몬스터가 코앞이 아니면)
  let downed: PlayerState | null = null
  for (const p of state.players) {
    if (p.id === idx || !p.alive || !p.downed || p.left) continue
    if (len(p.x - me.x, p.y - me.y) > 12 * TILE) continue
    if (!downed || len(p.x - me.x, p.y - me.y) < len(downed.x - me.x, downed.y - me.y)) downed = p
  }

  // 2) 표적: 사거리 안에서 보이는 깨어 있는 몬스터 중 가장 가까운 것. 20틱마다 다시 고른다
  let target = mem.target >= 0 ? findMonster(state, mem.target) : null
  const range = Math.max(PREFERRED_RANGE[me.weapon] * 1.6, 260)
  if (!target || (tick + idx) % 20 === 0) {
    let best: Monster | null = null
    let bestD = Infinity
    for (const m of state.monsters) {
      if (m.hp <= 0) continue
      const d = len(m.x - me.x, m.y - me.y)
      if (d > range || d >= bestD) continue
      if (m.st === MS_SLEEP && d > range * 0.7) continue
      if (rayBlocked(map, me.x, me.y, m.x, m.y)) continue
      best = m
      bestD = d
    }
    target = best
    mem.target = best ? best.id : -1
  }
  if (target && (tick + idx) % 6 === 0) mem.seen = !rayBlocked(map, me.x, me.y, target.x, target.y)

  // 3) 조준: 표적(없으면 가는 방향)으로 천천히 돈다 + 손떨림
  if (mem.wobbleTimer-- <= 0) {
    mem.wobbleTimer = 20 + Math.floor(rand(mem.rng) * 30)
    mem.wobbleBias = Math.round(randSigned(mem.rng) * diff.wobble)
  }
  let fx = 0
  let fy = 0
  if (target) {
    const d = len(target.x - me.x, target.y - me.y)
    // 느린 몬스터라 예측은 조금만
    const want = (atan2A(target.y - me.y, target.x - me.x) + mem.wobbleBias + Math.round(randSigned(mem.rng) * diff.aimErr * 0.3)) & 1023
    const diffA = angleDiff(want, mem.aim)
    mem.aim = (mem.aim + Math.round(diffA * diff.turnRate) + (Math.abs(diffA) < 4 ? diffA : 0)) & 1023
    out.aimDist = Math.min(255, Math.round(d / 4))
    const err = Math.abs(angleDiff(want, mem.aim))
    if (mem.seen && err < deg(10) && rand(mem.rng) < diff.fireChance && d < range) out.buttons |= BTN_FIRE
    if (w.scope && d > 220 && mem.seen) out.buttons |= BTN_ADS
    // 거리 유지
    const pref = PREFERRED_RANGE[me.weapon]
    if (w.melee || d > pref * 1.15) {
      const dir = pathDir(state, map, me.x, me.y, target.x, target.y)
      fx = dir.x
      fy = dir.y
    } else if (d < pref * 0.7) {
      fx = me.x - target.x
      fy = me.y - target.y
    } else {
      // 옆걸음
      if (mem.strafeTimer-- <= 0) {
        mem.strafeTimer = 40 + Math.floor(rand(mem.rng) * 60)
        mem.strafeDir = rand(mem.rng) < 0.5 ? 1 : -1
      }
      fx = -(target.y - me.y) * mem.strafeDir
      fy = (target.x - me.x) * mem.strafeDir
    }
  } else {
    if (me.ammo < w.magSize * 0.6 && me.reloadTimer === 0 && w.magSize > 0) out.buttons |= BTN_RELOAD
  }

  // 4) 표적이 없을 때: 쓰러진 동료 → 이끄는 사람 → (없으면) 가장 가까운 몬스터를 찾아간다
  if (downed && (!target || len(target.x - me.x, target.y - me.y) > 150)) {
    const d = len(downed.x - me.x, downed.y - me.y)
    if (d > 36) {
      const dir = pathDir(state, map, me.x, me.y, downed.x, downed.y)
      fx = dir.x
      fy = dir.y
    } else {
      fx = 0
      fy = 0
    }
    if (d <= 48) out.buttons |= BTN_USE
  } else if (!target) {
    const lead = leaderOf(state, me)
    if (lead) {
      const d = len(lead.x - me.x, lead.y - me.y)
      if (d > 3 * TILE) {
        const dir = pathDir(state, map, me.x, me.y, lead.x, lead.y)
        fx = dir.x
        fy = dir.y
      }
    } else {
      // 스스로 돈다: 가장 가까운 몬스터(직선 거리)로 흐름장을 따라간다
      let best: Monster | null = null
      let bestD = Infinity
      for (const m of state.monsters) {
        if (m.hp <= 0) continue
        const d = (m.x - me.x) ** 2 + (m.y - me.y) ** 2
        if (d < bestD) {
          bestD = d
          best = m
        }
      }
      if (best) {
        const dir = pathDir(state, map, me.x, me.y, best.x, best.y)
        fx = dir.x
        fy = dir.y
      }
    }
    if (fx !== 0 || fy !== 0) {
      const want = atan2A(fy, fx)
      mem.aim = (mem.aim + Math.round(angleDiff(want, mem.aim) * 0.15)) & 1023
    }
  }

  // 5) 피하기: 나를 노리고 예고 중인 몬스터가 가까우면 옆으로 구른다
  for (const m of state.monsters) {
    if (m.hp <= 0 || m.st !== MS_WINDUP || m.target !== idx || m.t > 12) continue
    const def = MONSTER_LIST[m.kind]
    const d = len(m.x - me.x, m.y - me.y)
    if (d > (def.attack === 'ranged' ? 999 : def.attack === 'explode' ? (def.blast ?? 80) + 30 : 70)) continue
    if (rand(mem.rng) >= diff.dodge * 0.25) continue
    const side = rand(mem.rng) < 0.5 ? 1 : -1
    fx = -(m.y - me.y) * side
    fy = (m.x - me.x) * side
    if (def.attack === 'explode') {
      fx = me.x - m.x
      fy = me.y - m.y
    }
    out.buttons |= BTN_DASH
    break
  }

  // 6) 끼였으면 조금 비킨다
  if (fx !== 0 || fy !== 0) {
    if (len(me.x - mem.stuckX, me.y - mem.stuckY) < 0.5) mem.stuckTicks++
    else mem.stuckTicks = 0
    mem.stuckX = me.x
    mem.stuckY = me.y
    if (mem.stuckTicks > 30) {
      const a = Math.floor(rand(mem.rng) * 1024)
      fx = cosA(a)
      fy = sinA(a)
      if (mem.stuckTicks > 50) mem.stuckTicks = 0
    }
  }
  toDir8(out, fx, fy)
  out.aim = mem.aim & 1023
  return out
}
