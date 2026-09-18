// 봇 AI. 매 틱 Input 을 생성한다. sim 과 같은 결정론 규칙을 따른다.
// (Math.random 금지 → 전용 Rng, 삼각함수 → fixedmath)
// 여러 명이 있으면 보이는 적 중 가장 가까운 사람을 표적으로 삼고, 안 보이면 마지막으로 본 곳을 뒤진다.

import { angleDiff, atan2A, cosA, sinA, len } from './fixedmath'
import { BTN_ADS, BTN_DASH, BTN_FIRE, BTN_RELOAD, BTN_SPRINT, BTN_SWAP, Input } from './input'
import { CHARACTER_LIST } from './characters'
import { GameMap, TILE, isWall, rayBlocked } from './map'
import { Rng, makeRng, rand, randInt, randSigned } from './rng'
import { GameState, PlayerState, isEnemy } from './state'
import { WEAPONS, WeaponId } from './weapons'

export type Difficulty = 'easy' | 'normal' | 'hard'

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: '쉬움',
  normal: '보통',
  hard: '어려움',
}

interface DiffDef {
  reaction: number
  aimErr: number
  turnRate: number
  fireChance: number
  useAds: boolean
  dashChance: number
  lead: number
  repathEvery: number
  wobble: number
}

const deg = (d: number) => Math.round((d / 360) * 1024)

// 2026-09-04 전체 하향: 예전 '쉬움'이 지금의 '보통' 정도다
// 2026-09-05 조준 하향: 봇이 사람보다 잘 맞혔다(사용자). 각도 오차·손떨림을 키우고 예측 사격을 줄였다.
//   어려움 aimErr 5.5° → 8°, wobble 3° → 4.5°, lead 0.6 → 0.5 · 보통 11° → 14° · 쉬움 18° → 22°
const DIFFS: Record<Difficulty, DiffDef> = {
  easy: { reaction: 62, aimErr: deg(22), turnRate: 0.07, fireChance: 0.3, useAds: false, dashChance: 0.001, lead: 0, repathEvery: 30, wobble: deg(11) },
  normal: { reaction: 34, aimErr: deg(14), turnRate: 0.12, fireChance: 0.5, useAds: false, dashChance: 0.005, lead: 0.15, repathEvery: 20, wobble: deg(8) },
  hard: { reaction: 16, aimErr: deg(8), turnRate: 0.26, fireChance: 0.8, useAds: true, dashChance: 0.02, lead: 0.5, repathEvery: 10, wobble: deg(4.5) },
}

/** 봇 조준점의 거리 오차 비율 (계측 도구가 바꿔 볼 수 있게 객체). 헤드샷 빈도를 사람이 확정한 11~14% 근처로 맞춘 값 */
export const BOT_AIM = { depthErr: 0.06, sniperErr: 1.8 } // depthErr 2026-09-05 계측: 0 → 헤드샷 39%, 0.08 → 9.5%, 0.25 → 3.6%. 사람이 확정한 11~14% 근처가 0.06
// sniperErr: 저격이 조준경 한 방이 된 뒤(v1.9.5) 봇 저격수는 각도 오차·손떨림을 이만큼 곱한다 — 안 그러면 봇 옥냥덕이 93% 로 판을 찢고, 혼자 하기가 저격 봇에게 계속 한 방에 죽는 판이 된다

const PREFERRED_RANGE: Record<WeaponId, number> = {
  pistol: 210,
  smg: 170,
  rifle: 260,
  shotgun: 110,
  sniper: 380,
  mg: 200,
  pan: 42,
}

/** 봇이 죽었을 때 캐릭터를 바꿀 확률 (2026-09-06 사용자: 봇전에서 봇도 게임 중에 캐릭터를 바꾸게). 계측·시험은 swap 을 끈 봇을 쓴다 */
export const BOT_SWAP = { chance: 0.4 }

export interface BotMemory {
  rng: Rng
  /** 죽었을 때 캐릭터를 바꿔도 되는지 (게임에서는 켬, 밸런스 계측·시험은 끔 — 조합이 흐트러진다) */
  swap: boolean
  /** 이번 죽음에서 바꿀지 이미 정했는지 */
  swapDecided: boolean
  /** 보낼 캐릭터 번호 (CHARACTER_LIST 순서 + 1, 0 = 없음) */
  swapTo: number
  aim: number
  wobbleBias: number
  wobbleTimer: number
  reaction: number
  /** 현재 표적 플레이어 인덱스 (-1 없음) */
  target: number
  lastSeenTick: number
  lastSeenX: number
  lastSeenY: number
  prevEnemyX: number
  prevEnemyY: number
  strafeDir: number
  strafeTimer: number
  wanderX: number
  wanderY: number
  wanderTimer: number
  path: number[]
  pathTick: number
  pathTargetTx: number
  pathTargetTy: number
  stuckX: number
  stuckY: number
  stuckTicks: number
  lastMyHp: number
}

