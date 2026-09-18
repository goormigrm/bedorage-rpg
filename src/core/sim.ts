// 결정론 시뮬레이션: 플레이어(덕에서 물려받은 이동·사격·구르기) + 몬스터(AI·공격) + 쓰러짐·부활 + 회복 구슬.
// 규칙은 DESIGN 2장 — Math.random/삼각함수/시간 금지, 모든 기억은 GameState 안.

import { CHARACTERS, CharacterId } from './characters'
import { angleDiff, atan2A, cosA, sinA, len } from './fixedmath'
import { BTN_ADS, BTN_DASH, BTN_FIRE, BTN_RELOAD, BTN_SPRINT, BTN_USE, Input } from './input'
import { COVER_DIST, GameMap, SANDBAG_HP, TILE, TILE_SANDBAG, isWallAt, nearSandbag, rayBlocked, rayCast } from './map'
import { BashDef } from './weapons'
import { circlesOverlap, moveCircle, pointLineDistance, segmentHitsCircle } from './physics'
import { makeRng, rand } from './rng'
import { DEATH_BLAST_MULT, MONSTER_LIST, MonsterDef } from './monsters'
import { entryOf, populate } from './dungeon'
import { Grid, flowField, flowStep } from './flow'
import {
  BLEED_TICKS,
  BLOCK_CHANCE,
  BLOCK_COST,
  BLOCK_LOCK_TICKS,
  Bullet,
  COUNTDOWN_TICKS,
  CHIM,
  DASH_COST,
  DASH_SPEED,
  DASH_TICKS,
  GIYEOL,
  GLOBE_HEAL_FRAC,
  GLOBE_RADIUS,
  GLOBE_SHARE_FRAC,
  GLOBE_SHARE_RANGE,
  GLOBE_TTL,
  GameState,
  JUPEOL,
  MAX_PLAYERS,
  MIN_PLAYERS,
  MS_CHASE,
  MS_RECOVER,
  MS_SLEEP,
  MS_WINDUP,
  MatchConfig,
  Monster,
  PLAYER_RADIUS,
  PUNGWOL,
  PlayerState,
  RESPAWN_TICKS,
  REVIVE_HP_FRAC,
  REVIVE_RANGE,
  REVIVE_TICKS,
  SOLO_BLEED_TICKS,
  SPAWN_PROTECT_TICKS,
  SPRINT_COST,
  SPRINT_MIN,
  SPRINT_MUL,
  STAMINA_MAX,
  STAMINA_REGEN,
  UWON,
  isActive,
} from './state'
import { HEAD_AIM_FRAC, PART_HEAD, WEAPONS, falloff, headMult, partForOffset } from './weapons'

const MAX_RECOIL_MUL = 3
/** 잠든 무리가 깨는 거리 (시야 반경 13칸보다 조금 짧다 — 보이고 나서 깬다) */
const WAKE_RANGE = 11 * TILE
/**
 * 총소리: 쏜 자리에서 이 거리 안의 잠든 무리가 깬다 (벽 너머도 — 소리니까). 한 방씩 조용히 정리하지 못하게 해서
 * 무리를 몰고 다니는 디아블로식 압박을 만든다. **소음기 권총(단군덕)은 깨우지 않는다** — 덕의 소음기가 여기서 정찰이 된다
 */
const NOISE_RANGE = 7 * TILE
/** 이 거리 안에서 표적이 보이면 흐름장 대신 곧장 다가간다 */
const DIRECT_RANGE = 6 * TILE
/** 몬스터가 한 틱에 돌 수 있는 각도 (1024 단위) */
const TURN = 40
const TURN_WINDUP = 8

/** 틱 안에서만 쓰는 폭발 대기열 (틱이 끝나면 늘 비어 있다 → 상태가 아니다) */
const booms: { x: number; y: number; r: number; dmg: number; by: number }[] = []
const grids = new WeakMap<GameMap, Grid>()

function gridFor(map: GameMap): Grid {
  let g = grids.get(map)
  if (!g) {
    g = new Grid(map.pw, map.ph)
    grids.set(map, g)
  }
  return g
}

function buildGrid(state: GameState, map: GameMap): Grid {
  const g = gridFor(map)
  const ms = state.monsters
  g.build(
    ms.length,
    (i) => ms[i].x,
    (i) => ms[i].y,
    (i) => ms[i].hp > 0,
  )
  return g
}

// ---------------------------------------------------------------- 만들기

export function createState(cfg: MatchConfig, map: GameMap): GameState {
  const rng = makeRng(cfg.seed)
  const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, cfg.chars.length))
  const players: PlayerState[] = []
  for (let i = 0; i < n; i++) {
    const p = makePlayer(i, cfg.chars[i])
    // 아직 아무도 안 들어온 자리는 판에 나오지 않는다 (난입하면 그때 채운다)
    if (cfg.absent?.[i]) {
      p.left = true
      p.vacant = true
      p.alive = false
      p.hp = 0
    }
    players.push(p)
  }
  const entry = entryOf(map)
  const state: GameState = {
    tick: 0,
    rng,
    phase: 'countdown',
    phaseTimer: COUNTDOWN_TICKS,
    deathRule: cfg.deathRule ?? 0,
    players,
    bullets: [],
    nextBulletId: 1,
    monsters: [],
    nextMonsterId: 1,
    mshots: [],
    nextShotId: 1,
    globes: [],
    nextGlobeId: 1,
    entryX: entry.x,
    entryY: entry.y,
    monstersTotal: 0,
    winner: -1,
    sandbags: {},
    events: [],
  }
  // 같은 맵 객체로 다시 시작해도 똑같이 시작하도록 부서진 모래주머니를 되돌린다
  for (const i of map.sandbagIdx) {
    map.tiles[i] = TILE_SANDBAG
    state.sandbags[i] = SANDBAG_HP
  }
  map.version++
  // 모두 입구에 모여서 시작한다 (협동)
  for (const p of players) {
    if (p.left) continue
    const s = spotNear(state, map, entry.x, entry.y, p.id)
    p.x = s.x
    p.y = s.y
    p.aim = atan2A(map.ph / 2 - p.y, map.pw / 2 - p.x)
  }
  if (!cfg.noMonsters) populate(state, map, cfg.seed, n)
  return state
}

