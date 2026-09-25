// 동료 봇 AI (협동). 매 틱 Input 을 만든다. sim 과 같은 결정론 규칙(전용 Rng · fixedmath)을 따른다.
// 덕의 PvP 봇을 대신한다: 표적은 몬스터, 이끄는 사람(0번)을 따라다니고, 쓰러진 동료를 일으킨다.
// 이끄는 사람이 없으면(0번 자신이거나 모두 봇) 가장 가까운 몬스터를 찾아 던전을 스스로 돈다 — 자동 시험·방 지키기용.
//
// 봇의 기억(BotMemory)은 상태 밖이라 P2P 에서는 호스트가 봇 입력을 만들어 보낸다(덕 DESIGN 8.6 그대로).

import { angleDiff, atan2A, cosA, sinA, len } from './fixedmath'
import { BTN_DASH, BTN_FIRE, BTN_USE, Input, SKILL_BTNS } from './input'
import { GameMap, TILE, isWallAt, rayBlocked } from './map'
import { ACID, MONSTER_LIST, isGiant } from './monsters'
import { Rng, makeRng, rand, randSigned } from './rng'
import { GameState, MS_SLEEP, MS_WINDUP, Monster, PlayerState, ZONE_ACID, ZONE_FUSE, ZONE_WARN, isActive, isHumanSeat } from './state'
import { inZone, zoneEscape } from './bosszone'
import { WEAPONS, WeaponId } from './weapons'
import { SKILLS, baseSkill, focusCost, nodeSkill, slotNode } from './skills'
import { flowField, flowStep } from './flow'

export type Difficulty = 'easy' | 'normal' | 'hard'

/** 봇의 **실력** 이름. 게임 난이도(보통 · 악몽 · 지옥)와 헷갈리지 않게 사람 실력처럼 부른다
 *  (2026-09-20 사용자: "쉬움/보통/어려움은 봇의 AI 수준 같은데 게임의 난이도인지 헷갈리게 되어 있어") */
export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: '초보',
  normal: '보통',
  hard: '고수',
}