export function makeBot(seed: number, opts: { swap?: boolean } = {}): BotMemory {
  return {
    rng: makeRng(seed),
    swap: opts.swap ?? false,
    swapDecided: false,
    swapTo: 0,
    aim: 0,
    wobbleBias: 0,
    wobbleTimer: 0,
    reaction: 999,
    target: -1,
    lastSeenTick: -10000,
    lastSeenX: 0,
    lastSeenY: 0,
    prevEnemyX: 0,
    prevEnemyY: 0,
    strafeDir: 1,
    strafeTimer: 0,
    wanderX: -1,
    wanderY: -1,
    wanderTimer: 0,
    path: [],
    pathTick: -1000,
    pathTargetTx: -1,
    pathTargetTy: -1,
    stuckX: 0,
    stuckY: 0,
    stuckTicks: 0,
    lastMyHp: 0,
  }
}

/**
 * 표적 고르기. 보이는 적이 있으면 그중 가장 가까운 사람, 없으면 가장 가까운 산 적.
 * 지금 표적은 조금 우대해서 표적이 너무 자주 바뀌지 않게 한다.
 */
function pickTarget(state: GameState, map: GameMap, me: PlayerState, mem: BotMemory): PlayerState | null {
  let best: PlayerState | null = null
  let bestScore = Infinity
  for (const e of state.players) {
    if (!isEnemy(me, e) || !e.alive || e.left) continue
    const d = len(e.x - me.x, e.y - me.y)
    const vis = !rayBlocked(map, me.x, me.y, e.x, e.y)
    let score = vis ? d : d + 600
    if (e.id === mem.target) score -= 150
    if (score < bestScore) {
      bestScore = score
      best = e
    }
  }
  if (best && best.id !== mem.target) {
    mem.target = best.id
    mem.prevEnemyX = best.x
    mem.prevEnemyY = best.y
    mem.lastSeenTick = -10000
    mem.path = []
  }
  if (!best) mem.target = -1
  return best
}