function makePlayer(id: number, char: CharacterId): PlayerState {
  const c = CHARACTERS[char]
  const w = WEAPONS[c.weapon]
  return {
    id,
    team: 0,
    char,
    x: 0,
    y: 0,
    aim: 0,
    hp: c.maxHp,
    maxHp: c.maxHp,
    alive: true,
    downed: false,
    downTimer: 0,
    revive: 0,
    out: false,
    respawnTimer: 0,
    weapon: c.weapon,
    ammo: w.magSize,
    reloadTimer: 0,
    fireCooldown: 0,
    recoil: 0,
    ads: false,
    aimDist: 0,
    dashTimer: 0,
    dashCooldown: 0,
    dashDx: 0,
    dashDy: 0,
    lastHitTick: -10000,
    prevFire: false,
    kills: 0,
    deaths: 0,
    legInjury: 0,
    invuln: SPAWN_PROTECT_TICKS,
    moving: false,
    sprinting: false,
    aliveTicks: 0,
    left: false,
    vacant: false,
    choosing: false,
    streak: 0,
    stamina: c.staminaMax ?? STAMINA_MAX,
    staminaMax: c.staminaMax ?? STAMINA_MAX,
    blockLock: 0,
    shots: 0,
    hits: 0,
    heads: 0,
    dmgDealt: 0,
    dmgTaken: 0,
    bestStreak: 0,
    killStreak: 0,
    revives: 0,
  }
}

/**
 * (x,y) 근처에서 벽·다른 사람과 겹치지 않는 자리. 자리 번호마다 다른 쪽부터 찾아 넷이 한 점에 겹치지 않는다.
 * 격자 순서가 고정이라 결정론이다.
 */
function spotNear(state: GameState, map: GameMap, x: number, y: number, seat: number): { x: number; y: number } {
  const OFF = [
    [0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1], [-1, 1], [1, -1], [-1, -1],
    [2, 0], [0, 2], [2, 1], [1, 2], [-2, 0], [0, -2], [2, 2], [-2, 1], [1, -2],
  ]
  for (let k = 0; k < OFF.length; k++) {
    const [ox, oy] = OFF[(k + seat) % OFF.length]
    const sx = x + ox * 30
    const sy = y + oy * 30
    if (isWallAt(map, sx - PLAYER_RADIUS, sy - PLAYER_RADIUS) || isWallAt(map, sx + PLAYER_RADIUS, sy - PLAYER_RADIUS)) continue
    if (isWallAt(map, sx - PLAYER_RADIUS, sy + PLAYER_RADIUS) || isWallAt(map, sx + PLAYER_RADIUS, sy + PLAYER_RADIUS)) continue
    let clash = false
    for (const o of state.players) {
      if (o.id === seat || o.left || !o.alive) continue
      if (circlesOverlap(sx, sy, PLAYER_RADIUS, o.x, o.y, PLAYER_RADIUS)) {
        clash = true
        break
      }
    }
    if (!clash) return { x: sx, y: sy }
  }
  return { x, y }
}

// ---------------------------------------------------------------- 틱

export function step(state: GameState, map: GameMap, inputs: Input[]): void {
  const ev = state.events
  ev.length = 0

  if (state.phase === 'countdown') {
    state.phaseTimer--
    if (state.phaseTimer <= 0) {
      state.phase = 'playing'
      ev.push({ type: 'start' })
    }
  }

  // 근접 휘두르기·조준 판정이 쓸 격자 (몬스터가 움직이기 전 위치)
  buildGrid(state, map)
  for (let i = 0; i < state.players.length; i++) stepPlayer(state, map, state.players[i], inputs[i])
  stepDowned(state, inputs)
  if (state.phase === 'playing') stepMonsters(state, map)
  const grid = buildGrid(state, map)
  separate(state, map, grid)
  stepBullets(state, map, grid)
  stepShots(state, map)
  runBooms(state, map, grid)
  // 쓰러진 몬스터를 뺀다 (순서 유지)
  if (state.monsters.some((m) => m.hp <= 0)) state.monsters = state.monsters.filter((m) => m.hp > 0)
  stepGlobes(state)
  checkOver(state)
  state.tick++
}

function checkOver(state: GameState): void {
  if (state.phase !== 'playing') return
  if (state.monstersTotal > 0 && state.monsters.length === 0) {
    state.phase = 'over'
    state.winner = 0
    state.events.push({ type: 'over', winner: 0 })
    return
  }
  // 하드코어: 모두가 탈락하면 전멸 (다른 규칙은 입구에서 다시 일어나므로 끝나지 않는다)
  const seated = state.players.filter((p) => !p.left)
  if (seated.length > 0 && seated.every((p) => p.out)) {
    state.phase = 'over'
    state.winner = 1
    state.events.push({ type: 'over', winner: 1 })
  }
}

// ---------------------------------------------------------------- 플레이어

/**
 * 빈 자리에 사람을 넣는다 (난입). 호스트가 정한 틱에 **모두가 같이** 호출해야 결정론이 유지된다.
 * 협동이라 동료 곁에 내려 준다(아무도 없으면 입구).
 */
export function joinPlayer(state: GameState, map: GameMap, idx: number, char: CharacterId, _team = 0): void {
  const p = state.players[idx]
  if (!p) return
  Object.assign(p, makePlayer(idx, char))
  const buddy = state.players.find((o) => o.id !== idx && isActive(o))
  const s = spotNear(state, map, buddy ? buddy.x : state.entryX, buddy ? buddy.y : state.entryY, idx)
  p.x = s.x
  p.y = s.y
  state.events.push({ type: 'join', p: idx, char })
}

/** 경기 도중 나간 사람 처리 (호스트가 정한 틱에 모두가 같이 호출해야 결정론이 유지된다) */
export function dropPlayer(state: GameState, idx: number): void {
  const p = state.players[idx]
  if (!p || p.left) return
  p.left = true
  p.alive = false
  p.downed = false
  p.hp = 0
  p.respawnTimer = 0
  state.events.push({ type: 'leave', p: idx })
}