/** 그 실력이 무엇을 뜻하는지 (대기실 설명) */
export const DIFFICULTY_HINT: Record<Difficulty, string> = {
  easy: '천천히 조준하고 잘 피하지 못합니다',
  normal: '사람만큼 조준하고 피합니다',
  hard: '빠르게 조준하고 스킬도 잘 씁니다',
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
  revolver: 220,
  flamer: 110,
  crossbow: 260,
  doublebarrel: 90,
  railgun: 360,
  launcher: 240,
  wok: 36,
  violin: 34,
  cello: 40,
  rapier: 62,
  katana: 68,
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

/** 방패병이 방패를 이쪽으로 들고 있나 (정면이면 탄이 막힌다) */
function guarding(m: Monster, me: PlayerState): boolean {
  const g = MONSTER_LIST[m.kind].guard
  if (!g || m.st === MS_SLEEP || m.stun > 0) return false
  return Math.abs(angleDiff(atan2A(me.y - m.y, me.x - m.x), m.aim)) <= g
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
      // 보스 방의 보스는 사람이 먼저 친 뒤에 (2026-09-25 사용자) — 봇이 먼저 쏘면 사람은 준비도 못 한 채 싸움이 시작됐다.
      // 봇이 **사람 자리**를 몰 때(계측 도구 · 영상 자동 조종)는 사람처럼 먼저 친다 — 안 그러면 넷 다 기다리기만 해 보스전이 열리지 않았다
      if (m.hitTick < 0 && isGiant(m) && !isHumanSeat(me)) continue
      const raw = len(m.x - me.x, m.y - me.y)
      if (raw > range) continue
      // 방패를 이쪽으로 든 방패병은 뒤로 미룬다 (다른 표적이 있으면 그쪽부터)
      const d = raw * (guarding(m, me) ? 2.5 : 1)
      if (d >= bestD) continue
      if (m.st === MS_SLEEP && raw > range * 0.7) continue
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
    // (조준경이 없어진 뒤로 저격도 정조준 이득이 작다 — 정조준하면 0.6배로 걸어 한 바퀴가 너무 느려졌다. 봇은 쓰지 않는다)
    // 거리 유지 (방패가 이쪽을 보면 옆으로 돌아 들어간다)
    const pref = PREFERRED_RANGE[me.weapon]
    if (guarding(target, me) && !w.melee) {
      fx = -(target.y - me.y) * mem.strafeDir + (target.x - me.x) * 0.3
      fy = (target.x - me.x) * mem.strafeDir + (target.y - me.y) * 0.3
    } else if (w.melee || d > pref * 1.15) {
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
        if (m.hp <= 0 || isWallAt(map, m.x, m.y)) continue
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

  // 5-2) 땅 위험: 산성 웅덩이 · 폭발 예고 원 · 떨어질 자리(토사꾼·포격 악마 예고) 안이면 밖으로 (터지기 직전이면 구른다)
  if (rand(mem.rng) < 0.3 + diff.dodge) {
    for (const z of state.zones) {
      if (z.owner !== -1 || (z.kind !== ZONE_ACID && z.kind !== ZONE_FUSE && z.kind !== ZONE_WARN) || z.wait) continue
      // 보스 범위는 모양이 여럿이다 (원 · 고리 · 줄 · 부채 — core/bosszone.ts): 모양에 맞게 빠져나간다
      if (!inZone(z, me.x, me.y, 18)) continue
      const e = zoneEscape(z, me.x, me.y)
      fx = e.x
      fy = e.y
      if (z.kind !== ZONE_ACID && z.t < 14 && rand(mem.rng) < diff.dodge) out.buttons |= BTN_DASH
      break
    }
    for (const m of state.monsters) {
      if (m.hp <= 0 || m.st !== MS_WINDUP || m.mode !== 0) continue
      const def = MONSTER_LIST[m.kind]
      if (def.attack !== 'lob') continue
      const r = (def.blast ?? ACID.r) + 18
      if (len(me.x - m.ax, me.y - m.ay) > r) continue
      fx = me.x - m.ax || 1
      fy = me.y - m.ay
      break
    }
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
  useSkills(state, me, mem, out, target, downed)
  return out
}

/**
 * 동료 봇의 스킬: 싸우는 중이면 Q·E 를 준비되는 대로, 궁극기는 몰릴 때(가까운 깨어난 괴물 5마리 이상) 또는 동료가 쓰러졌을 때(대수술).
 * 치유 스킬(응급 처치)은 누가 다쳤을 때만. 너무 기계적으로 쓰지 않게 틱마다 작은 확률로 누른다.
 */
function useSkills(state: GameState, me: PlayerState, mem: BotMemory, out: Input, target: Monster | null, downed: PlayerState | null): void {
  let near = 0
  for (const m of state.monsters) if (m.hp > 0 && m.st !== MS_SLEEP && len(m.x - me.x, m.y - me.y) < 300) near++
  const hurt = state.players.some((p) => p.alive && !p.downed && !p.left && p.hp < p.maxHp * 0.6 && len(p.x - me.x, p.y - me.y) < 190)
  for (let k = 0; k < SKILL_BTNS.length; k++) {
    if ((me.cd[k] ?? 0) > 0) continue
    const node = slotNode(me, k)
    if (node < 0) continue
    const id = nodeSkill(me, node)
    if (k !== 2 && state.mode === 'dungeon' && me.focus < focusCost(SKILLS[id], me.build, node)) continue
    let want: boolean
    const bid = baseSkill(id)
    if (bid === 'firstaid') want = hurt
    else if (bid === 'surgery') want = !!downed || (hurt && near >= 4)
    else if (k === 2) want = near >= 5
    else want = !!target && len(target.x - me.x, target.y - me.y) < 320
    if (want && rand(mem.rng) < 0.06) {
      out.buttons |= SKILL_BTNS[k]
      return
    }
  }
}
