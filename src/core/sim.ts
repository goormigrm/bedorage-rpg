// 결정론 시뮬레이션. 두 가지 판을 한 코드로 돈다:
//  - dungeon: 협동 던전 (몬스터 AI · 쓰러짐/부활 · 회복 구슬 · 죽음 규칙)
//  - arena:   투기장 PvP (배도라지 덕의 대전 규칙 이식 — 헤드샷 · 모래주머니 · 힐팩 · 목표 킬, RPG 에서 키운 캐릭터끼리)
// 둘 다 덕의 이동·사격·구르기·기력 위에 **스킬(Q·E·X)** 이 얹힌다. 스킬은 몬스터와 적 플레이어를 똑같이 친다.
// 규칙은 DESIGN 2장 — Math.random/삼각함수/시간 금지, 모든 기억은 GameState 안.

import { CHARACTERS, CharacterId, PLAYABLE, headHitScale } from './characters'
import { angleDiff, atan2A, cosA, sinA, len } from './fixedmath'
import {
  BTN_ADS, BTN_DASH, BTN_FIRE, BTN_PORTAL, BTN_POTION, BTN_RELOAD, BTN_SPRINT, BTN_USE, CMD_BUY, CMD_DROP, CMD_EQUIP, CMD_GAMBLE, CMD_POTUP, CMD_REROLL,
  CMD_HIRE, CMD_QUEST, CMD_RESPEC, CMD_SELL, CMD_SKILL_MOD, CMD_SKILL_SLOT, CMD_SKILL_UP, CMD_STASH_PUT, CMD_STASH_TAKE, CMD_UNEQUIP, CMD_WAYPOINT, Input, SKILL_BTNS,
  TOWN_BLOCKED,
} from './input'
import {
  BAG_SIZE, LEG_AMMO, LEG_BLOOD, LEG_CHAIN, LEG_CORPSE, LEG_FOCUS, LEG_FRENZY, LEG_FROST, LEG_GOLD, LEG_GUARD, LEG_UNDYING, LEVEL_CAP, STASH_SIZE, legMask, buyPrice, gamblePrice, itemValue, potUpPrice, rerollAffix, rerollPrice, SLOT_COUNT, SLOT_WEAPON, ST_CDR, ST_CRIT, ST_DMG, ST_DR, ST_HP, ST_LIFEKILL, ST_MAG, ST_RATE, ST_RELOAD, ST_SPEED,
  ST_STAMINA, ST_XP, Sheet, WEAPON_IDS, computeStats, rollItem, xpNeed,
} from './items'
import { COVER_DIST, GameMap, SANDBAG_HP, TILE, TILE_SANDBAG, isWallAt, nearSandbag, rayBlocked, rayCast } from './map'
import { BashDef, SNIPER_GRAZE_FRAC } from './weapons'
import { circlesOverlap, moveCircle, pointLineDistance, segmentHitsCircle } from './physics'
import { makeRng, rand, randInt } from './rng'
import {
  AFFIX_TUNE, CHARGE, DEATH_BLAST_MULT, GOBLIN, GOBLIN_KIND, EA_FAST, EA_SPLIT, EA_STOUT, EA_UNIQUE, EA_VAMP, EA_VOLATILE, ELITE, MONSTER_LIST, MonsterDef, UNIQUE, isBossLike, xpFor,
} from './monsters'
export { nodeSkill, slotNode } from './skills'
import { makeMonster, populate, rollAffixes } from './dungeon'
import { botInput, makeBot } from './bot'
import { ACTS, AreaLayout, QUESTS, WAYPOINTS, npcNear, questDiscount, questPoints, areaDef, areaLayout, areaLevel, areaSeed, isTown, safeSpots, wpBit } from './world'
import { Grid, flowField, flowStep } from './flow'
import {
  CHAR_SKILLS, FX_CHARGE, FX_COUNT, FX_CRIT, FX_FREEAMMO, FX_GUARD, FX_PARTYDR, FX_RATE, FX_SNIPE, FX_WHIRL,
  MAX_RANK, SKILLS, SkillId, ULT_START_FRAC, focusCost, freePoints, nodeCd, nodePow, nodeSkill, sanitizeBuild, slotNode,
} from './skills'
import {
  AreaState, BLEED_TICKS, BLOCK_CHANCE, BLOCK_COST, BLOCK_LOCK_TICKS, Bullet, CHICKEN_HEAL, CHICKEN_MAXHP_CAP, CHICKEN_MAXHP_PER_KILL,
  COUNTDOWN_TICKS, CHIM, MapObj, OBJ_CHEST, OBJ_GOLDCHEST, OBJ_SHRINE, OBJ_URN, SHRINE_TICKS, DASH_COST, DASH_SPEED, DASH_TICKS, GIYEOL, GLOBE_HEAL_FRAC, GLOBE_RADIUS, GLOBE_SHARE_FRAC,
  GLOBE_SHARE_RANGE, GLOBE_TTL, GameState, JUPEOL, MAX_PLAYERS, MEDKIT_HEAL_FRAC, MEDKIT_RADIUS, MEDKIT_TTL, MIN_PLAYERS,
  MS_CHARGE, MS_CHASE, MS_RECOVER, MS_SLEEP, MS_WINDUP, MatchConfig, Monster, PLAYER_RADIUS, PUNGWOL, PlayerState, RESPAWN_TICKS,
  REVIVE_HP_FRAC, REVIVE_RANGE, REVIVE_TICKS, SOLO_BLEED_TICKS, SPAWN_PROTECT_TICKS, SPRINT_COST, SPRINT_MIN, SPRINT_MUL,
  STAMINA_MAX, STAMINA_REGEN, UWON, ZONE_FUSE, ZONE_SPOTLIGHT, isActive, isEnemy, teamKills, MoveHow, SimEvent,
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
/** safe = 플레이어는 다치지 않는다 (전설 "시체 폭탄") */
const booms: { x: number; y: number; r: number; dmg: number; by: number; safe?: boolean }[] = []
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

// ================================================================ 지역 (GUIDE 5·12장)

/** 판이 받는 맵: 지역 번호 → 맵. 지역이 하나뿐인 판(투기장·시험)은 맵 하나를 그대로 넘겨도 된다 */
export type MapSource = GameMap | ((area: number) => GameMap)

function mapFn(maps: MapSource): (area: number) => GameMap {
  return typeof maps === 'function' ? maps : () => maps
}

/** 출구에 이만큼 다가서면 건너간다 · 웨이포인트를 밟으면 열린다 · 포털에 이만큼 가까이서 F */
const EXIT_R = 30
/** 보스 방 바로 앞 지역 (금빛 상자) */
const AREAS_BOSS_BEFORE = [8]
const WP_R = 44
const PORTAL_R = 40
/** 타운 포털 시전 (틱) */
export const PORTAL_CAST = 90
/** 사람이 없는 지역을 얼려 두는 수 (넘으면 가장 오래된 것부터 버린다 — 다시 가면 새로 채워진다) */
const FROZEN_KEEP = 3

function newArea(id: number, tick: number): AreaState {
  return { id, objects: [], monsters: [], mshots: [], bullets: [], globes: [], zones: [], throws: [], drops: [], monstersTotal: 0, seen: tick }
}

function findArea(state: GameState, id: number): AreaState | undefined {
  return state.areas.find((a) => a.id === id)
}

/** step 이 도는 중인가 (도는 동안에는 지역을 하나씩 묶고, 끝나면 "기본 지역" 을 다시 묶는다) */
let stepping = false

/** 묶인 칸(GameState.monsters …)을 그 지역으로 되돌린다 — 묶인 동안에는 칸 쪽이 정본이다 */
function unbind(state: GameState): void {
  if (state.curArea < 0) return
  const a = findArea(state, state.curArea)
  if (a) {
    a.monsters = state.monsters
    a.mshots = state.mshots
    a.bullets = state.bullets
    a.globes = state.globes
    a.zones = state.zones
    a.throws = state.throws
    a.drops = state.drops
    a.objects = state.objects
    a.monstersTotal = state.monstersTotal
  }
  state.curArea = -1
}

function bind(state: GameState, a: AreaState): void {
  state.curArea = a.id
  state.monsters = a.monsters
  state.mshots = a.mshots
  state.bullets = a.bullets
  state.globes = a.globes
  state.zones = a.zones
  state.throws = a.throws
  state.drops = a.drops
  state.objects = a.objects
  state.monstersTotal = a.monstersTotal
}

/**
 * step 밖에서는 **사람이 있는 지역 중 번호가 가장 작은 곳**을 칸에 묶어 둔다. 지역이 하나뿐인 판(투기장·시험)은
 * 예전처럼 `state.monsters` 를 바로 보고 만질 수 있다. 여러 지역이면 화면·봇은 반드시 `areaView` 로 본다.
 */
function bindPrimary(state: GameState): void {
  unbind(state)
  const live = liveAreas(state)
  const a = findArea(state, live[0] ?? -1) ?? state.areas[0]
  if (a) {
    bind(state, a)
    return
  }
  state.monsters = []
  state.mshots = []
  state.bullets = []
  state.globes = []
  state.zones = []
  state.throws = []
  state.drops = []
  state.objects = []
  state.monstersTotal = 0
}

/**
 * 지역 하나를 묶고 fn 을 돌린다: 그 지역의 배열을 GameState 의 칸에 걸고, **다른 지역에 있는 사람은 잠시 `left`** 로 둔다 —
 * 그러면 2천 줄의 전투 코드가 "이 지역에 있는 사람과 몬스터만" 보고 그대로 돈다. 끝나면 되돌린다.
 */
function withArea<T>(state: GameState, a: AreaState, fn: () => T): T {
  unbind(state)
  const hidden: PlayerState[] = []
  for (const p of state.players) {
    if (!p.left && p.area !== a.id) {
      p.left = true
      hidden.push(p)
    }
  }
  bind(state, a)
  try {
    return fn()
  } finally {
    // 전투 코드가 배열을 새로 만들어 끼우기도 한다(쓰러진 몬스터 걸러 내기) → 칸에 걸린 것을 도로 가져온다
    unbind(state)
    for (const p of hidden) p.left = false
    if (!stepping) bindPrimary(state)
  }
}

/** 판에 앉은 사람들의 평균 레벨 (몬스터 레벨의 바닥) */
function partyLevel(state: GameState): number {
  const seated = state.players.filter((p) => !p.vacant)
  return seated.length ? Math.round(seated.reduce((a, p) => a + p.level, 0) / seated.length) : 1
}

/**
 * 지역 채우기: 무리 + (지역에 있으면) 우두머리 또는 막 보스. 이미 쓰러뜨린 우두머리·보스는 다시 나오지 않는다.
 * 몬스터 레벨 = 지역 레벨 (파티가 훨씬 높으면 파티 − 3 까지)
 */
function fillArea(state: GameState, map: GameMap, id: number, seed: number): void {
  const def = areaDef(id)
  if (def.kind === 'town') return
  const l = areaLayout(id, map)
  const lvl = areaLevel(id, partyLevel(state))
  const seats = state.players.length
  populate(state, map, areaSeed(seed, id), seats, lvl, def.density ?? 1, def.packs ?? ACTS[def.act].packs, l.exits[0] ?? l.spawn, safeSpots(l))
  placeObjects(state, map, id, areaSeed(seed, id), safeSpots(l))
  // 보물 고블린: 가끔 한 마리 (지역 시드로 정한다)
  {
    const grng = makeRng((areaSeed(seed, id) ^ 0x60b1) >>> 0)
    if (def.kind !== 'boss' && rand(grng) < GOBLIN.chance) {
      for (let t = 0; t < 60; t++) {
        const tx = randInt(grng, 3, map.w - 3)
        const ty = randInt(grng, 3, map.h - 3)
        if (map.tiles[ty * map.w + tx] !== 0) continue
        const x = tx * TILE + TILE / 2
        const y = ty * TILE + TILE / 2
        if (safeSpots(l).some((q) => (q.x - x) ** 2 + (q.y - y) ** 2 < (10 * TILE) ** 2)) continue
        state.monsters.push(makeMonster(state, GOBLIN_KIND, x, y, 9997, 1 + 0.6 * Math.max(0, seats - 1), 100, lvl))
        state.monstersTotal++
        break
      }
    }
  }
  if (state.killed.includes(id)) return
  const hpMul = (1 + 0.6 * Math.max(0, seats - 1)) * (1 + 0.1 * (lvl - 1))
  const pow = Math.round(100 * (1 + 0.06 * (lvl - 1)))
  const at = l.special
  if (def.boss !== undefined) {
    // 막 보스: 가장 깊은 곳에서 잠들어 있다가 누가 다가오면 깬다
    state.monsters.push(makeMonster(state, def.boss, at.x, at.y, 9999, hpMul, pow, lvl))
    state.monstersTotal++
  } else if (def.unique) {
    // 우두머리: 평범한 원형을 크게 키우고 접두 능력 셋. 같은 원형 셋이 지킨다
    const rng = makeRng((areaSeed(seed, id) ^ 0x7a11e) >>> 0)
    const u = makeMonster(state, def.unique.kind, at.x, at.y, 9998, hpMul * UNIQUE.hp, Math.round(pow * UNIQUE.pow), lvl)
    u.elite = rollAffixes(rng, 1 | EA_UNIQUE, UNIQUE.affixes)
    state.monsters.push(u)
    const r = MONSTER_LIST[def.unique.kind].r
    for (let i = 0; i < 3; i++) {
      const a = (i * 341 + 100) & 1023
      const g = moveCircle(map, at.x, at.y, r, cosA(a) * 40, sinA(a) * 40)
      state.monsters.push(makeMonster(state, def.unique.kind, g.x, g.y, 9998, hpMul, pow, lvl))
    }
    state.monstersTotal += 4
  }
}

/** 지역이 없으면 만들어 채운다 (처음 들어설 때 · 버린 뒤 다시 올 때) */
function ensureArea(state: GameState, id: number, map: GameMap, fill = true): AreaState {
  let a = findArea(state, id)
  if (a) return a
  a = newArea(id, state.tick)
  unbind(state)
  state.areas.push(a)
  state.areas.sort((x, y) => x.id - y.id)
  const seed = state.seed
  if (fill) withArea(state, a, () => fillArea(state, map, id, seed))
  else if (!stepping) bindPrimary(state)
  return a
}

/** 사람이 있는 지역 (번호 순) — 이 지역들만 틱을 돈다 */
function liveAreas(state: GameState): number[] {
  const ids: number[] = []
  for (const p of state.players) if (!p.left && !ids.includes(p.area)) ids.push(p.area)
  return ids.sort((a, b) => a - b)
}

interface Move {
  p: number
  to: number
  how: MoveHow
  x?: number
  y?: number
  /** 포털 주인이 마을에서 자기 포털로 돌아갔다 → 포털이 닫힌다 (디아블로 2) */
  closePortal?: boolean
}
/** 이번 틱에 다른 지역으로 건너갈 사람 (지역을 다 돈 뒤에 한꺼번에 옮긴다 — 도는 중에 지역이 바뀌지 않게) */
const moves: Move[] = []

function queueMove(p: PlayerState, m: Omit<Move, 'p'>): void {
  if (moves.some((q) => q.p === p.id)) return
  moves.push({ p: p.id, ...m })
}

/** 사람을 지역 to 의 (x, y) 곁 빈자리에 세운다 */
function placeIn(state: GameState, map: GameMap, p: PlayerState, to: number, x: number, y: number, how: MoveHow): void {
  const a = ensureArea(state, to, map)
  const from = p.area
  const spot = withArea(state, a, () => spotNear(state, map, x, y, p.id))
  p.area = to
  p.x = spot.x
  p.y = spot.y
  p.dashTimer = 0
  p.portalCast = 0
  p.exitLock = 30
  p.ads = false
  p.fx[FX_CHARGE] = 0
  p.invuln = Math.max(p.invuln, SPAWN_PROTECT_TICKS)
  state.events.push({ type: 'areaEnter', p: p.id, area: to, from, how })
}

function runMoves(state: GameState, mapOf: (area: number) => GameMap): void {
  moves.sort((a, b) => a.p - b.p)
  for (const m of moves) {
    const p = state.players[m.p]
    if (!p || p.left) continue
    const map = mapOf(m.to)
    const l = areaLayout(m.to, map)
    let at: { x: number; y: number }
    if (m.x !== undefined && m.y !== undefined) at = { x: m.x, y: m.y }
    else if (m.how === 'exit') at = l.exits.find((e) => e.to === p.area)?.arrive ?? l.spawn
    else if (m.how === 'wp') at = l.wpArrive ?? l.spawn
    else at = l.spawn
    placeIn(state, map, p, m.to, at.x, at.y, m.how)
    if (m.closePortal) state.portals = state.portals.filter((q) => q.owner !== p.id)
  }
  moves.length = 0
}

/** 맵 하나짜리 판: 건너가기는 버리고, 되살아나는 사람만 그 지역의 처음 자리로 */
function stayMoves(state: GameState, mapOf: (area: number) => GameMap): void {
  for (const m of moves) {
    const p = state.players[m.p]
    if (!p || p.left || m.how !== 'town') continue
    const map = mapOf(p.area)
    const l = areaLayout(p.area, map)
    placeIn(state, map, p, p.area, l.spawn.x, l.spawn.y, 'town')
  }
  moves.length = 0
}

/** 용병·동료 봇: 따라가는 사람이 다른 지역에 있으면 곁으로 간다 (디아블로 2 의 용병처럼) */
function followLeaders(state: GameState, mapOf: (area: number) => GameMap): void {
  for (const f of state.players) {
    if (f.left || f.follow < 0 || !f.alive || f.downed) continue
    const lead = state.players[f.follow]
    if (!lead || lead.left || !lead.alive || lead.area === f.area) continue
    placeIn(state, mapOf(lead.area), f, lead.area, lead.x, lead.y, 'follow')
  }
}

/** 사람이 없는 지역: 날아다니던 것은 치우고 얼린다. 얼린 지역이 많으면 오래된 것부터 버린다 */
function freezeAreas(state: GameState): void {
  const live = liveAreas(state)
  const frozen = state.areas.filter((a) => !live.includes(a.id))
  for (const a of frozen) {
    a.bullets = []
    a.mshots = []
    a.zones = []
    a.throws = []
  }
  if (frozen.length <= FROZEN_KEEP) return
  frozen.sort((a, b) => b.seen - a.seen || a.id - b.id)
  const drop = new Set(frozen.slice(FROZEN_KEEP).map((a) => a.id))
  state.areas = state.areas.filter((a) => !drop.has(a.id))
}

/**
 * 지역 안의 상호작용 (던전만, 묶인 지역에서): 출구로 건너가기 · 웨이포인트 열기 · 타운 포털 시전과 드나들기.
 * 누른 순간(btnPrev 와 비교)만 본다.
 */
function stepInteract(state: GameState, map: GameMap, inputs: Input[]): void {
  const area = state.curArea
  const l = areaLayout(area, map)
  const town = isTown(area)
  for (const p of state.players) {
    if (p.left) continue
    const inp = inputs[p.id]
    const btn = inp?.buttons ?? 0
    const pressed = btn & ~p.btnPrev
    p.btnPrev = btn
    if (p.exitLock > 0) p.exitLock--
    if (p.potCd > 0) p.potCd--
    if (p.shrineT > 0) p.shrineT--
    if (p.legCd > 0) p.legCd--
    // 물약: 3초에 걸쳐 채운다 (쓰러지면 끊긴다)
    if (p.potHot > 0) {
      if (isActive(p)) p.hp = Math.min(p.maxHp, p.hp + (p.maxHp * 0.35) / POT_TICKS)
      p.potHot--
    }
    if (town && p.alive) p.potions = p.potMax
    if (!isActive(p) || state.phase !== 'playing') {
      p.portalCast = 0
      continue
    }
    // 물약 (3)
    if ((pressed & BTN_POTION) !== 0 && p.potions > 0 && p.potCd === 0 && !town) {
      p.potions--
      p.potHot = POT_TICKS
      p.potCd = 90
      state.events.push({ type: 'potion', p: p.id })
    }
    // 출구: 걸어 들어가면 그 사람만 건너간다
    if (p.exitLock === 0) {
      for (const e of l.exits) {
        if (len(p.x - e.x, p.y - e.y) > EXIT_R) continue
        queueMove(p, { to: e.to, how: 'exit' })
        break
      }
    }
    // 웨이포인트: 밟으면 열린다 (캐릭터에 남는다)
    if (l.wp && len(p.x - l.wp.x, p.y - l.wp.y) <= WP_R) {
      const bit = wpBit(area)
      if (bit && (p.wps & bit) === 0) {
        p.wps |= bit
        state.events.push({ type: 'wpFound', p: p.id, area })
      }
    }
    // 타운 포털 시전: 움직이거나 쏘거나 스킬을 쓰면 끊긴다 (맞으면 hurtPlayer 가 끊는다)
    if (!town && (pressed & BTN_PORTAL) !== 0 && p.portalCast === 0) {
      p.portalCast = PORTAL_CAST
      state.events.push({ type: 'portalCast', p: p.id, x: p.x, y: p.y })
    } else if (p.portalCast > 0) {
      const busy = (inp && (inp.mx !== 0 || inp.my !== 0)) || (btn & (BTN_FIRE | BTN_DASH)) !== 0 || SKILL_BTNS.some((b) => (btn & b) !== 0)
      if (busy) p.portalCast = 0
      else if (--p.portalCast === 0) {
        state.portals = state.portals.filter((q) => q.owner !== p.id)
        state.portals.push({ owner: p.id, area, x: p.x, y: p.y })
        state.events.push({ type: 'portalOpen', p: p.id, area, x: p.x, y: p.y })
      }
    }
    // F: 포털 → 물건(상자·항아리·제단) → 아이템 (가까운 것 하나만)
    let used = false
    if ((pressed & BTN_USE) !== 0) {
      for (const q of state.portals) {
        if (town) {
          const at = townPortalSpot(l, q.owner)
          if (!at || len(p.x - at.x, p.y - at.y) > PORTAL_R) continue
          queueMove(p, { to: q.area, how: 'portal', x: q.x, y: q.y + 44, closePortal: q.owner === p.id })
        } else {
          if (q.area !== area || len(p.x - q.x, p.y - q.y) > PORTAL_R) continue
          const t = ACTS[areaDef(area).act].town
          queueMove(p, { to: t, how: 'portal' })
        }
        used = true
        break
      }
      if (!used) used = useObject(state, p)
      if (!used) pickItem(state, p)
    }
  }
}

const POT_TICKS = 180

/** 스킬 트리 명령 (어디서나) · 재분배 · 용병 (마을에서만) */
function buildCommand(state: GameState, p: PlayerState, cmd: number, arg: number): void {
  const b = p.build
  if (cmd === CMD_SKILL_UP) {
    if (arg < 0 || arg >= b.r.length || b.r[arg] >= MAX_RANK || freePoints(p.level, b, p.spBonus) <= 0) return
    b.r[arg]++
    recalc(p)
  } else if (cmd === CMD_SKILL_MOD) {
    const node = arg >> 2
    const tier = (arg >> 1) & 1
    const pick = (arg & 1) + 1
    if (node < 0 || node >= b.r.length) return
    if (tier === 0 && b.r[node] >= 3 && b.m3[node] === 0) b.m3[node] = pick
    if (tier === 1 && b.r[node] >= 5 && b.m5[node] === 0) b.m5[node] = pick
  } else if (cmd === CMD_SKILL_SLOT) {
    const slot = arg >> 4
    const node = arg & 15
    if (slot < 0 || slot > 3 || node < 0 || node > 4 || b.r[node] === 0) return
    // 이미 다른 칸에 걸려 있으면 자리를 바꾼다
    const other = b.s.indexOf(node)
    if (other >= 0) b.s[other] = b.s[slot]
    b.s[slot] = node
  } else if (cmd === CMD_RESPEC) {
    // 재분배: 마을에서 골드로 (레벨 × 50)
    const g = 50 * p.level
    if (state.mode !== 'dungeon' || !isTown(p.area) || p.gold < g) return
    p.gold -= g
    const s0 = b.s.slice()
    Object.assign(b, sanitizeBuild(null))
    b.s = s0.map((n, k) => (b.r[n] > 0 ? n : k))
    recalc(p)
    state.events.push({ type: 'trade', p: p.id, what: 'respec', gold: -g, uid: 0 })
  } else if (cmd === CMD_HIRE) {
    hireCommand(state, p, arg)
  }
}

/** 촌장 (마을): 퀘스트를 받는다 · 이룬 퀘스트의 보상을 받는다 */
function questCommand(state: GameState, p: PlayerState, i: number): void {
  if (state.mode !== 'dungeon' || !isTown(p.area) || npcNear(p.area, p.x, p.y) !== 'elder' || !QUESTS[i]) return
  const st = p.quests[i] ?? 0
  if (st === 0) {
    p.quests[i] = 1
    return
  }
  if (st !== 2) return
  p.quests[i] = 3
  p.spBonus = questPoints(p.quests)
  if (i === 2) {
    // 뼈활 레나: 전설 하나 (가방이 차 있으면 발밑에)
    const it = rollItem(state.rng, state.nextItemUid++, Math.max(p.level, areaDef(QUESTS[i].area).level), p.weapon, 0, 3)
    if (p.bag.length < BAG_SIZE) p.bag.push(it)
    else state.drops.push({ id: state.nextDropId++, owner: p.id, x: p.x, y: p.y + 30, item: it, gold: 0, pot: 0, ttl: 60 * 600, lock: 30 })
  }
  if (i === 3) p.gold += 500
  state.events.push({ type: 'questReward', p: p.id, q: i })
}

/** 용병 값: 150 + 레벨 × 40 */
export const mercPrice = (level: number) => 150 + level * 40

/**
 * 용병 대장 (GUIDE 8장 — 디아블로 2): 빈 자리에 용병 하나를 앉힌다. 용병은 **sim 안의 봇**(결정론 — 봇 기억이 상태에 있다)이라
 * 네트워크로 입력을 보내지 않는다. 고용한 사람을 따라다닌다. 한 사람에 하나. arg = 캐릭터 번호, 255 = 내보내기.
 */
function hireCommand(state: GameState, p: PlayerState, arg: number): void {
  if (state.mode !== 'dungeon' || p.merc >= 0 || !isTown(p.area) || npcNear(p.area, p.x, p.y) !== 'captain') return
  const mine = state.players.find((q) => q.merc === p.id && !q.left)
  if (arg === 255) {
    if (!mine) return
    mine.left = true
    mine.vacant = true
    mine.alive = false
    mine.merc = -1
    mine.follow = -1
    mine.bot = undefined
    state.events.push({ type: 'hire', p: mine.id, by: p.id, on: false })
    return
  }
  const char = PLAYABLE[arg]
  const g = mercPrice(p.level)
  if (mine || !char || p.gold < g) return
  const seat = state.players.find((q) => q.vacant && q.left)
  if (!seat) return
  p.gold -= g
  const idx = seat.id
  Object.assign(seat, makePlayer(idx, char, 0, { level: p.level, xp: 0, gold: 0, equip: new Array(SLOT_COUNT).fill(null), bag: [] }))
  seat.merc = p.id
  seat.follow = p.id
  seat.area = p.area
  seat.bot = makeBot((state.seed ^ Math.imul(state.tick + 1, 0x2545f491) ^ idx) >>> 0)
  seat.x = p.x + 30
  seat.y = p.y
  state.events.push({ type: 'hire', p: idx, by: p.id, on: true })
}

/**
 * 마을 NPC 명령 (GUIDE 9장). 그 NPC 곁에 서 있어야 하고, 골드가 모자라면 아무 일도 없다.
 * 모든 추첨은 state.rng — 모두의 화면에서 같은 결과.
 */
function townCommand(state: GameState, p: PlayerState, cmd: number, arg: number): void {
  if (state.mode !== 'dungeon' || !p.alive) return
  const npc = npcNear(p.area, p.x, p.y)
  const trade = (what: string, gold: number, uid: number) => state.events.push({ type: 'trade', p: p.id, what, gold, uid })
  if (cmd === CMD_SELL && npc === 'merchant') {
    const it = p.bag[arg]
    if (!it) return
    const g = itemValue(it)
    p.bag.splice(arg, 1)
    p.gold += g
    trade('sell', g, it.uid)
  } else if (cmd === CMD_BUY && npc === 'merchant') {
    const it = state.shop[arg]
    const g = it ? Math.round(buyPrice(it) * questDiscount(p.quests)) : 0
    if (!it || p.gold < g || p.bag.length >= BAG_SIZE) return
    p.gold -= g
    state.shop.splice(arg, 1)
    p.bag.push({ ...it, aff: [...it.aff] })
    trade('buy', -g, it.uid)
  } else if (cmd === CMD_POTUP && npc === 'merchant') {
    const g = potUpPrice(p.potMax)
    if (p.potMax >= 8 || p.gold < g) return
    p.gold -= g
    p.potMax++
    p.potions = p.potMax
    trade('potup', -g, 0)
  } else if (cmd === CMD_REROLL && npc === 'smith') {
    const it = p.bag[arg]
    if (!it || it.aff.length === 0 || p.gold < rerollPrice(it)) return
    const g = rerollPrice(it)
    p.gold -= g
    rerollAffix(state.rng, it)
    trade('reroll', -g, it.uid)
  } else if (cmd === CMD_GAMBLE && npc === 'gambler') {
    const g = gamblePrice(p.level)
    if (arg < 0 || arg >= SLOT_COUNT || p.gold < g || p.bag.length >= BAG_SIZE) return
    p.gold -= g
    const it = rollItem(state.rng, state.nextItemUid++, p.level + 2, p.weapon, 0.12, 0, arg)
    p.bag.push(it)
    trade('gamble', -g, it.uid)
  } else if (cmd === CMD_STASH_PUT && npc === 'stash') {
    const it = p.bag[arg]
    if (!it || p.stash.length >= STASH_SIZE) return
    p.bag.splice(arg, 1)
    p.stash.push(it)
    trade('stash', 0, it.uid)
  } else if (cmd === CMD_STASH_TAKE && npc === 'stash') {
    const it = p.stash[arg]
    if (!it || p.bag.length >= BAG_SIZE) return
    p.stash.splice(arg, 1)
    p.bag.push(it)
    trade('stash', 0, it.uid)
  }
}

/** 가까운 물건을 쓴다 (상자 열기 · 항아리 깨기 · 제단) */
function useObject(state: GameState, p: PlayerState): boolean {
  for (const o of state.objects) {
    if (o.used || len(o.x - p.x, o.y - p.y) > 44) continue
    openObject(state, o, p)
    return true
  }
  return false
}

/** 물건이 열린다. 상자·항아리는 가까운 파티원 모두에게 각자의 전리품 (개인 전리품) */
function openObject(state: GameState, o: MapObj, by: PlayerState): void {
  o.used = true
  if (o.kind === OBJ_SHRINE) {
    by.shrine = o.v
    by.shrineT = SHRINE_TICKS
    state.events.push({ type: 'shrine', p: by.id, kind: o.v, x: o.x, y: o.y })
    return
  }
  state.events.push({ type: 'objOpen', p: by.id, kind: o.kind, x: o.x, y: o.y })
  if (state.mode !== 'dungeon') return
  for (const q of state.players) {
    if (!q.alive || q.left || q.out || len(q.x - o.x, q.y - o.y) > SHARE_RANGE) continue
    const lvl = Math.max(1, areaLevel(state.curArea, q.level))
    if (o.kind === OBJ_GOLDCHEST) spill(state, q, o.x, o.y, lvl, 4, 2, 1, 3 + (rand(state.rng) < 0.5 ? 1 : 0), 0.2, 2)
    else if (o.kind === OBJ_CHEST) spill(state, q, o.x, o.y, lvl, 2, 1.5, rand(state.rng) < 0.3 ? 1 : 0, 1 + (rand(state.rng) < 0.35 ? 1 : 0), 0.05, 0)
    else spill(state, q, o.x, o.y, lvl, rand(state.rng) < 0.5 ? 1 : 0, 0.6, rand(state.rng) < 0.08 ? 1 : 0, rand(state.rng) < 0.04 ? 1 : 0, 0, 0)
  }
}

/**
 * 지역에 물건을 둔다 (지역 시드 rng — 결정론): 상자 둘~넷(벽 곁 막다른 곳), 항아리 무리 여섯~열(둘~넷씩), 제단 0~1,
 * 던전 마지막 칸(다음 출구가 없는 곳 · 보스 방 앞)에는 금빛 상자 하나.
 */
function placeObjects(state: GameState, map: GameMap, id: number, seed: number, safe: { x: number; y: number }[]): void {
  const def = areaDef(id)
  if (def.kind === 'town') return
  const rng = makeRng((seed ^ 0x0b1ec7) >>> 0)
  const spots: { x: number; y: number; wall: number }[] = []
  for (let ty = 2; ty < map.h - 2; ty++) {
    for (let tx = 2; tx < map.w - 2; tx++) {
      if (map.tiles[ty * map.w + tx] !== 0) continue
      let walls = 0
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (map.tiles[(ty + dy) * map.w + tx + dx] === 1) walls++
      const x = tx * TILE + TILE / 2
      const y = ty * TILE + TILE / 2
      if (safe.some((q) => (q.x - x) ** 2 + (q.y - y) ** 2 < (5 * TILE) ** 2)) continue
      spots.push({ x, y, wall: walls })
    }
  }
  if (spots.length === 0) return
  const pick = (want: (s: { wall: number }) => boolean) => {
    for (let t = 0; t < 40; t++) {
      const s = spots[randInt(rng, 0, spots.length)]
      if (!want(s)) continue
      if (state.objects.some((o) => (o.x - s.x) ** 2 + (o.y - s.y) ** 2 < (4 * TILE) ** 2)) continue
      return s
    }
    return null
  }
  const add = (kind: number, s: { x: number; y: number } | null, v = 0) => {
    if (s) state.objects.push({ id: state.nextObjId++, kind, x: s.x, y: s.y, used: false, v })
  }
  const chests = randInt(rng, 2, 5)
  // 상자는 벽 두 면에 붙은 구석을 좋아하고, 없으면(트인 들판) 벽 곁 아무 데나
  for (let k = 0; k < chests; k++) add(OBJ_CHEST, pick((s) => s.wall >= 2) ?? pick((s) => s.wall >= 1))
  const urns = randInt(rng, 6, 11)
  for (let k = 0; k < urns; k++) {
    const c = pick((s) => s.wall >= 1)
    if (!c) continue
    const n = randInt(rng, 2, 5)
    for (let j = 0; j < n; j++) state.objects.push({ id: state.nextObjId++, kind: OBJ_URN, x: c.x + (j % 2) * 20 - 10, y: c.y + Math.floor(j / 2) * 20 - 10, used: false, v: 0 })
  }
  if (rand(rng) < 0.45) add(OBJ_SHRINE, pick((s) => s.wall === 0), randInt(rng, 0, 4))
  // 던전의 막다른 끝(더 깊이 가는 출구가 없는 곳)과 보스 방 바로 앞 층에는 금빛 상자
  const deepest = def.links.length === 1 || AREAS_BOSS_BEFORE.includes(id)
  if (def.kind !== 'field' && deepest) add(OBJ_GOLDCHEST, pick((s) => s.wall >= 2) ?? pick((s) => s.wall >= 1))
}


/** 마을 쪽 포털 자리 (주인마다 옆으로 두 칸씩) */
export function townPortalSpot(l: AreaLayout, owner: number): { x: number; y: number } | null {
  return l.portal ? { x: l.portal.x + owner * 2 * TILE, y: l.portal.y } : null
}

/**
 * 화면·봇이 보는 판: 지역 하나를 묶은 **얕은 사본**. 다른 지역에 있는 사람은 `left` + `away` 인 사본으로 바꾼다
 * (원본을 건드리지 않는다). 이벤트는 그 지역 것 + 지역 밖(건너가기·난입 등)의 것.
 */
export function areaView(state: GameState, id: number): GameState {
  const a = state.curArea === id ? state : findArea(state, id)
  const players = state.players.map((p) => (p.left || p.area === id ? p : { ...p, left: true, away: true }))
  return {
    ...state,
    players,
    curArea: id,
    monsters: a?.monsters ?? [],
    mshots: a?.mshots ?? [],
    bullets: a?.bullets ?? [],
    globes: a?.globes ?? [],
    zones: a?.zones ?? [],
    throws: a?.throws ?? [],
    drops: a?.drops ?? [],
    objects: a?.objects ?? [],
    monstersTotal: a?.monstersTotal ?? 0,
    events: eventsIn(state, id),
  }
}

function eventsIn(state: GameState, id: number): SimEvent[] {
  const sp = state.evSpans
  if (sp.length === 0) return state.events
  const ev = state.events
  const out: SimEvent[] = []
  let at = 0
  for (let i = 0; i < sp.length; i += 3) {
    for (let k = at; k < sp[i]; k++) out.push(ev[k])
    if (sp[i + 2] === id) for (let k = sp[i]; k < sp[i + 1]; k++) out.push(ev[k])
    at = sp[i + 1]
  }
  for (let k = at; k < ev.length; k++) out.push(ev[k])
  return out
}

// ================================================================ 만들기

export function createState(cfg: MatchConfig, maps: MapSource): GameState {
  const mapOf = mapFn(maps)
  const rng = makeRng(cfg.seed)
  const mode = cfg.mode ?? 'dungeon'
  const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, cfg.chars.length))
  const players: PlayerState[] = []
  for (let i = 0; i < n; i++) {
    const p = makePlayer(i, cfg.chars[i], mode === 'arena' ? (cfg.teams?.[i] ?? i) : 0, cfg.sheets?.[i])
    p.follow = mode === 'dungeon' ? (cfg.follow?.[i] ?? -1) : -1
    // 아직 아무도 안 들어온 자리는 판에 나오지 않는다 (난입하면 그때 채운다)
    if (cfg.absent?.[i]) {
      p.left = true
      p.vacant = true
      p.alive = false
      p.hp = 0
    }
    players.push(p)
  }
  // 던전은 카운트다운 없이 바로 마을에 서 있다 (GUIDE 4장). 투기장만 덕의 카운트다운
  const start = mode === 'arena' ? 0 : (cfg.area ?? ACTS[0].town)
  for (const p of players) p.area = start
  const map = mapOf(start)
  const state: GameState = {
    tick: 0,
    seed: cfg.seed,
    rng,
    phase: mode === 'arena' ? 'countdown' : 'playing',
    phaseTimer: mode === 'arena' ? COUNTDOWN_TICKS : 0,
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
    monstersTotal: 0,
    objects: [],
    nextObjId: 1,
    curArea: -1,
    areas: [],
    act: 0,
    killed: [],
    portals: [],
    shop: [],
    evSpans: [],
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
    // 투기장: 지역 하나(0). 덕 그대로 — 첫 사람은 무작위, 다음 사람은 이미 놓인 모두에게서 가장 먼 곳
    state.areas.push(newArea(0, 0))
    const used: { x: number; y: number }[] = []
    for (const p of players) {
      if (p.left) continue
      const s = used.length === 0 ? map.spawns[randInt(rng, 0, map.spawns.length)] : farthestSpawn(map, used, rng, 1)
      p.x = s.x
      p.y = s.y
      used.push(s)
    }
  } else {
    // 던전: 모두 시작 지역(마을)에 모여 선다. 전투 지역에서 시작하면(시험) 웨이포인트 곁 또는 입구
    const a = ensureArea(state, start, map, !cfg.noMonsters)
    const l = areaLayout(start, map)
    const at = isTown(start) ? l.spawn : (l.wpArrive ?? l.exits[0]?.arrive ?? l.spawn)
    withArea(state, a, () => {
      for (const p of players) {
        if (p.left) continue
        const s = spotNear(state, map, at.x, at.y, p.id)
        p.x = s.x
        p.y = s.y
      }
    })
    // 마을 웨이포인트는 처음부터 열려 있다
    for (const p of players) p.wps |= wpBit(ACTS[0].town)
    // 상인 진열 (게임 시드 — 모두 같다). 여러 무기 · 등급이 조금 높다
    const srng = makeRng((cfg.seed ^ 0x5409) >>> 0)
    const lvl = Math.max(1, Math.round(players.filter((q) => !q.vacant).reduce((a, q) => a + q.level, 0) / Math.max(1, players.filter((q) => !q.vacant).length)))
    for (let k = 0; k < 10; k++) state.shop.push(rollItem(srng, state.nextItemUid++, lvl + 1, WEAPON_IDS[k % WEAPON_IDS.length], 0.15, 1))
  }
  for (const p of players) p.aim = atan2A(map.ph / 2 - p.y, map.pw / 2 - p.x)
  bindPrimary(state)
  return state
}