function stepPlayer(state: GameState, map: GameMap, p: PlayerState, input: Input | undefined): void {
  const c = CHARACTERS[p.char]
  const w = WEAPONS[p.weapon]
  p.moving = false
  if (p.left) return
  if (!input) input = { mx: 0, my: 0, aim: p.aim, buttons: 0, char: 0 }
  const playing = state.phase === 'playing'

  if (!p.alive) {
    if (state.phase === 'over' || p.out) return
    if (p.respawnTimer > 0) p.respawnTimer--
    if (p.respawnTimer <= 0) respawn(state, map, p)
    return
  }
  // 쓰러진 사람은 바라보는 방향만 바꿀 수 있다 (진행은 stepDowned)
  if (p.downed) {
    p.aim = input.aim & 1023
    p.ads = false
    p.sprinting = false
    return
  }

  if (playing) p.aliveTicks++
  if (p.fireCooldown > 0) p.fireCooldown--
  if (p.dashCooldown > 0) p.dashCooldown--
  if (p.blockLock > 0) p.blockLock--
  // 달리기: 회복보다 먼저 계산해야 달리는 동안 기력이 차지 않는다 (덕 그대로)
  p.sprinting =
    playing &&
    (input.mx !== 0 || input.my !== 0) &&
    p.dashTimer === 0 &&
    p.stamina >= (p.sprinting ? Number.MIN_VALUE : SPRINT_MIN) &&
    p.stamina > 0 &&
    (input.buttons & BTN_SPRINT) !== 0 &&
    (input.buttons & BTN_ADS) === 0
  if (p.sprinting) p.stamina = Math.max(0, p.stamina - SPRINT_COST)
  if (p.dashTimer === 0 && p.blockLock === 0 && !p.sprinting && p.stamina < p.staminaMax) {
    p.stamina = Math.min(p.staminaMax, p.stamina + STAMINA_REGEN * (w.melee ? 2.4 : 1))
  }
  if (p.invuln > 0) p.invuln--
  if (p.legInjury > 0) p.legInjury--
  if (p.reloadTimer > 0) {
    p.reloadTimer--
    if (p.reloadTimer === 0) p.ammo = w.magSize
  }
  const recover = c.id === 'chim' ? w.recoilRecover * CHIM.recoverMul : w.recoilRecover
  p.recoil = Math.max(0, p.recoil - recover)

  // 매직덕 패시브(진료): 3초 안 맞으면 초당 6 회복
  if (c.id === 'magic' && state.tick - p.lastHitTick > 180 && p.hp < p.maxHp) {
    p.hp = Math.min(p.maxHp, p.hp + 6 / 60)
  }

  p.aim = input.aim & 1023
  p.aimDist = (input.aimDist ?? 0) * 4
  p.ads = playing && (input.buttons & BTN_ADS) !== 0 && p.dashTimer === 0

  // 이동
  let mx = input.mx
  let my = input.my
  if (!playing) {
    mx = 0
    my = 0
  }
  if (p.dashTimer > 0) {
    p.dashTimer--
    const r = moveCircle(map, p.x, p.y, PLAYER_RADIUS, p.dashDx * DASH_SPEED, p.dashDy * DASH_SPEED)
    p.x = r.x
    p.y = r.y
    p.moving = true
  } else if (mx !== 0 || my !== 0) {
    const inv = mx !== 0 && my !== 0 ? 0.70710678 : 1
    let speed = c.speed * w.moveMul
    if (p.sprinting) speed *= SPRINT_MUL
    if (p.ads && c.id !== 'oknyang') speed *= 0.6 // 옥냥덕 패시브: 정조준해도 느려지지 않음
    if (p.legInjury > 0) speed *= 0.7
    const r = moveCircle(map, p.x, p.y, PLAYER_RADIUS, mx * inv * speed, my * inv * speed)
    p.x = r.x
    p.y = r.y
    p.moving = true
  }

  // 구르기
  const dashCost = c.id === 'pungwol' ? PUNGWOL.dashCost : DASH_COST
  if (playing && input.buttons & BTN_DASH && p.dashCooldown === 0 && p.dashTimer === 0 && p.stamina >= dashCost && (mx !== 0 || my !== 0)) {
    p.stamina -= dashCost
    const inv = mx !== 0 && my !== 0 ? 0.70710678 : 1
    p.dashDx = mx * inv
    p.dashDy = my * inv
    p.dashTimer = c.id === 'juwoojae' ? Math.round(DASH_TICKS * 1.3) : DASH_TICKS
    p.dashCooldown = c.dashCooldown
    p.ads = false
    if (c.id === 'uwon') p.invuln = Math.max(p.invuln, p.dashTimer + UWON.invulnAfterDash)
    state.events.push({ type: 'dash', p: p.id })
  }

  // 재장전
  if (playing && input.buttons & BTN_RELOAD && p.reloadTimer === 0 && p.ammo < w.magSize) {
    p.reloadTimer = w.reloadTicks
    state.events.push({ type: 'reload', p: p.id })
  }

  // 사격
  const firePressed = (input.buttons & BTN_FIRE) !== 0
  const trigger = w.auto ? firePressed : firePressed && !p.prevFire
  p.prevFire = firePressed
  if (playing && trigger && p.dashTimer === 0) {
    // 저격총을 조준경 없이 쏘면 개머리판 후려치기 (재장전 중에도 가까운 적은 칠 수 있다)
    if (w.bash && !p.ads) {
      if (p.fireCooldown === 0) bashSwing(state, map, p, w.bash)
    } else {
      const infinite = w.magSize === 0
      if (!infinite && p.ammo === 0 && p.reloadTimer === 0) {
        p.reloadTimer = w.reloadTicks
        state.events.push({ type: 'reload', p: p.id })
      } else if (p.fireCooldown === 0 && p.reloadTimer === 0 && (infinite || p.ammo > 0)) {
        fire(state, map, p)
      }
    }
  }
}

/**
 * 쓰러진 사람: 동료가 곁에서 F(BTN_USE)를 누르고 있으면 일어나고, 아니면 시간이 흘러 죽는다.
 * 일으켜 주는 동안에는 시간이 멈춘다. 일으켜 줄 사람이 아무도 없으면(혼자·전원 쓰러짐) 오래 기다릴 이유가 없어 금방 죽는다.
 * 돕는 사람은 번호가 앞선 사람 하나만 친다(순서가 곧 결정론).
 */
