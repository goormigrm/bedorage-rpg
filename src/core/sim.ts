// 결정론 시뮬레이션. 두 가지 판을 한 코드로 돈다:
//  - dungeon: 협동 던전 (몬스터 AI · 쓰러짐/부활 · 회복 구슬 · 죽음 규칙)
//  - arena:   투기장 PvP (배도라지 덕의 대전 규칙 이식 — 헤드샷 · 모래주머니 · 힐팩 · 목표 킬, RPG 에서 키운 캐릭터끼리)
// 둘 다 덕의 이동·사격·구르기·기력 위에 **스킬(Q·E·X)** 이 얹힌다. 스킬은 몬스터와 적 플레이어를 똑같이 친다.
// 규칙은 DESIGN 2장 — Math.random/삼각함수/시간 금지, 모든 기억은 GameState 안.

import { CHARACTERS, CharacterId, headHitScale } from './characters'
import { angleDiff, atan2A, cosA, sinA, len } from './fixedmath'
import { BTN_ADS, BTN_DASH, BTN_FIRE, BTN_RELOAD, BTN_SPRINT, BTN_USE, CMD_DROP, CMD_EQUIP, CMD_UNEQUIP, Input, SKILL_BTNS } from './input'
import {
  BAG_SIZE, LEVEL_CAP, SLOT_COUNT, SLOT_WEAPON, ST_CDR, ST_CRIT, ST_DMG, ST_DR, ST_HP, ST_LIFEKILL, ST_MAG, ST_RATE, ST_RELOAD, ST_SPEED,
  ST_STAMINA, ST_XP, Sheet, WEAPON_IDS, computeStats, rollItem, xpNeed,
} from './items'
import { COVER_DIST, GameMap, SANDBAG_HP, TILE, TILE_SANDBAG, isWallAt, nearSandbag, rayBlocked, rayCast } from './map'
import { BashDef, SNIPER_GRAZE_FRAC } from './weapons'
import { circlesOverlap, moveCircle, pointLineDistance, segmentHitsCircle } from './physics'
import { makeRng, rand, randInt } from './rng'
import {
  AFFIX_TUNE, CHARGE, DEATH_BLAST_MULT, EA_FAST, EA_SPLIT, EA_STOUT, EA_UNIQUE, EA_VAMP, EA_VOLATILE, ELITE, MONSTER_LIST, MonsterDef, UNIQUE, isBossLike, xpFor,
} from './monsters'
import { entryOf, farPoint, floorSeed, makeMonster, populate, rollAffixes } from './dungeon'
import { ACTS, areaLevel, stageDef } from './campaign'
import { Grid, flowField, flowStep } from './flow'
import {
  CHAR_SKILLS, FX_CHARGE, FX_COUNT, FX_CRIT, FX_FREEAMMO, FX_GUARD, FX_PARTYDR, FX_RATE, FX_SNIPE, FX_WHIRL,
  SKILLS, SkillId, ULT_START_FRAC,
} from './skills'
import {
  BLEED_TICKS, BLOCK_CHANCE, BLOCK_COST, BLOCK_LOCK_TICKS, Bullet, CHICKEN_HEAL, CHICKEN_MAXHP_CAP, CHICKEN_MAXHP_PER_KILL,
  COUNTDOWN_TICKS, CHIM, DASH_COST, DASH_SPEED, DASH_TICKS, GIYEOL, GLOBE_HEAL_FRAC, GLOBE_RADIUS, GLOBE_SHARE_FRAC,
  GLOBE_SHARE_RANGE, GLOBE_TTL, GameState, JUPEOL, MAX_PLAYERS, MEDKIT_HEAL_FRAC, MEDKIT_RADIUS, MEDKIT_TTL, MIN_PLAYERS,
  MS_CHARGE, MS_CHASE, MS_RECOVER, MS_SLEEP, MS_WINDUP, MatchConfig, Monster, PLAYER_RADIUS, PUNGWOL, PlayerState, RESPAWN_TICKS,
  REVIVE_HP_FRAC, REVIVE_RANGE, REVIVE_TICKS, SOLO_BLEED_TICKS, SPAWN_PROTECT_TICKS, SPRINT_COST, SPRINT_MIN, SPRINT_MUL,
  STAMINA_MAX, STAMINA_REGEN, UWON, ZONE_FUSE, ZONE_SPOTLIGHT, isActive, isEnemy, teamKills,
} from './state'
import { HEAD_AIM_FRAC, HEAD_FRAC, PART_BODY, PART_HEAD, PART_LEGS, PART_MULT, WEAPONS, falloff, headMult, partForOffset } from './weapons'

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
/** 엄폐 사격이 모래주머니를 넘기는 거리 (투기장 — 덕 그대로) */
const COVER_REACH = COVER_DIST + TILE * 3
/** 돌진·도약 속도 (px/틱) */
const CHARGE_SPEED = 12

/** 틱 안에서만 쓰는 폭발 대기열 (틱이 끝나면 늘 비어 있다 → 상태가 아니다) */
const booms: { x: number; y: number; r: number; dmg: number; by: number }[] = []
/** 분열 정예가 낳을 구울 (이번 틱 끝에 넣는다 — 몬스터 배열을 도는 중에 늘리지 않게) */
const spawns: { x: number; y: number; pack: number; hpMul: number; pow: number; lvl: number }[] = []
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

const deg = (d: number) => Math.round((d / 360) * 1024)

/** 계단에서 F 를 누르면 이만큼 뒤 모두 내려간다 */
const DESCEND_TICKS = 60 * 5

/**
 * 층 채우기: 무리 + 계단. 마지막 층은 계단 대신 **막 보스**(3번째 원정) 또는 **우두머리**(1·2번째 원정)가 가장 깊은 곳에 있다.
 * 몬스터 레벨 = 원정의 지역 레벨 + (층 − 1) (파티가 훨씬 높으면 조금 따라 올라온다)
 */
function fillFloor(state: GameState, map: GameMap, seed: number, seats: number, partyLevel: number): void {
  const sd = stageDef(state.stage)
  const last = state.floor >= state.floorMax
  const lvl = areaLevel(state.stage, state.floor, partyLevel)
  populate(state, map, seed, seats, lvl, last && sd.boss !== undefined, ACTS[sd.act].packs)
  const far = farPoint(map)
  if (last) {
    const hpMul = (1 + 0.6 * Math.max(0, seats - 1)) * (1 + 0.1 * (lvl - 1))
    const pow = Math.round(100 * (1 + 0.06 * (lvl - 1)))
    if (sd.boss !== undefined) {
      // 보스: 가장 깊은 곳에서 잠들어 있다가 누가 다가오면 깬다
      state.monsters.push(makeMonster(state, sd.boss, far.x, far.y, 9999, hpMul, pow, lvl))
      state.monstersTotal++
    } else if (sd.unique) {
      // 우두머리: 평범한 원형을 크게 키우고 접두 능력 셋. 같은 원형 셋이 지킨다
      const rng = makeRng((seed ^ 0x7a11e) >>> 0)
      const u = makeMonster(state, sd.unique.kind, far.x, far.y, 9998, hpMul * UNIQUE.hp, Math.round(pow * UNIQUE.pow), lvl)
      u.elite = rollAffixes(rng, 1 | EA_UNIQUE, UNIQUE.affixes)
      state.monsters.push(u)
      const r = MONSTER_LIST[sd.unique.kind].r
      for (let i = 0; i < 3; i++) {
        const a = (i * 341 + 100) & 1023
        const at = moveCircle(map, far.x, far.y, r, cosA(a) * 40, sinA(a) * 40)
        state.monsters.push(makeMonster(state, sd.unique.kind, at.x, at.y, 9998, hpMul, pow, lvl))
      }
      state.monstersTotal += 4
    }
    state.stairX = -1
    state.stairY = -1
  } else {
    state.stairX = far.x
    state.stairY = far.y
  }
}

/**
 * 다음 층으로 (세션이 새 맵을 만든 뒤 **모두 같은 틱에** 부른다). 몬스터·탄·바닥 것은 치우고, 모두 새 입구에 모인다.
 * 쓰러졌거나 죽어 있던 사람도 일어난다(하드코어 탈락은 그대로). 판은 2초 카운트다운 뒤 이어진다.
 */
export function enterFloor(state: GameState, map: GameMap, floor: number, seed: number): void {
  state.floor = floor
  state.pendingFloor = 0
  state.descend = -1
  state.monsters = []
  state.mshots = []
  state.bullets = []
  state.zones = []
  state.throws = []
  state.drops = []
  state.globes = []
  state.monstersTotal = 0
  const entry = entryOf(map)
  state.entryX = entry.x
  state.entryY = entry.y
  for (const i of map.sandbagIdx) state.sandbags[i] = SANDBAG_HP
  map.version++
  for (const p of state.players) {
    if (p.left || p.out) continue
    if (!p.alive || p.downed) {
      p.alive = true
      p.downed = false
      p.hp = p.maxHp
      p.respawnTimer = 0
    }
    const s = spotNear(state, map, entry.x, entry.y, p.id)
    p.x = s.x
    p.y = s.y
    p.dashTimer = 0
    p.fx[FX_CHARGE] = 0
    p.invuln = Math.max(p.invuln, SPAWN_PROTECT_TICKS)
  }
  const seated = state.players.filter((p) => !p.vacant && !p.left)
  const lvl = seated.length ? Math.round(seated.reduce((a, p) => a + p.level, 0) / seated.length) : 1
  fillFloor(state, map, floorSeed(seed, floor), state.players.length, lvl)
  state.phase = 'countdown'
  state.phaseTimer = 120
  state.events.push({ type: 'floor', n: floor })
}

// ================================================================ 만들기