function makePlayer(id: number, char: CharacterId, team: number, sheet?: Sheet): PlayerState {
  const c = CHARACTERS[char]
  const w = WEAPONS[c.weapon]
  const ult = SKILLS[CHAR_SKILLS[char][2]]
  const sh: Sheet = sheet ?? { level: 1, xp: 0, gold: 0, equip: new Array(SLOT_COUNT).fill(null), bag: [] }
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
    cd: [0, 0, Math.round(ult.cd * ULT_START_FRAC), 0, 0],
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
    area: 0,
    wps: (sh.wps ?? 0) & ((1 << WAYPOINTS.length) - 1),
    btnPrev: 0,
    exitLock: 0,
    portalCast: 0,
    follow: -1,
    potions: sh.potMax ?? 4,
    potMax: sh.potMax ?? 4,
    potHot: 0,
    potCd: 0,
    shrine: 0,
    shrineT: 0,
    stash: (sh.stash ?? []).map((it) => ({ ...it, aff: [...it.aff] })),
    legs: legMask(equip),
    legCd: 0,
    focus: 50,
    dashCharges: 2,
    build: sanitizeBuild(sh.build),
    spBonus: questPoints(sh.quests ?? []),
    quests: Array.from({ length: 16 }, (_, i) => Math.max(0, Math.min(3, sh.quests?.[i] ?? 0))),
    merc: -1,
  }
}