export function botInput(
  state: GameState,
  map: GameMap,
  meIdx: number,
  mem: BotMemory,
  diff: Difficulty,
): Input {
  const d = DIFFS[diff]
  const me = state.players[meIdx]
  const w = WEAPONS[me.weapon]
  const out: Input = { mx: 0, my: 0, aim: mem.aim, buttons: 0, char: 0 }
  if (!me.alive) {
    mem.reaction = d.reaction
    // 죽어 있는 동안 한 번만 정한다: 확률로 다른 캐릭터를 고르고, Tab + 캐릭터 번호를 한 틱에 보내면 sim 이 그 틱에 바꾼다
    if (mem.swap && !mem.swapDecided && state.phase === 'playing') {
      mem.swapDecided = true
      if (rand(mem.rng) < BOT_SWAP.chance) {
        let k = randInt(mem.rng, 0, CHARACTER_LIST.length - 1)
        if (CHARACTER_LIST[k].id === me.char) k = (k + 1) % CHARACTER_LIST.length
        mem.swapTo = k + 1
      }
    }
    if (mem.swapTo > 0 && !me.choosing) {
      out.buttons |= BTN_SWAP
      out.char = mem.swapTo
      mem.swapTo = 0
    }
    return out
  }
  mem.swapDecided = false

  const enemy = state.phase === 'playing' ? pickTarget(state, map, me, mem) : null

  let dist = 0
  let dx = 0
  let dy = 0
  let enemyVx = 0
  let enemyVy = 0
  let los = false
  if (enemy) {
    enemyVx = enemy.x - mem.prevEnemyX
    enemyVy = enemy.y - mem.prevEnemyY
    mem.prevEnemyX = enemy.x
    mem.prevEnemyY = enemy.y
    dx = enemy.x - me.x
    dy = enemy.y - me.y
    dist = len(dx, dy)
    los = !rayBlocked(map, me.x, me.y, enemy.x, enemy.y)
  }

  if (los && enemy) {
    mem.lastSeenTick = state.tick
    mem.lastSeenX = enemy.x
    mem.lastSeenY = enemy.y
    if (mem.reaction > 0) mem.reaction--
  } else {
    mem.reaction = Math.min(d.reaction, mem.reaction + 1)
  }

  // ---- 조준 ----
  if (mem.wobbleTimer <= 0) {
    mem.wobbleBias = Math.round(randSigned(mem.rng) * d.wobble * (WEAPONS[me.weapon].lethalAds ? BOT_AIM.sniperErr : 1))
    mem.wobbleTimer = randInt(mem.rng, 20, 60)
  }
  mem.wobbleTimer--

  let desired = mem.aim
  if (los && enemy) {
    // 리드샷: 탄속 기준 예상 도달 시간 만큼 앞을 겨냥
    const t = (dist / w.speed) * d.lead
    const tx = enemy.x + enemyVx * t - me.x
    const ty = enemy.y + enemyVy * t - me.y
    desired = atan2A(ty, tx)
  } else if (enemy && state.tick - mem.lastSeenTick < 240) {
    desired = atan2A(mem.lastSeenY - me.y, mem.lastSeenX - me.x)
  } else if (me.moving || mem.path.length > 0) {
    // 이동 방향을 바라봄
    const nx = mem.wanderX - me.x
    const ny = mem.wanderY - me.y
    if (nx !== 0 || ny !== 0) desired = atan2A(ny, nx)
  }
  const err = Math.round(randSigned(mem.rng) * d.aimErr * (w.lethalAds ? BOT_AIM.sniperErr : 1)) + mem.wobbleBias
  const target = (desired + err) & 1023
  const diffA = angleDiff(target, mem.aim)
  mem.aim = (mem.aim + Math.round(diffA * d.turnRate)) & 1023
  out.aim = mem.aim
  // 조준점은 표적 쪽. 단 **거리에도 ±25% 오차**를 준다 — 사람은 커서 깊이가 정확하지만 봇에게까지 그러면
  // 각도 오차가 작을 때마다 "커서가 상대 위"(= 맞으면 헤드샷)가 돼 헤드샷 기계가 된다(2026-09-05 소총 헤드샷 39%).
  // 표적이 없으면 조준점 없음
  out.aimDist = enemy ? Math.min(255, Math.max(1, Math.round((dist * (1 + randSigned(mem.rng) * BOT_AIM.depthErr)) / 4))) : 0

  // ---- 사격 ----
  const range = PREFERRED_RANGE[me.weapon]
  const canSee = los && mem.reaction === 0
  const onTarget = Math.abs(angleDiff(mem.aim, desired)) < deg(6) + Math.max(0, deg(10) - dist / 40)
  const inRange = w.melee ? dist < (w.meleeRange ?? 60) + 12 : dist < range * 1.9
  if (enemy && canSee && onTarget && inRange && enemy.invuln === 0) {
    if (rand(mem.rng) < d.fireChance) {
      // 반자동 무기는 눌렀다 떼야 하므로 격틱 발사
      if (w.auto || state.tick % 2 === 0) out.buttons |= BTN_FIRE
    }
    // 저격총은 조준경 없이는 개머리판이라, 난이도와 상관없이 후려칠 거리 밖이면 조준경을 켠다
    if (((d.useAds && dist > 180) || (w.bash && dist > (w.bash.range + 20))) && me.dashTimer === 0) out.buttons |= BTN_ADS
  }
  if (!los && me.ammo < w.magSize * 0.4 && me.reloadTimer === 0) out.buttons |= BTN_RELOAD

  // ---- 이동 ----
  let goalX = -1
  let goalY = -1
  let mode: 'fight' | 'hunt' | 'wander' = 'wander'
  if (enemy && los) {
    mode = 'fight'
  } else if (enemy && state.tick - mem.lastSeenTick < 600) {
    mode = 'hunt'
    goalX = mem.lastSeenX
    goalY = mem.lastSeenY
  } else if (enemy && diff === 'hard') {
    // 어려움: 상대 위치를 어렴풋이 안다 (레이더)
    mode = 'hunt'
    goalX = enemy.x
    goalY = enemy.y
  } else if (enemy && diff === 'normal') {
    // 보통: 넓은 맵에서 영영 못 만나지 않도록, 상대 근처(±10타일)를 배회 목표로 삼는다
    mode = 'wander'
    if (mem.wanderX < 0 || mem.wanderTimer <= 0 || len(mem.wanderX - me.x, mem.wanderY - me.y) < 24) {
      pickWanderNear(map, mem, enemy.x, enemy.y, 10 * TILE)
    }
  }

  // 다쳤으면 가까운 힐팩을 주우러 간다. 안 그러면 봇만 손해라 대전이 한쪽으로 기운다
  if (me.hp < me.maxHp * 0.65 && state.medkits.length > 0) {
    let bx = 0
    let by = 0
    let bd = Infinity
    for (const m of state.medkits) {
      const d = len(m.x - me.x, m.y - me.y)
      // 교전 중이면 아주 가까운 것만, 아니면 좀 멀어도 주우러 간다
      if (d > (mode === 'fight' ? 220 : 620) || d >= bd) continue
      bd = d
      bx = m.x
      by = m.y
    }
    if (bd < Infinity) {
      mode = 'hunt'
      goalX = bx
      goalY = by
    }
  }

  if (mode === 'fight' && enemy) {
    if (mem.strafeTimer <= 0) {
      mem.strafeDir = rand(mem.rng) < 0.5 ? -1 : 1
      mem.strafeTimer = randInt(mem.rng, 30, 80)
    }
    mem.strafeTimer--
    const ux = dist > 0 ? dx / dist : 1
    const uy = dist > 0 ? dy / dist : 0
    let fx = 0
    let fy = 0
    if (dist > range + 50) {
      fx += ux
      fy += uy
    } else if (dist < range - 50) {
      fx -= ux
      fy -= uy
    }
    // 스트레이프 (수직 방향). 근접 무기는 옆으로 새지 않고 곧장 파고든다
    const strafe = w.melee ? 0.25 : 0.9
    fx += -uy * mem.strafeDir * strafe
    fy += ux * mem.strafeDir * strafe
    if (w.melee && dist > range) {
      fx += ux * 1.6
      fy += uy * 1.6
    }
    // 벽에 막히면 스트레이프 방향 전환
    const px = me.x + fx * 24
    const py = me.y + fy * 24
    if (isWall(map, Math.floor(px / TILE), Math.floor(py / TILE))) {
      mem.strafeDir = -mem.strafeDir
      mem.strafeTimer = randInt(mem.rng, 30, 80)
      fx = -fx
      fy = -fy
    }
    toDir8(out, fx, fy)
    // 회피 대시: 상대가 방금 쐈거나 내가 맞았을 때
    const gotHit = me.hp < mem.lastMyHp
    const enemyJustFired = enemy.fireCooldown === WEAPONS[enemy.weapon].fireInterval
    if (w.melee && me.dashCooldown === 0 && me.stamina >= 40 && dist > 90 && dist < 420 && (out.mx !== 0 || out.my !== 0)) {
      out.buttons |= BTN_DASH // 굴러서 거리를 좁힌다
    } else if (
      me.dashCooldown === 0 &&
      (out.mx !== 0 || out.my !== 0) &&
      (gotHit || enemyJustFired) &&
      rand(mem.rng) < d.dashChance * 8
    ) {
      out.buttons |= BTN_DASH
    } else if (me.dashCooldown === 0 && (out.mx !== 0 || out.my !== 0) && rand(mem.rng) < d.dashChance) {
      out.buttons |= BTN_DASH
    }
  } else {
    if (mode === 'wander') {
      if (mem.wanderX < 0 || mem.wanderTimer <= 0 || len(mem.wanderX - me.x, mem.wanderY - me.y) < 24) {
        pickWander(map, mem)
      }
      mem.wanderTimer--
      goalX = mem.wanderX
      goalY = mem.wanderY
    } else {
      mem.wanderX = goalX
      mem.wanderY = goalY
    }
    followPath(state, map, me, mem, d, goalX, goalY, out)
  }

  // 달리기: 멀리 갈 때만. 기력이 절반 넘게 남았을 때만 써서 **구르기 몫을 남긴다** —
  // 다 써 버리면 회피를 못 해 봇이 눈에 띄게 약해진다.
  if (
    (out.mx !== 0 || out.my !== 0) &&
    me.stamina > me.staminaMax * 0.75 &&
    (out.buttons & (BTN_ADS | BTN_DASH)) === 0 &&
    mode !== 'fight'
  ) {
    out.buttons |= BTN_SPRINT
  }

  // 끼임 감지
  if (out.mx !== 0 || out.my !== 0) {
    if (len(me.x - mem.stuckX, me.y - mem.stuckY) < 0.6) mem.stuckTicks++
    else mem.stuckTicks = 0
    if (mem.stuckTicks > 20) {
      pickWander(map, mem)
      mem.path = []
      mem.stuckTicks = 0
      mem.strafeDir = -mem.strafeDir
    }
  } else {
    mem.stuckTicks = 0
  }
  mem.stuckX = me.x
  mem.stuckY = me.y
  mem.lastMyHp = me.hp
  return out
}