export function createState(cfg: MatchConfig, map: GameMap): GameState {
  const rng = makeRng(cfg.seed)
  const mode = cfg.mode ?? 'dungeon'
  const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, cfg.chars.length))
  const players: PlayerState[] = []
  for (let i = 0; i < n; i++) {
    const p = makePlayer(i, cfg.chars[i], mode === 'arena' ? (cfg.teams?.[i] ?? i) : 0, cfg.sheets?.[i])
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
    mode,
    targetKills: mode === 'arena' ? Math.max(1, cfg.targetKills ?? 10) : 0,
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
    zones: [],
    throws: [],
    drops: [],
    nextDropId: 1,
    // 판마다 다른 큰 수에서 시작 — 세이브에 있던 아이템 번호와 겹치지 않게
    nextItemUid: 1_000_000 + (cfg.seed % 1_000_000) * 1000,
    nextFxId: 1,
    entryX: entry.x,
    entryY: entry.y,
    floor: 1,
    floorMax: cfg.floors ?? stageDef(cfg.stage ?? 0).floors,
    stairX: -1,
    stairY: -1,
    descend: -1,
    pendingFloor: 0,
    monstersTotal: 0,
    stage: Math.max(0, cfg.stage ?? 0),
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
  if (mode === 'arena') {
    // 투기장: 덕 그대로 — 첫 사람은 무작위, 다음 사람은 이미 놓인 모두에게서 가장 먼 곳
    const used: { x: number; y: number }[] = []
    for (const p of players) {
      if (p.left) continue
      const s = used.length === 0 ? map.spawns[randInt(rng, 0, map.spawns.length)] : farthestSpawn(map, used, rng, 1)
      p.x = s.x
      p.y = s.y
      used.push(s)
    }
  } else {
    // 던전: 모두 입구에 모여서 시작한다 (협동)
    for (const p of players) {
      if (p.left) continue
      const s = spotNear(state, map, entry.x, entry.y, p.id)
      p.x = s.x
      p.y = s.y
    }
    // 몬스터는 파티 평균 레벨에 맞춰 세진다 (빈 자리 제외)
    const seated = players.filter((p) => !p.vacant)
    const lvl = seated.length ? Math.round(seated.reduce((a, p) => a + p.level, 0) / seated.length) : 1
    if (!cfg.noMonsters) fillFloor(state, map, cfg.seed, n, lvl)
  }
  for (const p of players) p.aim = atan2A(map.ph / 2 - p.y, map.pw / 2 - p.x)
  return state
}

function makePlayer(id: number, char: CharacterId, team: number, sheet?: Sheet): PlayerState {
  const c = CHARACTERS[char]
  const w = WEAPONS[c.weapon]
  const ult = SKILLS[CHAR_SKILLS[char][2]]
  const sh = sheet ?? { level: 1, xp: 0, gold: 0, equip: new Array(SLOT_COUNT).fill(null), bag: [] }
  // 세이브에서 온 것은 복사해 둔다 (상태가 세이브 객체를 건드리지 않게)
  const equip = sh.equip.map((it) => (it ? { ...it, aff: [...it.aff] } : null))
  const bag = sh.bag.map((it) => ({ ...it, aff: [...it.aff] }))
  const st = computeStats(sh.level, equip)
  const maxHp = c.maxHp + st[ST_HP]
  const magSize = w.magSize > 0 ? Math.round(w.magSize * (1 + st[ST_MAG] / 100)) : 0
  return {
    id,
    team,
    char,
    x: 0,
    y: 0,
    aim: 0,
    hp: maxHp,
    maxHp,
    alive: true,
    downed: false,
    downTimer: 0,
    revive: 0,
    out: false,
    respawnTimer: 0,
    weapon: c.weapon,
    ammo: magSize,
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
    cd: [0, 0, Math.round(ult.cd * ULT_START_FRAC)],
    fx: new Array(FX_COUNT).fill(0),
    rateMul: 1,
    pierceShots: 0,
    empowerShots: 0,
    chargeTag: 0,
    level: sh.level,
    xp: sh.xp,
    gold: sh.gold,
    equip,
    bag,
    st,
    magSize,
    xpGain: 0,
    goldGain: 0,
    found: 0,
    bestFound: -1,
  }
}

/** 장비·레벨이 바뀌면 능력치를 다시 낸다. 최대 체력이 늘면 그만큼 체력도 는다 */
function recalc(p: PlayerState): void {
  const c = CHARACTERS[p.char]
  const w = WEAPONS[p.weapon]
  p.st = computeStats(p.level, p.equip)
  const maxHp = c.maxHp + p.st[ST_HP]
  if (maxHp > p.maxHp && p.alive) p.hp += maxHp - p.maxHp
  p.maxHp = maxHp
  p.hp = Math.min(p.hp, p.maxHp)
  p.magSize = w.magSize > 0 ? Math.round(w.magSize * (1 + p.st[ST_MAG] / 100)) : 0
  p.ammo = Math.min(p.ammo, p.magSize)
}

/** 피해 배율 (레벨 + 장비) */
function dmgMul(p: PlayerState): number {
  return 1 + p.st[ST_DMG] / 100
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

/** 기준점들로부터의 최소 거리가 가장 먼 스폰 상위 topN 개 중 무작위 (덕 그대로) */
function farthestSpawn(map: GameMap, from: { x: number; y: number }[], rng: GameState['rng'], topN: number): { x: number; y: number } {
  if (from.length === 0) return map.spawns[randInt(rng, 0, map.spawns.length)]
  const scored = map.spawns.map((s, i) => {
    let d = Infinity
    for (const f of from) d = Math.min(d, len(s.x - f.x, s.y - f.y))
    return { s, i, d }
  })
  scored.sort((a, b) => b.d - a.d || a.i - b.i)
  const top = scored.slice(0, Math.min(topN, scored.length))
  return top[randInt(rng, 0, top.length)].s
}

// ================================================================ 틱

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

  // 근접 휘두르기·조준 판정·스킬이 쓸 격자 (몬스터가 움직이기 전 위치)
  buildGrid(state, map)
  for (let i = 0; i < state.players.length; i++) stepPlayer(state, map, state.players[i], inputs[i])
  if (state.mode === 'dungeon') {
    stepDowned(state, inputs)
    stepStairs(state, inputs)
  }
  if (state.phase === 'playing' && state.monsters.length > 0) stepMonsters(state, map)
  const grid = buildGrid(state, map)
  separate(state, map, grid)
  stepZones(state)
  stepThrows(state, map, grid)
  stepBullets(state, map, grid)
  stepShots(state, map)
  runBooms(state, map, grid)
  flushSpawns(state, map)
  // 쓰러진 몬스터를 뺀다 (순서 유지)
  if (state.monsters.some((m) => m.hp <= 0)) state.monsters = state.monsters.filter((m) => m.hp > 0)
  stepGlobes(state)
  stepDrops(state)
  checkOver(state)
  state.tick++
}

/** 계단 위에서 누가 F 를 누르면 5초 뒤 모두 내려간다 (따로 다니면 층이 두 개가 돼야 해서 전원 같이 — PLAN 4.4) */
function stepStairs(state: GameState, inputs: Input[]): void {
  if (state.phase !== 'playing' || state.stairX < 0 || state.pendingFloor > 0) return
  if (state.descend < 0) {
    for (const p of state.players) {
      if (!isActive(p) || ((inputs[p.id]?.buttons ?? 0) & BTN_USE) === 0) continue
      if (len(p.x - state.stairX, p.y - state.stairY) > 48) continue
      state.descend = DESCEND_TICKS
      state.events.push({ type: 'descendStart', p: p.id })
      break
    }
    return
  }
  if (--state.descend <= 0) state.pendingFloor = state.floor + 1
}