function stepDowned(state: GameState, inputs: Input[]): void {
  if (state.phase !== 'playing') return
  for (const p of state.players) {
    if (!p.alive || !p.downed || p.left) continue
    let helper: PlayerState | null = null
    let anyone = false
    for (const q of state.players) {
      if (q.id === p.id || !isActive(q)) continue
      anyone = true
      const btn = inputs[q.id]?.buttons ?? 0
      if (!helper && (btn & BTN_USE) !== 0 && len(q.x - p.x, q.y - p.y) <= REVIVE_RANGE) helper = q
    }
    if (helper) {
      p.revive++
      if (p.revive >= REVIVE_TICKS) {
        p.downed = false
        p.revive = 0
        p.hp = Math.round(p.maxHp * REVIVE_HP_FRAC)
        p.invuln = 90
        helper.revives++
        state.events.push({ type: 'revive', p: p.id, by: helper.id, x: p.x, y: p.y })
      }
      continue
    }
    p.revive = Math.max(0, p.revive - 2)
    if (!anyone) p.downTimer = Math.min(p.downTimer, SOLO_BLEED_TICKS)
    p.downTimer--
    if (p.downTimer <= 0) die(state, p)
  }
}

function die(state: GameState, p: PlayerState): void {
  p.alive = false
  p.downed = false
  p.revive = 0
  p.deaths++
  p.killStreak = 0
  p.respawnTimer = RESPAWN_TICKS
  if (state.deathRule === 2) p.out = true
  state.events.push({ type: 'death', p: p.id, x: p.x, y: p.y, out: p.out })
}

function respawn(state: GameState, map: GameMap, p: PlayerState): void {
  const c = CHARACTERS[p.char]
  const w = WEAPONS[p.weapon]
  const s = spotNear(state, map, state.entryX, state.entryY, p.id)
  p.x = s.x
  p.y = s.y
  p.maxHp = c.maxHp
  p.hp = c.maxHp
  p.alive = true
  p.downed = false
  p.ammo = w.magSize
  p.reloadTimer = 0
  p.fireCooldown = 0
  p.recoil = 0
  p.dashTimer = 0
  p.dashCooldown = 0
  p.legInjury = 0
  p.invuln = SPAWN_PROTECT_TICKS
  p.aliveTicks = 0
  p.lastHitTick = -10000
  p.streak = 0
  p.staminaMax = c.staminaMax ?? STAMINA_MAX
  p.stamina = p.staminaMax
  p.blockLock = 0
  p.sprinting = false
  state.events.push({ type: 'respawn', p: p.id, x: p.x, y: p.y })
}

/** 몬스터가 플레이어를 때린다. 실제로 맞았으면 true (구르는 중·무적이면 false — 투사체는 그대로 지나간다) */
function hurtPlayer(state: GameState, p: PlayerState, dmg: number, by: number, sx: number, sy: number): boolean {
  if (!isActive(p) || p.invuln > 0 || p.dashTimer > 0 || state.phase !== 'playing') return false
  // 후라이팬: 앞에서 오는 공격을 기력으로 막는다 (덕의 규칙 그대로 — 막는 동안 기력이 안 찬다, 확률로만)
  if (WEAPONS[p.weapon].melee) {
    const from = atan2A(sy - p.y, sx - p.x)
    if (Math.abs(angleDiff(from, p.aim)) < 213) {
      p.blockLock = BLOCK_LOCK_TICKS
      if (p.stamina > 0 && rand(state.rng) < BLOCK_CHANCE) {
        const absorbed = Math.min(dmg, Math.floor(p.stamina / BLOCK_COST))
        p.stamina = Math.max(0, p.stamina - absorbed * BLOCK_COST)
        dmg -= absorbed
        state.events.push({ type: 'block', p: p.id, x: p.x, y: p.y })
      }
    }
  }
  if (dmg <= 0) return true
  p.hp -= dmg
  p.dmgTaken += dmg
  p.lastHitTick = state.tick
  state.events.push({ type: 'hurt', p: p.id, by, x: p.x, y: p.y, dmg })
  if (p.hp <= 0) {
    p.hp = 0
    p.downed = true
    p.revive = 0
    p.downTimer = BLEED_TICKS
    p.ads = false
    p.dashTimer = 0
    p.sprinting = false
    p.killStreak = 0
    state.events.push({ type: 'down', p: p.id, x: p.x, y: p.y })
  }
  return true
}

// ---------------------------------------------------------------- 사격

/** 쏠 때 커서(조준점)가 약점 위에 있는 몬스터 id (-1 = 없음). 치명타는 이 몬스터에게만 난다 (덕의 헤드샷 규칙) */
function aimedMonster(state: GameState, map: GameMap, p: PlayerState): number {
  if (p.aimDist <= 0) return -1
  const ax = p.x + cosA(p.aim) * p.aimDist
  const ay = p.y + sinA(p.aim) * p.aimDist
  let found = -1
  gridFor(map).query(ax - 24, ay - 24, ax + 24, ay + 24, (i) => {
    const m = state.monsters[i]
    if (!m || m.hp <= 0) return
    if (len(ax - m.x, ay - m.y) <= MONSTER_LIST[m.kind].r * HEAD_AIM_FRAC && (found < 0 || m.id < found)) found = m.id
  })
  return found
}

/** 부채꼴 안의 몬스터를 모두 친다 (후라이팬 · 개머리판). 반환 = 맞힌 수 */
function swingAt(state: GameState, map: GameMap, p: PlayerState, range: number, arc: number, dmg: number, knock: number): number {
  let n = 0
  const reach = range + PLAYER_RADIUS + 20
  const hit: Monster[] = []
  gridFor(map).query(p.x - reach, p.y - reach, p.x + reach, p.y + reach, (i) => {
    const m = state.monsters[i]
    if (!m || m.hp <= 0) return
    const dx = m.x - p.x
    const dy = m.y - p.y
    const d = len(dx, dy)
    if (d > range + PLAYER_RADIUS + MONSTER_LIST[m.kind].r) return
    if (d > 1 && Math.abs(angleDiff(atan2A(dy, dx), p.aim)) > arc) return
    if (rayCast(map, p.x, p.y, m.x, m.y, 'bullet', true).blocked) return
    hit.push(m)
  })
  // 격자 칸 순서가 아니라 id 순서로 (읽기 쉬운 결정론)
  hit.sort((a, b) => a.id - b.id)
  for (const m of hit) {
    const d = len(m.x - p.x, m.y - p.y) || 1
    const k = knock * (1 - MONSTER_LIST[m.kind].knockRes)
    m.kx += ((m.x - p.x) / d) * k
    m.ky += ((m.y - p.y) / d) * k
    hurtMonster(state, m, dmg, p.id, false, m.x, m.y)
    n++
  }
  return n
}