/** 장비·레벨이 바뀌면 능력치를 다시 낸다. 최대 체력이 늘면 그만큼 체력도 는다 */
/** 던전 구르기: 두 번까지 모아 두고, 한 번 다시 차는 데 걸리는 틱 (민첩 랭크마다 -6%) */
const DASH_MAX = 2
function dashRecharge(p: PlayerState): number {
  return Math.round(CHARACTERS[p.char].dashCooldown * 1.6 * (1 - 0.06 * (p.build.r[8] ?? 0)))
}

/** 전설 효과를 끼고 있나 */
function hasLeg(p: PlayerState | null | undefined, leg: number): boolean {
  return !!p && (p.legs & (1 << leg)) !== 0
}

function recalc(p: PlayerState): void {
  const c = CHARACTERS[p.char]
  const w = WEAPONS[p.weapon]
  p.st = computeStats(p.level, p.equip)
  p.legs = legMask(p.equip)
  // 전설 "집중": 스킬 재사용 대기 -15% (옵션 상한과 따로 더한다)
  if (hasLeg(p, LEG_FOCUS)) p.st[ST_CDR] += 15
  // 스킬 트리 패시브: 총기 숙련 · 강인함 · (민첩은 이동에서) · 정신 집중
  p.st[ST_DMG] += 4 * p.build.r[6]
  p.st[ST_HP] += Math.round(c.maxHp * 0.06 * p.build.r[7])
  p.st[ST_CDR] += 2 * p.build.r[9]
  const maxHp = c.maxHp + p.st[ST_HP]
  if (maxHp > p.maxHp && p.alive) p.hp += maxHp - p.maxHp
  p.maxHp = maxHp
  p.hp = Math.min(p.hp, p.maxHp)
  p.magSize = w.magSize > 0 ? Math.round(w.magSize * (1 + p.st[ST_MAG] / 100)) : 0
  p.ammo = Math.min(p.ammo, p.magSize)
}