function checkOver(state: GameState): void {
  if (state.phase !== 'playing' || state.mode !== 'dungeon') return
  // 원정 완료: 마지막 층에서 보스(또는 우두머리)가 쓰러지면 (또는 그 층의 몬스터를 다 잡으면)
  const last = state.floor >= state.floorMax
  const bossAlive = state.monsters.some((m) => m.hp > 0 && isBossLike(m))
  if (last && state.monstersTotal > 0 && (!bossAlive || state.monsters.length === 0)) {
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

// ================================================================ 플레이어

/**
 * 빈 자리에 사람을 넣는다 (난입). 호스트가 정한 틱에 **모두가 같이** 호출해야 결정론이 유지된다.
 * 던전은 동료 곁에, 투기장은 적에게서 먼 곳에.
 */
export function joinPlayer(state: GameState, map: GameMap, idx: number, char: CharacterId, team = 0, sheet?: Sheet): void {
  const p = state.players[idx]
  if (!p) return
  Object.assign(p, makePlayer(idx, char, state.mode === 'arena' ? team : 0, sheet))
  if (state.mode === 'arena') {
    respawn(state, map, p)
  } else {
    const buddy = state.players.find((o) => o.id !== idx && isActive(o))
    const s = spotNear(state, map, buddy ? buddy.x : state.entryX, buddy ? buddy.y : state.entryY, idx)
    p.x = s.x
    p.y = s.y
  }
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
  if (input.cmd) runCommand(state, p, input.cmd, input.arg ?? 0)

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
  for (let k = 0; k < 3; k++) if (p.cd[k] > 0) p.cd[k]--
  for (let k = 0; k < FX_COUNT; k++) if (p.fx[k] > 0) p.fx[k]--
  if (p.fx[FX_RATE] === 0) p.rateMul = 1
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
    p.stamina = Math.min(p.staminaMax, p.stamina + STAMINA_REGEN * (w.melee ? 2.4 : 1) * (1 + p.st[ST_STAMINA] / 100))
  }
  if (p.invuln > 0) p.invuln--
  if (p.legInjury > 0) p.legInjury--
  if (p.reloadTimer > 0) {
    // 아홉 목숨: 재장전 즉시
    if (p.fx[FX_SNIPE] > 0) p.reloadTimer = 1
    p.reloadTimer--
    if (p.reloadTimer === 0) p.ammo = p.magSize
  }
  const recover = c.id === 'chim' ? w.recoilRecover * CHIM.recoverMul : w.recoilRecover
  p.recoil = p.fx[FX_CRIT] > 0 ? 0 : Math.max(0, p.recoil - recover)

  // 매직덕 패시브(진료): 3초 안 맞으면 초당 6 회복
  if (c.id === 'magic' && state.tick - p.lastHitTick > 180 && p.hp < p.maxHp) {
    p.hp = Math.min(p.maxHp, p.hp + 6 / 60)
  }

  p.aim = input.aim & 1023
  p.aimDist = (input.aimDist ?? 0) * 4
  p.ads = playing && (input.buttons & BTN_ADS) !== 0 && p.dashTimer === 0

  // 돌진·도약 (승빠덕 Q · 옥냥덕 Q): 정해진 방향으로 빠르게, 그동안 무적. 조작은 받지 않는다
  if (p.fx[FX_CHARGE] > 0) {
    const r = moveCircle(map, p.x, p.y, PLAYER_RADIUS, p.dashDx * CHARGE_SPEED, p.dashDy * CHARGE_SPEED)
    p.x = r.x
    p.y = r.y
    p.moving = true
    p.invuln = Math.max(p.invuln, 2)
    if (p.chargeTag > 0) chargeHit(state, map, p)
    return
  }

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
    if (p.fx[FX_WHIRL] > 0) speed *= 1.3
    speed *= 1 + p.st[ST_SPEED] / 100
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

  // 스킬 Q · E · X (누르고 있으면 준비되는 대로 쓴다 — 디아블로처럼)
  if (playing && p.dashTimer === 0) {
    for (let k = 0; k < 3; k++) {
      if ((input.buttons & SKILL_BTNS[k]) === 0 || p.cd[k] > 0) continue
      castSkill(state, map, p, k)
      break
    }
  }

  // 회전 공격(주방 대참사): 0.25초마다 주변을 친다
  if (p.fx[FX_WHIRL] > 0 && p.fx[FX_WHIRL] % 15 === 0) {
    aoe(state, map, p, p.x, p.y, 2.4 * TILE, 35, { knock: 3, id: 'kitchen', quiet: true })
  }

  // 줍기: 내 전리품·버려진 것 위를 지나가면 줍는다 (디아블로처럼 한 번 클릭 대신 — 슈터는 손이 바쁘다)
  if (state.drops.length > 0) pickUp(state, p)

  // 재장전
  if (playing && input.buttons & BTN_RELOAD && p.reloadTimer === 0 && p.ammo < p.magSize) {
    p.reloadTimer = reloadTicks(p)
    state.events.push({ type: 'reload', p: p.id })
  }

  // 사격
  const firePressed = (input.buttons & BTN_FIRE) !== 0
  const trigger = w.auto ? firePressed : firePressed && !p.prevFire
  p.prevFire = firePressed
  if (playing && trigger && p.dashTimer === 0 && p.fx[FX_WHIRL] === 0) {
    // 저격총을 조준경 없이 쏘면 개머리판 후려치기 (아홉 목숨 중에는 그냥 쏜다)
    if (w.bash && !p.ads && p.fx[FX_SNIPE] === 0) {
      if (p.fireCooldown === 0) bashSwing(state, map, p, w.bash)
    } else {
      const infinite = w.magSize === 0
      if (!infinite && p.ammo === 0 && p.reloadTimer === 0) {
        p.reloadTimer = reloadTicks(p)
        state.events.push({ type: 'reload', p: p.id })
      } else if (p.fireCooldown === 0 && p.reloadTimer === 0 && (infinite || p.ammo > 0)) {
        fire(state, map, p)
      }
    }
  }
}

/**
 * 쓰러진 사람(던전): 동료가 곁에서 F(BTN_USE)를 누르고 있으면 일어나고, 아니면 시간이 흘러 죽는다.
 * 일으켜 주는 동안에는 시간이 멈춘다. 일으켜 줄 사람이 아무도 없으면(혼자·전원 쓰러짐) 금방 죽는다.
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
        raise(state, p, Math.round(p.maxHp * REVIVE_HP_FRAC), 90)
        helper.revives++
        state.events.push({ type: 'revive', p: p.id, by: helper.id, x: p.x, y: p.y })
      }
      continue
    }
    p.revive = Math.max(0, p.revive - 2)
    if (!anyone) p.downTimer = Math.min(p.downTimer, SOLO_BLEED_TICKS)
    p.downTimer--
    if (p.downTimer <= 0) die(state, p, -1)
  }
}

/** 쓰러진 사람을 일으킨다 */
function raise(state: GameState, p: PlayerState, hp: number, invuln: number): void {
  p.downed = false
  p.revive = 0
  p.hp = Math.min(p.maxHp, hp)
  p.invuln = Math.max(p.invuln, invuln)
  void state
}

function die(state: GameState, p: PlayerState, by: number): void {
  p.alive = false
  p.downed = false
  p.revive = 0
  p.deaths++
  p.killStreak = 0
  p.respawnTimer = p.char === 'seungwoo' && state.mode === 'arena' ? 120 : RESPAWN_TICKS
  p.fx.fill(0)
  p.rateMul = 1
  if (state.mode === 'dungeon' && state.deathRule === 2) p.out = true
  // 소실(디아블로 2 방식): 지금 레벨 경험치 10% · 골드 20% 를 잃는다. 레벨은 떨어지지 않는다
  if (state.mode === 'dungeon' && state.deathRule === 1) {
    p.xp = Math.max(0, p.xp - Math.round(xpNeed(p.level) * 0.1))
    const lost = Math.floor(p.gold * 0.2)
    p.gold -= lost
    p.goldGain -= lost
  }
  state.events.push({ type: 'death', p: p.id, by, x: p.x, y: p.y, out: p.out })
}

function respawn(state: GameState, map: GameMap, p: PlayerState): void {
  const c = CHARACTERS[p.char]
  const w = WEAPONS[p.weapon]
  if (state.mode === 'arena') {
    // 살아있는 적 모두에게서 먼 곳 (상위 3곳 중 무작위) — 덕 그대로
    const enemies: { x: number; y: number }[] = []
    for (const e of state.players) if (isEnemy(p, e) && e.alive && !e.left) enemies.push(e)
    let spot = farthestSpawn(map, enemies, state.rng, 3)
    for (const e of state.players) {
      if (e.id !== p.id && e.alive && circlesOverlap(spot.x, spot.y, PLAYER_RADIUS, e.x, e.y, PLAYER_RADIUS)) {
        spot = farthestSpawn(map, [spot, ...enemies], state.rng, 1)
        break
      }
    }
    p.x = spot.x
    p.y = spot.y
  } else {
    const s = spotNear(state, map, state.entryX, state.entryY, p.id)
    p.x = s.x
    p.y = s.y
  }
  p.maxHp = c.maxHp + p.st[ST_HP]
  p.hp = p.maxHp
  p.alive = true
  p.downed = false
  p.ammo = p.magSize
  void w
  p.reloadTimer = 0
  p.fireCooldown = 0
  p.recoil = 0
  p.dashTimer = 0
  p.dashCooldown = 0
  p.legInjury = 0
  p.invuln = c.id === 'seungwoo' && state.mode === 'arena' ? SPAWN_PROTECT_TICKS * 2 : SPAWN_PROTECT_TICKS
  p.aliveTicks = 0
  p.lastHitTick = -10000
  p.streak = 0
  p.staminaMax = c.staminaMax ?? STAMINA_MAX
  p.stamina = p.staminaMax
  p.blockLock = 0
  p.sprinting = false
  p.pierceShots = 0
  p.empowerShots = 0
  state.events.push({ type: 'respawn', p: p.id, x: p.x, y: p.y })
}

/** 받는 피해 배율: 철벽 · 회전 공격 · 포효의 가호 (곱한다) */
function takenMul(p: PlayerState): number {
  let k = 1 - p.st[ST_DR] / 100
  if (p.fx[FX_GUARD] > 0) k *= 0.5
  if (p.fx[FX_WHIRL] > 0) k *= 0.5
  if (p.fx[FX_PARTYDR] > 0) k *= 0.7
  return k
}

/**
 * 후라이팬 막기 (덕 규칙): 앞에서 온 공격을 BLOCK_CHANCE 확률로 기력만큼 막는다. 막는 동안 기력이 안 찬다.
 * 반환 = 막고 남은 피해
 */
function panBlock(state: GameState, p: PlayerState, dmg: number, sx: number, sy: number): number {
  if (!WEAPONS[p.weapon].melee) return dmg
  const from = atan2A(sy - p.y, sx - p.x)
  if (Math.abs(angleDiff(from, p.aim)) >= 213) return dmg
  p.blockLock = BLOCK_LOCK_TICKS
  if (p.stamina > 0 && rand(state.rng) < BLOCK_CHANCE) {
    const absorbed = Math.min(dmg, Math.floor(p.stamina / BLOCK_COST))
    p.stamina = Math.max(0, p.stamina - absorbed * BLOCK_COST)
    dmg -= absorbed
    state.events.push({ type: 'block', p: p.id, x: p.x, y: p.y })
  }
  return dmg
}

/** 몬스터가 플레이어를 때린다(던전). 실제로 맞았으면 true (구르는 중·무적이면 false — 투사체는 그대로 지나간다) */
function hurtPlayer(state: GameState, p: PlayerState, dmg: number, by: number, sx: number, sy: number): boolean {
  if (!isActive(p) || p.invuln > 0 || p.dashTimer > 0 || state.phase !== 'playing') return false
  dmg = panBlock(state, p, Math.round(dmg * takenMul(p)), sx, sy)
  if (dmg <= 0) return true
  p.hp -= dmg
  p.dmgTaken += dmg
  p.lastHitTick = state.tick
  state.events.push({ type: 'hurt', p: p.id, by, x: p.x, y: p.y, dmg })
  // 흡혈 정예: 때린 만큼 회복 (by = 몬스터 id)
  if (by >= 0) {
    const m = state.monsters.find((q) => q.id === by)
    if (m && m.hp > 0 && m.elite & EA_VAMP) m.hp = Math.min(m.maxHp, m.hp + Math.round(dmg * AFFIX_TUNE.vamp))
  }
  if (p.hp <= 0) {
    p.hp = 0
    p.downed = true
    p.revive = 0
    p.downTimer = BLEED_TICKS
    p.ads = false
    p.dashTimer = 0
    p.sprinting = false
    p.killStreak = 0
    p.fx.fill(0)
    p.rateMul = 1
    state.events.push({ type: 'down', p: p.id, x: p.x, y: p.y })
  }
  return true
}

/**
 * 플레이어가 플레이어를 때린다(투기장 — 덕의 hurt). 킬·힐팩·승리 판정까지.
 * part = 부위(머리·몸·다리). 스킬 피해는 몸통으로 친다.
 */
function hurtPvp(state: GameState, shooter: PlayerState, victim: PlayerState, dmg: number, part: number, hx: number, hy: number): void {
  if (dmg <= 0 || !victim.alive || victim.left) return
  dmg = Math.round(dmg * takenMul(victim))
  if (dmg <= 0) return
  shooter.hits++
  if (part === PART_HEAD) shooter.heads++
  shooter.dmgDealt += dmg
  victim.dmgTaken += dmg
  victim.hp -= dmg
  victim.lastHitTick = state.tick
  if (part === PART_LEGS) victim.legInjury = 180
  state.events.push({ type: 'hit', p: victim.id, by: shooter.id, x: hx, y: hy, part, dmg })
  if (victim.hp > 0) return
  victim.hp = 0
  die(state, victim, shooter.id)
  shooter.kills++
  shooter.killStreak++
  if (shooter.killStreak > shooter.bestStreak) shooter.bestStreak = shooter.killStreak
  if (shooter.st[ST_LIFEKILL] > 0) shooter.hp = Math.min(shooter.maxHp, shooter.hp + shooter.st[ST_LIFEKILL])
  if (shooter.char === 'tongdak') {
    shooter.maxHp = Math.min(CHARACTERS.tongdak.maxHp + shooter.st[ST_HP] + CHICKEN_MAXHP_CAP, shooter.maxHp + CHICKEN_MAXHP_PER_KILL)
    shooter.hp = Math.min(shooter.maxHp, shooter.hp + CHICKEN_HEAL)
  }
  // 죽은 자리에 힐팩 (덕 규칙 — 이긴 쪽이 그 자리를 차지하면 이어서 싸울 수 있다)
  state.globes.push({ id: state.nextGlobeId++, x: victim.x, y: victim.y, ttl: MEDKIT_TTL, heal: Math.round(MEDKIT_HEAL_FRAC * 100), share: false })
  state.events.push({ type: 'drop', x: victim.x, y: victim.y })
  while (state.globes.length > 6) state.globes.shift()
  if (teamKills(state, shooter.team) >= state.targetKills && state.phase === 'playing') {
    state.phase = 'over'
    state.winner = shooter.team
    state.events.push({ type: 'over', winner: shooter.team })
  }
}

// ================================================================ 사격

/** 던전: 쏠 때 커서가 약점 위에 있는 몬스터 id (-1 = 없음). 치명타는 이 몬스터에게만 난다 (덕의 헤드샷 규칙) */
function aimedMonster(state: GameState, map: GameMap, p: PlayerState): number {
  if (p.aimDist <= 0 || state.monsters.length === 0) return -1
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

/** 투기장: 쏠 때 커서가 올라가 있는 적 플레이어 (덕 그대로) */
function aimedEnemy(state: GameState, p: PlayerState): number {
  if (p.aimDist <= 0 || state.mode !== 'arena') return -1
  const ax = p.x + cosA(p.aim) * p.aimDist
  const ay = p.y + sinA(p.aim) * p.aimDist
  for (const e of state.players) {
    if (!isEnemy(p, e) || !e.alive || e.left) continue
    if (len(ax - e.x, ay - e.y) <= PLAYER_RADIUS * HEAD_AIM_FRAC * headHitScale(e.char)) return e.id
  }
  return -1
}

/** 투기장: 이 각도의 탄이 적의 머리(중심)를 정확히 겨누는가 → 모래주머니를 넘어간다 (덕 그대로) */
function aimsAtHead(state: GameState, map: GameMap, shooter: PlayerState, mx: number, my: number, a: number, headTarget: number): boolean {
  if (headTarget < 0) return false
  const dx = cosA(a)
  const dy = sinA(a)
  for (const e of state.players) {
    if (e.id !== headTarget || !isEnemy(shooter, e) || !e.alive || e.left) continue
    const t = (e.x - mx) * dx + (e.y - my) * dy
    if (t <= 0 || t > 1200) continue
    if (len(mx + dx * t - e.x, my + dy * t - e.y) > PLAYER_RADIUS * HEAD_FRAC * headHitScale(e.char)) continue
    if (rayCast(map, mx, my, e.x, e.y, 'sight').blocked) continue
    return true
  }
  return false
}

interface AoeOpts {
  /** 기절 (몬스터) · 적 플레이어는 다리 부상(느려짐)으로 */
  stun?: number
  slow?: number
  knock?: number
  /** 부채꼴: 이 방향 ±arc 만 */
  arcAim?: number
  arc?: number
  /** 스킬 이름 (렌더·소리) */
  id: string
  /** 이벤트를 내지 않는다 (회전 공격처럼 자주 치는 것) */
  quiet?: boolean
  /** 한 번만 맞는 효과 번호 (돌진) */
  tag?: number
}

/**
 * 스킬 범위 공격: 원(또는 부채꼴) 안의 몬스터와 **적 플레이어**를 친다. 벽 너머는 안 맞는다.
 * 반환 = 맞힌 수
 */
function aoe(state: GameState, map: GameMap, caster: PlayerState, x: number, y: number, r: number, dmg: number, o: AoeOpts): number {
  if (!o.quiet) state.events.push({ type: 'aoe', p: caster.id, id: o.id, x, y, r })
  dmg = Math.round(dmg * dmgMul(caster))
  let n = 0
  const inArc = (tx: number, ty: number) => {
    if (o.arc === undefined || o.arcAim === undefined) return true
    const d = len(tx - x, ty - y)
    return d < 1 || Math.abs(angleDiff(atan2A(ty - y, tx - x), o.arcAim)) <= o.arc
  }
  const hit: Monster[] = []
  gridFor(map).query(x - r - 20, y - r - 20, x + r + 20, y + r + 20, (i) => {
    const m = state.monsters[i]
    if (!m || m.hp <= 0) return
    if (o.tag !== undefined && m.tag === o.tag) return
    if (len(m.x - x, m.y - y) > r + MONSTER_LIST[m.kind].r) return
    if (!inArc(m.x, m.y)) return
    if (rayCast(map, x, y, m.x, m.y, 'bullet', true).blocked) return
    hit.push(m)
  })
  hit.sort((a, b) => a.id - b.id)
  for (const m of hit) {
    const def = MONSTER_LIST[m.kind]
    if (o.tag !== undefined) m.tag = o.tag
    if (o.knock) {
      const d = len(m.x - x, m.y - y) || 1
      const k = o.knock * (1 - def.knockRes)
      m.kx += ((m.x - x) / d) * k
      m.ky += ((m.y - y) / d) * k
    }
    if (o.stun) m.stun = Math.max(m.stun, o.stun)
    if (o.slow) m.slow = Math.max(m.slow, o.slow)
    hurtMonster(state, m, dmg, caster.id, false, m.x, m.y)
    n++
  }
  // 투기장: 적 플레이어도 맞는다 (기절 대신 다리 부상 — 조작을 빼앗으면 PvP 에서 너무 답답하다)
  if (state.mode === 'arena') {
    for (const e of state.players) {
      if (!isEnemy(caster, e) || !e.alive || e.left || e.invuln > 0 || e.dashTimer > 0) continue
      if (len(e.x - x, e.y - y) > r + PLAYER_RADIUS) continue
      if (!inArc(e.x, e.y)) continue
      if (rayCast(map, x, y, e.x, e.y, 'bullet', true).blocked) continue
      if (o.stun || o.slow) e.legInjury = Math.max(e.legInjury, Math.max(o.stun ?? 0, o.slow ?? 0))
      hurtPvp(state, caster, e, dmg, PART_BODY, e.x, e.y)
      n++
    }
  }
  return n
}

/** 부채꼴 안을 친다 (후라이팬 · 개머리판) — 몬스터와 적 플레이어 */
function swingAt(state: GameState, map: GameMap, p: PlayerState, range: number, arc: number, dmg: number, knock: number): number {
  dmg = Math.round(dmg * dmgMul(p))
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
  hit.sort((a, b) => a.id - b.id)
  for (const m of hit) {
    const d = len(m.x - p.x, m.y - p.y) || 1
    const k = knock * (1 - MONSTER_LIST[m.kind].knockRes)
    m.kx += ((m.x - p.x) / d) * k
    m.ky += ((m.y - p.y) / d) * k
    hurtMonster(state, m, dmg, p.id, false, m.x, m.y)
    n++
  }
  if (state.mode === 'arena') {
    for (const victim of state.players) {
      if (!isEnemy(p, victim) || !victim.alive || victim.left || victim.invuln > 0 || victim.dashTimer > 0) continue
      const dx = victim.x - p.x
      const dy = victim.y - p.y
      if (len(dx, dy) > range + PLAYER_RADIUS) continue
      if (Math.abs(angleDiff(atan2A(dy, dx), p.aim)) > arc) continue
      if (rayCast(map, p.x, p.y, victim.x, victim.y, 'bullet', true).blocked) continue
      hurtPvp(state, p, victim, dmg, PART_BODY, victim.x, victim.y)
      n++
    }
  }
  return n
}

function bashSwing(state: GameState, map: GameMap, p: PlayerState, bash: BashDef): void {
  p.fireCooldown = bash.interval
  state.events.push({ type: 'bash', p: p.id, x: p.x, y: p.y, aim: p.aim })
  p.shots++
  swingAt(state, map, p, bash.range, bash.arc, bash.damage, 3)
}

/** 탄 하나를 만든다 (사격·난사·관통 저격 공용) */
function spawnBullet(state: GameState, p: PlayerState, mx: number, my: number, a: number, weapon: PlayerState['weapon'], o: { speed?: number; damage?: number; life?: number; pierce?: number; mul?: number; headTarget: number; critMon: number; over: boolean; overR: number }): void {
  const w = WEAPONS[weapon]
  const sp = o.speed ?? w.speed
  const b: Bullet = {
    id: state.nextBulletId++,
    owner: p.id,
    x: mx,
    y: my,
    px: mx,
    py: my,
    vx: cosA(a) * sp,
    vy: sinA(a) * sp,
    life: o.life ?? w.life,
    // 레벨·장비의 피해 증가는 탄에 실어 보낸다 (쏜 뒤 장비를 바꿔도 이미 날아가는 탄은 그대로)
    damage: (o.damage ?? w.damage) * dmgMul(p),
    ads: p.ads || p.fx[FX_SNIPE] > 0,
    ox: p.x,
    oy: p.y,
    weapon,
    hitSomeone: false,
    over: o.over,
    headTarget: o.headTarget,
    critMon: o.critMon,
    overR: o.overR,
    pierce: o.pierce ?? 0,
    lastHit: 0,
    mul: o.mul ?? 1,
    forceCrit: p.fx[FX_CRIT] > 0,
  }
  state.bullets.push(b)
}

function muzzle(map: GameMap, p: PlayerState): { x: number; y: number } {
  const mx = p.x + cosA(p.aim) * (PLAYER_RADIUS + 6)
  const my = p.y + sinA(p.aim) * (PLAYER_RADIUS + 6)
  return isWallAt(map, mx, my) ? { x: p.x, y: p.y } : { x: mx, y: my }
}

function fire(state: GameState, map: GameMap, p: PlayerState): void {
  const w = WEAPONS[p.weapon]
  const snipe = p.fx[FX_SNIPE] > 0
  const spread = Math.round((p.ads || snipe ? w.spreadAds : w.spreadHip) * (p.char === 'chim' ? CHIM.spreadMul : 1)) + p.recoil
  const { x: mx, y: my } = muzzle(map, p)
  const rate = (p.fx[FX_RATE] > 0 ? p.rateMul : 1) * (1 + p.st[ST_RATE] / 100)
  const interval = Math.max(1, Math.ceil(w.fireInterval / rate))
  if (w.melee) {
    p.fireCooldown = interval
    p.shots++
    state.events.push({ type: 'fire', p: p.id, x: mx, y: my, aim: p.aim, weapon: p.weapon })
    const n = swingAt(state, map, p, w.meleeRange ?? 60, w.meleeArc ?? 150, Math.round(w.damage), w.knock)
    if (n > 0) p.streak = Math.min(99, p.streak + 1)
    return
  }
  // 투기장: 모래주머니에 붙어 쏘면(엄폐) 내가 기댄 자루만 넘어간다 (덕 그대로)
  const overR = nearSandbag(map, p.x, p.y) ? COVER_REACH : 0
  const headTarget = aimedEnemy(state, p)
  const critMon = aimedMonster(state, map, p)
  // 관통탄(침착덕 Q) · 아홉 목숨(관통 2) · 고양이 걸음 다음 한 발(2배)
  let pierce = 0
  let mul = 1
  if (p.pierceShots > 0) {
    p.pierceShots--
    pierce = 3
    mul *= 1.3
  }
  if (snipe) pierce = Math.max(pierce, 2)
  if (p.empowerShots > 0 && w.scope) {
    p.empowerShots--
    mul *= 2
  }
  for (let i = 0; i < w.pellets; i++) {
    const off = spread > 0 ? randInt(state.rng, -spread, spread + 1) : 0
    const a = (p.aim + off) & 1023
    spawnBullet(state, p, mx, my, a, p.weapon, { headTarget, critMon, over: aimsAtHead(state, map, p, mx, my, a, headTarget), overR, pierce, mul })
  }
  if (w.magSize > 0 && p.fx[FX_FREEAMMO] === 0) p.ammo--
  if (state.mode === 'dungeon' && !w.suppressed) noise(state, p.x, p.y)
  p.shots += w.pellets // 명중률을 탄 단위로 재야 산탄총이 왜곡되지 않는다
  p.fireCooldown = interval
  if (p.fx[FX_CRIT] === 0) p.recoil = Math.min(w.recoil * MAX_RECOIL_MUL * 2, p.recoil + w.recoil * (p.char === 'chim' ? CHIM.recoilMul : 1))
  state.events.push({ type: 'fire', p: p.id, x: mx, y: my, aim: p.aim, weapon: p.weapon })
  if (w.magSize > 0 && p.ammo === 0) {
    p.reloadTimer = reloadTicks(p)
    state.events.push({ type: 'reload', p: p.id })
  }
}

/** 재장전 시간 (재장전 속도 옵션 반영) */
function reloadTicks(p: PlayerState): number {
  return Math.max(10, Math.round(WEAPONS[p.weapon].reloadTicks / (1 + p.st[ST_RELOAD] / 100)))
}

// ================================================================ 스킬

/** 커서 지점 (reach 까지, 벽을 넘지 않게 — 벽에 닿으면 그 앞) */
function cursorPoint(map: GameMap, p: PlayerState, reach: number): { x: number; y: number } {
  const d = Math.min(reach, p.aimDist > 0 ? p.aimDist : reach)
  let x = p.x + cosA(p.aim) * d
  let y = p.y + sinA(p.aim) * d
  const hit = rayCast(map, p.x, p.y, x, y, 'sight')
  if (hit.blocked) {
    // 막힌 타일 앞까지 조금씩 당긴다
    for (let k = 1; k <= 12; k++) {
      const t = 1 - k / 12
      x = p.x + cosA(p.aim) * d * t
      y = p.y + sinA(p.aim) * d * t
      if (!rayCast(map, p.x, p.y, x, y, 'sight').blocked) break
    }
  }
  return { x, y }
}

/** 같은 편(자기 포함)으로 반경 안에 있고 움직일 수 있는 사람 */
function alliesNear(state: GameState, p: PlayerState, r: number, includeDowned = false): PlayerState[] {
  return state.players.filter((q) => q.alive && !q.left && q.team === p.team && (includeDowned || !q.downed) && len(q.x - p.x, q.y - p.y) <= r)
}

function buffRate(p: PlayerState, ticks: number, mul: number): void {
  p.rateMul = p.fx[FX_RATE] > 0 ? Math.max(p.rateMul, mul) : mul
  p.fx[FX_RATE] = Math.max(p.fx[FX_RATE], ticks)
}

function castSkill(state: GameState, map: GameMap, p: PlayerState, slot: number): void {
  const id: SkillId = CHAR_SKILLS[p.char][slot]
  const def = SKILLS[id]
  p.cd[slot] = Math.round(def.cd * (1 - p.st[ST_CDR] / 100))
  let tx = p.x
  let ty = p.y
  if (def.reach) {
    const c = cursorPoint(map, p, def.reach)
    tx = c.x
    ty = c.y
  }
  state.events.push({ type: 'skill', p: p.id, slot, id, x: p.x, y: p.y, aim: p.aim, tx, ty })
  const T = TILE
  switch (id) {
    // ---- 철면덕
    case 'ironwall': {
      p.fx[FX_GUARD] = 240
      // 도발: 7칸 안의 (깨어 있는) 몬스터가 나를 노린다
      for (const m of state.monsters) {
        if (m.hp <= 0 || len(m.x - p.x, m.y - p.y) > 7 * T) continue
        if (m.st === MS_SLEEP) wakePack(state, m.pack, m.x, m.y)
        m.target = p.id
        m.taunt = 240
      }
      break
    }
    case 'barrage':
      buffRate(p, 240, 2)
      p.fx[FX_FREEAMMO] = 240
      break
    case 'roar': {
      aoe(state, map, p, p.x, p.y, 5 * T, 120, { stun: 120, knock: 8, id })
      for (const q of alliesNear(state, p, 8 * T)) q.fx[FX_PARTYDR] = 360
      break
    }
    // ---- 침착덕
    case 'pierce':
      p.pierceShots = 6
      break
    case 'grenade':
      state.throws.push({ id: state.nextFxId++, owner: p.id, x0: p.x, y0: p.y, x: tx, y: ty, t: 42, max: 42 })
      break
    case 'composure':
      p.fx[FX_CRIT] = 360
      buffRate(p, 360, 1.5)
      break
    // ---- 단군덕
    case 'broadcast': {
      for (const m of state.monsters) {
        if (m.hp <= 0 || len(m.x - p.x, m.y - p.y) > 18 * T) continue
        m.mark = 480
        m.vuln = 480
        m.vulnPct = Math.max(m.vulnPct, 25)
      }
      break
    }
    case 'fanfire': {
      const { x: mx, y: my } = muzzle(map, p)
      const headTarget = aimedEnemy(state, p)
      const critMon = aimedMonster(state, map, p)
      for (let i = 0; i < 8; i++) {
        const a = (p.aim + Math.round(((i - 3.5) / 3.5) * deg(15))) & 1023
        spawnBullet(state, p, mx, my, a, 'pistol', { headTarget, critMon, over: false, overR: 0 })
      }
      p.shots += 8
      state.events.push({ type: 'fire', p: p.id, x: mx, y: my, aim: p.aim, weapon: 'pistol' })
      break
    }
    case 'spotlight':
      state.zones.push({ id: state.nextFxId++, kind: ZONE_SPOTLIGHT, owner: p.id, x: tx, y: ty, r: 4 * T, t: 480, max: 480, dmg: 0 })
      break
    // ---- 매직덕
    case 'firstaid': {
      for (const q of alliesNear(state, p, 6 * T)) {
        const amount = Math.min(q.maxHp - q.hp, Math.round(q.maxHp * 0.25))
        if (amount <= 0) continue
        q.hp += amount
        state.events.push({ type: 'heal', p: q.id, x: q.x, y: q.y, amount })
      }
      break
    }
    case 'flame':
      aoe(state, map, p, p.x, p.y, 4 * T, 60, { knock: 5, arcAim: p.aim, arc: deg(40), id })
      break
    case 'surgery': {
      for (const q of alliesNear(state, p, 8 * T, true)) {
        if (q.downed) {
          raise(state, q, q.maxHp, 180)
          p.revives++
          state.events.push({ type: 'revive', p: q.id, by: p.id, x: q.x, y: q.y })
        } else {
          const amount = q.maxHp - q.hp
          q.hp = q.maxHp
          q.invuln = Math.max(q.invuln, 180)
          if (amount > 0) state.events.push({ type: 'heal', p: q.id, x: q.x, y: q.y, amount: Math.round(amount) })
        }
      }
      break
    }
    // ---- 승빠덕
    case 'pancharge':
      p.dashDx = cosA(p.aim)
      p.dashDy = sinA(p.aim)
      p.fx[FX_CHARGE] = 13
      p.chargeTag = state.nextFxId++
      p.ads = false
      break
    case 'oil':
      aoe(state, map, p, p.x, p.y, 3 * T, 50, { slow: 150, knock: 2, id })
      break
    case 'kitchen':
      p.fx[FX_WHIRL] = 300
      break
    // ---- 옥냥덕
    case 'catstep':
      p.dashDx = -cosA(p.aim)
      p.dashDy = -sinA(p.aim)
      p.fx[FX_CHARGE] = 11
      p.chargeTag = 0
      p.empowerShots = 1
      break
    case 'railshot': {
      const { x: mx, y: my } = muzzle(map, p)
      spawnBullet(state, p, mx, my, p.aim, 'sniper', { speed: 30, damage: 200, life: 50, pierce: 99, headTarget: aimedEnemy(state, p), critMon: aimedMonster(state, map, p), over: false, overR: 0 })
      p.shots++
      state.events.push({ type: 'fire', p: p.id, x: mx, y: my, aim: p.aim, weapon: 'sniper' })
      break
    }
    case 'ninelives':
      p.fx[FX_SNIPE] = 480
      buffRate(p, 480, 3)
      break
  }
}

/** 돌진 중: 몸에 닿는 몬스터·적을 한 번씩 친다 */
function chargeHit(state: GameState, map: GameMap, p: PlayerState): void {
  aoe(state, map, p, p.x, p.y, PLAYER_RADIUS + 10, 60, { knock: 6, id: 'pancharge', quiet: true, tag: p.chargeTag })
}

/** 땅의 효과: 스포트라이트 — 안의 몬스터는 느려지고 약해지고, 안의 동료는 빨리 쏜다 */
function stepZones(state: GameState): void {
  if (state.zones.length === 0) return
  let write = 0
  for (const z of state.zones) {
    z.t--
    if (z.t <= 0) {
      // 몬스터 편 폭발: 대기열에 넣으면 이번 틱 runBooms 가 터뜨린다 (by -2 = 몬스터는 안 다친다)
      if (z.kind === ZONE_FUSE) booms.push({ x: z.x, y: z.y, r: z.r, dmg: z.dmg, by: -2 })
      continue
    }
    if (z.kind === ZONE_SPOTLIGHT) {
      for (const m of state.monsters) {
        if (m.hp <= 0 || len(m.x - z.x, m.y - z.y) > z.r) continue
        m.slow = Math.max(m.slow, 6)
        m.vuln = Math.max(m.vuln, 6)
        m.vulnPct = Math.max(m.vulnPct, 50)
      }
      const owner = state.players[z.owner]
      for (const q of state.players) {
        if (!q.alive || q.left || q.downed || len(q.x - z.x, q.y - z.y) > z.r) continue
        if (owner && isEnemy(owner, q)) q.legInjury = Math.max(q.legInjury, 6)
        else buffRate(q, 6, 1.3)
      }
    }
    state.zones[write++] = z
  }
  state.zones.length = write
}

/** 던진 것(수류탄): 시간이 다 되면 터진다 */
function stepThrows(state: GameState, map: GameMap, grid: Grid): void {
  if (state.throws.length === 0) return
  let write = 0
  for (const t of state.throws) {
    t.t--
    if (t.t > 0) {
      state.throws[write++] = t
      continue
    }
    const owner = state.players[t.owner]
    if (owner) aoe(state, map, owner, t.x, t.y, 3 * TILE, 80, { stun: 60, knock: 4, id: 'grenade' })
  }
  state.throws.length = write
  void grid
}

// ================================================================ 탄

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

    // 엄폐 관통은 총구 근처에서만 (기대고 있는 자루를 넘기려는 것이다)
    const near = b.overR > 0 && (b.px - b.ox) ** 2 + (b.py - b.oy) ** 2 <= b.overR * b.overR
    const tileHit = rayCast(map, b.px, b.py, b.x, b.y, 'bullet', b.over || near)
    if (tileHit.blocked) {
      if (tileHit.tile === TILE_SANDBAG) damageSandbag(state, map, tileHit.tx, tileHit.ty, b.damage)
      state.events.push({ type: 'wall', x: b.x, y: b.y, aim: state.players[b.owner].aim })
      dead = true
    }

    if (!dead) {
      // 이 선분에 걸리는 것 중 **가장 먼저 닿는** 것 (몬스터·적 플레이어). 같으면 번호가 작은 것
      const shooter = state.players[b.owner]
      const sx = b.x - b.px
      const sy = b.y - b.py
      const s2 = sx * sx + sy * sy || 1
      let bestT = Infinity
      let bestM: Monster | null = null
      let bestP: PlayerState | null = null
      if (state.monsters.length > 0) {
        grid.query(Math.min(b.px, b.x) - 24, Math.min(b.py, b.y) - 24, Math.max(b.px, b.x) + 24, Math.max(b.py, b.y) + 24, (k) => {
          const m = state.monsters[k]
          if (!m || m.hp <= 0 || m.id === b.lastHit) return
          if (!segmentHitsCircle(b.px, b.py, b.x, b.y, m.x, m.y, MONSTER_LIST[m.kind].r)) return
          const t = ((m.x - b.px) * sx + (m.y - b.py) * sy) / s2
          if (t < bestT || (t === bestT && bestM && m.id < bestM.id)) {
            bestT = t
            bestM = m
          }
        })
      }
      if (state.mode === 'arena') {
        for (const v of state.players) {
          if (!isEnemy(shooter, v) || !v.alive || v.left || v.invuln > 0 || v.dashTimer > 0 || -(v.id + 1) === b.lastHit) continue
          if (!segmentHitsCircle(b.px, b.py, b.x, b.y, v.x, v.y, PLAYER_RADIUS)) continue
          const t = ((v.x - b.px) * sx + (v.y - b.py) * sy) / s2
          if (t < bestT) {
            bestT = t
            bestP = v
            bestM = null
          }
        }
      }
      if (bestM) {
        const m: Monster = bestM
        applyHit(state, b, m, pointLineDistance(m.x, m.y, b.px, b.py, b.vx, b.vy))
        if (b.pierce > 0) {
          b.pierce--
          b.lastHit = m.id
        } else dead = true
      } else if (bestP) {
        const v: PlayerState = bestP
        applyHitPlayer(state, b, v, pointLineDistance(v.x, v.y, b.px, b.py, b.vx, b.vy))
        if (b.pierce > 0) {
          b.pierce--
          b.lastHit = -(v.id + 1)
        } else dead = true
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
  // 산탄은 정중앙을 지나는 탄만 (일곱 개가 전부 치명타가 되면 과하다). 침착 모드는 전부
  const crit = b.forceCrit || (b.critMon === m.id && (w.pellets === 1 || partForOffset(dOff, def.r) === PART_HEAD))
  const shooter = state.players[b.owner]
  let dmg = b.damage * b.mul * (crit ? headMult(w) + shooter.st[ST_CRIT] / 100 : 1) * falloff(w, dist)
  if (shooter.char === 'jupeol' && dist < JUPEOL.range) dmg *= JUPEOL.mult
  if (shooter.char === 'giyeol') dmg *= 1 + Math.min(GIYEOL.maxStacks, shooter.streak) * GIYEOL.perHit
  dmg = Math.round(dmg)
  b.hitSomeone = true
  shooter.streak = Math.min(99, shooter.streak + 1)
  const speed = len(b.vx, b.vy) || 1
  const k = w.knock * (1 - def.knockRes)
  m.kx += (b.vx / speed) * k
  m.ky += (b.vy / speed) * k
  // 탄막(철면덕 E): 맞은 괴물은 잠깐 느려진다
  if (shooter.fx[FX_FREEAMMO] > 0) m.slow = Math.max(m.slow, 30)
  hurtMonster(state, m, dmg, b.owner, crit, b.x, b.y)
}

/**
 * 탄이 적 플레이어를 맞혔다 (투기장 — 덕의 applyHit). 헤드샷은 커서 규칙, 저격 조준경 한 방, 후라이팬 막기까지 덕 그대로.
 * 스킬 배율(mul)과 침착 모드(forceCrit = 머리)가 얹힌다.
 */
function applyHitPlayer(state: GameState, b: Bullet, victim: PlayerState, dOff: number): void {
  const w = WEAPONS[b.weapon]
  const dist = len(victim.x - b.ox, victim.y - b.oy)
  let part = partForOffset(dOff, PLAYER_RADIUS, headHitScale(victim.char))
  if (b.forceCrit) part = PART_HEAD
  else if (w.pellets > 1) {
    if (part === PART_HEAD && b.headTarget !== victim.id) part = PART_BODY
  } else if (b.headTarget === victim.id) part = PART_HEAD
  else if (part === PART_HEAD) part = PART_BODY
  const mult = part === PART_HEAD ? headMult(w) + state.players[b.owner].st[ST_CRIT] / 100 : PART_MULT[part]
  let dmg = b.damage * b.mul * mult * falloff(w, dist)
  // 저격 조준경 탄: 맞으면 한 방, 스치면 체력 10 남김 (덕 오픈 베타 규칙)
  if (w.lethalAds && b.ads && b.mul === 1 && b.pierce === 0) {
    const graze = dOff > PLAYER_RADIUS * SNIPER_GRAZE_FRAC
    dmg = graze ? Math.max(0, victim.hp - (w.grazeLeave ?? 10)) : victim.hp / takenMul(victim)
  }
  const shooter = state.players[b.owner]
  if (shooter.char === 'jupeol' && dist < JUPEOL.range) dmg *= JUPEOL.mult
  if (shooter.char === 'giyeol') dmg *= 1 + Math.min(GIYEOL.maxStacks, shooter.streak) * GIYEOL.perHit
  dmg = Math.round(dmg)
  b.hitSomeone = true
  shooter.streak = Math.min(99, shooter.streak + 1)
  dmg = panBlock(state, victim, dmg, b.ox, b.oy)
  hurtPvp(state, shooter, victim, dmg, part, b.x, b.y)
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

// ================================================================ 몬스터

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
  // 약화(생중계·스포트라이트): 받는 피해 증가
  if (m.vuln > 0 && m.vulnPct > 0) dmg = Math.round(dmg * (1 + m.vulnPct / 100))
  if (m.elite & EA_STOUT) dmg = Math.max(1, Math.round(dmg * AFFIX_TUNE.stout))
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
      if (killer.st[ST_LIFEKILL] > 0 && isActive(killer)) killer.hp = Math.min(killer.maxHp, killer.hp + killer.st[ST_LIFEKILL])
    }
    reward(state, m, def)
    if (rand(state.rng) < def.globe) {
      state.globes.push({ id: state.nextGlobeId++, x: m.x, y: m.y, ttl: GLOBE_TTL, heal: Math.round(GLOBE_HEAL_FRAC * 100), share: true })
      state.events.push({ type: 'drop', x: m.x, y: m.y })
    }
    // 쓰러뜨려도 터진다 — 약하게
    if (def.attack === 'explode') booms.push({ x: m.x, y: m.y, r: def.blast ?? 80, dmg: Math.round(def.dmg * DEATH_BLAST_MULT), by })
  }
  if (m.elite & EA_VOLATILE) {
    const t = AFFIX_TUNE.fuseTicks
    state.zones.push({ id: state.nextFxId++, kind: ZONE_FUSE, owner: -1, x: m.x, y: m.y, r: AFFIX_TUNE.fuseR, t, max: t, dmg: Math.round((AFFIX_TUNE.fuseDmg * m.pow) / 100) })
  }
  if (m.elite & EA_SPLIT) {
    // 정예 배율을 걷어 낸 층 보정만 물려준다
    const hpMul = m.maxHp / (def.hp * ELITE.hp)
    for (let i = 0; i < AFFIX_TUNE.splitN; i++) spawns.push({ x: m.x, y: m.y, pack: m.pack, hpMul: hpMul * AFFIX_TUNE.splitHp, pow: Math.round(m.pow / ELITE.pow), lvl: m.lvl })
  }
}

/** 분열로 나온 구울을 넣는다: 깨어 있고, 죽은 자리 둘레에 조금씩 벌려 놓는다 */
function flushSpawns(state: GameState, map: GameMap): void {
  if (spawns.length === 0) return
  const ring = [[0, -1], [0.87, 0.5], [-0.87, 0.5], [0.87, -0.5], [-0.87, -0.5], [0, 1]]
  for (let i = 0; i < spawns.length; i++) {
    const s = spawns[i]
    const d = ring[i % ring.length]
    const r = moveCircle(map, s.x, s.y, MONSTER_LIST[0].r, d[0] * 14, d[1] * 14)
    const g = makeMonster(state, 0, r.x, r.y, s.pack, s.hpMul, s.pow, s.lvl)
    g.st = MS_CHASE
    g.cd = 20 + i * 6
    g.aim = (i * 341) & 1023
    state.monsters.push(g)
    state.monstersTotal++
  }
  spawns.length = 0
}

/** 괴물이 쓰러지면 가까운 파티원 **모두**에게 경험치·골드, 그리고 각자 몫의 전리품을 굴린다 (디아블로 3·4 개인 전리품) */
const SHARE_RANGE = 30 * TILE
function reward(state: GameState, m: Monster, def: MonsterDef): void {
  if (state.mode !== 'dungeon') return
  for (const p of state.players) {
    if (!p.alive || p.left || p.out) continue
    if (len(p.x - m.x, p.y - m.y) > SHARE_RANGE) continue
    const unique = (m.elite & EA_UNIQUE) !== 0
    const eliteK = unique ? UNIQUE.xp : m.elite ? ELITE.xp : 1
    gainXp(state, p, Math.round(xpFor(m) * (1 + p.st[ST_XP] / 100)))
    const g = Math.max(1, Math.round(def.xp * 0.4 * eliteK * (m.pow / 100)))
    p.gold += g
    p.goldGain += g
    // 전리품: 사람마다 따로 굴린다. 주인에게만 보이고 주인만 줍는다
    // 정예·우두머리·보스는 확정 + 등급이 오른다 (우두머리·보스는 둘). 아이템 레벨 = 이 층의 지역 레벨
    const drops = def.boss ? 2 : unique ? UNIQUE.drops : m.elite || rand(state.rng) < def.loot ? 1 : 0
    const ilvl = Math.max(1, areaLevel(state.stage, state.floor, p.level))
    for (let k = 0; k < drops; k++) {
      const item = rollItem(state.rng, state.nextItemUid++, ilvl, p.weapon, def.boss ? 0.3 : unique ? UNIQUE.lootBonus : m.elite ? ELITE.lootBonus : 0)
      const ox = (rand(state.rng) - 0.5) * 36
      const oy = (rand(state.rng) - 0.5) * 36
      state.drops.push({ id: state.nextDropId++, owner: p.id, x: m.x + ox, y: m.y + oy, item, ttl: 60 * 240, lock: 20 })
      state.events.push({ type: 'loot', owner: p.id, x: m.x + ox, y: m.y + oy, rarity: item.rarity })
    }
  }
}

function gainXp(state: GameState, p: PlayerState, xp: number): void {
  if (p.level >= LEVEL_CAP || xp <= 0) return
  p.xp += xp
  p.xpGain += xp
  let up = false
  while (p.level < LEVEL_CAP && p.xp >= xpNeed(p.level)) {
    p.xp -= xpNeed(p.level)
    p.level++
    up = true
  }
  if (!up) return
  recalc(p)
  // 레벨이 오르면 체력이 가득 찬다 (디아블로)
  if (p.alive && !p.downed) p.hp = p.maxHp
  state.events.push({ type: 'levelup', p: p.id, level: p.level })
}

/** 바닥 전리품 줍기: 가방에 자리가 있으면 발밑의 내 것·버려진 것을 줍는다 */
function pickUp(state: GameState, p: PlayerState): void {
  if (!isActive(p) || p.bag.length >= BAG_SIZE) return
  const R2 = (PLAYER_RADIUS + 14) ** 2
  for (let i = 0; i < state.drops.length; i++) {
    const d = state.drops[i]
    if (d.lock > 0 || (d.owner !== p.id && d.owner !== -1)) continue
    if ((d.x - p.x) ** 2 + (d.y - p.y) ** 2 > R2) continue
    p.bag.push(d.item)
    // 내가 버렸다 다시 주운 것도 센다 — 드물고, 결과표는 대략이면 된다
    p.found++
    if (d.item.rarity > p.bestFound) p.bestFound = d.item.rarity
    state.drops.splice(i, 1)
    state.events.push({ type: 'pickup', p: p.id, rarity: d.item.rarity, uid: d.item.uid })
    return
  }
}

/** 가방·장비 명령 (Input.cmd). 무기는 내 무기 종류만 낀다 */
function runCommand(state: GameState, p: PlayerState, cmd: number, arg: number): void {
  if (p.left) return
  if (cmd === CMD_EQUIP) {
    const it = p.bag[arg]
    if (!it) return
    if (it.slot === SLOT_WEAPON && WEAPON_IDS[it.wt] !== p.weapon) return
    const old = p.equip[it.slot]
    p.equip[it.slot] = it
    if (old) p.bag[arg] = old
    else p.bag.splice(arg, 1)
    recalc(p)
    state.events.push({ type: 'equip', p: p.id, slot: it.slot })
  } else if (cmd === CMD_UNEQUIP) {
    const it = p.equip[arg]
    if (!it || p.bag.length >= BAG_SIZE) return
    p.equip[arg] = null
    p.bag.push(it)
    recalc(p)
    state.events.push({ type: 'equip', p: p.id, slot: arg })
  } else if (cmd === CMD_DROP) {
    const it = p.bag[arg]
    if (!it || !p.alive) return
    p.bag.splice(arg, 1)
    // 버린 것은 누구나 볼 수 있고 누구나 줍는다 (친구에게 주는 방법). 바로 다시 줍지 않게 잠깐 잠근다
    state.drops.push({ id: state.nextDropId++, owner: -1, x: p.x + cosA(p.aim) * 30, y: p.y + sinA(p.aim) * 30, item: it, ttl: 60 * 240, lock: 90 })
    state.events.push({ type: 'loot', owner: -1, x: p.x, y: p.y, rarity: it.rarity })
  }
}

/** 바닥 전리품: 시간이 지나면 사라진다 */
function stepDrops(state: GameState): void {
  if (state.drops.length === 0) return
  let write = 0
  for (const d of state.drops) {
    if (d.lock > 0) d.lock--
    if (--d.ttl <= 0) continue
    state.drops[write++] = d
  }
  state.drops.length = write
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
    if (b.by === -2) continue
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
    if (m.mark > 0) m.mark--
    if (m.vuln > 0 && --m.vuln === 0) m.vulnPct = 0
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
    if (m.slow > 0) m.slow--
    if (m.taunt > 0) m.taunt--
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
      // 보스는 기절이 짧다 (4분의 1)
      m.stun = def.boss ? Math.max(0, m.stun - 4) : m.stun - 1
      // 기절하면 하던 공격 예고도 끊긴다
      if (m.st === MS_WINDUP || m.st === MS_CHARGE) {
        m.st = MS_CHASE
        m.mode = 0
        m.cd = Math.max(m.cd, 20)
      }
      continue
    }
    if (m.cd > 0) m.cd--
    // 표적: 가장 가까운 움직일 수 있는 사람. 30틱마다 다시 고른다 (쓰러지면 바로). 도발 중이면 그대로
    const tauntOk = m.taunt > 0 && m.target >= 0 && isActive(state.players[m.target])
    if (!tauntOk && (m.target < 0 || !isActive(state.players[m.target]) || (tick + m.id) % 30 === 0)) m.target = nearestActive(state, m.x, m.y)
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

    if (m.st === MS_CHARGE) {
      // 보스 돌진: 정한 방향으로 곧게, 닿는 사람을 한 번씩 친다
      const r = moveCircle(map, m.x, m.y, def.r, cosA(m.aim) * CHARGE.speed, sinA(m.aim) * CHARGE.speed)
      const blocked = Math.abs(r.x - m.x) + Math.abs(r.y - m.y) < CHARGE.speed * 0.3
      m.x = r.x
      m.y = r.y
      m.moving = 1
      for (const p of state.players) {
        if (!isActive(p) || len(p.x - m.x, p.y - m.y) > def.r + PLAYER_RADIUS + 4) continue
        if (hurtPlayer(state, p, Math.round((CHARGE.dmg * m.pow) / 100), m.id, m.x, m.y)) {
          p.x += cosA(m.aim) * 30
          p.y += sinA(m.aim) * 30
        }
      }
      if (--m.t <= 0 || blocked) {
        m.st = MS_RECOVER
        m.t = 50
        m.mode = 0
        m.cd = CHARGE.every
      }
      continue
    }
    if (m.st === MS_CHASE) {
      m.aim = turnToward(m.aim, face, TURN)
      // 보스: 멀리 있는 표적에게 예고선을 긋고 돌진
      if (def.boss && m.cd === 0 && m.los === 1 && d > 140 && d < 520) {
        m.st = MS_WINDUP
        m.mode = 1
        m.t = CHARGE.windup
        m.aim = face
        m.ax = tp.x
        m.ay = tp.y
        state.events.push({ type: 'windup', m: m.id, kind: m.kind, x: m.x, y: m.y })
        continue
      }
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
    } else if (m.st === MS_WINDUP && m.mode === 1) {
      // 돌진 예고: 방향은 정해졌다 (옆으로 비키면 산다)
      if (--m.t <= 0) {
        m.st = MS_CHARGE
        m.t = CHARGE.ticks
        m.tag = state.nextFxId++
      }
    } else if (m.st === MS_WINDUP) {
      if (def.attack === 'melee') m.aim = turnToward(m.aim, face, TURN_WINDUP)
      else if (def.attack === 'ranged') m.aim = atan2A(m.ay - m.y, m.ax - m.x)
      m.t--
      if (m.t <= 0) resolveAttack(state, m, def)
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
  let speed = away ? def.speed * 0.8 : def.speed
  if (m.elite & EA_FAST) speed *= AFFIX_TUNE.fast
  if (m.slow > 0) speed *= 0.5
  const r = moveCircle(map, m.x, m.y, def.r, dirX * speed, dirY * speed)
  m.x = r.x
  m.y = r.y
  m.moving = 1
}

function resolveAttack(state: GameState, m: Monster, def: MonsterDef): void {
  if (def.attack === 'melee') {
    state.events.push({ type: 'swipe', m: m.id, x: m.x, y: m.y, aim: m.aim })
    const reach = def.r + PLAYER_RADIUS + def.range + 8
    for (const p of state.players) {
      if (!isActive(p)) continue
      const dx = p.x - m.x
      const dy = p.y - m.y
      if (len(dx, dy) > reach) continue
      if (Math.abs(angleDiff(atan2A(dy, dx), m.aim)) > (def.arc ?? 180)) continue
      hurtPlayer(state, p, Math.round((def.dmg * m.pow) / 100), m.id, m.x, m.y)
    }
    m.st = MS_RECOVER
    m.t = def.recover
    m.cd = def.cooldown
  } else if (def.attack === 'ranged') {
    const a = atan2A(m.ay - m.y, m.ax - m.x)
    const sp = def.shotSpeed ?? 5
    const sx = m.x + cosA(a) * (def.r + 4)
    const sy = m.y + sinA(a) * (def.r + 4)
    state.mshots.push({ id: state.nextShotId++, kind: m.kind, by: m.id, x: sx, y: sy, vx: cosA(a) * sp, vy: sinA(a) * sp, life: def.shotLife ?? 80, dmg: Math.round((def.dmg * m.pow) / 100), r: def.shotR ?? 6 })
    state.events.push({ type: 'mshot', m: m.id, kind: m.kind, x: sx, y: sy })
    m.st = MS_RECOVER
    m.t = def.recover
    m.cd = def.cooldown
  } else {
    // 부풀었다가 터진다 — 스스로 죽는다
    killMonster(state, m, -1, true)
    booms.push({ x: m.x, y: m.y, r: def.blast ?? 80, dmg: Math.round((def.dmg * m.pow) / 100), by: -1 })
  }
}

/** 몬스터끼리 겹치지 않게 서로 민다 + 플레이어 몸 안으로는 못 들어온다 (몬스터만 밀린다) */
function separate(state: GameState, map: GameMap, grid: Grid): void {
  const ms = state.monsters
  if (ms.length === 0) return
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
  if (state.mshots.length === 0) return
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
        if (hurtPlayer(state, p, s.dmg, s.by, px, py)) {
          dead = true
          break
        }
      }
    }
    if (!dead) state.mshots[write++] = s
  }
  state.mshots.length = write
}