function bashSwing(state: GameState, map: GameMap, p: PlayerState, bash: BashDef): void {
  p.fireCooldown = bash.interval
  state.events.push({ type: 'bash', p: p.id, x: p.x, y: p.y, aim: p.aim })
  p.shots++
  swingAt(state, map, p, bash.range, bash.arc, bash.damage, 3)
}

function fire(state: GameState, map: GameMap, p: PlayerState): void {
  const w = WEAPONS[p.weapon]
  const spread = Math.round((p.ads ? w.spreadAds : w.spreadHip) * (p.char === 'chim' ? CHIM.spreadMul : 1)) + p.recoil
  let mx = p.x + cosA(p.aim) * (PLAYER_RADIUS + 6)
  let my = p.y + sinA(p.aim) * (PLAYER_RADIUS + 6)
  if (isWallAt(map, mx, my)) {
    mx = p.x
    my = p.y
  }
  if (w.melee) {
    p.fireCooldown = w.fireInterval
    p.shots++
    state.events.push({ type: 'fire', p: p.id, x: mx, y: my, aim: p.aim, weapon: p.weapon })
    const n = swingAt(state, map, p, w.meleeRange ?? 60, w.meleeArc ?? 150, Math.round(w.damage), w.knock)
    if (n > 0) p.streak = Math.min(99, p.streak + 1)
    return
  }
  // 모래주머니에 붙어 쏘면 기댄 자루만 넘어간다 (던전에는 모래주머니가 없지만 덕의 맵에서 시험할 때를 위해 둔다)
  const overR = nearSandbag(map, p.x, p.y) ? COVER_DIST + TILE * 3 : 0
  const headTarget = aimedMonster(state, map, p)
  for (let i = 0; i < w.pellets; i++) {
    const off = spread > 0 ? Math.floor(rand(state.rng) * (spread * 2 + 1)) - spread : 0
    const a = (p.aim + off) & 1023
    const b: Bullet = {
      id: state.nextBulletId++,
      owner: p.id,
      x: mx,
      y: my,
      px: mx,
      py: my,
      vx: cosA(a) * w.speed,
      vy: sinA(a) * w.speed,
      life: w.life,
      damage: w.damage,
      ads: p.ads,
      ox: p.x,
      oy: p.y,
      weapon: p.weapon,
      hitSomeone: false,
      over: false,
      overR,
      headTarget,
    }
    state.bullets.push(b)
  }
  if (w.magSize > 0) p.ammo--
  if (!w.suppressed) noise(state, p.x, p.y)
  p.shots += w.pellets // 명중률을 탄 단위로 재야 산탄총이 왜곡되지 않는다
  p.fireCooldown = w.fireInterval
  p.recoil = Math.min(w.recoil * MAX_RECOIL_MUL * 2, p.recoil + w.recoil * (p.char === 'chim' ? CHIM.recoilMul : 1))
  state.events.push({ type: 'fire', p: p.id, x: mx, y: my, aim: p.aim, weapon: p.weapon })
  if (w.magSize > 0 && p.ammo === 0) {
    p.reloadTimer = w.reloadTicks
    state.events.push({ type: 'reload', p: p.id })
  }
}

function stepBullets(state: GameState, map: GameMap, grid: Grid): void {
  const bullets = state.bullets
  let write = 0
  for (let i = 0; i < bullets.length; i++) {
    const b = bullets[i]
    b.px = b.x
    b.py = b.y
    b.x += b.vx
    b.y += b.vy
    b.life--
    let dead = false

    const near = b.overR > 0 && (b.px - b.ox) ** 2 + (b.py - b.oy) ** 2 <= b.overR * b.overR
    const tileHit = rayCast(map, b.px, b.py, b.x, b.y, 'bullet', b.over || near)
    if (tileHit.blocked) {
      if (tileHit.tile === TILE_SANDBAG) damageSandbag(state, map, tileHit.tx, tileHit.ty, b.damage)
      state.events.push({ type: 'wall', x: b.x, y: b.y, aim: state.players[b.owner].aim })
      dead = true
    }

    if (!dead) {
      // 이 선분에 걸리는 몬스터 중 **가장 먼저 닿는** 것 (같으면 id 가 작은 것)
      let best: Monster | null = null
      let bestT = Infinity
      const sx = b.x - b.px
      const sy = b.y - b.py
      const s2 = sx * sx + sy * sy || 1
      grid.query(Math.min(b.px, b.x) - 24, Math.min(b.py, b.y) - 24, Math.max(b.px, b.x) + 24, Math.max(b.py, b.y) + 24, (k) => {
        const m = state.monsters[k]
        if (!m || m.hp <= 0) return
        const r = MONSTER_LIST[m.kind].r
        if (!segmentHitsCircle(b.px, b.py, b.x, b.y, m.x, m.y, r)) return
        const t = ((m.x - b.px) * sx + (m.y - b.py) * sy) / s2
        if (t < bestT || (t === bestT && best && m.id < best.id)) {
          bestT = t
          best = m
        }
      })
      if (best) {
        applyHit(state, b, best, pointLineDistance((best as Monster).x, (best as Monster).y, b.px, b.py, b.vx, b.vy))
        dead = true
      }
    }

    if (!dead && b.life <= 0) dead = true
    // 맞히지 못하고 사라진 탄 → 기열덕 연속 명중 한 단계 내림
    if (dead && !b.hitSomeone) state.players[b.owner].streak = Math.max(0, state.players[b.owner].streak - 1)
    if (!dead) bullets[write++] = b
  }
  bullets.length = write
}