/** 어떤 지점 근처(반경 radius px)의 바닥 타일을 배회 목표로. 못 찾으면 아무 곳 */
function pickWanderNear(map: GameMap, mem: BotMemory, cx: number, cy: number, radius: number): void {
  for (let tries = 0; tries < 20; tries++) {
    const px = cx + randSigned(mem.rng) * radius
    const py = cy + randSigned(mem.rng) * radius
    const tx = Math.floor(px / TILE)
    const ty = Math.floor(py / TILE)
    if (tx <= 0 || ty <= 0 || tx >= map.w - 1 || ty >= map.h - 1) continue
    if (!isWall(map, tx, ty)) {
      mem.wanderX = tx * TILE + TILE / 2
      mem.wanderY = ty * TILE + TILE / 2
      mem.wanderTimer = randInt(mem.rng, 180, 420)
      mem.path = []
      return
    }
  }
  pickWander(map, mem)
}

function pickWander(map: GameMap, mem: BotMemory): void {
  for (let tries = 0; tries < 20; tries++) {
    const tx = randInt(mem.rng, 1, map.w - 1)
    const ty = randInt(mem.rng, 1, map.h - 1)
    if (!isWall(map, tx, ty)) {
      mem.wanderX = tx * TILE + TILE / 2
      mem.wanderY = ty * TILE + TILE / 2
      mem.wanderTimer = randInt(mem.rng, 180, 420)
      mem.path = []
      return
    }
  }
}