/**
 * 회복 구슬(던전) · 힐팩(투기장): 밟은 사람이 회복한다. 던전 구슬은 가까운 동료에게도 나눈다.
 * 모두 가득이면 남겨 둔다. 동시에 밟으면 번호가 앞선 사람이 줍는다(순서가 곧 결정론).
 */
function stepGlobes(state: GameState): void {
  if (state.globes.length === 0) return
  let write = 0
  for (const g of state.globes) {
    g.ttl--
    if (g.ttl <= 0) continue
    const reach = (g.share ? GLOBE_RADIUS : MEDKIT_RADIUS) + PLAYER_RADIUS
    let taker: PlayerState | null = null
    for (const p of state.players) {
      if (!isActive(p) || p.hp >= p.maxHp) continue
      if ((p.x - g.x) ** 2 + (p.y - g.y) ** 2 > reach * reach) continue
      taker = p
      break
    }
    if (!taker) {
      state.globes[write++] = g
      continue
    }
    for (const p of state.players) {
      if (!isActive(p) || p.hp >= p.maxHp) continue
      const frac = p === taker ? g.heal / 100 : g.share && p.team === taker.team && len(p.x - g.x, p.y - g.y) <= GLOBE_SHARE_RANGE ? GLOBE_SHARE_FRAC : 0
      if (frac <= 0) continue
      const amount = Math.min(p.maxHp - p.hp, Math.round(p.maxHp * frac))
      p.hp += amount
      state.events.push({ type: 'heal', p: p.id, x: p.x, y: p.y, amount })
    }
  }
  state.globes.length = write
}

// ================================================================ 스냅샷

/**
 * 화면 보간용 가벼운 사본: 렌더러가 이전 틱에서 읽는 것은 **위치뿐**이다(플레이어 x·y, 탄·몬스터·투사체의 id·x·y).
 * 전에는 매 틱 판 전체를 structuredClone 했는데(덕 그대로), 몬스터·가방이 생기자 틱마다 0.33ms 가 들었다(2026-09-18 실측).
 * 모양만 GameState 이고 나머지는 비어 있다 — 렌더러 말고는 쓰지 말 것. 리싱크·난입 전송은 snapshot() 을 쓴다.
 */
export function interpSnapshot(state: GameState): GameState {
  return {
    players: state.players.map((p) => ({ x: p.x, y: p.y })),
    bullets: state.bullets.map((b) => ({ id: b.id, x: b.x, y: b.y })),
    monsters: state.monsters.map((m) => ({ id: m.id, x: m.x, y: m.y })),
    mshots: state.mshots.map((m) => ({ id: m.id, x: m.x, y: m.y })),
  } as unknown as GameState
}

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