/** 탄이 몬스터를 맞혔다. dOff = 탄 궤적과 몬스터 중심 사이 거리 */
function applyHit(state: GameState, b: Bullet, m: Monster, dOff: number): void {
  const w = WEAPONS[b.weapon]
  const def = MONSTER_LIST[m.kind]
  const dist = len(m.x - b.ox, m.y - b.oy)
  // 치명타 = 덕의 헤드샷: 쏠 때 커서가 이 몬스터의 약점 위였고, 그 탄이 이 몬스터를 맞혔다.
  // 산탄은 정중앙을 지나는 탄만 (일곱 개가 전부 치명타가 되면 과하다)
  const crit = b.headTarget === m.id && (w.pellets === 1 || partForOffset(dOff, def.r) === PART_HEAD)
  let dmg = b.damage * (crit ? headMult(w) : 1) * falloff(w, dist)
  const shooter = state.players[b.owner]
  if (shooter.char === 'jupeol' && dist < JUPEOL.range) dmg *= JUPEOL.mult
  if (shooter.char === 'giyeol') dmg *= 1 + Math.min(GIYEOL.maxStacks, shooter.streak) * GIYEOL.perHit
  dmg = Math.round(dmg)
  b.hitSomeone = true
  shooter.streak = Math.min(99, shooter.streak + 1)
  const speed = len(b.vx, b.vy) || 1
  const k = w.knock * (1 - def.knockRes)
  m.kx += (b.vx / speed) * k
  m.ky += (b.vy / speed) * k
  hurtMonster(state, m, dmg, b.owner, crit, b.x, b.y)
}

function damageSandbag(state: GameState, map: GameMap, tx: number, ty: number, dmg: number): void {
  const i = ty * map.w + tx
  const hp = state.sandbags[i]
  if (hp === undefined) return
  const left = hp - dmg
  if (left <= 0) {
    delete state.sandbags[i]
    map.tiles[i] = 0
    map.version++
    state.events.push({ type: 'break', tx, ty })
  } else {
    state.sandbags[i] = left
  }
}

/** 상태(정본)에 맞춰 맵의 모래주머니 타일을 되돌린다 (리싱크 후) */
export function syncSandbags(state: GameState, map: GameMap): void {
  for (const i of map.sandbagIdx) {
    map.tiles[i] = state.sandbags[i] === undefined ? 0 : TILE_SANDBAG
  }
  map.version++
}

// ---------------------------------------------------------------- 몬스터

function wakePack(state: GameState, pack: number, x: number, y: number): void {
  let woke = false
  for (const m of state.monsters) {
    if (m.pack !== pack || m.st !== MS_SLEEP || m.hp <= 0) continue
    m.st = MS_CHASE
    // 한꺼번에 똑같이 움직이지 않게 첫 공격을 조금씩 늦춘다 (id 로 정하므로 결정론)
    m.cd = 10 + (m.id % 5) * 8
    woke = true
  }
  if (woke) state.events.push({ type: 'wake', pack, x, y })
}

/** 총소리가 닿는 잠든 무리를 깨운다 (무리 번호 순서로) */
function noise(state: GameState, x: number, y: number): void {
  let last = -1
  for (const m of state.monsters) {
    if (m.st !== MS_SLEEP || m.hp <= 0 || m.pack === last) continue
    if ((m.x - x) ** 2 + (m.y - y) ** 2 > NOISE_RANGE * NOISE_RANGE) continue
    last = m.pack
    wakePack(state, m.pack, m.x, m.y)
  }
}

function hurtMonster(state: GameState, m: Monster, dmg: number, by: number, crit: boolean, x: number, y: number): void {
  if (m.hp <= 0 || dmg <= 0) return
  const shooter = by >= 0 ? state.players[by] : null
  if (shooter) {
    shooter.hits++
    if (crit) shooter.heads++
    shooter.dmgDealt += Math.min(dmg, m.hp)
  }
  m.hp -= dmg
  m.hitTick = state.tick
  if (by >= 0) m.lastBy = by
  if (m.st === MS_SLEEP) wakePack(state, m.pack, m.x, m.y)
  state.events.push({ type: 'mhit', m: m.id, by, x, y, dmg, crit })
  if (m.hp <= 0) killMonster(state, m, by, false)
}

/** suicide = 부푼 시체가 스스로 터짐 (처치 기록·구슬 없음) */
function killMonster(state: GameState, m: Monster, by: number, suicide: boolean): void {
  const def = MONSTER_LIST[m.kind]
  m.hp = 0
  state.events.push({ type: 'mdeath', m: m.id, kind: m.kind, by: suicide ? -1 : by, x: m.x, y: m.y, aim: m.aim })
  if (!suicide) {
    const killer = by >= 0 ? state.players[by] : null
    if (killer) {
      killer.kills++
      killer.killStreak++
      if (killer.killStreak > killer.bestStreak) killer.bestStreak = killer.killStreak
    }
    if (rand(state.rng) < def.globe) {
      state.globes.push({ id: state.nextGlobeId++, x: m.x, y: m.y, ttl: GLOBE_TTL })
      state.events.push({ type: 'drop', x: m.x, y: m.y })
    }
    // 쓰러뜨려도 터진다 — 약하게
    if (def.attack === 'explode') booms.push({ x: m.x, y: m.y, r: def.blast ?? 80, dmg: Math.round(def.dmg * DEATH_BLAST_MULT), by })
  }
}

/** 폭발 대기열을 비운다. 폭발이 다른 부푼 시체를 쓰러뜨리면 그것도 대기열에 들어가 이어 터진다 */
function runBooms(state: GameState, map: GameMap, grid: Grid): void {
  while (booms.length > 0) {
    const b = booms.shift()!
    state.events.push({ type: 'boom', x: b.x, y: b.y, r: b.r })
    for (const p of state.players) {
      if (!isActive(p)) continue
      if (len(p.x - b.x, p.y - b.y) > b.r + PLAYER_RADIUS) continue
      if (rayBlocked(map, b.x, b.y, p.x, p.y)) continue
      hurtPlayer(state, p, b.dmg, -1, b.x, b.y)
    }
    const hit: Monster[] = []
    grid.query(b.x - b.r - 20, b.y - b.r - 20, b.x + b.r + 20, b.y + b.r + 20, (i) => {
      const m = state.monsters[i]
      if (!m || m.hp <= 0) return
      if (len(m.x - b.x, m.y - b.y) > b.r + MONSTER_LIST[m.kind].r) return
      hit.push(m)
    })
    hit.sort((a, c) => a.id - c.id)
    for (const m of hit) {
      const d = len(m.x - b.x, m.y - b.y) || 1
      const k = 6 * (1 - MONSTER_LIST[m.kind].knockRes)
      m.kx += ((m.x - b.x) / d) * k
      m.ky += ((m.y - b.y) / d) * k
      hurtMonster(state, m, b.dmg, b.by, false, m.x, m.y)
    }
  }
}