/** 피해 배율 (레벨 + 장비) */
function dmgMul(p: PlayerState): number {
  return (1 + p.st[ST_DMG] / 100) * (p.shrineT > 0 && p.shrine === 0 ? 1.25 : 1)
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

export function step(state: GameState, maps: MapSource, inputs: Input[]): void {
  const mapOf = mapFn(maps)
  unbind(state)
  stepping = true
  try {
    stepAll(state, mapOf, inputs, typeof maps !== 'function')
  } finally {
    stepping = false
    bindPrimary(state)
  }
}

/** single = 맵 하나만 받은 판(투기장·시험): 다른 지역으로 건너가지 않고, 죽으면 그 지역의 처음 자리에서 일어난다 */
function stepAll(state: GameState, mapOf: (area: number) => GameMap, inputs: Input[], single: boolean): void {
  const ev = state.events
  ev.length = 0
  state.evSpans.length = 0

  if (state.phase === 'countdown') {
    state.phaseTimer--
    if (state.phaseTimer <= 0) {
      state.phase = 'playing'
      ev.push({ type: 'start' })
    }
  }

  // 용병: 입력을 sim 안에서 만든다 (봇 기억이 상태에 있어 결정론) — 네트워크 입력은 쓰지 않는다
  if (state.players.some((q) => q.merc >= 0 && !q.left)) {
    inputs = inputs.slice()
    for (const q of state.players) {
      if (q.merc < 0 || q.left || !q.bot) continue
      inputs[q.id] = botInput(areaView(state, q.area), mapOf(q.area), q.id, q.bot, 'normal')
    }
  }
  // 사람이 있는 지역만, 번호 순으로 (결정론)
  for (const id of liveAreas(state)) {
    const map = mapOf(id)
    const a = ensureArea(state, id, map)
    a.seen = state.tick
    const from = ev.length
    withArea(state, a, () => stepArea(state, map, inputs))
    state.evSpans.push(from, ev.length, id)
  }
  if (state.mode === 'dungeon') {
    if (single) stayMoves(state, mapOf)
    else {
      runMoves(state, mapOf)
      followLeaders(state, mapOf)
    }
    freezeAreas(state)
  }
  checkOver(state)
  state.tick++
}

/** 퀘스트 목표를 이뤘다: 같은 게임에 있는 모두의 그 퀘스트가 "이룸" 이 된다 (디아블로 2) */
function questGoal(state: GameState, goal: 'clear' | 'kill', area: number): void {
  QUESTS.forEach((q, i) => {
    if (q.goal !== goal || q.area !== area) return
    let any = false
    for (const p of state.players) {
      if (p.vacant || p.merc >= 0 || (p.quests[i] ?? 0) >= 2) continue
      p.quests[i] = 2
      any = true
    }
    if (any) state.events.push({ type: 'questDone', q: i })
  })
}

/** 묶인 지역 하나의 한 틱 (예전의 step 몸통) */
function stepArea(state: GameState, map: GameMap, inputs: Input[]): void {
  // 근접 휘두르기·조준 판정·스킬이 쓸 격자 (몬스터가 움직이기 전 위치)
  buildGrid(state, map)
  for (let i = 0; i < state.players.length; i++) stepPlayer(state, map, state.players[i], inputs[i])
  if (state.mode === 'dungeon') {
    stepDowned(state, inputs)
    stepInteract(state, map, inputs)
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
  if (state.monsters.some((m) => m.hp <= 0)) {
    state.monsters = state.monsters.filter((m) => m.hp > 0)
    // 지역을 비웠다 (보물 고블린은 세지 않는다 — 도망쳐도 비운 것)
    if (state.mode === 'dungeon' && state.monstersTotal > 0 && !state.monsters.some((m) => MONSTER_LIST[m.kind].attack !== 'flee')) questGoal(state, 'clear', state.curArea)
  }
  stepGlobes(state)
  stepDrops(state)
}

function checkOver(state: GameState): void {
  if (state.phase !== 'playing' || state.mode !== 'dungeon') return
  // 던전에는 끝이 없다(디아블로 2 — 나가면 캐릭터만 남는다). 하드코어로 모두 탈락했을 때만 판이 끝난다
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
export function joinPlayer(state: GameState, maps: MapSource, idx: number, char: CharacterId, team = 0, sheet?: Sheet): void {
  const mapOf = mapFn(maps)
  const p = state.players[idx]
  if (!p) return
  Object.assign(p, makePlayer(idx, char, state.mode === 'arena' ? team : 0, sheet))
  if (state.mode === 'arena') {
    p.area = 0
    const a = ensureArea(state, 0, mapOf(0), false)
    withArea(state, a, () => respawn(state, mapOf(0), p))
  } else {
    // 난입한 사람은 지금 막의 마을에서 시작한다 (GUIDE 5.3)
    const t = ACTS[state.act].town
    const map = mapOf(t)
    const a = ensureArea(state, t, map)
    const l = areaLayout(t, map)
    p.area = t
    p.wps |= wpBit(t)
    const s = withArea(state, a, () => spotNear(state, map, l.spawn.x, l.spawn.y, idx))
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
  if (input.cmd) runCommand(state, map, p, input.cmd, input.arg ?? 0)
  // 마을은 안전지대: 쏘지도 스킬을 쓰지도 않고, 체력이 가득 찬다 (GUIDE 5.2)
  if (state.mode === 'dungeon' && isTown(p.area)) {
    input = { ...input, buttons: input.buttons & ~TOWN_BLOCKED }
    if (p.alive && !p.downed) p.hp = p.maxHp
  }

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
  if (p.dashCooldown > 0) {
    p.dashCooldown--
    // 던전: 구르기는 충전식 (다 차면 멈춘다)
    if (state.mode === 'dungeon' && p.dashCooldown === 0 && p.dashCharges < DASH_MAX) {
      p.dashCharges++
      if (p.dashCharges < DASH_MAX) p.dashCooldown = dashRecharge(p)
    }
  }
  if (p.blockLock > 0) p.blockLock--
  for (let k = 0; k < p.cd.length; k++) if (p.cd[k] > 0) p.cd[k]--
  // 집중: 조금씩 저절로 찬다 (1.8/초) — 대부분은 총이 맞아서 찬다
  p.focus = Math.min(100, p.focus + 0.03)
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
    if (p.shrineT > 0 && p.shrine === 3) speed *= 1.2
    if (p.build.r[8] > 0) speed *= 1 + 0.02 * p.build.r[8]
    if (p.fx[FX_WHIRL] > 0) speed *= 1.3
    speed *= 1 + p.st[ST_SPEED] / 100
    const r = moveCircle(map, p.x, p.y, PLAYER_RADIUS, mx * inv * speed, my * inv * speed)
    p.x = r.x
    p.y = r.y
    p.moving = true
  }

  // 구르기
  const dashCost = c.id === 'pungwol' ? PUNGWOL.dashCost : DASH_COST
  const dungeon = state.mode === 'dungeon'
  const canDash = dungeon ? p.dashCharges > 0 && p.dashCooldown < dashRecharge(p) - 20 : p.dashCooldown === 0 && p.stamina >= dashCost
  if (playing && input.buttons & BTN_DASH && canDash && p.dashTimer === 0 && (mx !== 0 || my !== 0)) {
    if (dungeon) p.dashCharges--
    else p.stamina -= dashCost
    const inv = mx !== 0 && my !== 0 ? 0.70710678 : 1
    p.dashDx = mx * inv
    p.dashDy = my * inv
    p.dashTimer = c.id === 'juwoojae' ? Math.round(DASH_TICKS * 1.3) : DASH_TICKS
    p.dashCooldown = dungeon ? (p.dashCooldown > 0 ? p.dashCooldown : dashRecharge(p)) : c.dashCooldown
    p.ads = false
    if (c.id === 'uwon') p.invuln = Math.max(p.invuln, p.dashTimer + UWON.invulnAfterDash)
    state.events.push({ type: 'dash', p: p.id })
  }

  // 스킬 Q · E · X · 1 · 2 (누르고 있으면 준비되는 대로 쓴다 — 디아블로처럼). 궁극기 빼고는 집중이 든다
  if (playing && p.dashTimer === 0) {
    for (let k = 0; k < SKILL_BTNS.length; k++) {
      if ((input.buttons & SKILL_BTNS[k]) === 0 || (p.cd[k] ?? 0) > 0) continue
      const node = slotNode(p, k)
      if (node < 0) continue
      const id = nodeSkill(p, node)
      if (state.mode === 'dungeon' && p.focus < focusCost(SKILLS[id], p.build, node)) continue
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
      p.revive += hasLeg(helper, LEG_GUARD) ? 2 : 1
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
    // 던전: 마을에서 되살아난다 (이번 틱이 끝나면 옮겨진다)
    queueMove(p, { to: ACTS[areaDef(p.area).act].town, how: 'town' })
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
  if (p.shrineT > 0 && p.shrine === 1) k *= 0.75
  if (hasLeg(p, LEG_GUARD)) k *= 0.92
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
  p.portalCast = 0
  // 전설 "불굴": 체력이 30% 아래로 떨어지는 순간 2초 무적 (40초에 한 번) — 쓰러질 만큼 맞았으면 1 을 남긴다
  if (hasLeg(p, LEG_UNDYING) && p.legCd === 0 && p.hp < p.maxHp * 0.3) {
    p.hp = Math.max(1, p.hp)
    p.invuln = Math.max(p.invuln, 120)
    p.legCd = 60 * 40
  }
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
  dmg = Math.round(dmg * dmgMul(caster) * skillPow)
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

/** 지금 쓰는 스킬의 위력 배율 (aoe 가 피해에 곱한다) */
let skillPow = 1

function castSkill(state: GameState, map: GameMap, p: PlayerState, slot: number): void {
  const node = slotNode(p, slot)
  const id: SkillId = nodeSkill(p, node < 0 ? 0 : node)
  const def = SKILLS[id]
  p.cd[slot] = Math.round(def.cd * (1 - p.st[ST_CDR] / 100) * (node >= 0 ? nodeCd(p.build, node) : 1))
  if (state.mode === 'dungeon' && node >= 0) p.focus = Math.max(0, p.focus - focusCost(def, p.build, node))
  skillPow = node >= 0 ? nodePow(p.build, node) : 1
  try {
    castSkillBody(state, map, p, slot, id, def)
  } finally {
    skillPow = 1
  }
}

function castSkillBody(state: GameState, map: GameMap, p: PlayerState, slot: number, id: SkillId, def: (typeof SKILLS)[SkillId]): void {
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

    if (!dead && state.objects.length > 0) {
      for (const o of state.objects) {
        if (o.used || o.kind !== OBJ_URN) continue
        if (!segmentHitsCircle(b.px, b.py, b.x, b.y, o.x, o.y, 11)) continue
        openObject(state, o, state.players[b.owner])
        dead = true
        break
      }
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
  {
    const sh = state.players[b.owner]
    if (sh) sh.focus = Math.min(100, sh.focus + (crit ? 4 : 2) * (1 + 0.1 * (sh.build.r[9] ?? 0)))
  }
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
  if (shooter && state.mode === 'dungeon') {
    // 전설: 피의 갈증 · 서리탄 · 연쇄 번개 (연쇄는 치명타에서만 — 번개는 치명타가 아니라 다시 튀지 않는다)
    if (hasLeg(shooter, LEG_BLOOD) && isActive(shooter)) shooter.hp = Math.min(shooter.maxHp, shooter.hp + dmg * 0.03)
    if (hasLeg(shooter, LEG_FROST) && rand(state.rng) < 0.2) m.slow = Math.max(m.slow, 90)
    if (crit && hasLeg(shooter, LEG_CHAIN)) {
      let best: Monster | null = null
      let bd = 150 * 150
      for (const o of state.monsters) {
        if (o === m || o.hp <= 0) continue
        const d2 = (o.x - m.x) ** 2 + (o.y - m.y) ** 2
        if (d2 < bd || (d2 === bd && best && o.id < best.id)) {
          bd = d2
          best = o
        }
      }
      if (best) {
        state.events.push({ type: 'chain', x: m.x, y: m.y, x2: best.x, y2: best.y })
        hurtMonster(state, best, Math.round(dmg * 0.5), by, false, best.x, best.y)
      }
    }
  }
  if (m.st === MS_SLEEP) wakePack(state, m.pack, m.x, m.y)
  state.events.push({ type: 'mhit', m: m.id, by, x, y, dmg, crit })
  if (m.hp <= 0) killMonster(state, m, by, false)
}

/** suicide = 부푼 시체가 스스로 터짐 (처치 기록·구슬 없음) */
function killMonster(state: GameState, m: Monster, by: number, suicide: boolean): void {
  const def = MONSTER_LIST[m.kind]
  m.hp = 0
  state.events.push({ type: 'mdeath', m: m.id, kind: m.kind, by: suicide ? -1 : by, x: m.x, y: m.y, aim: m.aim })
  if (state.mode === 'dungeon' && isBossLike(m) && !state.killed.includes(state.curArea)) {
    state.killed.push(state.curArea)
    state.events.push({ type: 'bossDown', area: state.curArea, kind: m.kind })
  }
  if (state.mode === 'dungeon' && isBossLike(m)) questGoal(state, 'kill', state.curArea)
  if (!suicide) {
    const killer = by >= 0 ? state.players[by] : null
    if (killer) {
      killer.kills++
      killer.killStreak++
      if (killer.killStreak > killer.bestStreak) killer.bestStreak = killer.killStreak
      if (killer.st[ST_LIFEKILL] > 0 && isActive(killer)) killer.hp = Math.min(killer.maxHp, killer.hp + killer.st[ST_LIFEKILL])
      if (hasLeg(killer, LEG_CORPSE) && rand(state.rng) < 0.25) booms.push({ x: m.x, y: m.y, r: 70, dmg: Math.round(m.maxHp * 0.3), by: killer.id, safe: true })
      if (hasLeg(killer, LEG_FRENZY)) buffRate(killer, 180, 1.25)
      if (hasLeg(killer, LEG_AMMO) && killer.magSize > 0) killer.ammo = Math.min(killer.magSize, killer.ammo + Math.ceil(killer.magSize * 0.2))
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

/**
 * 바닥에 전리품을 흩뿌린다 (주인 p): 골드 더미 golds 개(×goldK) · 물약 pots 개 · 아이템 items 개(등급 bonus, 첫 아이템은 minFirst 등급 이상)
 */
function spill(state: GameState, p: PlayerState, x: number, y: number, lvl: number, golds: number, goldK: number, pots: number, items: number, bonus: number, minFirst: number): void {
  const at = () => ({ x: x + (rand(state.rng) - 0.5) * 60, y: y + (rand(state.rng) - 0.5) * 60 })
  for (let k = 0; k < golds; k++) {
    const g = Math.max(1, Math.round((4 + 1.3 * lvl) * goldK * (0.6 + rand(state.rng) * 0.8)))
    const a = at()
    state.drops.push({ id: state.nextDropId++, owner: p.id, x: a.x, y: a.y, item: null, gold: g, pot: 0, ttl: 60 * 120, lock: 12 })
  }
  for (let k = 0; k < pots; k++) {
    const a = at()
    state.drops.push({ id: state.nextDropId++, owner: p.id, x: a.x, y: a.y, item: null, gold: 0, pot: 1, ttl: 60 * 120, lock: 12 })
  }
  for (let k = 0; k < items; k++) {
    const item = rollItem(state.rng, state.nextItemUid++, lvl, p.weapon, bonus, k === 0 ? minFirst : 0)
    const a = at()
    state.drops.push({ id: state.nextDropId++, owner: p.id, x: a.x, y: a.y, item, gold: 0, pot: 0, ttl: 60 * 240, lock: 20 })
    state.events.push({ type: 'loot', owner: p.id, x: a.x, y: a.y, rarity: item.rarity })
  }
}

/** 괴물이 쓰러지면 가까운 파티원 **모두**에게 경험치·골드, 그리고 각자 몫의 전리품을 굴린다 (디아블로 3·4 개인 전리품) */
const SHARE_RANGE = 30 * TILE
function reward(state: GameState, m: Monster, def: MonsterDef): void {
  if (state.mode !== 'dungeon') return
  for (const p of state.players) {
    if (!p.alive || p.left || p.out) continue
    if (len(p.x - m.x, p.y - m.y) > SHARE_RANGE) continue
    const unique = (m.elite & EA_UNIQUE) !== 0
    gainXp(state, p, Math.round(xpFor(m) * (1 + p.st[ST_XP] / 100) * (p.shrineT > 0 && p.shrine === 2 ? 1.5 : 1)))
    // 전리품 (GUIDE 9장): 졸개는 골드 더미 35% · 물약 4% · 아이템 10~16% / 정예는 골드 둘 · 아이템 1~2 · 물약 25% /
    // 우두머리·보스는 **전리품 분수** — 골드 다섯 · 물약 둘 · 아이템 3~4(보스 5~6), 첫 아이템은 희귀 이상.
    // 사람마다 따로 굴리고, 주인에게만 보이고 주인만 줍는다 (디아블로 3·4 개인 전리품)
    const lvl = Math.max(1, areaLevel(state.curArea, p.level))
    const boss = !!def.boss
    const fountain = boss || unique || m.kind === GOBLIN_KIND
    const golds = m.kind === GOBLIN_KIND ? 8 : fountain ? 5 : m.elite ? 2 : rand(state.rng) < 0.35 ? 1 : 0
    const pots = fountain ? 2 : m.elite ? (rand(state.rng) < 0.25 ? 1 : 0) : rand(state.rng) < 0.04 ? 1 : 0
    const items = boss ? 5 + (rand(state.rng) < 0.5 ? 1 : 0) : unique ? 3 + (rand(state.rng) < 0.5 ? 1 : 0) : m.elite ? 1 + (rand(state.rng) < 0.4 ? 1 : 0) : rand(state.rng) < def.loot ? 1 : 0
    const bonus = fountain ? 0.25 : m.elite ? ELITE.lootBonus : 0
    spill(state, p, m.x, m.y, lvl, golds, fountain ? 3 : m.elite ? 2 : 1, pots, items, bonus, fountain ? 2 : 0)
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
/** 밟으면 줍는 것: 골드 더미 · 물약(칸이 찼으면 두고 간다). 아이템은 F (pickItem) */
function pickUp(state: GameState, p: PlayerState): void {
  if (!isActive(p)) return
  const R2 = (PLAYER_RADIUS + 14) ** 2
  for (let i = state.drops.length - 1; i >= 0; i--) {
    const d = state.drops[i]
    if (d.item || d.lock > 0 || (d.owner !== p.id && d.owner !== -1)) continue
    if ((d.x - p.x) ** 2 + (d.y - p.y) ** 2 > R2) continue
    if (d.gold > 0) {
      const g = hasLeg(p, LEG_GOLD) ? Math.round(d.gold * 1.5) : d.gold
      p.gold += g
      p.goldGain += g
      if (hasLeg(p, LEG_GOLD)) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.02)
      state.events.push({ type: 'gold', p: p.id, n: g, x: d.x, y: d.y })
    } else if (d.pot > 0) {
      if (p.potions >= p.potMax) continue
      p.potions++
      state.events.push({ type: 'potGet', p: p.id, x: d.x, y: d.y })
    }
    state.drops.splice(i, 1)
  }
}

/** F: 가장 가까운 내 아이템(또는 버려진 것)을 줍는다 (가방이 차면 못 줍는다) */
function pickItem(state: GameState, p: PlayerState): boolean {
  if (p.bag.length >= BAG_SIZE) return false
  let best = -1
  let bestD = (PLAYER_RADIUS + 30) ** 2
  for (let i = 0; i < state.drops.length; i++) {
    const d = state.drops[i]
    if (!d.item || d.lock > 0 || (d.owner !== p.id && d.owner !== -1)) continue
    const dd = (d.x - p.x) ** 2 + (d.y - p.y) ** 2
    if (dd < bestD) {
      bestD = dd
      best = i
    }
  }
  if (best < 0) return false
  const d = state.drops[best]
  const it = d.item!
  p.bag.push(it)
  p.found++
  if (it.rarity > p.bestFound) p.bestFound = it.rarity
  state.drops.splice(best, 1)
  state.events.push({ type: 'pickup', p: p.id, rarity: it.rarity, uid: it.uid })
  return true
}

/** 가방·장비 명령 (Input.cmd). 무기는 내 무기 종류만 낀다 */
function runCommand(state: GameState, map: GameMap, p: PlayerState, cmd: number, arg: number): void {
  if (p.left) return
  if (cmd >= CMD_SELL && cmd <= CMD_STASH_TAKE) {
    townCommand(state, p, cmd, arg)
    return
  }
  if (cmd === CMD_QUEST) {
    questCommand(state, p, arg)
    return
  }
  if (cmd >= CMD_SKILL_UP && cmd <= CMD_HIRE) {
    buildCommand(state, p, cmd, arg)
    return
  }
  if (cmd === CMD_WAYPOINT) {
    // 웨이포인트 곁에 서 있고, 가려는 곳의 웨이포인트가 열려 있어야 한다
    if (state.mode !== 'dungeon' || !isActive(p) || arg === p.area) return
    const l = areaLayout(p.area, map)
    const bit = wpBit(arg)
    if (!l.wp || len(p.x - l.wp.x, p.y - l.wp.y) > WP_R + 20 || !bit || (p.wps & bit) === 0) return
    queueMove(p, { to: arg, how: 'wp' })
    return
  }
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
    state.drops.push({ id: state.nextDropId++, owner: -1, x: p.x + cosA(p.aim) * 30, y: p.y + sinA(p.aim) * 30, item: it, gold: 0, pot: 0, ttl: 60 * 240, lock: 90 })
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
      if (!isActive(p) || b.safe) continue
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
      } else if (def.attack === 'flee') {
        // 보물 고블린: 늘 도망친다. 골드를 흘리고, 오래 버티면 사라진다 (t = 깨어 있던 틱 — 예고·회복 상태를 쓰지 않아 비어 있다)
        away = true
        m.t++
        if (m.t % GOBLIN.trail === 0) state.drops.push({ id: state.nextDropId++, owner: -1, x: m.x, y: m.y, item: null, gold: Math.max(1, Math.round(3 + m.lvl * 1.5)), pot: 0, ttl: 60 * 60, lock: 10 })
        if (m.t >= GOBLIN.escape) {
          m.hp = 0
          state.events.push({ type: 'goblinGone', x: m.x, y: m.y })
          continue
        }
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
  const { events: _e, evSpans: _s, ...rest } = state
  const copy = structuredClone(rest) as GameState
  copy.events = []
  copy.evSpans = []
  return copy
}

/** FNV-1a 32비트 해시. 결정론 검증용. */
export function hashState(state: GameState): number {
  const { events: _e, evSpans: _s, ...rest } = state
  const s = JSON.stringify(rest)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