/** BFS 로 다음 웨이포인트를 찾아 8방향 입력으로 변환 */
function followPath(
  state: GameState,
  map: GameMap,
  me: PlayerState,
  mem: BotMemory,
  d: DiffDef,
  goalX: number,
  goalY: number,
  out: Input,
): void {
  const gtx = Math.floor(goalX / TILE)
  const gty = Math.floor(goalY / TILE)
  const mtx = Math.floor(me.x / TILE)
  const mty = Math.floor(me.y / TILE)
  const needRepath =
    mem.path.length === 0 ||
    state.tick - mem.pathTick > d.repathEvery ||
    gtx !== mem.pathTargetTx ||
    gty !== mem.pathTargetTy
  if (needRepath) {
    mem.path = bfs(map, mtx, mty, gtx, gty)
    mem.pathTick = state.tick
    mem.pathTargetTx = gtx
    mem.pathTargetTy = gty
  }
  // 현재 타일과 같은 웨이포인트는 건너뜀
  while (mem.path.length > 0) {
    const n = mem.path[0]
    const ntx = n % map.w
    const nty = Math.floor(n / map.w)
    if (ntx === mtx && nty === mty) mem.path.shift()
    else break
  }
  let tx = goalX
  let ty = goalY
  if (mem.path.length > 0) {
    const n = mem.path[0]
    tx = (n % map.w) * TILE + TILE / 2
    ty = Math.floor(n / map.w) * TILE + TILE / 2
  }
  toDir8(out, tx - me.x, ty - me.y)
}

function toDir8(out: Input, fx: number, fy: number): void {
  const l = len(fx, fy)
  if (l < 0.01) {
    out.mx = 0
    out.my = 0
    return
  }
  const a = atan2A(fy, fx)
  // 8 방향 양자화 (128 스텝 단위)
  const oct = Math.round(a / 128) & 7
  const ca = cosA(oct * 128)
  const sa = sinA(oct * 128)
  out.mx = ca > 0.3 ? 1 : ca < -0.3 ? -1 : 0
  out.my = sa > 0.3 ? 1 : sa < -0.3 ? -1 : 0
}

/** 4방향 BFS. 시작 제외, 목표 포함 타일 인덱스 배열 반환. */
function bfs(map: GameMap, sx: number, sy: number, gx: number, gy: number): number[] {
  const w = map.w
  const h = map.h
  const start = sy * w + sx
  const goal = gy * w + gx
  if (start === goal) return []
  if (isWall(map, gx, gy)) return []
  const prev = new Int32Array(w * h).fill(-1)
  const queue: number[] = [start]
  prev[start] = start
  let head = 0
  const dirs = [1, -1, w, -w]
  while (head < queue.length) {
    const cur = queue[head++]
    if (cur === goal) break
    const cx = cur % w
    const cy = (cur - cx) / w
    for (let i = 0; i < 4; i++) {
      const nx = cx + (i === 0 ? 1 : i === 1 ? -1 : 0)
      const ny = cy + (i === 2 ? 1 : i === 3 ? -1 : 0)
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const n = cur + dirs[i]
      if (prev[n] !== -1) continue
      if (isWall(map, nx, ny)) continue
      prev[n] = cur
      queue.push(n)
    }
  }
  if (prev[goal] === -1) return []
  const path: number[] = []
  let c = goal
  while (c !== start) {
    path.push(c)
    c = prev[c]
  }
  path.reverse()
  return path
}