function turnToward(cur: number, want: number, max: number): number {
  const d = angleDiff(want, cur)
  if (d > max) return (cur + max) & 1023
  if (d < -max) return (cur - max) & 1023
  return want & 1023
}

function nearestActive(state: GameState, x: number, y: number): number {
  let best = -1
  let bestD = Infinity
  for (const p of state.players) {
    if (!isActive(p)) continue
    const d = (p.x - x) ** 2 + (p.y - y) ** 2
    if (d < bestD) {
      bestD = d
      best = p.id
    }
  }
  return best
}

function stepMonsters(state: GameState, map: GameMap): void {
  const tick = state.tick
  for (const m of state.monsters) {
    if (m.hp <= 0) continue
    const def = MONSTER_LIST[m.kind]
    m.moving = 0
    if (m.st === MS_SLEEP) {
      // 8틱에 한 번만 본다 (잠든 무리가 수십이라 매 틱 레이캐스트는 아깝다)
      if (((tick + m.id) & 7) !== 0) continue
      for (const p of state.players) {
        if (!isActive(p)) continue
        if ((p.x - m.x) ** 2 + (p.y - m.y) ** 2 > WAKE_RANGE * WAKE_RANGE) continue
        if (rayBlocked(map, m.x, m.y, p.x, p.y)) continue
        wakePack(state, m.pack, m.x, m.y)
        break
      }
      continue
    }
    // 넉백: 벽에 막히며 밀리고 금방 줄어든다
    if (m.kx !== 0 || m.ky !== 0) {
      const r = moveCircle(map, m.x, m.y, def.r, m.kx, m.ky)
      m.x = r.x
      m.y = r.y
      m.kx *= 0.72
      m.ky *= 0.72
      if (Math.abs(m.kx) < 0.05) m.kx = 0
      if (Math.abs(m.ky) < 0.05) m.ky = 0
    }
    if (m.stun > 0) {
      m.stun--
      continue
    }
    if (m.cd > 0) m.cd--
    // 표적: 가장 가까운 움직일 수 있는 사람. 30틱마다 다시 고른다 (쓰러지면 바로)
    if (m.target < 0 || !isActive(state.players[m.target]) || (tick + m.id) % 30 === 0) m.target = nearestActive(state, m.x, m.y)
    if (m.target < 0) {
      if (m.st !== MS_CHASE) m.st = MS_CHASE
      continue
    }
    const tp = state.players[m.target]
    const dx = tp.x - m.x
    const dy = tp.y - m.y
    const d = len(dx, dy)
    if ((tick + m.id) % 10 === 0) m.los = rayBlocked(map, m.x, m.y, tp.x, tp.y) ? 0 : 1
    const face = atan2A(dy, dx)

    if (m.st === MS_CHASE) {
      m.aim = turnToward(m.aim, face, TURN)
      let attack = false
      let away = false
      let hold = false
      if (def.attack === 'melee') {
        attack = m.cd === 0 && m.los === 1 && d - def.r - PLAYER_RADIUS <= def.range
      } else if (def.attack === 'ranged') {
        attack = m.cd === 0 && m.los === 1 && d <= def.range
        const keep = def.keepDist ?? 200
        if (m.los === 1 && d < keep * 0.65) away = true
        else if (m.los === 1 && d <= keep) hold = true
      } else {
        attack = m.los === 1 && d <= def.range
      }
      if (attack) {
        m.st = MS_WINDUP
        m.t = def.windup
        m.aim = face
        m.ax = tp.x
        m.ay = tp.y
        state.events.push({ type: 'windup', m: m.id, kind: m.kind, x: m.x, y: m.y })
      } else if (!hold) {
        moveMonster(map, m, def, tp.x, tp.y, d, away)
      }
    } else if (m.st === MS_WINDUP) {
      if (def.attack === 'melee') m.aim = turnToward(m.aim, face, TURN_WINDUP)
      else if (def.attack === 'ranged') m.aim = atan2A(m.ay - m.y, m.ax - m.x)
      m.t--
      if (m.t <= 0) resolveAttack(state, map, m, def)
    } else if (m.st === MS_RECOVER) {
      m.t--
      if (m.t <= 0) m.st = MS_CHASE
    }
  }
}

function moveMonster(map: GameMap, m: Monster, def: MonsterDef, tx: number, ty: number, d: number, away: boolean): void {
  let dirX: number
  let dirY: number
  if (away || (m.los === 1 && d < DIRECT_RANGE)) {
    dirX = (tx - m.x) / (d || 1)
    dirY = (ty - m.y) / (d || 1)
    if (away) {
      dirX = -dirX
      dirY = -dirY
    }
  } else {
    const field = flowField(map, Math.floor(ty / TILE) * map.w + Math.floor(tx / TILE))
    const s = flowStep(map, field, m.x, m.y)
    const gx = s ? s.x : tx
    const gy = s ? s.y : ty
    const gd = len(gx - m.x, gy - m.y) || 1
    dirX = (gx - m.x) / gd
    dirY = (gy - m.y) / gd
  }
  const speed = away ? def.speed * 0.8 : def.speed
  const r = moveCircle(map, m.x, m.y, def.r, dirX * speed, dirY * speed)
  m.x = r.x
  m.y = r.y
  m.moving = 1
}

function resolveAttack(state: GameState, map: GameMap, m: Monster, def: MonsterDef): void {
  if (def.attack === 'melee') {
    state.events.push({ type: 'swipe', m: m.id, x: m.x, y: m.y, aim: m.aim })
    const reach = def.r + PLAYER_RADIUS + def.range + 8
    for (const p of state.players) {
      if (!isActive(p)) continue
      const dx = p.x - m.x
      const dy = p.y - m.y
      if (len(dx, dy) > reach) continue
      if (Math.abs(angleDiff(atan2A(dy, dx), m.aim)) > (def.arc ?? 180)) continue
      hurtPlayer(state, p, def.dmg, m.id, m.x, m.y)
    }
    m.st = MS_RECOVER
    m.t = def.recover
    m.cd = def.cooldown
  } else if (def.attack === 'ranged') {
    const a = atan2A(m.ay - m.y, m.ax - m.x)
    const sp = def.shotSpeed ?? 5
    const sx = m.x + cosA(a) * (def.r + 4)
    const sy = m.y + sinA(a) * (def.r + 4)
    state.mshots.push({ id: state.nextShotId++, kind: m.kind, x: sx, y: sy, vx: cosA(a) * sp, vy: sinA(a) * sp, life: def.shotLife ?? 80, dmg: def.dmg, r: def.shotR ?? 6 })
    state.events.push({ type: 'mshot', m: m.id, kind: m.kind, x: sx, y: sy })
    m.st = MS_RECOVER
    m.t = def.recover
    m.cd = def.cooldown
  } else {
    // 부풀었다가 터진다 — 스스로 죽는다
    killMonster(state, m, -1, true)
    booms.push({ x: m.x, y: m.y, r: def.blast ?? 80, dmg: def.dmg, by: -1 })
  }
  void map
}

/** 몬스터끼리 겹치지 않게 서로 민다 + 플레이어 몸 안으로는 못 들어온다 (몬스터만 밀린다) */
function separate(state: GameState, map: GameMap, grid: Grid): void {
  const ms = state.monsters
  for (let i = 0; i < ms.length; i++) {
    const a = ms[i]
    if (a.hp <= 0 || a.st === MS_SLEEP) continue
    const ra = MONSTER_LIST[a.kind].r
    grid.query(a.x - 40, a.y - 40, a.x + 40, a.y + 40, (j) => {
      if (j <= i) return
      const b = ms[j]
      if (b.hp <= 0) return
      const rb = MONSTER_LIST[b.kind].r
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d2 = dx * dx + dy * dy
      const rr = ra + rb
      if (d2 >= rr * rr) return
      const d = Math.sqrt(d2)
      // 완전히 겹치면 id 로 정한 방향으로 민다
      const nx = d > 0.001 ? dx / d : (a.id + b.id) % 2 === 0 ? 1 : -1
      const ny = d > 0.001 ? dy / d : 0
      const push = (rr - d) * 0.5
      const ra2 = moveCircle(map, a.x, a.y, ra, -nx * push, -ny * push)
      a.x = ra2.x
      a.y = ra2.y
      if (b.st !== MS_SLEEP) {
        const rb2 = moveCircle(map, b.x, b.y, rb, nx * push, ny * push)
        b.x = rb2.x
        b.y = rb2.y
      }
    })
  }
  for (const p of state.players) {
    if (!p.alive || p.left) continue
    grid.query(p.x - 40, p.y - 40, p.x + 40, p.y + 40, (j) => {
      const m = ms[j]
      if (m.hp <= 0) return
      const r = MONSTER_LIST[m.kind].r
      const dx = m.x - p.x
      const dy = m.y - p.y
      const d = len(dx, dy)
      const rr = r + PLAYER_RADIUS
      if (d >= rr) return
      const nx = d > 0.001 ? dx / d : 1
      const ny = d > 0.001 ? dy / d : 0
      const rm = moveCircle(map, m.x, m.y, r, nx * (rr - d), ny * (rr - d))
      m.x = rm.x
      m.y = rm.y
    })
  }
}

/** 몬스터 투사체: 벽에 막히고, 구르는 사람은 지나간다 */
function stepShots(state: GameState, map: GameMap): void {
  let write = 0
  for (const s of state.mshots) {
    const px = s.x
    const py = s.y
    s.x += s.vx
    s.y += s.vy
    s.life--
    let dead = s.life <= 0
    if (!dead && rayCast(map, px, py, s.x, s.y, 'bullet').blocked) {
      state.events.push({ type: 'shotEnd', x: s.x, y: s.y, kind: s.kind })
      dead = true
    }
    if (!dead) {
      for (const p of state.players) {
        if (!isActive(p)) continue
        if (!segmentHitsCircle(px, py, s.x, s.y, p.x, p.y, PLAYER_RADIUS + s.r)) continue
        if (hurtPlayer(state, p, s.dmg, -1, px, py)) {
          dead = true
          break
        }
      }
    }
    if (!dead) state.mshots[write++] = s
  }
  state.mshots.length = write
}

/** 회복 구슬: 밟은 사람과 가까운 동료가 회복한다. 모두 가득이면 남겨 둔다 */
function stepGlobes(state: GameState): void {
  if (state.globes.length === 0) return
  let write = 0
  for (const g of state.globes) {
    g.ttl--
    if (g.ttl <= 0) continue
    let taker: PlayerState | null = null
    for (const p of state.players) {
      if (!isActive(p) || p.hp >= p.maxHp) continue
      if ((p.x - g.x) ** 2 + (p.y - g.y) ** 2 > (GLOBE_RADIUS + PLAYER_RADIUS) ** 2) continue
      taker = p
      break
    }
    if (!taker) {
      state.globes[write++] = g
      continue
    }
    for (const p of state.players) {
      if (!isActive(p) || p.hp >= p.maxHp) continue
      const frac = p === taker ? GLOBE_HEAL_FRAC : len(p.x - g.x, p.y - g.y) <= GLOBE_SHARE_RANGE ? GLOBE_SHARE_FRAC : 0
      if (frac <= 0) continue
      const amount = Math.min(p.maxHp - p.hp, Math.round(p.maxHp * frac))
      p.hp += amount
      state.events.push({ type: 'heal', p: p.id, x: p.x, y: p.y, amount })
    }
  }
  state.globes.length = write
}

// ---------------------------------------------------------------- 스냅샷

/** 스냅샷 (events 제외) */
export function snapshot(state: GameState): GameState {
  const { events: _e, ...rest } = state
  const copy = structuredClone(rest) as GameState
  copy.events = []
  return copy
}

/** FNV-1a 32비트 해시. 결정론 검증용. */
export function hashState(state: GameState): number {
  const { events: _e, ...rest } = state
  const s = JSON.stringify(rest)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
