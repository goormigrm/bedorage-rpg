// 결정론 시뮬레이션. 두 가지 판을 한 코드로 돈다:
//  - dungeon: 협동 던전 (몬스터 AI · 쓰러짐/부활 · 회복 구슬 · 죽음 규칙)
//  - arena:   투기장 PvP (배도라지 덕의 대전 규칙 이식 — 헤드샷 · 모래주머니 · 힐팩 · 목표 킬, RPG 에서 키운 캐릭터끼리)
// 둘 다 덕의 이동·사격·구르기·기력 위에 **스킬(Q·E·R)** 이 얹힌다. 스킬은 몬스터와 적 플레이어를 똑같이 친다.
// 규칙은 DESIGN 2장 — Math.random/삼각함수/시간 금지, 모든 기억은 GameState 안.

import { bossBit, sanitizeStats } from './stats'
import { ATTR_REC, CHARACTERS, CharacterId, PLAYABLE, Role, headHitScale } from './characters'
import { angleDiff, atan2A, cosA, sinA, len } from './fixedmath'
import {
  BTN_ADS, BTN_DASH, BTN_FIRE, BTN_PORTAL, BTN_SPRINT, BTN_ULT, BTN_USE, CMD_BUY, CMD_DROP, CMD_EQUIP, CMD_GAMBLE, CMD_UPGRADE,
  CMD_ATTR, CMD_AUTOPICK, CMD_BAGUP, CMD_DONCAP, CMD_FORGE, CMD_HIRE, CMD_LOCK, CMD_QUEST, CMD_DONATE, CMD_SELL_ALL, CMD_SHOPNEW, CMD_SORT, CMD_RESPEC, CMD_SELL, CMD_SKILL_MOD, CMD_SKILL_SLOT, CMD_SKILL_UP, CMD_STASHUP, CMD_STASH_PUT, CMD_STASH_TAKE, CMD_UNEQUIP, CMD_WAYPOINT, Input, SKILL_BTNS,
  TOWN_BLOCKED,
} from './input'
import {
  AUTOPICK_ALL, attrFree, GAMBLE_PITY, BAG_MAX, BAG_SIZE, BAG_STEP, bagUpPrice, STASH_MAX, STASH_STEP, stashUpPrice, shopNewPrice, FORGE_MAX, FORGE_MIN, forgeIlvl, forgeMaterials, forgeNeed, forgeOdds, forgePrice, takeMaterials, LEG_AMMO, LEG_BLOOD, LEG_CHAIN, LEG_CORPSE, LEG_FOCUS, LEG_FRENZY, LEG_FROST, LEG_GOLD, LEG_GUARD, LEG_UNDYING, LEVEL_CAP, STASH_SIZE, legMask, buyPrice, gamblePrice, itemValue, upgradeMaterials, upgradeNeed, upgradePrice, UPGRADE_MAX, LootSource, SLOT_COUNT, SLOT_WEAPON, ST_CDR, ST_CRIT, ST_DMG, ST_DR, ST_HP, ST_LIFEKILL, ST_ELITEDMG, ST_RATE, ST_SKILLPOW, ST_SPEED,
  ST_STAMINA, ST_XP, Item, Sheet, WEAPON_IDS, computeStats, isJunk, rollItem, sortItems, xpNeed,
} from './items'
import { COVER_DIST, GameMap, SANDBAG_HP, TILE, TILE_SANDBAG, isWallAt, nearSandbag, rayBlocked, rayCast } from './map'
import { SNIPER_GRAZE_FRAC, WeaponId } from './weapons'
import { circleHitsWall, circlesOverlap, moveCircle, pointLineDistance, segmentHitsCircle } from './physics'
import { makeRng, rand, randInt, Rng } from './rng'
import {
  AFFIX_TUNE, DEATH_BLAST_MULT, GOBLIN, GOBLIN_KIND, QUEEN, SPIDER_KIND, ACID, GHOUL_KIND, GUARD, RAISE, SHIELD_KIND, WARDEN, BLINK, DEMON_FUSE, LORD, SHADE_KIND, levelHp, levelPow, tierOf,
  BOSS_PATS, BOSS_PLANS, BOSS_RAGE_PM, BOSS_ULT, BOSS_ULT_CD, BOSS_SWIPE_PM, BOSS_TIER_PM, BP, BossPatId, PAT, EA_FAST, EA_SPLIT, EA_STOUT, EA_UNIQUE, EA_VAMP, EA_VOLATILE, ELITE, MONSTER_LIST, MonsterDef, UNIQUE, isBossLike, xpFor, xpGapMul,
  bodyR, GIANT_HP, isGiant,
} from './monsters'
export { nodeSkill, slotNode } from './skills'
import { affixCount, affixSkip, makeMonster, populate, rollAffixes } from './dungeon'
import { ALLY_BOSS_CD, ALLY_BOSS_HIT, ALLY_BOSS_SPLASH, ALLY_CD, ALLY_HIT, ALLY_SEEK, CheerDef, cheerEvent, DON_CAP_CHOICES, DON_CAP_DEFAULT, DON_DARK, DON_INVERT, DON_MAX, DON_SEAL, DON_SHAKE, DON_SLOTS, DON_TICKS, HELL_DARK_TICKS, RAGE_POW, RAGE_SPEED, RAGE_TICKS, SHAKE_MAX, donateEvent } from './donate'
import { botInput, makeBot } from './bot'
import { ACTS, AREAS, AreaDef, AreaLayout, QUESTS, WAYPOINTS, actBossQuest, actReached, npcNear, questDiscount, questPoints, areaDef, areaLayout, areaLevel, areaSeed, isTown, safeSpots, wpBit } from './world'
import { Grid, flowField, flowStep } from './flow'
import { inZone } from './bosszone'
import {
  CHAR_SKILLS, baseSkill, FX_CARPET, FX_CHARGE, FX_COUNT, FX_CRIT, FX_FREEAMMO, FX_GUARD, FX_KING, FX_PARTYDR, FX_RATE, FX_REFLECT, FX_KENWANG, FX_SNIPE, FX_SWIFT, FX_WHIRL,
  MAX_RANK, SKILLS, SkillId, ULT_START_FRAC, focusCost, freePoints, nodeCd, nodePow, nodeSkill, sanitizeBuild, slotNode,
} from './skills'
import {
  AreaState, BLEED_TICKS, BLOCK_CHANCE, BLOCK_COST, BLOCK_LOCK_TICKS, Bullet, CHICKEN_HEAL, CHICKEN_MAXHP_CAP, CHICKEN_MAXHP_PER_KILL,
  COUNTDOWN_TICKS, CHIM, MapObj, OBJ_CHEST, OBJ_GOLDCHEST, OBJ_SHRINE, OBJ_URN, SHRINE_TICKS, DASH_COST, DASH_SPEED, DASH_TICKS, GIYEOL, GLOBE_BIG_FRAC, GLOBE_DROP_MUL, GLOBE_HEAL_FRAC, GLOBE_RADIUS, GLOBE_SHARE_FRAC,
  GLOBE_SHARE_RANGE, GLOBE_TTL, GameState, JUPEOL, MAX_PLAYERS, MEDKIT_HEAL_FRAC, MEDKIT_RADIUS, MEDKIT_TTL, MIN_PLAYERS,
  CHAR_PVP, MS_CHARGE, MS_CHASE, MS_RECOVER, MS_SLEEP, MS_WINDUP, Ally, MatchConfig, Monster, PLAYER_RADIUS, PUNGWOL, PlayerState, RESPAWN_TICKS,
  REVIVE_HP_FRAC, REVIVE_RANGE, REVIVE_TICKS, SOLO_BLEED_TICKS, SPAWN_PROTECT_TICKS, SPRINT_COST, SPRINT_MIN, SPRINT_MUL, TICK_RATE,
  STAMINA_MAX, STAMINA_REGEN, UWON, DASH_GRACE, ZONE_ACID, ZONE_FUSE, ZONE_SPOTLIGHT, ZONE_TRAP, ZONE_VORTEX, ZONE_WARN, ZS_CIRCLE, ZS_CONE, ZS_LINE, ZS_RING, Zone, isActive, isEnemy, isHumanSeat, teamKills, MoveHow, SimEvent,
} from './state'
import { HEAD_AIM_FRAC, HEAD_FRAC, PART_BODY, PART_HEAD, PART_LEGS, PART_MULT, WEAPONS, falloff, headMult, partForOffset } from './weapons'

const MAX_RECOIL_MUL = 3
/** 잠든 무리가 깨는 거리 (시야 반경 13칸보다 조금 짧다 — 보이고 나서 깬다) */
const WAKE_RANGE = 11 * TILE
/**
 * 총소리: 쏜 자리에서 이 거리 안의 잠든 무리가 깬다 (벽 너머도 — 소리니까). 한 방씩 조용히 정리하지 못하게 해서
 * 무리를 몰고 다니는 디아블로식 압박을 만든다. **소음기 권총(단군란)은 깨우지 않는다** — 덕의 소음기가 여기서 정찰이 된다
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
const spawns: { kind: number; x: number; y: number; pack: number; hpMul: number; pow: number; lvl: number }[] = []
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
/** 출구 곁에서 F 로 건너간다 (고리 반지름 약 36px + 몸) — 2026-09-19 "원에 들어가면 바로 이동이라 전투 중에 뜬금없이 넘어간다" */
const EXIT_USE_R = 52
/** 금빛 상자가 있는 지역: 보스 방 바로 앞 층 · "비워라" 퀘스트 던전(예전 막다른 옆길 — 2026-09-24 큰길 사이로 옮겼다) */
const GOLD_CHEST_AREAS = [2, 8, 12, 21, 35]
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

/** withArea 가 잠깐 가린(다른 지역에 있는) 사람들 — 파티 전체에 거는 후원 효과가 본다 (partyOf) */
let hiddenNow: PlayerState[] = []

/** p 의 파티 전체 (다른 지역에 있는 사람도 — 묶인 지역 밖이라 잠깐 left 로 가려져 있어도). 빈 자리 · 탈락은 빼고 */
function partyOf(state: GameState, p: PlayerState): PlayerState[] {
  return state.players.filter((q) => (!q.left || hiddenNow.includes(q)) && !q.vacant && !q.out && q.team === p.team)
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
    if (state.allies?.length) a.allies = state.allies
    else delete a.allies
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
  state.allies = a.allies
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
  state.allies = undefined
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
  const prevHidden = hiddenNow
  hiddenNow = hidden
  try {
    return fn()
  } finally {
    hiddenNow = prevHidden
    // 전투 코드가 배열을 새로 만들어 끼우기도 한다(쓰러진 몬스터 걸러 내기) → 칸에 걸린 것을 도로 가져온다
    unbind(state)
    for (const p of hidden) p.left = false
    if (!stepping) bindPrimary(state)
  }
}

/**
 * 지역 채우기: 무리 + (지역에 있으면) 우두머리 또는 막 보스. 이미 쓰러뜨린 우두머리·보스는 다시 나오지 않는다.
 * 몬스터 레벨 = 지역 레벨 (파티가 훨씬 높으면 파티 − 3 까지)
 */
function fillArea(state: GameState, map: GameMap, id: number, seed: number): void {
  const def = areaDef(id)
  if (def.kind === 'town') return
  const l = areaLayout(id, map)
  const lvl = areaLevel(id, state.tier)
  const seats = state.players.length
  // 보스 결투장에는 무리를 두지 않는다 (보스와 그 졸개만 — 2026-09-23)
  populate(state, map, areaSeed(seed, id), seats, lvl, (def.density ?? 1) * ACTS[def.act].density, def.packs ?? ACTS[def.act].packs, l.exits[0] ?? l.spawn, safeSpots(l), map.arena)
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
  const hpMul = (1 + 0.6 * Math.max(0, seats - 1)) * levelHp(lvl) * tierOf(state.tier).hp
  const pow = Math.round(levelPow(lvl) * tierOf(state.tier).pow)
  const at = l.special
  if (def.boss !== undefined) {
    // 막 보스: 가장 깊은 곳에서 잠들어 있다가 누가 다가오면 깬다
    state.monsters.push(makeMonster(state, def.boss, at.x, at.y, 9999, hpMul * GIANT_HP, pow, lvl))
    state.monstersTotal++
  } else if (def.unique) {
    // 우두머리: 평범한 원형을 크게 키우고 접두 능력 셋. 같은 원형 셋이 지킨다
    const rng = makeRng((areaSeed(seed, id) ^ 0x7a11e) >>> 0)
    const u = makeMonster(state, def.unique.kind, at.x, at.y, 9998, hpMul * UNIQUE.hp, Math.round(pow * UNIQUE.pow), lvl)
    u.elite = rollAffixes(rng, 1 | EA_UNIQUE, Math.min(4, UNIQUE.affixes + tierOf(state.tier).affix), affixSkip(u.kind))
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
  // 마을에 들어서면 그 마을의 웨이포인트가 열린다
  if (isTown(to)) p.wps |= wpBit(to)
  // 이 게임에서 누군가 가 본 가장 뒤 막 (난입한 사람이 설 마을을 정한다)
  state.act = Math.max(state.act, areaDef(to).act)
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
    // 응원 아군은 사람이 떠나면 사라진다
    delete a.allies
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
    // 건너온 뒤 30틱은 출구가 안 먹는다 (F 를 누르고 있다가 도로 넘어가지 않게)
    if (p.exitLock > 0) p.exitLock--
    if (p.shrineT > 0) p.shrineT--
    if (p.legCd > 0) p.legCd--
    // 물약(3)은 없앴다 — 회복은 체력 구슬 하나로 (GLOBE_DROP_MUL 머리말). potions·potMax 칸은 옛 세이브를 위해 남겨 둔다
    if (!isActive(p) || state.phase !== 'playing') {
      p.portalCast = 0
      continue
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
      // 출구: 곁에서 F — 그 사람만 건너간다 (예전에는 원에 들어서기만 하면 넘어갔다)
      if (!used && p.exitLock === 0) {
        for (const e of l.exits) {
          if (len(p.x - e.x, p.y - e.y) > EXIT_USE_R) continue
          queueMove(p, { to: e.to, how: 'exit' })
          used = true
          break
        }
      }
      // 다음 막으로 가는 문: 보스를 쓰러뜨리면 보스가 섰던 자리에 열린다 (2026-09-20 — 보스를 잡고 갈 곳이 없던 문제)
      if (!used && p.exitLock === 0 && gateOpen(areaDef(area), p) && l.special && len(p.x - l.special.x, p.y - l.special.y) <= EXIT_USE_R) {
        queueMove(p, { to: areaDef(area).gate!, how: 'exit' })
        used = true
      }
      if (!used) used = useObject(state, p)
      if (!used) pickItem(state, p)
    }
  }
}


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
  if (state.mode !== 'dungeon' || !isTown(p.area) || npcNear(p.area, p.x, p.y) !== 'elder') return
  // 막 이동 (arg = 100 + 막): 앞 막의 보스를 쓰러뜨렸으면 그 막의 마을로 (디아블로 2 — 촌장이 길을 안내한다)
  if (i >= 100) {
    const act = i - 100
    if (!ACTS[act] || act > actReached(p.quests) || act === areaDef(p.area).act) return
    queueMove(p, { to: ACTS[act].town, how: 'wp' })
    return
  }
  if (!QUESTS[i]) return
  const st = p.quests[i] ?? 0
  if (st === 0) {
    p.quests[i] = 1
    return
  }
  if (st !== 2) return
  p.quests[i] = 3
  p.spBonus = questPoints(p.quests)
  const qd = QUESTS[i]
  if (qd.legend) {
    // 전설 하나 (가방이 차 있으면 발밑에)
    const it = rollItem(state.rng, state.nextItemUid++, Math.max(p.level, areaDef(QUESTS[i].area).level + tierOf(state.tier).lvl), p.weapon, 'boss', tierOf(state.tier).loot, 3)
    if (p.bag.length < p.bagMax) p.bag.push(it)
    else state.drops.push({ id: state.nextDropId++, owner: p.id, x: p.x, y: p.y + 30, item: it, gold: 0, pot: 0, ttl: 60 * 600, lock: 30 })
  }
  if (qd.gold) p.gold += qd.gold
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
 * 상인 진열 열 개를 새로 깐다 (처음 깔기 · 골드로 새로 받기가 같은 길을 쓴다 — 2026-09-25).
 * 무기 종류를 돌아가며 · 물러난 무기(권총 · 리볼버)는 빼고 · 마법 등급 이상.
 */
function restockShop(state: GameState, level: number, rng: Rng): void {
  state.shop.length = 0
  const kinds = WEAPON_IDS.filter((id) => !WEAPONS[id].retired)
  for (let k = 0; k < 10; k++) state.shop.push(rollItem(rng, state.nextItemUid++, level + 1, kinds[k % kinds.length], 'shop', 0, 1))
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
    if (!it || p.gold < g || p.bag.length >= p.bagMax) return
    p.gold -= g
    state.shop.splice(arg, 1)
    p.bag.push({ ...it, aff: [...it.aff] })
    trade('buy', -g, it.uid)
  } else if (cmd === CMD_UPGRADE && npc === 'smith') {
    // 강화: 가방 칸 또는 100 + 장비 칸. 같은 부위 · 같은 등급 (단계 + 1)개를 녹인다 (싼 것부터)
    const eq = arg >= 100
    const it = eq ? p.equip[arg - 100] : p.bag[arg]
    if (!it || (it.up ?? 0) >= UPGRADE_MAX) return
    const need = upgradeNeed(it)
    const g = upgradePrice(it)
    // 재료는 가방과 **보관함**에서 함께 고른다 (2026-09-20 요청)
    const mats = upgradeMaterials(p.bag, p.stash, it)
    if (mats.length < need || p.gold < g) return
    p.gold -= g
    takeMaterials(p.bag, p.stash, mats.slice(0, need))
    it.up = (it.up ?? 0) + 1
    if (eq) recalc(p)
    trade('upgrade', -g, it.uid)
  } else if (cmd === CMD_SELL_ALL && npc === 'merchant') {
    // 한꺼번에 팔기 (2026-09-20 요청): arg 0 = 잡템(일반 · 마법)만 · 1 = 전부. **잠근 것은 빼고** 판다
    let gold = 0
    let n = 0
    const keep: Item[] = []
    for (const it of p.bag) {
      if (it.lk || (arg === 0 && !isJunk(it))) {
        keep.push(it)
        continue
      }
      gold += itemValue(it)
      n++
    }
    if (n === 0) return
    p.bag = keep
    p.gold += gold
    state.events.push({ type: 'trade', p: p.id, what: 'sellAll', gold, uid: n })
  } else if (cmd === CMD_FORGE && npc === 'smith') {
    // 벼리기 (2026-09-20 등급 사다리): arg = 재료 등급 × 16 + 부위.
    // 같은 등급 여럿 + 골드 → 그 **윗 등급**이 나올 확률을 굴린다. 실패해도 같은 등급 하나는 나온다.
    const slot = arg & 15
    const rar = arg >> 4
    if (slot < 0 || slot >= SLOT_COUNT || rar < FORGE_MIN || rar > FORGE_MAX || p.bag.length >= p.bagMax) return
    const need = forgeNeed(rar)
    // 재료는 가방과 **보관함**에서 함께 고른다 (싼 것부터)
    const mats = forgeMaterials(p.bag, p.stash, rar).slice(0, need)
    if (mats.length < need) return
    const ilvl = forgeIlvl(p.bag, p.stash, mats)
    const g = forgePrice(ilvl, rar)
    if (p.gold < g) return
    p.gold -= g
    takeMaterials(p.bag, p.stash, mats)
    const out = rand(state.rng) < forgeOdds(rar) ? rar + 1 : rar
    const it = rollItem(state.rng, state.nextItemUid++, ilvl, p.weapon, 'forge', 0, out, slot)
    p.bag.push(it)
    trade('forge', -g, it.uid)
    // 화면 가운데 연출용 (성공 = 등급이 올랐다)
    state.events.push({ type: 'forge', p: p.id, uid: it.uid, rarity: out, up: out > rar })
  } else if (cmd === CMD_GAMBLE && npc === 'gambler') {
    // 2026-09-25 요청: **10연**(arg 0x10) 과 **뭐가 나왔는지 알림**. 돈이나 가방이 모자라면 되는 데까지만 뽑는다
    const slot = arg & 15
    const times = arg & 16 ? 10 : 1
    if (slot < 0 || slot >= SLOT_COUNT) return
    const g = gamblePrice(p.level)
    const uids: number[] = []
    let spent = 0
    for (let k = 0; k < times; k++) {
      if (p.gold < g || p.bag.length >= p.bagMax) break
      p.gold -= g
      spent += g
      // 천장: 전설 없이 GAMBLE_PITY 번이면 이번은 전설 이상
      const pity = p.gpity >= GAMBLE_PITY
      const it = rollItem(state.rng, state.nextItemUid++, p.level + 2, p.weapon, 'gamble', tierOf(state.tier).loot, pity ? 3 : 0, slot)
      p.gpity = it.rarity >= 3 ? 0 : p.gpity + 1
      p.bag.push(it)
      uids.push(it.uid)
    }
    if (uids.length === 0) return
    trade('gamble', -spent, uids[uids.length - 1])
    state.events.push({ type: 'gamble', p: p.id, uids, n: uids.length, gold: spent })
  } else if (cmd === CMD_STASH_PUT && npc === 'stash') {
    if (arg === 200) {
      // 한꺼번에 보관 (2026-09-25 요청). **잠근 것은 그대로 가방에** 둔다 — "전부 팔기" 와 같은 약속
      const keep: Item[] = []
      let n = 0
      for (const it of p.bag) {
        if (it.lk || p.stash.length >= p.stashMax) {
          keep.push(it)
          continue
        }
        p.stash.push(it)
        n++
      }
      if (n === 0) return
      p.bag = keep
      state.events.push({ type: 'trade', p: p.id, what: 'stashAll', gold: 0, uid: n })
      return
    }
    const it = p.bag[arg]
    if (!it || p.stash.length >= p.stashMax) return
    p.bag.splice(arg, 1)
    p.stash.push(it)
    trade('stash', 0, it.uid)
  } else if (cmd === CMD_STASH_TAKE && npc === 'stash') {
    if (arg === 200) {
      // 한꺼번에 꺼내기 — 가방이 차는 데까지
      const keep: Item[] = []
      let n = 0
      for (const it of p.stash) {
        if (p.bag.length >= p.bagMax) {
          keep.push(it)
          continue
        }
        p.bag.push(it)
        n++
      }
      if (n === 0) return
      p.stash = keep
      state.events.push({ type: 'trade', p: p.id, what: 'stashAll', gold: 0, uid: n })
      return
    }
    const it = p.stash[arg]
    if (!it || p.bag.length >= p.bagMax) return
    p.stash.splice(arg, 1)
    p.bag.push(it)
    trade('stash', 0, it.uid)
  } else if (cmd === CMD_BAGUP && npc === 'merchant') {
    // 가방 칸 늘리기 (2026-09-25 요청 — 돈 쓸 곳). 캐릭터마다 남는다
    const price = bagUpPrice(p.bagMax)
    if (!price || p.gold < price || p.bagMax >= BAG_MAX) return
    p.gold -= price
    p.bagMax = Math.min(BAG_MAX, p.bagMax + BAG_STEP)
    trade('bagUp', -price, p.bagMax)
  } else if (cmd === CMD_STASHUP && npc === 'stash') {
    // 보관함 칸 늘리기 — 보관함은 캐릭터끼리 나눠 쓰므로 한 번 늘리면 모든 캐릭터가 함께 쓴다
    const price = stashUpPrice(p.stashMax)
    if (!price || p.gold < price || p.stashMax >= STASH_MAX) return
    p.gold -= price
    p.stashMax = Math.min(STASH_MAX, p.stashMax + STASH_STEP)
    trade('stashUp', -price, p.stashMax)
  } else if (cmd === CMD_SHOPNEW && npc === 'merchant') {
    // 진열 새로 받기 — 판의 rng 로 굴리므로 모두의 화면에서 같은 물건이 깔린다(진열은 파티 공용)
    const price = shopNewPrice(p.level)
    if (p.gold < price) return
    p.gold -= price
    restockShop(state, p.level, state.rng)
    trade('shopNew', -price, 0)
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
    const lvl = Math.max(1, areaLevel(state.curArea, state.tier))
    // 상자는 일반·마법 · 금빛 상자는 희귀 이상 하나 확정("비워라" 던전 · 보스 방 앞의 보상) · 항아리는 드물게 하나
    const up = tierOf(state.tier).loot
    if (o.kind === OBJ_GOLDCHEST) spill(state, q, o.x, o.y, lvl, 4, 2, 3 + (rand(state.rng) < 0.5 ? 1 : 0), 'goldchest', up, 2)
    else if (o.kind === OBJ_CHEST) spill(state, q, o.x, o.y, lvl, 2, 1.5, 1 + (rand(state.rng) < 0.35 ? 1 : 0), 'chest', up, 0)
    else spill(state, q, o.x, o.y, lvl, rand(state.rng) < 0.5 ? 1 : 0, 0.6, rand(state.rng) < 0.04 ? 1 : 0, 'chest', up, 0)
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
      // 보스 결투장 안은 비워 둔다 (상자 · 항아리 · 제단도 없이)
      if (map.arena && (map.arena.x - x) ** 2 + (map.arena.y - y) ** 2 < (map.arena.r + TILE) ** 2) continue
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
  // 보스 방 · 보스 방 바로 앞 층 · "비워라" 퀘스트 던전에는 금빛 상자
  const deepest = def.kind === 'boss' || GOLD_CHEST_AREAS.includes(id)
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
    allies: a?.allies,
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
  roleOn = mode === 'dungeon'
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
    tier: Math.max(0, Math.min(2, cfg.tier ?? 0)),
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
    act: areaDef(start).act,
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
    for (const p of players) p.wps |= wpBit(ACTS[0].town) | (isTown(start) ? wpBit(start) : 0)
    // 상인 진열 (게임 시드 — 모두 같다). 여러 무기 · 등급이 조금 높다
    const srng = makeRng((cfg.seed ^ 0x5409) >>> 0)
    const lvl = Math.max(1, Math.round(players.filter((q) => !q.vacant).reduce((a, q) => a + q.level, 0) / Math.max(1, players.filter((q) => !q.vacant).length)))
    // 무기 종류를 돌아가며 진열한다 — 물러난 무기(권총 · 리볼버)는 빼고 (2026-09-23: 상점에 "권총" 이 떠 있었다)
    restockShop(state, lvl, srng)
  }
  for (const p of players) p.aim = atan2A(map.ph / 2 - p.y, map.pw / 2 - p.x)
  bindPrimary(state)
  return state
}

/** 쏘는 무기: 무기 칸 아이템의 종류가 캐릭터 기본 무기와 같은 계열이면 그것, 아니면 기본 (2026-09-19 변형 무기) */
/**
 * 역할 특화(탱 · 딜 · 힐)는 **던전에서만** (투기장 밸런스는 그대로 — 2026-09-19).
 * step · createState · joinPlayer 가 판의 모드로 정한다(모든 피어가 같은 값 — 결정론).
 */
let roleOn = false
/** 역할별 무기 피해 배율 (던전) */
const ROLE_DMG: Record<Role, number> = { tank: 1, dps: 1.2, heal: 0.8 }
function roleOf(p: PlayerState): Role {
  return CHARACTERS[p.char].role
}

/** 무기를 바꾼 캐릭터의 옛 무기 아이템을 새 계열로 (2026-09-19 — 철면란 기관총 → 고기 바이올린 · 우재란 소총 → 장검) */
const LEGACY_WEAPON: Partial<Record<CharacterId, Partial<Record<WeaponId, WeaponId>>>> = {
  cheolmyeon: { mg: 'violin', launcher: 'cello' },
  juwoojae: { rifle: 'rapier', crossbow: 'katana' },
  // 2026-09-20 권총 계열을 없앴다 — 옛 권총 · 리볼버는 SMG · 화염방사기로 바뀐다
  dangun: { pistol: 'smg', revolver: 'flamer' },
  uwon: { pistol: 'smg', revolver: 'flamer' },
}

/** 총소리가 무리를 깨우지 않는 캐릭터 (옛 소음기 권총 — 2026-09-20 무기에서 캐릭터 특성으로) */
const SILENT_CHARS = new Set<CharacterId>(['dangun', 'uwon'])
function convertLegacy(char: CharacterId, it: Item): Item {
  const map = LEGACY_WEAPON[char]
  if (!map || it.slot !== SLOT_WEAPON) return it
  const to = map[WEAPON_IDS[it.wt]]
  return to ? { ...it, wt: WEAPON_IDS.indexOf(to) } : it
}

export function weaponFor(char: CharacterId, equip: (Item | null)[]): WeaponId {
  const base = CHARACTERS[char].weapon
  const it = equip[SLOT_WEAPON]
  const id = it ? WEAPON_IDS[it.wt] : undefined
  return id && WEAPONS[id] && WEAPONS[id].family === WEAPONS[base].family ? id : base
}

function makePlayer(id: number, char: CharacterId, team: number, sheet?: Sheet): PlayerState {
  const c = CHARACTERS[char]
  const ult = SKILLS[CHAR_SKILLS[char][2]]
  const sh: Sheet = sheet ?? { level: 1, xp: 0, gold: 0, equip: new Array(SLOT_COUNT).fill(null), bag: [] }
  // 세이브에서 온 것은 복사해 둔다 (상태가 세이브 객체를 건드리지 않게)
  const equip = sh.equip.map((it) => (it ? convertLegacy(char, { ...it, aff: [...it.aff] }) : null))
  const bag = sh.bag.map((it) => convertLegacy(char, { ...it, aff: [...it.aff] }))
  const attr = (sh.attr ?? [0, 0, 0, 0]).slice(0, 4)
  const st = computeStats(sh.level, equip, attr)
  // 탱커: 최대 체력 +30% (던전 — recalc 과 같은 식)
  if (roleOn && c.role === 'tank') st[ST_HP] += Math.round(c.maxHp * 0.3)
  const maxHp = c.maxHp + st[ST_HP]
  const weapon = weaponFor(char, equip)
  const magSize = 0
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
    weapon,
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
    grit: 0,
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
    bagMax: sh.bagMax ?? BAG_SIZE,
    gpity: sh.gpity ?? 0,
    stats: sanitizeStats(sh.stats),
    st,
    magSize,
    xpGain: 0,
    goldGain: 0,
    found: 0,
    bestFound: -1,
    area: 0,
    // 잡은 막 보스의 보스 방 웨이포인트는 늘 안다 — 예전 저장이 16비트로 잘라 지운 것(거미 둥지 · 관리인의 방 · 심연의 옥좌)을 되살린다
    wps: ((sh.wps ?? 0) | bossRoomWps(sh.quests)) & ((1 << WAYPOINTS.length) - 1),
    btnPrev: 0,
    exitLock: 0,
    portalCast: 0,
    follow: -1,
    autoPick: AUTOPICK_ALL,
    attr,
    potions: sh.potMax ?? 4,
    potMax: sh.potMax ?? 4,
    potHot: 0,
    potCd: 0,
    shrine: 0,
    shrineT: 0,
    stash: (sh.stash ?? []).map((it) => ({ ...it, aff: [...it.aff] })),
    stashMax: sh.stashMax ?? STASH_SIZE,
    legs: legMask(equip),
    legCd: 0,
    focus: 50,
    dashCharges: 2,
    carpetDmg: 0,
    build: sanitizeBuild(sh.build),
    spBonus: questPoints(sh.quests ?? []),
    quests: Array.from({ length: QUESTS.length }, (_, i) => Math.max(0, Math.min(3, sh.quests?.[i] ?? 0))),
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

/** 능력치 (C 창): 0~3 한 점 · 10 추천대로 모두 · 99 되돌리기(마을에서만) */
function attrCommand(state: GameState, p: PlayerState, arg: number): void {
  if (arg === 99) {
    if (!isTown(p.area)) return
    p.attr = [0, 0, 0, 0]
  } else if (arg === 10) autoAttr(p)
  else if (arg >= 0 && arg < 4 && attrFree(p.level, p.attr) > 0) p.attr[arg]++
  else return
  recalc(p)
  state.events.push({ type: 'attr', p: p.id })
}

/** 남은 포인트를 추천 능력치 둘에 6:4 로 (용병 · 봇 · "추천대로 분배") — 결정론 */
export function autoAttr(p: { char: CharacterId; level: number; attr: number[] }): void {
  const [a, b] = ATTR_REC[p.char]
  for (let n = attrFree(p.level, p.attr); n > 0; n--) {
    if (p.attr[a] * 4 <= p.attr[b] * 6) p.attr[a]++
    else p.attr[b]++
  }
}

function recalc(p: PlayerState): void {
  const c = CHARACTERS[p.char]
  p.weapon = weaponFor(p.char, p.equip)
  p.st = computeStats(p.level, p.equip, p.attr)
  p.legs = legMask(p.equip)
  // 전설 "집중": 스킬 재사용 대기 -15% (옵션 상한과 따로 더한다)
  if (hasLeg(p, LEG_FOCUS)) p.st[ST_CDR] += 15
  // 스킬 트리 패시브: 총기 숙련 · 강인함 · (민첩은 이동에서) · 정신 집중
  p.st[ST_DMG] += 4 * p.build.r[6]
  p.st[ST_HP] += Math.round(c.maxHp * 0.06 * p.build.r[7])
  p.st[ST_CDR] += 2 * p.build.r[9]
  // 탱커: 최대 체력 +30% (던전)
  if (roleOn && c.role === 'tank') p.st[ST_HP] += Math.round(c.maxHp * 0.3)
  const maxHp = c.maxHp + p.st[ST_HP]
  if (maxHp > p.maxHp && p.alive) p.hp += maxHp - p.maxHp
  p.maxHp = maxHp
  p.hp = Math.min(p.hp, p.maxHp)
  // 재장전이 없다 (2026-09-19) — 탄창 칸은 0
  p.magSize = 0
  p.ammo = 0
}

/** 피해 배율 (레벨 + 장비) */
function dmgMul(p: PlayerState): number {
  return (1 + p.st[ST_DMG] / 100) * (p.shrineT > 0 && p.shrine === 0 ? 1.25 : 1) * ((p.cpow ?? 0) > 0 ? (p.cpowMul ?? 1) : 1)
}

/** 무기(사격 · 휘두르기) 피해 배율 = 레벨·장비 × 역할 (딜러 1.2 · 힐러 0.8 — 던전). 스킬 피해에는 역할을 곱하지 않는다 */
function weaponMul(p: PlayerState): number {
  return dmgMul(p) * (roleOn ? ROLE_DMG[roleOf(p)] : 1)
}

/** 치유 배율: 스킬 위력 × 힐러 1.5 (던전) */
function healMul(p: PlayerState): number {
  return skillPow * (roleOn && roleOf(p) === 'heal' ? 1.5 : 1)
}

/** 체력을 채우고 떠오르는 숫자를 띄운다. 실제로 찬 만큼을 돌려준다 */
function healPlayer(state: GameState, q: PlayerState, amount: number): number {
  const a = Math.min(q.maxHp - q.hp, Math.round(amount))
  if (a <= 0 || !q.alive || q.downed) return 0
  q.hp += a
  state.events.push({ type: 'heal', p: q.id, x: q.x, y: q.y, amount: a })
  return a
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
  roleOn = state.mode === 'dungeon'
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

/**
 * 이 사람에게 **다음 막 문**이 열렸는가 — 그 막 보스를 쓰러뜨렸으면(퀘스트 "이룸" 이상).
 * 사람마다 따로 본다: 늦게 난입한 사람은 문이 아직 닫혀 있다 (퀘스트가 그 사람 것이 아니므로).
 */
export function gateOpen(def: AreaDef, p: { quests: number[] }): boolean {
  return def.gate !== undefined && (p.quests[actBossQuest(def.act)] ?? 0) >= 2
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
  if (state.allies?.length) stepAllies(state, map)
  const grid = buildGrid(state, map)
  separate(state, map, grid)
  stepZones(state, map)
  stepThrows(state, map, grid)
  stepBullets(state, map, grid)
  stepShots(state, map)
  runBooms(state, map, grid)
  flushSpawns(state, map)
  bossImmune(state)
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
  roleOn = state.mode === 'dungeon'
  Object.assign(p, makePlayer(idx, char, state.mode === 'arena' ? team : 0, sheet))
  if (state.mode === 'arena') {
    p.area = 0
    const a = ensureArea(state, 0, mapOf(0), false)
    withArea(state, a, () => respawn(state, mapOf(0), p))
  } else {
    // 난입한 사람은 지금 막의 마을에서 시작한다 (GUIDE 5.3) — 아직 그 막을 열지 못한 캐릭터는 자기가 연 가장 뒤 막의 마을
    const t = ACTS[Math.min(state.act, actReached(p.quests))].town
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

/**
 * 영상 · 계측 도구용: 사람을 다른 지역의 자리로 곧장 옮긴다(출구를 걸어가지 않고 — 소개 영상이 보스 방마다 들른다, tools/trailer.js).
 * step 사이에만 부른다. 여럿이 함께 쓰면 판이 어긋나므로 게임 코드에서는 쓰지 않는다
 */
export function warpPlayer(state: GameState, maps: MapSource, idx: number, to: number, x?: number, y?: number): void {
  const mapOf = mapFn(maps)
  const p = state.players[idx]
  if (!p || p.left) return
  const map = mapOf(to)
  const l = areaLayout(to, map)
  placeIn(state, map, p, to, x ?? l.spawn.x, y ?? l.spawn.y, 'wp')
  bindPrimary(state)
}

/**
 * 영상용: 정원(4) 밖에 AI 동료를 더한다 — 소개 영상 마지막 "크루 12명이 함께 보스를" 장면만 (tools/trailer.js · 2026-09-24 사용자).
 * 용병처럼 sim 안의 봇이 움직이고 owner 를 따라다닌다. 게임 코드에서는 쓰지 않는다
 */
export function addCameo(state: GameState, char: CharacterId, owner: number, x: number, y: number): PlayerState {
  const o = state.players[owner]
  const idx = state.players.length
  const p = makePlayer(idx, char, o.team, { level: o.level, xp: 0, gold: 0, equip: new Array(SLOT_COUNT).fill(null), bag: [] })
  p.merc = owner
  p.follow = owner
  p.area = o.area
  p.x = x
  p.y = y
  p.bot = makeBot((state.seed ^ Math.imul(idx + 7, 0x2545f491)) >>> 0)
  p.cameo = true
  state.players.push(p)
  return p
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
  if (p.bossCd) p.bossCd--
  if (p.legInjury > 0) p.legInjury--
  const recover = c.id === 'chim' ? w.recoilRecover * CHIM.recoverMul : w.recoilRecover
  p.recoil = p.fx[FX_CRIT] > 0 ? 0 : Math.max(0, p.recoil - recover)

  // 매직란 패시브(진료): 3초 안 맞으면 초당 6 회복
  if (c.id === 'magic' && state.tick - p.lastHitTick > 180 && p.hp < p.maxHp) {
    p.hp = Math.min(p.maxHp, p.hp + 6 / 60)
  }
  // 힐러의 기운 (던전): 2초마다 7칸 안 동료(나 포함) 체력 3% 회복 — 사람마다 박자를 어긋나게
  if (roleOn && c.role === 'heal' && isActive(p) && (state.tick + p.id * 29) % 120 === 0) {
    for (const q of alliesNear(state, p, 7 * TILE)) healPlayer(state, q, Math.max(1, q.maxHp * 0.03))
  }
  // 후원 효과 (core/donate.ts): 남은 틱을 줄인다
  const don = p.don
  if (don) for (let k = 0; k < don.length; k++) if (don[k] > 0) don[k]--
  if (p.cpow && --p.cpow === 0) p.cpowMul = 1
  // 풍월란 패시브(근성): 잠깐 안 맞으면 쌓인 칸이 식는다
  if (c.id === 'pungwol' && p.grit > 0 && state.tick - p.lastHitTick > PUNGWOL.gritCool) p.grit = 0
  // 풍월란 궁극기(켠왕): 켜져 있는 동안 8칸 안 괴물이 계속 나만 노린다 (0.5초마다 다시 건다)
  if (p.fx[FX_KENWANG] > 0 && isActive(p) && state.tick % 30 === 0) tauntNear(state, p, 8 * TILE, 60)

  // 후원 "화면 흔들림"(DON_SHAKE)은 화면만 흔든다 — 판(조준)은 건드리지 않는다 (2026-09-26 — donate.ts)
  p.aim = input.aim & 1023
  p.aimDist = (input.aimDist ?? 0) * 4
  p.ads = playing && (input.buttons & BTN_ADS) !== 0 && p.dashTimer === 0

  // 돌진·도약 (승빠란 Q · 옥냥란 Q): 정해진 방향으로 빠르게, 그동안 무적. 조작은 받지 않는다
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
  // 후원 "거꾸로 걷기"
  if (don && don[DON_INVERT] > 0) {
    mx = -mx
    my = -my
  }
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
    if (p.ads && c.id !== 'oknyang') speed *= 0.6 // 옥냥란 패시브: 정조준해도 느려지지 않음
    if (p.legInjury > 0) speed *= 0.7
    if (p.shrineT > 0 && p.shrine === 3) speed *= 1.2
    if (p.build.r[8] > 0) speed *= 1 + 0.02 * p.build.r[8]
    if (p.fx[FX_WHIRL] > 0) speed *= 1.3
    if (p.fx[FX_SWIFT] > 0) speed *= 1.4
    speed *= 1 + p.st[ST_SPEED] / 100
    const r = moveCircle(map, p.x, p.y, PLAYER_RADIUS, mx * inv * speed, my * inv * speed)
    p.x = r.x
    p.y = r.y
    p.moving = true
  }

  // 구르기
  const dashCost = DASH_COST
  const dungeon = state.mode === 'dungeon'
  const canDash = dungeon ? p.dashCharges > 0 && p.dashCooldown < dashRecharge(p) - 20 : p.dashCooldown === 0 && p.stamina >= dashCost
  // 후원 "스킬 봉인": 스킬(Q · E · 1 · 2)만 금지 — 궁극기 · 구르기는 된다 (2026-09-26 사용자: "말 그대로 스킬만 봉인")
  const sealed = !!don && don[DON_SEAL] > 0
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
    // 던전: 구르기 끝에 무적 유예 (DASH_GRACE — 합쳐 0.25초 · 승빠란 빼고)
    else if (dungeon && c.id !== 'seungwoo') p.invuln = Math.max(p.invuln, p.dashTimer + DASH_GRACE)
    // 레드카펫: 구르기가 줄지 않고, 구를 때마다 주변을 친다
    if (p.fx[FX_CARPET] > 0) {
      if (dungeon) p.dashCharges = Math.min(DASH_MAX, p.dashCharges + 1)
      aoe(state, map, p, p.x, p.y, 2.5 * TILE, p.carpetDmg, { stun: dungeon ? 60 : 30, knock: 4, id: 'redcarpet' })
    }
    state.events.push({ type: 'dash', p: p.id })
  }

  // 스킬 Q · E · R · 1 · 2 (누르고 있으면 준비되는 대로 쓴다 — 디아블로처럼). 궁극기 빼고는 집중이 든다
  if (playing && p.dashTimer === 0) {
    for (let k = 0; k < SKILL_BTNS.length; k++) {
      if ((input.buttons & SKILL_BTNS[k]) === 0 || (p.cd[k] ?? 0) > 0) continue
      if (sealed && SKILL_BTNS[k] !== BTN_ULT) continue
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
    const dun = state.mode === 'dungeon'
    aoe(state, map, p, p.x, p.y, (dun ? 3 : 2.4) * TILE, dun ? 65 : 35, { knock: 3, id: 'kitchen', quiet: true })
  }

  // 줍기: 내 전리품·버려진 것 위를 지나가면 줍는다 (디아블로처럼 한 번 클릭 대신 — 슈터는 손이 바쁘다)
  if (state.drops.length > 0) pickUp(state, p)

  // 사격
  const firePressed = (input.buttons & BTN_FIRE) !== 0
  const trigger = w.auto ? firePressed : firePressed && !p.prevFire
  p.prevFire = firePressed
  // 재장전이 없다 (2026-09-19 사용자 — 시원한 슈팅): 누르고 있으면 발사 간격마다 끝없이 쏜다
  if (playing && trigger && p.dashTimer === 0 && p.fx[FX_WHIRL] === 0 && p.fireCooldown === 0) fire(state, map, p)
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
  if (state.mode === 'dungeon') p.stats.deaths++
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
  p.grit = 0
  p.staminaMax = c.staminaMax ?? STAMINA_MAX
  p.stamina = p.staminaMax
  p.blockLock = 0
  p.sprinting = false
  p.pierceShots = 0
  p.empowerShots = 0
  state.events.push({ type: 'respawn', p: p.id, x: p.x, y: p.y })
}

/** 도발: 반경 안의 (깨어 있는) 몬스터가 ticks 동안 이 사람만 노린다 (철면란 철벽 · 풍월란 훈수 · 켠왕) */
function tauntNear(state: GameState, p: PlayerState, r: number, ticks: number): void {
  for (const m of state.monsters) {
    if (m.hp <= 0 || len(m.x - p.x, m.y - p.y) > r) continue
    if (m.st === MS_SLEEP) wakePack(state, m.pack, m.x, m.y)
    m.target = p.id
    m.taunt = Math.max(m.taunt, ticks)
  }
}

/** 받는 피해 배율: 철벽 · 회전 공격 · 포효의 가호 (곱한다) */
function takenMul(p: PlayerState): number {
  let k = 1 - p.st[ST_DR] / 100
  if (p.fx[FX_GUARD] > 0) k *= 0.5
  if (p.fx[FX_WHIRL] > 0) k *= 0.5
  if (p.fx[FX_REFLECT] > 0) k *= 0.4
  if (p.fx[FX_PARTYDR] > 0) k *= 0.7
  // 풍월란 궁극기(켠왕): 깰 때까지 버틴다
  if (p.fx[FX_KENWANG] > 0) k *= 0.4
  // 풍월란 패시브(근성): 맞을수록 단단해진다 (최대 -30%)
  if (p.char === 'pungwol' && p.grit > 0) k *= 1 - Math.min(PUNGWOL.gritMax, p.grit) * PUNGWOL.gritPer
  if (roleOn && roleOf(p) === 'tank') k *= 0.8
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
function hurtPlayer(state: GameState, p: PlayerState, dmg: number, by: number, sx: number, sy: number, raw = false): boolean {
  if (!isActive(p) || p.invuln > 0 || p.dashTimer > 0 || state.phase !== 'playing') return false
  // 반사광: 때린 괴물이 받은 피해의 1.5배를 돌려받는다
  if (p.fx[FX_REFLECT] > 0 && by >= 0) {
    const m = state.monsters.find((q) => q.id === by && q.hp > 0)
    if (m) hurtMonster(state, m, Math.round(dmg * 1.5), p.id, false, m.x, m.y)
  }
  // raw (보스 ‰ 피해): 방어력 · 역할 · 피해 감소 스킬 · 후라이팬 막기를 모두 무시한다
  if (!raw) dmg = panBlock(state, p, Math.round(dmg * takenMul(p)), sx, sy)
  if (dmg <= 0) return true
  p.hp -= dmg
  p.dmgTaken += dmg
  p.lastHitTick = state.tick
  p.portalCast = 0
  // 풍월란 패시브(근성): 맞을 때마다 한 칸 더 단단해진다
  if (p.char === 'pungwol') p.grit = Math.min(PUNGWOL.gritMax, p.grit + 1)
  // 풍월란 궁극기(켠왕, 던전): 그동안은 쓰러지지 않는다 — 대신 한 번 버티면 끝난다 ("다시 갈게요")
  if (p.hp <= 0 && p.fx[FX_KENWANG] > 0 && state.mode === 'dungeon') {
    p.hp = 1
    p.fx[FX_KENWANG] = 0
    p.invuln = Math.max(p.invuln, 60)
  }
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
  if (p.hp <= 0) downPlayer(state, p)
  return true
}

/** 체력 0 → 쓰러짐 (동료가 일으킨다 · 죽음 규칙은 쓰러진 채 시간이 다 됐을 때) */
function downPlayer(state: GameState, p: PlayerState): void {
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

/**
 * 막 보스 즉사기에 맞았다: 레벨 · 역할 · 방어 · 피해 감소 · 켠왕 · 불굴(체력 1 로 버티기) · 보스 공격 쿨다운을 **무시**하고 쓰러진다
 * (2026-09-24 사용자: "레벨 · 탱에 상관없이 무조건 한 방에"). 단 **무적은 그대로 막는다** — 스킬 무적 · 돌진/도약 · 구르기 무적 틱
 * (같은 날 사용자: "즉사기여도 무적 상태는 적용되게 — 무적인데 죽는다는 건 말이 안 된다"). 피하는 길은 범위 밖 · 무적
 */
function killOutright(state: GameState, p: PlayerState, by: number): void {
  if (!isActive(p) || state.phase !== 'playing') return
  if (p.invuln > 0 || p.dashTimer > 0) return
  p.dmgTaken += p.hp
  state.events.push({ type: 'hurt', p: p.id, by, x: p.x, y: p.y, dmg: p.hp })
  state.events.push({ type: 'ultHit', p: p.id, x: p.x, y: p.y })
  downPlayer(state, p)
}

/**
 * 보스 공격 (2026-09-23 사용자: "퍼센트 데미지로 공격을 해서 탱커든 딜러든 힐러든 동일하게 피해를 받도록"):
 * 맞은 사람 **최대 체력의 pm/1000**. 방어 · 역할 · 막기 · 피해 감소를 무시한다 — 구르기(무적 틱) · 무적만 피한다
 */
function hurtPct(state: GameState, p: PlayerState, pm: number, by: number, sx: number, sy: number): boolean {
  // 한 번 맞으면 잠깐(BOSS_HIT_CD) 다시 맞지 않는다 — 코앞에서 부채 일곱 갈래 · 겹친 광선 네 줄이 한 틱에 다 들어와 한 번에 쓰러졌다
  if ((p.bossCd ?? 0) > 0) return false
  if (!hurtPlayer(state, p, Math.max(1, Math.round((p.maxHp * pm) / 1000)), by, sx, sy, true)) return false
  p.bossCd = BOSS_HIT_CD
  return true
}
/** 보스 공격 사이 틱 (0.33초) */
const BOSS_HIT_CD = 20

/**
 * 플레이어가 플레이어를 때린다(투기장 — 덕의 hurt). 킬·힐팩·승리 판정까지.
 * part = 부위(머리·몸·다리). 스킬 피해는 몸통으로 친다.
 */
function hurtPvp(state: GameState, shooter: PlayerState, victim: PlayerState, dmg: number, part: number, hx: number, hy: number): void {
  if (dmg <= 0 || !victim.alive || victim.left) return
  // 풍월란은 투기장에서도 탱커답게 조금 덜 맞는다 (역할 효과는 던전에만 있다 — state.ts PUNGWOL)
  dmg = Math.round(dmg * takenMul(victim) * (victim.char === 'pungwol' ? PUNGWOL.pvpTaken : 1))
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
  gridFor(map).query(ax - 40, ay - 40, ax + 40, ay + 40, (i) => {
    const m = state.monsters[i]
    if (!m || m.hp <= 0) return
    if (len(ax - m.x, ay - m.y) <= bodyR(m) * HEAD_AIM_FRAC && (found < 0 || m.id < found)) found = m.id
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
  gridFor(map).query(x - r - 80, y - r - 80, x + r + 80, y + r + 80, (i) => {
    const m = state.monsters[i]
    if (!m || m.hp <= 0) return
    if (o.tag !== undefined && m.tag === o.tag) return
    if (len(m.x - x, m.y - y) > r + bodyR(m)) return
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
  dmg = Math.round(dmg * weaponMul(p))
  let n = 0
  const reach = range + PLAYER_RADIUS + 80
  const hit: Monster[] = []
  gridFor(map).query(p.x - reach, p.y - reach, p.x + reach, p.y + reach, (i) => {
    const m = state.monsters[i]
    if (!m || m.hp <= 0) return
    const dx = m.x - p.x
    const dy = m.y - p.y
    const d = len(dx, dy)
    if (d > range + PLAYER_RADIUS + bodyR(m)) return
    if (d > 1 && Math.abs(angleDiff(atan2A(dy, dx), p.aim)) > arc) return
    if (rayCast(map, p.x, p.y, m.x, m.y, 'bullet', true).blocked) return
    hit.push(m)
  })
  hit.sort((a, b) => a.id - b.id)
  for (const m of hit) {
    const d = len(m.x - p.x, m.y - p.y) || 1
    // 격정 연주(철면란 E) · 다지기 연타 중 휘두르기에 맞은 괴물은 느려진다 (총의 탄막과 같은 효과)
    if (p.fx[FX_FREEAMMO] > 0) m.slow = Math.max(m.slow, 60)
    const k = knock * (1 - MONSTER_LIST[m.kind].knockRes)
    m.kx += ((m.x - p.x) / d) * k
    m.ky += ((m.y - p.y) / d) * k
    hurtMonster(state, m, dmg, p.id, false, m.x, m.y)
    n++
  }
  // 검(우재란)의 흡혈 (던전): 벤 피해의 4% — 근접 딜러가 떼 속에서 버티게 (조용히, 숫자는 띄우지 않는다)
  if (roleOn && n > 0 && WEAPONS[p.weapon].family === 'rapier' && isActive(p)) p.hp = Math.min(p.maxHp, p.hp + dmg * n * 0.04)
  if (state.mode === 'arena') {
    for (const victim of state.players) {
      if (!isEnemy(p, victim) || !victim.alive || victim.left || victim.invuln > 0 || victim.dashTimer > 0) continue
      const dx = victim.x - p.x
      const dy = victim.y - p.y
      if (len(dx, dy) > range + PLAYER_RADIUS) continue
      if (Math.abs(angleDiff(atan2A(dy, dx), p.aim)) > arc) continue
      if (rayCast(map, p.x, p.y, victim.x, victim.y, 'bullet', true).blocked) continue
      // 투기장 배율은 근접에도 (2026-09-19 — 예전에는 총알에만 걸렸다)
      hurtPvp(state, p, victim, Math.round(dmg * (WEAPONS[p.weapon].pvp ?? 1)), PART_BODY, victim.x, victim.y)
      n++
    }
  }
  return n
}

/** 탄 하나를 만든다 (사격·난사·관통 저격 공용) */
function spawnBullet(state: GameState, p: PlayerState, mx: number, my: number, a: number, weapon: PlayerState['weapon'], o: { speed?: number; damage?: number; life?: number; pierce?: number; mul?: number; breaker?: boolean; headTarget: number; critMon: number; over: boolean; overR: number }): void {
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
    damage: o.damage !== undefined ? o.damage * dmgMul(p) : w.damage * weaponMul(p),
    ads: p.ads || p.fx[FX_SNIPE] > 0,
    ox: p.x,
    oy: p.y,
    weapon,
    hitSomeone: false,
    over: o.over,
    headTarget: o.headTarget,
    critMon: o.critMon,
    overR: o.overR,
    pierce: (o.pierce ?? 0) + (p.fx[FX_KING] > 0 ? 2 : 0),
    lastHit: 0,
    mul: (o.mul ?? 1) * (p.fx[FX_KING] > 0 ? 1.3 : 1),
    boom: WEAPONS[weapon].boom ? WEAPONS[weapon].boom!.r : 0,
    forceCrit: p.fx[FX_CRIT] > 0,
  }
  if (o.breaker) b.breaker = true
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
  // 관통탄(침착란 Q) · 아홉 목숨(관통 2) · 고양이 걸음 다음 한 발(2배)
  let pierce = 0
  let mul = 1
  if (p.pierceShots > 0) {
    p.pierceShots--
    pierce = 3
    mul *= 1.3
  }
  if (snipe) pierce = Math.max(pierce, 2)
  pierce += w.pierce ?? 0
  if (p.empowerShots > 0) {
    p.empowerShots--
    mul *= 2
  }
  for (let i = 0; i < w.pellets; i++) {
    const off = spread > 0 ? randInt(state.rng, -spread, spread + 1) : 0
    const a = (p.aim + off) & 1023
    spawnBullet(state, p, mx, my, a, p.weapon, { headTarget, critMon, over: aimsAtHead(state, map, p, mx, my, a, headTarget), overR, pierce, mul })
  }
  if (state.mode === 'dungeon' && !w.suppressed && !SILENT_CHARS.has(p.char)) noise(state, p.x, p.y)
  p.shots += w.pellets // 명중률을 탄 단위로 재야 산탄총이 왜곡되지 않는다
  p.fireCooldown = interval
  if (p.fx[FX_CRIT] === 0) p.recoil = Math.min(w.recoil * MAX_RECOIL_MUL * 2, p.recoil + w.recoil * (p.char === 'chim' ? CHIM.recoilMul : 1))
  state.events.push({ type: 'fire', p: p.id, x: mx, y: my, aim: p.aim, weapon: p.weapon })
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

/** alliesNear + 화면에 **초록 고리**(동료를 고치거나 지켜 주는 범위)를 알린다. 스킬을 쓸 때만 부른다 (틱마다 부르는 곳은 alliesNear) */
function alliesFx(state: GameState, p: PlayerState, r: number, includeDowned = false): PlayerState[] {
  state.events.push({ type: 'allyfx', p: p.id, x: p.x, y: p.y, r })
  return alliesNear(state, p, r, includeDowned)
}

function buffRate(p: PlayerState, ticks: number, mul: number): void {
  p.rateMul = p.fx[FX_RATE] > 0 ? Math.max(p.rateMul, mul) : mul
  p.fx[FX_RATE] = Math.max(p.fx[FX_RATE], ticks)
}

/** 응원 공격력 (dmgMul 에 곱한다 — 무기 · 스킬 모두). 겹치면 큰 배율 · 긴 시간 */
function buffPow(p: PlayerState, ticks: number, mul: number): void {
  p.cpowMul = (p.cpow ?? 0) > 0 ? Math.max(p.cpowMul ?? 1, mul) : mul
  p.cpow = Math.max(p.cpow ?? 0, ticks)
}

/** 지금 쓰는 스킬의 위력 배율 (aoe 가 피해에 곱한다) */
let skillPow = 1

function castSkill(state: GameState, map: GameMap, p: PlayerState, slot: number): void {
  const node = slotNode(p, slot)
  const id: SkillId = nodeSkill(p, node < 0 ? 0 : node)
  const def = SKILLS[id]
  p.cd[slot] = Math.round(def.cd * (1 - p.st[ST_CDR] / 100) * (node >= 0 ? nodeCd(p.build, node) : 1))
  if (state.mode === 'dungeon' && node >= 0) p.focus = Math.max(0, p.focus - focusCost(def, p.build, node))
  skillPow = (node >= 0 ? nodePow(p.build, node) : 1) * (1 + p.st[ST_SKILLPOW] / 100)
  try {
    castSkillBody(state, map, p, slot, id, def)
  } finally {
    skillPow = 1
  }
}

function castSkillBody(state: GameState, map: GameMap, p: PlayerState, slot: number, realId: SkillId, def: (typeof SKILLS)[SkillId]): void {
  // 트리 스킬(캐릭터 고유 이름)은 바탕 스킬의 효과를 그대로 쓴다 — 이벤트 · 연출 · 소리도 바탕 id 로
  const id = baseSkill(realId)
  // 궁극기는 던전에서 확실히 세게 (2026-09-19 "궁극기가 일반 스킬보다 효과가 작은 게 많다 — 확실히 우위로"). 투기장은 그대로
  const dun = state.mode === 'dungeon'
  let tx = p.x
  let ty = p.y
  if (def.reach) {
    const c = cursorPoint(map, p, def.reach)
    tx = c.x
    ty = c.y
  }
  // rid = 쓴 스킬 그대로(트리 스킬의 고유 이름 — 머리 위 외침), id = 효과를 내는 바탕
  state.events.push({ type: 'skill', p: p.id, slot, id, x: p.x, y: p.y, aim: p.aim, tx, ty, rid: realId })
  const T = TILE
  switch (id) {
    // ---- 철면란
    case 'ironwall': {
      p.fx[FX_GUARD] = 240
      tauntNear(state, p, 7 * T, 240)
      break
    }
    case 'barrage':
      buffRate(p, 240, 2)
      p.fx[FX_FREEAMMO] = 240
      break
    case 'roar': {
      aoe(state, map, p, p.x, p.y, (dun ? 6 : 5) * T, dun ? 220 : 120, { stun: dun ? 180 : 120, knock: dun ? 10 : 8, id })
      for (const q of alliesFx(state, p, 8 * T)) q.fx[FX_PARTYDR] = 360
      if (dun) p.fx[FX_GUARD] = Math.max(p.fx[FX_GUARD], 360)
      break
    }
    // ---- 침착란
    case 'pierce':
      p.pierceShots = 6
      break
    case 'grenade':
      state.throws.push({ id: state.nextFxId++, owner: p.id, x0: p.x, y0: p.y, x: tx, y: ty, t: 42, max: 42 })
      break
    case 'composure':
      p.fx[FX_CRIT] = dun ? 480 : 360
      buffRate(p, dun ? 480 : 360, dun ? 2 : 1.5)
      break
    // ---- 단군란
    case 'broadcast': {
      for (const m of state.monsters) {
        if (m.hp <= 0 || len(m.x - p.x, m.y - p.y) > 18 * T) continue
        m.mark = 480
        m.vuln = 480
        m.vulnPct = Math.max(m.vulnPct, 25)
      }
      // 카메라 앞이라 괴물이 몸을 사린다: 던전에서 8초간 나와 곁의 동료가 받는 피해 -30% (포효의 가호와 같은 효과)
      if (state.mode === 'dungeon') for (const q of alliesFx(state, p, 8 * T)) q.fx[FX_PARTYDR] = Math.max(q.fx[FX_PARTYDR], 480)
      break
    }
    case 'fanfire': {
      const { x: mx, y: my } = muzzle(map, p)
      const headTarget = aimedEnemy(state, p)
      const critMon = aimedMonster(state, map, p)
      // 던전: 떼를 치는 스킬이 되게 한 발 28 피해 · 하나를 더 꿰뚫는다 (권총 자체는 그대로 — 2026-09-19 요청). 투기장은 예전 그대로
      const dun = state.mode === 'dungeon' ? { damage: Math.round(28 * skillPow), pierce: 1 } : {}
      for (let i = 0; i < 8; i++) {
        const a = (p.aim + Math.round(((i - 3.5) / 3.5) * deg(15))) & 1023
        spawnBullet(state, p, mx, my, a, 'pistol', { headTarget, critMon, over: false, overR: 0, ...dun })
      }
      p.shots += 8
      state.events.push({ type: 'fire', p: p.id, x: mx, y: my, aim: p.aim, weapon: 'pistol' })
      // 던전: 달라붙은 떼를 밀쳐 낸다 (앞쪽 3칸 · 1.5초 느리게) — 권총은 한 마리씩이라 떼에 둘러싸이면 빠져나올 길이 없었다
      if (state.mode === 'dungeon') aoe(state, map, p, p.x, p.y, 3 * T, 15, { knock: 10, slow: 90, arcAim: p.aim, arc: deg(40), id, quiet: true })
      break
    }
    case 'spotlight':
      // 던전: 무대 5칸 · 켜지는 순간 1.5초 기절 · 0.5초마다 30 피해 (투기장은 4칸 · 피해 없음 — 예전 그대로)
      state.zones.push({ id: state.nextFxId++, kind: ZONE_SPOTLIGHT, owner: p.id, x: tx, y: ty, r: (dun ? 5 : 4) * T, t: 480, max: 480, dmg: dun ? Math.round(30 * skillPow) : 0 })
      if (dun) aoe(state, map, p, tx, ty, 5 * T, 0, { stun: 90, id, quiet: true })
      break
    // ---- 매직란
    case 'firstaid': {
      for (const q of alliesFx(state, p, 6 * T)) {
        // 던전: 4초간 받는 피해 -30% (붙은 떼 속에서 회복만으로는 다시 쓰러졌다)
        if (state.mode === 'dungeon') q.fx[FX_PARTYDR] = Math.max(q.fx[FX_PARTYDR], 240)
        healPlayer(state, q, q.maxHp * 0.25 * healMul(p))
      }
      break
    }
    case 'flame':
      // 던전: 부채꼴 대신 둘레 전체 — 산탄은 가까이 붙어 싸워 떼에 사방으로 둘러싸였다 (피해 · 밀침은 그대로)
      // 시드 5 평균 죽음: 앞 부채꼴 54 → 둘레 + 85 피해·강한 밀침·느려짐 6 → 둘레 + 60·밀침 8·1초 느림 8 (둘 다 가장 쉬운 캐릭터가 됐다)
      if (state.mode === 'dungeon') aoe(state, map, p, p.x, p.y, 4 * T, 60, { knock: 5, id })
      else aoe(state, map, p, p.x, p.y, 4 * T, 60, { knock: 5, arcAim: p.aim, arc: deg(40), id })
      break
    case 'surgery': {
      // 던전: 12칸 · 그 뒤 8초간 받는 피해 -50%
      if (dun) for (const q of alliesNear(state, p, 12 * T)) q.fx[FX_GUARD] = Math.max(q.fx[FX_GUARD], 480)
      for (const q of alliesFx(state, p, (dun ? 12 : 8) * T, true)) {
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
    // ---- 승빠란
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
      p.fx[FX_WHIRL] = dun ? 420 : 300
      break
    // ---- 옥냥란
    case 'catstep':
      // 던전: 뛰어오르며 원래 자리를 할퀸다 — 추격하던 떼를 2초 묶고, 착지 뒤 2초간 받는 피해 -30% · 재사용 7초
      if (state.mode === 'dungeon') {
        aoe(state, map, p, p.x, p.y, 3 * T, 40, { stun: 120, id })
        p.fx[FX_PARTYDR] = Math.max(p.fx[FX_PARTYDR], 11 + 120)
        p.cd[slot] = Math.round((p.cd[slot] * 7) / 9)
      }
      p.dashDx = -cosA(p.aim)
      p.dashDy = -sinA(p.aim)
      p.fx[FX_CHARGE] = 11
      p.chargeTag = 0
      p.empowerShots = 1
      break
    case 'railshot': {
      const { x: mx, y: my } = muzzle(map, p)
      spawnBullet(state, p, mx, my, p.aim, 'sniper', { speed: 30, damage: state.mode === 'dungeon' ? 260 : 200, life: 50, pierce: 99, breaker: state.mode === 'dungeon', headTarget: aimedEnemy(state, p), critMon: aimedMonster(state, map, p), over: false, overR: 0 })
      p.shots++
      state.events.push({ type: 'fire', p: p.id, x: mx, y: my, aim: p.aim, weapon: 'sniper' })
      break
    }
    case 'ninelives':
      p.fx[FX_SNIPE] = 480
      buffRate(p, 480, 3)
      // 던전: 그동안 받는 피해 -30% · 모든 탄이 치명타
      if (dun) {
        p.fx[FX_PARTYDR] = Math.max(p.fx[FX_PARTYDR], 480)
        p.fx[FX_CRIT] = Math.max(p.fx[FX_CRIT], 480)
      }
      break
    // ---- 주펄란
    case 'flash':
      aoe(state, map, p, p.x, p.y, 3.5 * T, 25, { stun: 90, id })
      break
    case 'mirror':
      p.fx[FX_REFLECT] = 180
      // 후광 (던전 — 주펄란 힐러): 7칸 안 동료(나 포함) 체력 15% · 5초간 받는 피해 -30%
      if (dun) {
        for (const q of alliesFx(state, p, 7 * T)) {
          healPlayer(state, q, q.maxHp * 0.15 * healMul(p))
          q.fx[FX_PARTYDR] = Math.max(q.fx[FX_PARTYDR], 300)
        }
      }
      break
    case 'supernova':
      aoe(state, map, p, p.x, p.y, (dun ? 7 : 6) * T, dun ? 380 : 200, { stun: dun ? 180 : 150, knock: 10, id })
      if (dun) for (const q of alliesFx(state, p, 9 * T)) healPlayer(state, q, q.maxHp * 0.4 * healMul(p))
      break
    // ---- 우원란
    case 'stunt': {
      // 뒤로 구른다 (앞으로 구르면 조준한 괴물 떼 한가운데로 들어갔다)
      p.dashDx = -cosA(p.aim)
      p.dashDy = -sinA(p.aim)
      p.fx[FX_CHARGE] = 11
      p.chargeTag = 0
      p.ads = false
      const { x: mx, y: my } = muzzle(map, p)
      const headTarget = aimedEnemy(state, p)
      const critMon = aimedMonster(state, map, p)
      // 던전: 8발 · 한 발 28 피해 · 하나를 더 꿰뚫는다 (투기장은 6발 그대로)
      const dun = state.mode === 'dungeon'
      const n = dun ? 8 : 6
      const o = dun ? { damage: Math.round(28 * skillPow), pierce: 1 } : {}
      for (let i = 0; i < n; i++) spawnBullet(state, p, mx, my, (p.aim + Math.round(((i - (n - 1) / 2) / ((n - 1) / 2)) * deg(18))) & 1023, 'pistol', { headTarget, critMon, over: false, overR: 0, ...o })
      p.shots += n
      state.events.push({ type: 'fire', p: p.id, x: mx, y: my, aim: p.aim, weapon: 'pistol' })
      break
    }
    case 'curtain':
      for (const m of state.monsters) {
        if (m.hp <= 0 || len(m.x - p.x, m.y - p.y) > 7 * T) continue
        m.stun = Math.max(m.stun, 60)
        m.slow = Math.max(m.slow, 240)
        m.mark = Math.max(m.mark, 240)
        m.vuln = Math.max(m.vuln, 240)
        m.vulnPct = Math.max(m.vulnPct, 20)
      }
      // 던전: 40 피해도 (받는 피해 +20% 가 걸린 뒤라 48) — 떼를 한 번에 깎는 수단
      if (state.mode === 'dungeon') aoe(state, map, p, p.x, p.y, 7 * T, 40, { id, quiet: true })
      break
    case 'redcarpet':
      p.fx[FX_CARPET] = 480
      p.carpetDmg = Math.round((dun ? 160 : 70) * skillPow)
      break
    // ---- 기열란
    case 'overdrive':
      p.streak = Math.max(p.streak, GIYEOL.maxStacks)
      buffRate(p, 300, 1.3)
      break
    case 'shout': {
      // 던전 (기열란 딜러 — 2026-09-19 탱커에서 바뀜): 앞 6칸 · 120 피해, 맞힌 괴물 하나마다 뇌절 한 칸
      const n = aoe(state, map, p, p.x, p.y, (dun ? 6 : 5) * T, dun ? 120 : 50, { knock: 9, slow: 120, arcAim: p.aim, arc: deg(45), id })
      if (dun) p.streak = Math.min(GIYEOL.maxStacks, p.streak + n)
      break
    }
    case 'kingrage':
      p.fx[FX_KING] = dun ? 600 : 480
      if (dun) buffRate(p, 600, 1.5)
      break
    // ---- 풍월란
    // 우재란 트리 스킬 "칼바람" (옛 돌풍)
    case 'bladewind':
      aoe(state, map, p, p.x, p.y, 4 * T, 30, { knock: 12, stun: 60, id })
      break
    // ---- 풍월란 (2026-09-20 탱커: 바람 셋 → 훈수 · 꼬꼬꼬 · 켠왕)
    case 'advice':
      // 훈수: 채팅창의 훈수가 쏟아진다 — 끌어모으고 약하게 만든다
      tauntNear(state, p, (dun ? 10 : 8) * T, dun ? 360 : 300)
      for (const m of state.monsters) {
        if (m.hp <= 0 || len(m.x - p.x, m.y - p.y) > (dun ? 10 : 8) * T) continue
        m.vuln = Math.max(m.vuln, dun ? 360 : 300)
        m.vulnPct = Math.max(m.vulnPct, 25)
      }
      break
    case 'cluck': {
      // 꼬꼬꼬: 이득 봤을 때 내는 소리 — 둘러싸일수록 많이 회복한다
      const n = aoe(state, map, p, p.x, p.y, (dun ? 4 : 3.5) * T, dun ? 120 : 70, { knock: 10, slow: 90, id })
      if (n > 0) healPlayer(state, p, p.maxHp * (dun ? 0.08 : 0.06) * Math.min(5, n))
      break
    }
    case 'kenwang':
      // 켠왕: 깰 때까지 안 끈다 — 버티고 끌어모은다
      p.fx[FX_KENWANG] = dun ? 720 : 600
      tauntNear(state, p, 8 * T, 120)
      for (const q of alliesFx(state, p, 6 * T)) q.fx[FX_PARTYDR] = Math.max(q.fx[FX_PARTYDR], dun ? 720 : 600)
      break
    // ---- 통천란
    case 'snack': {
      // 치킨 나눔 (2026-09-19 통천란 = 힐러): 나와 7칸 안 동료 체력 25%
      for (const q of alliesFx(state, p, 7 * T)) {
        healPlayer(state, q, q.maxHp * 0.25 * healMul(p))
        if (state.mode === 'dungeon') q.fx[FX_PARTYDR] = Math.max(q.fx[FX_PARTYDR], 240)
      }
      buffRate(p, 240, 1.3)
      // 던전: 나는 빠져나간다 — 이동 +40% (가장 느린 캐릭터라 떼에 잡히면 벗어나지 못했다)
      if (state.mode === 'dungeon') p.fx[FX_SWIFT] = Math.max(p.fx[FX_SWIFT], 240)
      break
    }
    case 'trap':
      state.zones.push({ id: state.nextFxId++, kind: ZONE_TRAP, owner: p.id, x: tx, y: ty, r: 1.2 * T, t: 1200, max: 1200, dmg: Math.round(120 * skillPow) })
      break
    case 'angelshot': {
      const { x: mx, y: my } = muzzle(map, p)
      spawnBullet(state, p, mx, my, p.aim, 'sniper', { speed: 30, damage: 400, life: 60, pierce: 99, breaker: dun, headTarget: aimedEnemy(state, p), critMon: aimedMonster(state, map, p), over: false, overR: 0 })
      p.shots++
      state.events.push({ type: 'fire', p: p.id, x: mx, y: my, aim: p.aim, weapon: 'sniper' })
      // 던전: 빛의 기둥 — 조준 방향 18칸 줄 위의 모든 괴물에 900 피해 · 2초 기절 (한 마리 400 은 70초 궁극기로 너무 약했다)
      if (dun) {
        lineAoe(state, p, 18 * T, 1.2 * T, 900, 120)
        // 천사의 가호: 12칸 안 동료(나 포함) 체력 40% · 6초간 받는 피해 -30%
        for (const q of alliesFx(state, p, 12 * T)) {
          healPlayer(state, q, q.maxHp * 0.4 * healMul(p))
          q.fx[FX_PARTYDR] = Math.max(q.fx[FX_PARTYDR], 360)
        }
      }
      break
    }
    // ---- 우재란
    case 'catwalk':
      // 던전: 출발하며 둘레를 밀쳐 낸다 — 둘러싸여도 빠져나간다
      if (state.mode === 'dungeon') aoe(state, map, p, p.x, p.y, 3 * T, 20, { knock: 10, slow: 90, id, quiet: true })
      p.dashDx = cosA(p.aim)
      p.dashDy = sinA(p.aim)
      p.fx[FX_CHARGE] = 20
      p.chargeTag = state.nextFxId++
      p.ads = false
      break
    case 'flashbulb': {
      // 던전: 4칸 · 40 피해 (투기장은 3칸 · 20 그대로)
      const fr = (state.mode === 'dungeon' ? 4 : 3) * T
      aoe(state, map, p, tx, ty, fr, state.mode === 'dungeon' ? 40 : 20, { stun: 120, id })
      for (const m of state.monsters) {
        if (m.hp <= 0 || len(m.x - tx, m.y - ty) > fr) continue
        m.mark = Math.max(m.mark, 360)
        m.vuln = Math.max(m.vuln, 360)
        m.vulnPct = Math.max(m.vulnPct, 30)
      }
      break
    }
    case 'encore':
      for (let k = 0; k < p.cd.length; k++) if (k !== slot) p.cd[k] = 0
      p.focus = 100
      buffRate(p, 360, dun ? 2 : 1.5)
      // 던전: 8칸 안 동료도 6초간 연사 +50%, 나는 받는 피해 -30%
      if (dun) {
        for (const q of alliesFx(state, p, 8 * T)) if (q !== p) buffRate(q, 360, 1.5)
        p.fx[FX_PARTYDR] = Math.max(p.fx[FX_PARTYDR], 360)
      }
      break
  }
}

/** 조준 방향으로 길이 len · 반폭 halfW 의 줄 위 모든 괴물 (천사의 한 발 — 벽 · 방패를 뚫는 빛의 기둥) */
function lineAoe(state: GameState, p: PlayerState, len: number, halfW: number, dmg: number, stun: number): void {
  const dx = cosA(p.aim)
  const dy = sinA(p.aim)
  const d = Math.round(dmg * dmgMul(p) * skillPow)
  const hit: Monster[] = []
  for (const m of state.monsters) {
    if (m.hp <= 0) continue
    const rx = m.x - p.x
    const ry = m.y - p.y
    const along = rx * dx + ry * dy
    if (along < 0 || along > len) continue
    if (Math.abs(rx * dy - ry * dx) > halfW + bodyR(m)) continue
    hit.push(m)
  }
  hit.sort((a, b) => a.id - b.id)
  for (const m of hit) {
    m.stun = Math.max(m.stun, stun)
    hurtMonster(state, m, d, p.id, false, m.x, m.y)
  }
  state.events.push({ type: 'chain', x: p.x, y: p.y, x2: p.x + dx * len, y2: p.y + dy * len })
}

/** 돌진 중: 몸에 닿는 몬스터·적을 한 번씩 친다 */
function chargeHit(state: GameState, map: GameMap, p: PlayerState): void {
  aoe(state, map, p, p.x, p.y, PLAYER_RADIUS + 10, 60, { knock: 6, id: 'pancharge', quiet: true, tag: p.chargeTag })
}

/** 땅의 효과: 스포트라이트 — 안의 몬스터는 느려지고 약해지고, 안의 동료는 빨리 쏜다 */
function stepZones(state: GameState, map: GameMap): void {
  if (state.zones.length === 0) return
  let write = 0
  for (const z of state.zones) {
    // 연속 패턴의 둘째 범위: 기다렸다가 나타난다
    if (z.wait) {
      z.wait--
      state.zones[write++] = z
      continue
    }
    z.t--
    if (z.t <= 0) {
      // 보스 범위(‰ · 모양) — 여기서 바로 친다
      if (z.kind === ZONE_FUSE && (z.pm || z.kill)) bossBlast(state, map, z)
      // 몬스터 편 폭발: 대기열에 넣으면 이번 틱 runBooms 가 터뜨린다 (by -2 = 몬스터는 안 다친다)
      else if (z.kind === ZONE_FUSE) booms.push({ x: z.x, y: z.y, r: z.r, dmg: z.dmg, by: -2 })
      continue
    }
    if (z.kind === ZONE_VORTEX) {
      // 태풍: 안의 괴물을 가운데로 끌어당기고(보스는 조금) 30틱마다 친다
      const owner = state.players[z.owner]
      for (const m of state.monsters) {
        if (m.hp <= 0) continue
        const dx = z.x - m.x
        const dy = z.y - m.y
        const d = len(dx, dy)
        if (d > z.r || d < 4) continue
        const k = 1.2 * (1 - MONSTER_LIST[m.kind].knockRes)
        m.kx += (dx / d) * k
        m.ky += (dy / d) * k
      }
      if (owner && z.t % 30 === 0) aoe(state, map, owner, z.x, z.y, z.r, z.dmg, { id: 'typhoon', quiet: true })
    } else if (z.kind === ZONE_TRAP) {
      // 덫: 처음 밟은 괴물 둘레를 치고 사라진다
      const owner = state.players[z.owner]
      if (owner && state.monsters.some((m) => m.hp > 0 && m.st !== MS_SLEEP && len(m.x - z.x, m.y - z.y) <= z.r)) {
        aoe(state, map, owner, z.x, z.y, (state.mode === 'dungeon' ? 3 : 2) * TILE, z.dmg, { stun: 180, id: 'trap' })
        continue
      }
    } else if (z.kind === ZONE_ACID) {
      // 산성 웅덩이: 안에 선 사람이 주기마다 다친다 (구르는 중·무적이면 hurtPlayer 가 거른다)
      if (z.t % ACID.every === 0) {
        for (const q of state.players) {
          if (!isActive(q) || len(q.x - z.x, q.y - z.y) > z.r + PLAYER_RADIUS * 0.5) continue
          hurtPlayer(state, q, z.dmg, -1, z.x, z.y)
        }
      }
    } else if (z.kind === ZONE_SPOTLIGHT) {
      const lit = state.players[z.owner]
      if (lit && z.dmg > 0 && z.t % 30 === 0) aoe(state, map, lit, z.x, z.y, z.r, z.dmg, { id: 'spotlight', quiet: true })
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
        grid.query(Math.min(b.px, b.x) - 80, Math.min(b.py, b.y) - 80, Math.max(b.px, b.x) + 80, Math.max(b.py, b.y) + 80, (k) => {
          const m = state.monsters[k]
          if (!m || m.hp <= 0 || m.id === b.lastHit) return
          if (!segmentHitsCircle(b.px, b.py, b.x, b.y, m.x, m.y, bodyR(m))) return
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
        const blocked = applyHit(state, b, m, pointLineDistance(m.x, m.y, b.px, b.py, b.vx, b.vy))
        if (blocked) dead = true
        else if (b.pierce > 0) {
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
    // 유탄: 맞거나 벽에 닿거나 멈추면 그 자리에서 터진다 (몬스터만 — 사람은 안 다친다)
    if (dead && b.boom > 0) {
      const bw = WEAPONS[b.weapon]
      booms.push({ x: b.x, y: b.y, r: b.boom, dmg: Math.round(b.damage * b.mul * (bw.boom?.mul ?? 1)), by: b.owner, safe: true })
      state.events.push({ type: 'aoe', p: b.owner, id: 'grenade', x: b.x, y: b.y, r: b.boom })
    }
    // 맞히지 못하고 사라진 탄 → 기열란 연속 명중 한 단계 내림
    if (dead && !b.hitSomeone) state.players[b.owner].streak = Math.max(0, state.players[b.owner].streak - 1)
    if (!dead) bullets[write++] = b
  }
  bullets.length = write
}

/** 탄이 몬스터를 맞혔다. dOff = 탄 궤적과 몬스터 중심 사이 거리. 방패에 막혔으면 true (탄이 멈춘다 — 관통도 안 된다) */
function applyHit(state: GameState, b: Bullet, m: Monster, dOff: number): boolean {
  const w = WEAPONS[b.weapon]
  const def = MONSTER_LIST[m.kind]
  // 방패병: 깨어 있고 기절하지 않았으면 정면(±guard)에서 온 탄을 방패로 막는다 — 피해 조금 · 치명타·넉백·집중 없음
  if (def.guard && !b.breaker && m.st !== MS_SLEEP && m.stun === 0 && Math.abs(angleDiff(atan2A(-b.vy, -b.vx), m.aim)) <= def.guard) {
    b.hitSomeone = true
    state.events.push({ type: 'mblock', m: m.id, x: b.x, y: b.y })
    hurtMonster(state, m, Math.max(1, Math.round(b.damage * b.mul * tierOf(state.tier).guard)), b.owner, false, b.x, b.y)
    return true
  }
  const dist = len(m.x - b.ox, m.y - b.oy)
  // 치명타 = 덕의 헤드샷: 쏠 때 커서가 이 몬스터의 약점 위였고, 그 탄이 이 몬스터를 맞혔다.
  // 산탄은 정중앙을 지나는 탄만 (일곱 개가 전부 치명타가 되면 과하다). 침착 모드는 전부
  const crit = b.forceCrit || (b.critMon === m.id && (w.pellets === 1 || partForOffset(dOff, bodyR(m)) === PART_HEAD))
  const shooter = state.players[b.owner]
  let dmg = b.damage * b.mul * (crit ? headMult(w) + shooter.st[ST_CRIT] / 100 : 1) * falloff(w, dist)
  if (shooter.char === 'jupeol' && dist < JUPEOL.range) dmg *= JUPEOL.mult
  if (shooter.char === 'giyeol') dmg *= 1 + Math.min(GIYEOL.maxStacks, shooter.streak) * GIYEOL.perHit
  dmg = Math.round(dmg)
  b.hitSomeone = true
  shooter.streak = Math.min(99, shooter.streak + (shooter.fx[FX_KING] > 0 ? 2 : 1))
  const speed = len(b.vx, b.vy) || 1
  const k = w.knock * (1 - def.knockRes)
  m.kx += (b.vx / speed) * k
  m.ky += (b.vy / speed) * k
  // 탄막(철면란 E): 맞은 괴물은 잠깐 느려진다
  if (shooter.fx[FX_FREEAMMO] > 0) m.slow = Math.max(m.slow, 30)
  hurtMonster(state, m, dmg, b.owner, crit, b.x, b.y)
  {
    const sh = state.players[b.owner]
    if (sh) sh.focus = Math.min(100, sh.focus + (crit ? 4 : 2) * (1 + 0.1 * (sh.build.r[9] ?? 0)))
  }
  return false
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
  dmg *= CHAR_PVP[shooter.char] ?? 1
  // 투기장 배율 (2026-09-19 재장전을 없앤 뒤 tools/arena.ts 로 맞춘 값 — 던전 밸런스와 따로)
  dmg *= w.pvp ?? 1
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
  let kind = -1
  for (const m of state.monsters) {
    if (m.pack !== pack || m.st !== MS_SLEEP || m.hp <= 0) continue
    m.st = MS_CHASE
    // 한꺼번에 똑같이 움직이지 않게 첫 공격을 조금씩 늦춘다 (id 로 정하므로 결정론)
    m.cd = 10 + (m.id % 5) * 8
    if (kind < 0) kind = m.kind
  }
  // kind = 무리의 첫 괴물 (깨어날 때 그 괴물의 소리 — audio/sfx.ts voice)
  if (kind >= 0) state.events.push({ type: 'wake', pack, x, y, kind })
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
  // 보스 방의 보스는 **사람이 먼저** 친다 (2026-09-25 사용자: "보스방에서 AI 봇이 먼저 보스를 때리지 않도록 — 유저가 때린 후 때리도록").
  // 안 맞은 보스에게 봇 · 용병(빗나간 탄 · 범위) · 주인 없는 피해는 들지 않는다 — 깨우지도 않는다
  if (m.hitTick < 0 && isGiant(m) && !isHumanSeat(by >= 0 ? state.players[by] : undefined)) return
  // 정예·보스 피해 옵션 (옛 탄창 칸)
  const hitter = by >= 0 ? state.players[by] : undefined
  if (hitter && hitter.st[ST_ELITEDMG] > 0 && (m.elite || MONSTER_LIST[m.kind].boss)) dmg = Math.round(dmg * (1 + hitter.st[ST_ELITEDMG] / 100))
  // 약화(생중계·스포트라이트): 받는 피해 증가
  if (m.vuln > 0 && m.vulnPct > 0) dmg = Math.round(dmg * (1 + m.vulnPct / 100))
  if (m.elite & EA_STOUT) dmg = Math.max(1, Math.round(dmg * AFFIX_TUNE.stout))
  const shooter = by >= 0 ? state.players[by] : null
  if (shooter) {
    shooter.hits++
    if (crit) shooter.heads++
    shooter.dmgDealt += Math.min(dmg, m.hp)
  }
  // 우두머리: 체력이 25% 줄 때마다 큰 구슬 · 막 보스: 10% 마다 (긴 싸움에서 회복할 길 — 물약 대신, 2026-09-23 보스 싸움을 길게)
  const steps = MONSTER_LIST[m.kind].boss ? 10 : 4
  const part0 = Math.ceil((m.hp / m.maxHp) * steps)
  m.hp -= dmg
  m.hitTick = state.tick
  if (state.mode === 'dungeon' && isBossLike(m) && m.hp > 0 && Math.ceil((m.hp / m.maxHp) * steps) < part0) dropGlobe(state, m.x, m.y + 30, GLOBE_BIG_FRAC)
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
  // 후원으로 부른 보스는 그 지역의 보스가 아니다 — 처치 기록 · 다음 막 문 · 엔딩 · 퀘스트로 치지 않는다
  const summoned = m.sum !== undefined
  if (state.mode === 'dungeon' && isBossLike(m) && !summoned && !state.killed.includes(state.curArea)) {
    state.killed.push(state.curArea)
    state.events.push({ type: 'bossDown', area: state.curArea, kind: m.kind })
  }
  if (state.mode === 'dungeon' && isBossLike(m) && !summoned) questGoal(state, 'kill', state.curArea)
  // 통계: 막 보스는 그 지역에 있던 파티 모두 · 괴물 · 정예 · 고블린은 잡은 사람 (2026-09-25 업적)
  if (state.mode === 'dungeon' && def.boss && !summoned) {
    const bit = bossBit(areaDef(state.curArea).act, state.tier ?? 0)
    for (const q of state.players) if (!q.vacant && !q.left && q.area === state.curArea) q.stats.bosses |= bit
  }
  if (!suicide) {
    const killer = by >= 0 ? state.players[by] : null
    if (killer && state.mode === 'dungeon') {
      killer.stats.kills++
      if (m.elite > 0) killer.stats.elites++
      if (m.kind === GOBLIN_KIND) killer.stats.goblins++
    }
    if (killer) {
      killer.kills++
      killer.killStreak++
      if (killer.killStreak > killer.bestStreak) killer.bestStreak = killer.killStreak
      if (killer.st[ST_LIFEKILL] > 0 && isActive(killer)) killer.hp = Math.min(killer.maxHp, killer.hp + killer.st[ST_LIFEKILL])
      if (hasLeg(killer, LEG_CORPSE) && rand(state.rng) < 0.25) booms.push({ x: m.x, y: m.y, r: 70, dmg: Math.round(m.maxHp * 0.3), by: killer.id, safe: true })
      if (hasLeg(killer, LEG_FRENZY)) buffRate(killer, 180, 1.25)
      if (hasLeg(killer, LEG_AMMO)) killer.pierceShots = Math.min(6, killer.pierceShots + 3)
    }
    reward(state, m, def)
    // 체력 구슬: 졸개는 종류별 확률 ×1.5 · 정예는 하나 확정 · 우두머리·보스는 둘 (물약을 없앤 몫 — GLOBE_DROP_MUL)
    const nGlobe = isBossLike(m) ? 2 : m.elite ? 1 : rand(state.rng) < def.globe * GLOBE_DROP_MUL ? 1 : 0
    for (let k = 0; k < nGlobe; k++) dropGlobe(state, m.x + k * 20, m.y + k * 8, GLOBE_HEAL_FRAC)
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
    for (let i = 0; i < AFFIX_TUNE.splitN; i++) spawns.push({ kind: 0, x: m.x, y: m.y, pack: m.pack, hpMul: hpMul * AFFIX_TUNE.splitHp, pow: Math.round(m.pow / ELITE.pow), lvl: m.lvl })
  }
}

/** 소환 등급 */
const SUM_HORDE = 0
const SUM_ELITE = 1
const SUM_UNIQUE = 2
const SUM_BOSS = 3

/**
 * 후원 이벤트 (2026-09-23 — core/donate.ts). 입력 명령이라 모두의 판에서 같은 틱에 같게 일어난다.
 * 마을 · 투기장 · 죽어 있을 때는 없다(세션이 던전에 나갈 때까지 들고 있다).
 */
function donateCommand(state: GameState, map: GameMap, p: PlayerState, arg: number): void {
  const ev = donateEvent(arg & 15)
  const seq = arg >> 4
  if (!ev || state.mode !== 'dungeon' || isTown(p.area) || !p.alive || p.out) return
  // 사람에게 거는 효과(화면 흔들림 · 암흑 · 거꾸로 · 봉인)는 **파티 모두**에게 (2026-09-24 사용자: "후원은 어차피 스트리머 한 명에게만 온다 —
  // 같이 하는 사람들은 후원받지 못하니 효과는 모두에게"). 다른 지역에 있는 파티원도 받는다
  const party = partyOf(state, p)
  // 이어 붙는 한도는 후원을 받은 사람(방송인)이 정한 값 (CMD_DONCAP) — 이미 더 길게 걸려 있으면(다른 방송인의 한도) 줄이지 않는다
  const cap = Math.min(DON_MAX, (p.donCap ?? DON_CAP_DEFAULT) * TICK_RATE)
  const addDon = (slot: number, ticks: number) => {
    const max = slot === DON_SHAKE ? Math.min(SHAKE_MAX, cap) : cap
    for (const q of party) {
      q.don ??= new Array(DON_SLOTS).fill(0)
      q.don[slot] = Math.max(q.don[slot], Math.min(max, q.don[slot] + ticks))
    }
  }
  let lead: Monster | null = null
  switch (ev.key) {
    case 'horde':
      lead = summon(state, map, p, SUM_HORDE, seq)
      break
    case 'elite':
      lead = summon(state, map, p, SUM_ELITE, seq)
      break
    case 'unique':
      lead = summon(state, map, p, SUM_UNIQUE, seq)
      break
    case 'boss':
      lead = summon(state, map, p, SUM_BOSS, seq)
      break
    case 'hell':
      lead = summon(state, map, p, SUM_BOSS, seq)
      summon(state, map, p, SUM_UNIQUE, seq)
      summon(state, map, p, SUM_UNIQUE, seq)
      addDon(DON_DARK, HELL_DARK_TICKS)
      break
    case 'shake':
      addDon(DON_SHAKE, DON_TICKS[DON_SHAKE])
      break
    case 'dark':
      addDon(DON_DARK, DON_TICKS[DON_DARK])
      break
    case 'invert':
      addDon(DON_INVERT, DON_TICKS[DON_INVERT])
      break
    case 'seal':
      addDon(DON_SEAL, DON_TICKS[DON_SEAL])
      break
    case 'cheer': {
      // 응원 (금액 단계마다 다르다, donate.ts CHEER_EVENTS): 회복 구슬 · 같은 지역 우리 편 공격 강화 · 아군 괴물 · 초록 고리
      const c = cheerEvent(ev.id)
      if (!c) break
      state.events.push({ type: 'allyfx', p: p.id, x: p.x, y: p.y, r: 12 * TILE })
      // 공격 강화는 파티 모두 (다른 지역에 있어도) — 구슬 · 아군 괴물은 부른 사람 곁
      if (c.ticks > 0) {
        for (const q of party) {
          if (!q.alive) continue
          if (c.rate > 1) buffRate(q, c.ticks, c.rate)
          if (c.pow > 1) buffPow(q, c.ticks, c.pow)
        }
      }
      if (c.globes > 0) cheerGlobes(state, map, p, c.globes)
      if (c.allies > 0) spawnAllies(state, map, p, c, seq)
      break
    }
    case 'rage':
      // 이 지역의 살아 있는 괴물 모두 (잠든 무리까지 — 깨우면 이미 세다)
      for (const m of state.monsters) {
        if (m.hp <= 0) continue
        if (!m.rage) m.pow = Math.round(m.pow * RAGE_POW)
        m.rage = Math.max(m.rage ?? 0, RAGE_TICKS)
      }
      break
  }
  state.events.push({ type: 'donate', p: p.id, ev: ev.id, seq, m: lead ? lead.id : -1 })
}

// ---------------------------------------------------------------- 응원 (회복 구슬 · 아군 괴물)

/** 응원 회복 구슬: 부른 사람 둘레 2.5~4 칸에 고르게 (벽을 넘지 않는다). 가득이면 줍지 않고 남는다 */
function cheerGlobes(state: GameState, map: GameMap, p: PlayerState, n: number): void {
  const a0 = randInt(state.rng, 0, 1024)
  for (let i = 0; i < n; i++) {
    const a = (a0 + Math.round((i * 1024) / n)) & 1023
    const d = 80 + randInt(state.rng, 0, 48)
    const g = moveCircle(map, p.x, p.y, GLOBE_RADIUS, cosA(a) * d, sinA(a) * d)
    dropGlobe(state, g.x, g.y, GLOBE_HEAL_FRAC)
  }
}

/** 한 지역의 응원 아군 상한 (몰려도 화면 · 판이 무너지지 않게) */
export const ALLY_CAP = 12

/**
 * 아군 괴물을 부른다: 그 막의 근접 괴물(보스 단계는 그 막 보스) 모습으로 부른 사람 곁에. 피해는 그 지역 구울 체력에 맞춘다 —
 * 막 · 레벨 · 난이도 · 인원이 달라도 졸개 하나를 서너 번에 쓰러뜨린다.
 */
function spawnAllies(state: GameState, map: GameMap, p: PlayerState, c: CheerDef, seq: number): void {
  state.allies ??= []
  const act = areaDef(p.area).act
  const lvl = areaLevel(p.area, state.tier)
  const seats = state.players.length
  const ghoulHp = MONSTER_LIST[GHOUL_KIND].hp * (1 + 0.6 * Math.max(0, seats - 1)) * levelHp(lvl) * tierOf(state.tier).hp
  const melee = summonPool(act).filter((k) => MONSTER_LIST[k].attack === 'melee')
  const boss = AREAS.find((a) => a.act === act && a.boss !== undefined)?.boss
  for (let i = 0; i < c.allies && state.allies.length < ALLY_CAP; i++) {
    const kind = c.allyBoss && boss !== undefined ? boss : melee.length ? melee[randInt(state.rng, 0, melee.length)] : GHOUL_KIND
    const a = (p.aim + 512 + Math.round(((i - (c.allies - 1) / 2) * 1024) / Math.max(4, c.allies * 2))) & 1023
    const at = moveCircle(map, p.x, p.y, MONSTER_LIST[kind].r, cosA(a) * 56, sinA(a) * 56)
    const al: Ally = {
      id: state.nextMonsterId++, kind, x: at.x, y: at.y, aim: p.aim, t: c.allyTicks, cd: 20 + i * 6, target: -1, by: p.id, seq,
      dmg: Math.max(1, Math.round(ghoulHp * (c.allyBoss ? ALLY_BOSS_HIT : ALLY_HIT))), splash: c.allyBoss ? ALLY_BOSS_SPLASH : 0, moving: 0,
    }
    state.allies.push(al)
    state.events.push({ type: 'allyfx', p: p.id, x: al.x, y: al.y, r: MONSTER_LIST[kind].r * 3 })
  }
}

/**
 * 아군 괴물 한 틱: 부른 사람 둘레(ALLY_SEEK)의 가장 가까운 괴물에게 달려가 친다 · 없으면 부른 사람 곁으로 · 시간이 다 되면 사라진다.
 * 괴물은 아군을 노리지 않고, 아군은 맞지 않는다 (Ally 설명).
 */
function stepAllies(state: GameState, map: GameMap): void {
  const list = state.allies!
  let write = 0
  for (const al of list) {
    const def = MONSTER_LIST[al.kind]
    al.moving = 0
    if (--al.t <= 0) {
      state.events.push({ type: 'allyfx', p: al.by, x: al.x, y: al.y, r: def.r * 3 })
      continue
    }
    list[write++] = al
    if (al.cd > 0) al.cd--
    const owner = state.players[al.by]
    const home = owner && isActive(owner) ? owner : null
    // 표적: 10틱마다 (또는 쓰러지면) 다시 — 부른 사람 곁의, 아군에게서 보이는 괴물
    let tgt = al.target >= 0 ? state.monsters.find((m) => m.id === al.target && m.hp > 0) : undefined
    if (!tgt || (state.tick + al.id) % 10 === 0) {
      const cx = home ? home.x : al.x
      const cy = home ? home.y : al.y
      let best: Monster | undefined
      let bd = Infinity
      for (const m of state.monsters) {
        if (m.hp <= 0 || MONSTER_LIST[m.kind].attack === 'flee') continue
        // 보스 방의 보스는 사람이 먼저 친 뒤에 (응원 아군도 봇과 같다)
        if (m.hitTick < 0 && isGiant(m)) continue
        if ((m.x - cx) ** 2 + (m.y - cy) ** 2 > ALLY_SEEK * ALLY_SEEK) continue
        const d2 = (m.x - al.x) ** 2 + (m.y - al.y) ** 2
        if (d2 < bd && !rayBlocked(map, al.x, al.y, m.x, m.y)) {
          bd = d2
          best = m
        }
      }
      tgt = best
      al.target = best ? best.id : -1
    }
    const speed = Math.max(def.speed, 1.4) * 1.25
    if (tgt) {
      const dx = tgt.x - al.x
      const dy = tgt.y - al.y
      const d = len(dx, dy)
      al.aim = atan2A(dy, dx)
      const reach = def.r + MONSTER_LIST[tgt.kind].r + 12
      if (d > reach) {
        const k = Math.min(speed, d - reach + 1) / Math.max(1, d)
        const r = moveCircle(map, al.x, al.y, def.r, dx * k, dy * k)
        al.x = r.x
        al.y = r.y
        al.moving = 1
      } else if (al.cd === 0) {
        al.cd = al.splash > 0 ? ALLY_BOSS_CD : ALLY_CD
        state.events.push({ type: 'swipe', m: al.id, x: al.x, y: al.y, aim: al.aim })
        if (al.splash > 0) {
          for (const m of state.monsters) {
            if (m.hp > 0 && m !== tgt && !(m.hitTick < 0 && isGiant(m)) && (m.x - tgt.x) ** 2 + (m.y - tgt.y) ** 2 <= al.splash * al.splash) hurtMonster(state, m, Math.round(al.dmg * 0.5), al.by, false, m.x, m.y)
          }
        }
        hurtMonster(state, tgt, al.dmg, al.by, false, tgt.x, tgt.y)
      }
    } else if (home) {
      // 부른 사람 곁으로 (멀리 떨어져 길을 잃으면 곁으로 옮긴다)
      const dx = home.x - al.x
      const dy = home.y - al.y
      const d = len(dx, dy)
      if (d > 14 * TILE) {
        const g = moveCircle(map, home.x, home.y, def.r, cosA((al.id * 137) & 1023) * 48, sinA((al.id * 137) & 1023) * 48)
        al.x = g.x
        al.y = g.y
      } else if (d > 70) {
        al.aim = atan2A(dy, dx)
        const k = Math.min(speed, d - 60) / d
        const r = moveCircle(map, al.x, al.y, def.r, dx * k, dy * k)
        al.x = r.x
        al.y = r.y
        al.moving = 1
      }
    }
  }
  list.length = write
  if (write === 0) state.allies = undefined
}

/** 한 지역에 동시에 살아 있을 수 있는 후원 소환 괴물 (졸개 포함) — 후원이 몰려도 판이 무너지지 않게 */
export const SUMMON_CAP = 30

/** 막마다 부를 수 있는 괴물 종류 (막 무리 · 그 막 지역 무리에 나오는 것 — 도망치는 고블린 · 보스는 빼고) */
function summonPool(act: number): number[] {
  const set = new Set<number>()
  for (const p of ACTS[act]?.packs ?? []) for (const g of p.groups) set.add(g[0])
  for (const a of AREAS) if (a.act === act) for (const p of a.packs ?? []) for (const g of p.groups) set.add(g[0])
  return [...set].filter((k) => !MONSTER_LIST[k].boss && MONSTER_LIST[k].attack !== 'flee').sort((a, b) => a - b)
}

/**
 * 후원 소환. 부른 사람 둘레 5~8 칸에 깨어 있는 채로 나와 그 사람을 노린다. 돌려주는 것은 우두머리(없으면 null — 한도에 걸림).
 * - 좀비 떼: 이 막 졸개 여덟 · 정예: 정예 하나(접두 능력 지역 레벨만큼 + 1) + 같은 종류 셋
 * - 우두머리(중간보스): 지역 우두머리와 같은 세기(체력 ×9 · 접두 셋) + 호위 셋 · 막 보스: 이 막의 보스
 * 레벨은 지역 레벨 + 1(보스는 + 2). 전리품 · 경험치는 보통 괴물과 같다.
 */
function summon(state: GameState, map: GameMap, p: PlayerState, tier: number, seq: number): Monster | null {
  const alive = state.monsters.filter((m) => m.hp > 0 && m.sum !== undefined).length
  if (alive >= SUMMON_CAP) return null
  const act = areaDef(p.area).act
  const lvl = areaLevel(p.area, state.tier) + (tier === SUM_BOSS ? 2 : 1)
  const tr = tierOf(state.tier)
  const seats = state.players.length
  const hpMul = (1 + 0.6 * Math.max(0, seats - 1)) * levelHp(lvl) * tr.hp
  const pow = Math.round(levelPow(lvl) * tr.pow)
  const pool = summonPool(act)
  const boss = AREAS.find((a) => a.act === act && a.boss !== undefined)?.boss
  const kind = tier === SUM_BOSS && boss !== undefined ? boss : pool[randInt(state.rng, 0, pool.length)] ?? GHOUL_KIND
  const r = MONSTER_LIST[kind].r
  // 자리: 여러 방향을 재어 벽에 막히지 않고 가장 멀리 간 곳 (moveCircle — 벽을 넘지 않는다)
  let at = { x: p.x, y: p.y }
  let best = -1
  const a0 = randInt(state.rng, 0, 1024)
  for (let i = 0; i < 8; i++) {
    const a = (a0 + i * 128) & 1023
    const d = 5 * TILE + randInt(state.rng, 0, 3 * TILE)
    const g = moveCircle(map, p.x, p.y, r, cosA(a) * d, sinA(a) * d)
    const got = len(g.x - p.x, g.y - p.y)
    if (got > best) {
      best = got
      at = g
    }
    if (got >= 5 * TILE) break
  }
  const pack = 8000 + p.id * 64 + (seq & 63)
  const wake = (m: Monster, k: number): Monster => {
    m.st = MS_CHASE
    m.target = p.id
    m.cd = 60 + k * 10
    m.aim = atan2A(p.y - m.y, p.x - m.x)
    m.sum = seq + 1
    m.sumBy = p.id
    state.monsters.push(m)
    state.monstersTotal++
    return m
  }
  let lead: Monster
  if (tier === SUM_BOSS && boss !== undefined) {
    lead = wake(makeMonster(state, kind, at.x, at.y, pack, hpMul, pow, lvl), 0)
  } else if (tier === SUM_UNIQUE) {
    const u = makeMonster(state, kind, at.x, at.y, pack, hpMul * UNIQUE.hp, Math.round(pow * UNIQUE.pow), lvl)
    u.elite = rollAffixes(state.rng, 1 | EA_UNIQUE, Math.min(4, UNIQUE.affixes + tr.affix), affixSkip(kind))
    lead = wake(u, 0)
  } else if (tier === SUM_ELITE) {
    const def = MONSTER_LIST[kind]
    const e = makeMonster(state, kind, at.x, at.y, pack, hpMul * (def.eliteHp ?? ELITE.hp), Math.round(pow * ELITE.pow), lvl)
    e.elite = rollAffixes(state.rng, 1, Math.min(4, affixCount(lvl) + 1 + tr.affix), affixSkip(kind))
    lead = wake(e, 0)
  } else {
    lead = wake(makeMonster(state, kind, at.x, at.y, pack, hpMul, pow, lvl), 0)
  }
  // 호위 · 무리: 우두머리 · 정예는 같은 종류 셋, 좀비 떼는 일곱을 더 데려온다
  const more = tier === SUM_BOSS ? 0 : tier === SUM_HORDE ? 7 : 3
  for (let i = 0; i < more; i++) {
    const a = (a0 + 200 + i * 341) & 1023
    const g = moveCircle(map, at.x, at.y, r, cosA(a) * (40 + (i >> 2) * 30), sinA(a) * (40 + (i >> 2) * 30))
    wake(makeMonster(state, kind, g.x, g.y, pack, hpMul, pow, lvl), i + 1)
  }
  return lead
}

/** 분열로 나온 구울을 넣는다: 깨어 있고, 죽은 자리 둘레에 조금씩 벌려 놓는다 */
function flushSpawns(state: GameState, map: GameMap): void {
  if (spawns.length === 0) return
  const ring = [[0, -1], [0.87, 0.5], [-0.87, 0.5], [0.87, -0.5], [-0.87, -0.5], [0, 1]]
  for (let i = 0; i < spawns.length; i++) {
    const s = spawns[i]
    const d = ring[i % ring.length]
    const far = 1 + Math.floor(i / 6)
    const r = moveCircle(map, s.x, s.y, MONSTER_LIST[s.kind].r, d[0] * 14 * far, d[1] * 14 * far)
    const g = makeMonster(state, s.kind, r.x, r.y, s.pack, s.hpMul, s.pow, s.lvl)
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
function spill(state: GameState, p: PlayerState, x: number, y: number, lvl: number, golds: number, goldK: number, items: number, src: LootSource, up: number, minFirst: number): void {
  const at = () => ({ x: x + (rand(state.rng) - 0.5) * 60, y: y + (rand(state.rng) - 0.5) * 60 })
  for (let k = 0; k < golds; k++) {
    const g = Math.max(1, Math.round((4 + 1.3 * lvl) * goldK * (0.6 + rand(state.rng) * 0.8)))
    const a = at()
    state.drops.push({ id: state.nextDropId++, owner: p.id, x: a.x, y: a.y, item: null, gold: g, pot: 0, ttl: 60 * 120, lock: 12 })
  }
  for (let k = 0; k < items; k++) {
    const item = rollItem(state.rng, state.nextItemUid++, lvl, p.weapon, src, up, k === 0 ? minFirst : 0)
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
    // 레벨 차이: 괴물보다 5 레벨 넘게 높으면 경험치가 확 준다 (xpGapMul — 낮은 곳에서 오래 잡아 올리지 못하게)
    gainXp(state, p, Math.round(xpFor(m) * xpGapMul(p.level, m.lvl) * (1 + p.st[ST_XP] / 100) * (p.shrineT > 0 && p.shrine === 2 ? 1.5 : 1)))
    // 전리품 (GUIDE 9장): 졸개는 골드 더미 35% · 아이템 10~16%(일반·마법만) / 정예는 골드 둘 · 아이템 1~2(희귀·전설도) /
    // 우두머리·보스는 **전리품 분수** — 골드 다섯 · 아이템 3~4(보스 5~6), 첫 아이템은 희귀 이상, 신화가 드물게 (items.ts DROP_TABLE).
    // 사람마다 따로 굴리고, 주인에게만 보이고 주인만 줍는다 (디아블로 3·4 개인 전리품)
    const lvl = Math.max(1, areaLevel(state.curArea, state.tier))
    const boss = !!def.boss
    const fountain = boss || unique || m.kind === GOBLIN_KIND
    const golds = m.kind === GOBLIN_KIND ? 8 : fountain ? 5 : m.elite ? 2 : rand(state.rng) < 0.35 ? 1 : 0
    const items = boss ? 5 + (rand(state.rng) < 0.5 ? 1 : 0) : unique ? 3 + (rand(state.rng) < 0.5 ? 1 : 0) : m.elite ? 1 + (rand(state.rng) < 0.4 ? 1 : 0) : rand(state.rng) < def.loot ? 1 : 0
    const tier = tierOf(state.tier)
    const src: LootSource = fountain ? 'boss' : m.elite ? 'elite' : 'normal'
    // 첫 아이템 희귀 이상 확정은 막 보스만 (우두머리 · 보물 고블린은 뺐다 — 2026-09-24 "저렙에서도 희귀 · 전설이 너무 쉽다")
    spill(state, p, m.x, m.y, lvl, golds, (fountain ? 3 : m.elite ? 2 : 1) * tier.gold, items, src, tier.loot, boss ? 2 : 0)
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
  // 용병은 UI 가 없으니 능력치 포인트를 추천대로 스스로 쓴다
  if (p.merc >= 0) autoAttr(p)
  recalc(p)
  // 레벨이 오르면 체력이 가득 찬다 (디아블로)
  if (p.alive && !p.downed) p.hp = p.maxHp
  state.events.push({ type: 'levelup', p: p.id, level: p.level })
}

/** 자석: 내 골드·아이템은 2칸 안이면 끌려와 줍는다 (2026-09-19 "밟는 건 이동이 너무 많다 — 2칸쯤은 자석처럼") */
const MAGNET_R = 2 * TILE
const MAGNET_SPEED = 8

/**
 * 줍기: 골드 더미 · **내 아이템 중 자동 줍기를 켠 등급**(가방에 자리가 있으면). 2칸(MAGNET_R) 안이면 끌려와서 닿으면 줍는다.
 * 버려진 것·남에게 준 것(주인 -1) 아이템은 자동으로 줍지 않는다 — 버리자마자 도로 줍게 된다. 그런 것과 끈 등급은 F (pickItem).
 */
function pickUp(state: GameState, p: PlayerState): void {
  if (!isActive(p)) return
  const R2 = (PLAYER_RADIUS + 14) ** 2
  const RI2 = (PLAYER_RADIUS + 22) ** 2
  let full = false
  for (let i = state.drops.length - 1; i >= 0; i--) {
    const d = state.drops[i]
    if (d.lock > 0) continue
    const want = d.item ? d.owner === p.id && ((p.autoPick >> d.item.rarity) & 1) === 1 : d.owner === p.id || d.owner === -1
    if (!want) continue
    const dx = d.x - p.x
    const dy = d.y - p.y
    const dd = dx * dx + dy * dy
    if (dd > MAGNET_R * MAGNET_R) continue
    if (d.item && p.bag.length >= p.bagMax) {
      full = true
      continue
    }
    // 아직 닿지 않았으면 끌려온다 (틱마다 MAGNET_SPEED px)
    if (dd > (d.item ? RI2 : R2)) {
      const dist = Math.sqrt(dd)
      const k = Math.min(1, MAGNET_SPEED / dist)
      d.x -= dx * k
      d.y -= dy * k
      continue
    }
    if (d.item) {
      takeItem(state, p, i)
      continue
    }
    if (d.gold > 0) {
      const g = hasLeg(p, LEG_GOLD) ? Math.round(d.gold * 1.5) : d.gold
      p.gold += g
      p.goldGain += g
      p.stats.gold += g
      if (hasLeg(p, LEG_GOLD)) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.02)
      state.events.push({ type: 'gold', p: p.id, n: g, x: d.x, y: d.y })
    } else if (d.pot > 0) {
      if (p.potions >= p.potMax) continue
      p.potions++
      state.events.push({ type: 'potGet', p: p.id, x: d.x, y: d.y })
    }
    state.drops.splice(i, 1)
  }
  if (full && state.tick % 120 === 0) state.events.push({ type: 'bagFull', p: p.id })
}

/** 체력 구슬 하나 (곁의 동료도 조금 — share) */
function dropGlobe(state: GameState, x: number, y: number, frac: number): void {
  state.globes.push({ id: state.nextGlobeId++, x, y, ttl: GLOBE_TTL, heal: Math.round(frac * 100), share: true })
  state.events.push({ type: 'drop', x, y })
}

/** 바닥의 아이템 하나(drops[i])를 가방에 */
function takeItem(state: GameState, p: PlayerState, i: number): void {
  const it = state.drops[i].item!
  p.bag.push(it)
  p.found++
  if (it.rarity > p.bestFound) p.bestFound = it.rarity
  if (it.rarity === 3) p.stats.legends++
  else if (it.rarity >= 4) p.stats.mythics++
  state.drops.splice(i, 1)
  state.events.push({ type: 'pickup', p: p.id, rarity: it.rarity, uid: it.uid })
}

/** F: 가장 가까운 내 아이템(또는 버려진 것)을 줍는다 (가방이 차면 못 줍는다) */
function pickItem(state: GameState, p: PlayerState): boolean {
  if (p.bag.length >= p.bagMax) return false
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
  takeItem(state, p, best)
  return true
}

/** 가방·장비 명령 (Input.cmd). 무기는 내 무기 종류만 낀다 */
function runCommand(state: GameState, map: GameMap, p: PlayerState, cmd: number, arg: number): void {
  if (p.left) return
  if ((cmd >= CMD_SELL && cmd <= CMD_STASH_TAKE) || cmd === CMD_UPGRADE || cmd === CMD_FORGE || cmd === CMD_SELL_ALL || cmd === CMD_BAGUP || cmd === CMD_STASHUP || cmd === CMD_SHOPNEW) {
    townCommand(state, p, cmd, arg)
    return
  }
  if (cmd === CMD_SORT) {
    // 가방은 어디서나, 보관함은 보관함 곁에서 (2026-09-20 요청)
    if (arg === 0) p.bag = sortItems(p.bag)
    else if (npcNear(p.area, p.x, p.y) === 'stash') p.stash = sortItems(p.stash)
    return
  }
  if (cmd === CMD_DONATE) {
    donateCommand(state, map, p, arg)
    return
  }
  if (cmd === CMD_LOCK) {
    const it = p.bag[arg]
    if (it) {
      if (it.lk) delete it.lk
      else it.lk = 1
    }
    return
  }
  if (cmd === CMD_QUEST) {
    questCommand(state, p, arg)
    return
  }
  if (cmd === CMD_AUTOPICK) {
    p.autoPick = arg & AUTOPICK_ALL
    return
  }
  if (cmd === CMD_DONCAP) {
    const s = arg * 10
    if (DON_CAP_CHOICES.includes(s)) p.donCap = s
    return
  }
  if (cmd === CMD_ATTR) {
    attrCommand(state, p, arg)
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
    if (it.slot === SLOT_WEAPON && WEAPONS[WEAPON_IDS[it.wt]]?.family !== WEAPONS[CHARACTERS[p.char].weapon].family) return
    const old = p.equip[it.slot]
    p.equip[it.slot] = it
    if (old) p.bag[arg] = old
    else p.bag.splice(arg, 1)
    recalc(p)
    state.events.push({ type: 'equip', p: p.id, slot: it.slot })
  } else if (cmd === CMD_UNEQUIP) {
    const it = p.equip[arg]
    if (!it || p.bag.length >= p.bagMax) return
    p.equip[arg] = null
    p.bag.push(it)
    recalc(p)
    state.events.push({ type: 'equip', p: p.id, slot: arg })
  } else if (cmd === CMD_DROP) {
    const it = p.bag[arg]
    if (!it || !p.alive || it.lk) return
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
    grid.query(b.x - b.r - 80, b.y - b.r - 80, b.x + b.r + 80, b.y + b.r + 80, (i) => {
      const m = state.monsters[i]
      if (!m || m.hp <= 0) return
      if (len(m.x - b.x, m.y - b.y) > b.r + bodyR(m)) return
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

function nearestActive(state: GameState, x: number, y: number, plain = false): number {
  let best = -1
  let bestD = Infinity
  for (const p of state.players) {
    if (!isActive(p)) continue
    // 탱커는 괴물이 먼저 노린다 (던전): 거리를 0.63배로 본다. 보스(plain)는 그냥 가까운 사람 — 누구든 같게 맞는다
    const d = ((p.x - x) ** 2 + (p.y - y) ** 2) * (!plain && roleOn && roleOf(p) === 'tank' ? 0.4 : 1)
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
    if (m.rage && --m.rage === 0) m.pow = Math.round(m.pow / RAGE_POW)
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
    // 보스는 상태 이상이 먹히지 않는다 (틱 끝에도 한 번 더 지운다 — bossImmune)
    if (def.boss) clearCc(m)
    if (m.slow > 0) m.slow--
    if (m.taunt > 0) m.taunt--
    // 넉백: 벽에 막히며 밀리고 금방 줄어든다
    if (m.kx !== 0 || m.ky !== 0) {
      const r = moveCircle(map, m.x, m.y, bodyR(m), m.kx, m.ky)
      m.x = r.x
      m.y = r.y
      m.kx *= 0.72
      m.ky *= 0.72
      if (Math.abs(m.kx) < 0.05) m.kx = 0
      if (Math.abs(m.ky) < 0.05) m.ky = 0
    }
    if (m.stun > 0) {
      m.stun--
      // 기절하면 하던 공격 예고도 끊긴다
      if (m.st === MS_WINDUP || m.st === MS_CHARGE) {
        m.st = MS_CHASE
        m.mode = 0
        m.cd = Math.max(m.cd, 20)
      }
      continue
    }
    if (m.cd > 0) m.cd--
    if (m.scd > 0) m.scd--
    if (m.kcd !== undefined && m.kcd > 0) m.kcd--
    // 표적: 가장 가까운 움직일 수 있는 사람. 30틱마다 다시 고른다 (쓰러지면 바로). 도발 중이면 그대로
    const tauntOk = m.taunt > 0 && m.target >= 0 && isActive(state.players[m.target])
    if (!tauntOk && (m.target < 0 || !isActive(state.players[m.target]) || (tick + m.id) % 30 === 0)) m.target = nearestActive(state, m.x, m.y, !!def.boss)
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
    if (def.boss) bossStage(state, m, def)

    if (m.st === MS_CHARGE) {
      if (m.pat === PAT.leap) {
        // 여왕 도약: 예고 때 정한 자리로 날아간다 (내려앉는 원이 친다 — 몸으로는 안 친다)
        const left = Math.max(1, m.t)
        const r = moveCircle(map, m.x, m.y, bodyR(m), (m.ax - m.x) / left, (m.ay - m.y) / left)
        m.x = r.x
        m.y = r.y
        m.moving = 1
        if (--m.t <= 0) bossDone(state, m, def, 24)
        continue
      }
      // 도살자 돌진: 정한 방향으로 곧게, 닿는 사람을 한 번씩 치고 옆으로 밀쳐 낸다
      const sp = BP.charge.speed
      const r = moveCircle(map, m.x, m.y, bodyR(m), cosA(m.aim) * sp, sinA(m.aim) * sp)
      const blocked = Math.abs(r.x - m.x) + Math.abs(r.y - m.y) < sp * 0.3
      m.x = r.x
      m.y = r.y
      m.moving = 1
      for (const p of state.players) {
        if (!isActive(p) || ((m.hitMask ?? 0) >> p.id) & 1 || len(p.x - m.x, p.y - m.y) > bodyR(m) + PLAYER_RADIUS + 4) continue
        if (hurtPct(state, p, bossPm(state, m, BP.charge.pm), m.id, m.x, m.y)) {
          m.hitMask = (m.hitMask ?? 0) | (1 << p.id)
          const side = -(p.x - m.x) * sinA(m.aim) + (p.y - m.y) * cosA(m.aim) >= 0 ? 1 : -1
          const a = (m.aim + side * 256) & 1023
          const q = moveCircle(map, p.x, p.y, PLAYER_RADIUS, cosA(a) * 40, sinA(a) * 40)
          p.x = q.x
          p.y = q.y
        }
      }
      if (--m.t <= 0 || blocked) bossDone(state, m, def, 40)
      continue
    }
    if (m.st === MS_CHASE) {
      m.aim = turnToward(m.aim, face, def.guard ? Math.max(1, Math.round(TURN * GUARD.turn)) : TURN)
      // 보스 방의 막 보스는 **먼저 맞기 전에는** 움직이지도 · 치지도 · 패턴을 쓰지도 않는다 — 깨어나 바라보기만 (2026-09-24 사용자:
      // "보스가 먼저 다가와 입구를 막으니 들어가지도 무빙도 못 하고 즉사기를 맞고 죽어야 한다"). 즉사기 시계(kcd)도 첫 패턴 때부터 센다
      if (isGiant(m) && m.hitTick < 0) {
        m.moving = 0
        continue
      }
      // 막 보스: 정해진 차례로 패턴 (monsters.ts BOSS_PLANS)
      if (def.boss && bossThink(state, map, m, def, tp, d)) continue
      // 그림자: 떨어진 표적의 등 뒤로 순간이동 (mode 2 — 나타날 자리는 예고 때 정한다: 표적 자리에서 등 쪽으로 밀어 벽을 피한다)
      if (def.special === 'blink' && m.scd === 0 && m.los === 1 && d > BLINK.min && d < BLINK.max) {
        const to = moveCircle(map, tp.x, tp.y, def.r, (dx / d) * BLINK.behind, (dy / d) * BLINK.behind)
        // 벽에 겹치거나 표적에게서 안 보이는 자리면 건너뛴다 (벽 속에 나타나면 쏠 수도 닿을 수도 없게 된다 — D7 계측에서 봇이 멈췄다)
        if (isWallAt(map, to.x, to.y) || rayBlocked(map, tp.x, tp.y, to.x, to.y) || circleHitsWall(map, to.x, to.y, def.r)) {
          m.scd = 60
        } else {
        m.st = MS_WINDUP
        m.mode = 2
        m.t = BLINK.windup
        m.aim = face
        m.ax = to.x
        m.ay = to.y
        state.events.push({ type: 'windup', m: m.id, kind: m.kind, x: m.x, y: m.y })
        continue
        }
      }
      // 강령술사: 무리가 줄었으면 구울을 일으킨다 (mode 3)
      if (def.special === 'raise' && m.scd === 0 && m.los === 1 && d < 420 && packAlive(state, m) < RAISE.max) {
        m.st = MS_WINDUP
        m.mode = 3
        m.t = RAISE.windup
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
        attack = m.cd === 0 && m.los === 1 && d - bodyR(m) - PLAYER_RADIUS <= def.range
      } else if (def.attack === 'ranged' || def.attack === 'lob') {
        attack = m.cd === 0 && m.los === 1 && d <= def.range
        const keep = def.keepDist ?? 200
        if (m.los === 1 && d < keep * 0.65) away = true
        else if (m.los === 1 && d <= keep) hold = true
      } else if (def.attack === 'heal') {
        // 주술사: 다친 동료가 곁에 있으면 고친다. 사람과는 거리를 둔다
        attack = m.cd === 0 && hasWounded(state, m, def.range)
        const keep = def.keepDist ?? 240
        if (m.los === 1 && d < keep * 0.7) away = true
        else if (m.los === 1 && d <= keep) hold = true
      } else if (def.attack === 'flee') {
        // 보물 고블린: **들킨 뒤부터** 도망친다 — 골드를 흘리고, 오래 버티면 사라진다 (t = 들킨 뒤 틱 — 예고·회복 상태를 쓰지 않아 비어 있다).
        // 2026-09-24 사용자: "실제 만나기도 전에 도망갔다고 뜬다" — 총소리에 깨어(벽 너머로도) 곧장 시계가 돌았다.
        // 이제 사람이 보이는 거리(GOBLIN.seen)에서 벽 없이 마주쳐야 들킨다 — 그 전에는 제자리에서 기다린다
        // 2026-09-25 사용자: "난 보이지도 않았는데 이미 도망갔대" — 멀리 간 봇이 먼저 보아 시계가 돌았다. **사람**이 보아야 들킨다
        if (!m.seen) {
          const seenBy = state.players.some((q) => isHumanSeat(q) && isActive(q) && len(q.x - m.x, q.y - m.y) <= GOBLIN.seen && !rayBlocked(map, q.x, q.y, m.x, m.y))
          if (!seenBy) continue
          m.seen = 1
          state.events.push({ type: 'goblinSeen', x: m.x, y: m.y })
        }
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
    } else if (m.st === MS_WINDUP && m.mode >= 2 && def.boss && (m.pat ?? -1) >= 0) {
      // 보스 패턴 예고: 범위는 예고를 시작할 때 깔았다 (그 자리에서 버틴다 — 상태 이상이 안 먹혀 끊기지도 않는다)
      if (--m.t <= 0) bossRelease(state, m, def)
    } else if (m.st === MS_WINDUP && m.mode >= 2) {
      // 보스 특수 예고: 끝나면 부채 · 새끼 (방향은 예고 시작 때 정했다 — 예고선 밖으로 비키면 산다)
      if (--m.t <= 0) {
        if (def.special === 'blink') {
          state.events.push({ type: 'blink', m: m.id, x0: m.x, y0: m.y, x: m.ax, y: m.ay })
          m.x = m.ax
          m.y = m.ay
          m.scd = BLINK.every
          m.cd = 0
        } else {
          summonKind(state, m, GHOUL_KIND, RAISE.n, RAISE.max, RAISE.hp)
          m.scd = RAISE.every
        }
        m.st = MS_RECOVER
        // 순간이동한 그림자는 곧장 덤빈다
        m.t = def.special === 'blink' ? 6 : 30
        m.mode = 0
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
  if (m.rage) speed *= RAGE_SPEED
  if (def.boss) speed *= BOSS_PLANS[def.id]?.speed[m.stage] ?? 1
  if (m.slow > 0) speed *= 0.5
  const r = moveCircle(map, m.x, m.y, bodyR(m), dirX * speed, dirY * speed)
  m.x = r.x
  m.y = r.y
  m.moving = 1
}

/** 곁에 (보스·우두머리가 아닌) 다친 동료가 있나 */
function hasWounded(state: GameState, m: Monster, r: number): boolean {
  for (const o of state.monsters) {
    if (o === m || o.hp <= 0 || o.st === MS_SLEEP || o.hp >= o.maxHp * 0.8 || isBossLike(o)) continue
    if (len(o.x - m.x, o.y - m.y) <= r) return true
  }
  return false
}

// ================================================================ 보스 패턴 (2026-09-23)
// 사용자: "보스는 각자 가진 특별한 패턴 · 퍼센트 데미지 · 넉백을 포함한 모든 상태 이상이 먹히지 않게 · 적어도 3가지 일정한 패턴 — 피하지 않으면 클리어가 어렵게".
// 정해진 차례(BOSS_PLANS.order)로 돈다. 범위는 예고를 시작할 때 땅에 깔고(ZONE_FUSE + pm · 모양), 예고가 끝나는 틱에 터진다.

/** 보스 ‰: 패턴 값 × 난이도 × (후원 광폭화) */
function bossPm(state: GameState, m: Monster, base: number): number {
  const tier = BOSS_TIER_PM[Math.max(0, Math.min(BOSS_TIER_PM.length - 1, state.tier ?? 0))]
  return Math.round(base * tier * (m.rage ? BOSS_RAGE_PM : 1))
}

/** 상태 이상 지우기: 기절 · 둔화 · 넉백(끌어당김 포함) · 도발. 받는 피해 증가 · 드러남은 남긴다 (상태 이상이 아니라 표시 · 약점) */
function clearCc(m: Monster): void {
  m.stun = 0
  m.slow = 0
  m.kx = 0
  m.ky = 0
  m.taunt = 0
}

/** 틱 끝: 이번 틱에 탄 · 스킬 · 폭발이 건 상태 이상을 보스에게서 지운다 (화면에 한 틱도 남지 않게) */
function bossImmune(state: GameState): void {
  for (const m of state.monsters) if (m.hp > 0 && MONSTER_LIST[m.kind].boss) clearCc(m)
}

/** 보스 단계: 체력이 정한 비율 아래로 내려가는 순간 분노 — 차례가 길어지고 간격이 짧아진다. 여왕 · 관리인 · 군주는 졸개를 부른다 */
function bossStage(state: GameState, m: Monster, def: MonsterDef): void {
  const plan = BOSS_PLANS[def.id]
  if (!plan) return
  const k = m.hp / m.maxHp
  let stage = 0
  for (const t of plan.stages) if (k <= t) stage++
  if (stage <= m.stage) return
  m.stage = stage
  state.events.push({ type: 'bossRage', m: m.id, kind: m.kind, stage, x: m.x, y: m.y })
  if (def.id === 'lord') summonKind(state, m, SHADE_KIND, LORD.shades, LORD.shadeMax, LORD.shadeHp)
  else if (def.id === 'queen') summonKind(state, m, SPIDER_KIND, QUEEN.brood, QUEEN.broodMax, QUEEN.broodHp)
  else if (def.id === 'warden') summonKind(state, m, SHIELD_KIND, WARDEN.guards, WARDEN.guardMax, WARDEN.guardHp)
  m.scd = Math.min(m.scd, 30)
}

/** 패턴을 쓸 때인가 → 차례대로 다음 패턴 (쓸 수 없는 것은 건너뛴다). 시작했으면 true */
function bossThink(state: GameState, map: GameMap, m: Monster, def: MonsterDef, tp: PlayerState, d: number): boolean {
  const plan = BOSS_PLANS[def.id]
  if (!plan || m.scd > 0 || m.los !== 1 || d > 620) return false
  // 즉사기: 차례와 따로 센다 (처음 깨어 패턴을 쓸 때부터 BOSS_ULT_CD.first 뒤 · 그다음은 단계마다 every)
  const ult = BOSS_ULT[def.id]
  if (ult) {
    if (m.kcd === undefined) m.kcd = BOSS_ULT_CD.first
    else if (m.kcd <= 0 && bossStart(state, map, m, def, ult, tp)) {
      m.kcd = BOSS_ULT_CD.every[Math.min(m.stage, BOSS_ULT_CD.every.length - 1)]
      return true
    }
  }
  const order = plan.order[Math.min(m.stage, plan.order.length - 1)]
  for (let k = 0; k < order.length; k++) {
    if (!bossStart(state, map, m, def, order[(m.phase + k) % order.length], tp)) continue
    m.phase += k + 1
    return true
  }
  // 지금은 쓸 것이 없다 (다 멀다 · 부를 자리가 없다) — 조금 뒤에 다시 본다
  m.scd = 30
  return false
}

/** 조건에 맞는 사람 중 하나: 가장 먼 (far) · 아무나 (rng) — 보스가 보이는 사람만 */
function bossPick(state: GameState, map: GameMap, m: Monster, min: number, max: number, how: 'far' | 'any'): PlayerState | null {
  const ok: PlayerState[] = []
  for (const p of state.players) {
    if (!isActive(p)) continue
    const d = len(p.x - m.x, p.y - m.y)
    if (d < min || d > max || rayBlocked(map, m.x, m.y, p.x, p.y)) continue
    ok.push(p)
  }
  if (ok.length === 0) return null
  if (how === 'any') return ok[randInt(state.rng, 0, ok.length)]
  let best = ok[0]
  for (const p of ok) if (len(p.x - m.x, p.y - m.y) > len(best.x - m.x, best.y - m.y)) best = p
  return best
}

/** 사람이 조작하는 자리인가 (state.ts 로 옮겼다 — bot.ts 도 쓴다) */
export { isHumanSeat }

/** 잡은 막 보스(막 보스 퀘스트를 마친 막)의 보스 방 웨이포인트 비트 */
function bossRoomWps(quests: number[] | undefined): number {
  let w = 0
  for (let a = 0; a < ACTS.length; a++) {
    if ((quests?.[actBossQuest(a)] ?? 0) < 2) continue
    const room = AREAS.find((d) => d.act === a && d.boss !== undefined)
    if (room) w |= wpBit(room.id)
  }
  return w
}

/** 보스 범위 하나를 깐다 (몬스터 편 · 사람만 다친다) */
function bossZone(state: GameState, m: Monster, z: Omit<Zone, 'id' | 'kind' | 'owner' | 'max' | 'dmg'> & { kind?: number }): void {
  state.zones.push({ id: state.nextFxId++, kind: z.kind ?? ZONE_FUSE, owner: -1, max: z.t, dmg: 0, from: m.id, ...z })
}

/**
 * 패턴 시작: 예고 범위를 깔고 예고(MS_WINDUP · mode 2)에 들어간다. 쓸 수 없으면 false (아무것도 바꾸지 않는다).
 * 거리와 상관없이 늘 쓴다 — 차례가 흔들리지 않게 (거리로 거르면 근접 캐릭터 앞에서 회전 베기만 되풀이했다). 못 쓰는 것은 부를 자리가 없을 때 · 보이는 사람이 없을 때뿐
 */
function bossStart(state: GameState, map: GameMap, m: Monster, _def: MonsterDef, id: BossPatId, tp: PlayerState): boolean {
  const W = BOSS_PATS[PAT[id]].windup
  let aim = atan2A(tp.y - m.y, tp.x - m.x)
  let ax = tp.x
  let ay = tp.y
  const pm = (v: number) => bossPm(state, m, v)
  switch (id) {
    case 'charge': {
      // 돌진: 가장 먼 사람에게 (멀리 있는 사람이 없으면 곁의 사람에게라도) — 가는 길을 예고한다 (몸으로 치므로 길은 예고만)
      const t = bossPick(state, map, m, BP.charge.min, BP.charge.max, 'far') ?? bossPick(state, map, m, 0, BP.charge.max, 'far')
      if (!t) return false
      aim = atan2A(t.y - m.y, t.x - m.x)
      ax = t.x
      ay = t.y
      bossZone(state, m, { kind: ZONE_WARN, x: m.x, y: m.y, shape: ZS_LINE, a: aim, len: BP.charge.speed * BP.charge.ticks + bodyR(m), r: bodyR(m) + PLAYER_RADIUS, t: W })
      break
    }
    case 'spin':
      bossZone(state, m, { x: m.x, y: m.y, r: BP.spin.r, t: W, pm: pm(BP.spin.pm) })
      break
    case 'hook': {
      // 갈고리: 가장 먼 사람에게 줄 — 맞으면 도살자 앞으로 끌려온다(그리고 곧장 칼질)
      const t = bossPick(state, map, m, 90, BP.hook.len, 'far') ?? bossPick(state, map, m, 0, BP.hook.len, 'far')
      if (!t) return false
      aim = atan2A(t.y - m.y, t.x - m.x)
      bossZone(state, m, { x: m.x, y: m.y, shape: ZS_LINE, a: aim, len: BP.hook.len, r: BP.hook.w, t: W, pm: pm(BP.hook.pm), pull: m.id })
      break
    }
    case 'meat':
      // 고기 비: 사람마다 발밑 하나 + 도살자 둘레 셋
      for (const p of state.players) if (isActive(p)) bossZone(state, m, { x: p.x, y: p.y, r: BP.meat.r, t: W, pm: pm(BP.meat.pm) })
      for (let i = 0; i < BP.meat.extra; i++) {
        const a = randInt(state.rng, 0, 1024)
        const q = moveCircle(map, m.x, m.y, BP.meat.r * 0.5, cosA(a) * (90 + rand(state.rng) * 170), sinA(a) * (90 + rand(state.rng) * 170))
        bossZone(state, m, { x: q.x, y: q.y, r: BP.meat.r, t: W, pm: pm(BP.meat.pm) })
      }
      break
    case 'fan':
      break
    case 'leap': {
      // 도약: 아무나 한 사람의 발밑 — 원이 차오르면 여왕이 내려앉는다
      const t = bossPick(state, map, m, 0, BP.leap.max, 'any')
      if (!t) return false
      aim = atan2A(t.y - m.y, t.x - m.x)
      ax = t.x
      ay = t.y
      bossZone(state, m, { x: ax, y: ay, r: BP.leap.r, t: W + BP.leap.fly, pm: pm(BP.leap.pm) })
      break
    }
    case 'brood':
      if (packAlive(state, m) >= QUEEN.broodMax) return false
      break
    case 'venom':
      // 독 안개: 둘레 고리 — 여왕 곁(안쪽 원)만 안전하다
      bossZone(state, m, { x: m.x, y: m.y, shape: ZS_RING, r2: BP.venom.r2, r: BP.venom.r, t: W, pm: pm(BP.venom.pm) })
      break
    case 'sweep':
      // 앞뒤 휘두르기: 앞 부채가 터지면 곧바로 뒤 부채
      bossZone(state, m, { x: m.x, y: m.y, shape: ZS_CONE, a: aim, arc: BP.sweep.arc, r: BP.sweep.r, t: W, pm: pm(BP.sweep.pm) })
      bossZone(state, m, { x: m.x, y: m.y, shape: ZS_CONE, a: (aim + 512) & 1023, arc: BP.sweep.arc, r: BP.sweep.r, wait: W, t: BP.sweep.back, pm: pm(BP.sweep.pm) })
      break
    case 'slam':
      bossZone(state, m, { x: m.x, y: m.y, r: BP.slam.r, t: W, pm: pm(BP.slam.pm) })
      break
    case 'cross':
      // 충격파 십자: 네 갈래 → 비스듬히 네 갈래 (갈래 사이로 비킨 뒤 다시 비킨다)
      for (let k = 0; k < 4; k++) {
        bossZone(state, m, { x: m.x, y: m.y, shape: ZS_LINE, a: (aim + k * 256) & 1023, len: BP.cross.len, r: BP.cross.w, t: W, pm: pm(BP.cross.pm) })
        bossZone(state, m, { x: m.x, y: m.y, shape: ZS_LINE, a: (aim + 128 + k * 256) & 1023, len: BP.cross.len, r: BP.cross.w, wait: W, t: BP.cross.second, pm: pm(BP.cross.pm) })
      }
      break
    case 'guards':
      if (packAlive(state, m) >= WARDEN.guardMax) return false
      break
    case 'quake':
      // 여진: 안에서 밖으로 퍼지는 고리 셋 — 이미 터진 안쪽으로 들어가면 산다
      for (let i = 0; i < BP.quake.n; i++) {
        const r2 = i * BP.quake.ring
        bossZone(state, m, { x: m.x, y: m.y, shape: i === 0 ? ZS_CIRCLE : ZS_RING, r2, r: r2 + BP.quake.ring, wait: i * BP.quake.gap, t: W, pm: pm(BP.quake.pm) })
      }
      break
    case 'nova':
      break
    case 'meteor':
      // 불비: 사람마다 발밑 하나 + 곁 하나
      for (const p of state.players) {
        if (!isActive(p)) continue
        const a = randInt(state.rng, 0, 1024)
        const r = 50 + rand(state.rng) * 60
        for (const [x, y] of [[p.x, p.y], [p.x + cosA(a) * r, p.y + sinA(a) * r]]) bossZone(state, m, { x, y, r: BP.meteor.r, t: W, pm: pm(BP.meteor.pm) })
      }
      break
    case 'spokes': {
      // 심연 광선: 여섯 갈래 (마지막 단계는 비스듬히 한 번 더)
      const n = BP.spokes.n
      for (let k = 0; k < n; k++) {
        const a = (aim + Math.round((k * 1024) / n)) & 1023
        bossZone(state, m, { x: m.x, y: m.y, shape: ZS_LINE, a, len: BP.spokes.len, r: BP.spokes.w, t: W, pm: pm(BP.spokes.pm) })
        if (m.stage >= 2) bossZone(state, m, { x: m.x, y: m.y, shape: ZS_LINE, a: (a + Math.round(512 / n)) & 1023, len: BP.spokes.len, r: BP.spokes.w, wait: W, t: BP.spokes.second, pm: pm(BP.spokes.pm) })
      }
      break
    }
    case 'hellfire':
      // 지옥불: 가까이(원)가 먼저 터지고, 곧바로 멀리(고리) — 밖으로 빠졌다가 다시 안으로
      bossZone(state, m, { x: m.x, y: m.y, r: BP.hellfire.r, t: W, pm: pm(BP.hellfire.pm) })
      bossZone(state, m, { x: m.x, y: m.y, shape: ZS_RING, r2: BP.hellfire.r, r: BP.hellfire.outer, wait: W, t: BP.hellfire.second, pm: pm(BP.hellfire.pm) })
      break
    case 'shades':
      if (packAlive(state, m) >= LORD.shadeMax) return false
      break
    // ---- 즉사기 (kill: 맞으면 무조건 쓰러진다)
    case 'slaughter':
      bossZone(state, m, { x: m.x, y: m.y, r: BP.slaughter.r, t: W, kill: true })
      break
    case 'webdoom':
      bossZone(state, m, { x: m.x, y: m.y, shape: ZS_RING, r2: BP.webdoom.r2, r: BP.webdoom.r, t: W, kill: true })
      break
    case 'execute':
      bossZone(state, m, { x: m.x, y: m.y, shape: ZS_CONE, a: aim, arc: BP.execute.arc, r: BP.execute.r, t: W, kill: true })
      break
    case 'abyss': {
      // 빛 원: 군주에게서 dist 떨어진 곳 (벽을 넘지 않게) — 그 원 안만 안전
      const a = randInt(state.rng, 0, 1024)
      const s = moveCircle(map, m.x, m.y, BP.abyss.r2, cosA(a) * BP.abyss.dist, sinA(a) * BP.abyss.dist)
      bossZone(state, m, { x: s.x, y: s.y, shape: ZS_RING, r2: BP.abyss.r2, r: BP.abyss.r, t: W, kill: true })
      break
    }
  }
  if (BOSS_PATS[PAT[id]].kill) state.events.push({ type: 'bossUlt', m: m.id, kind: m.kind, pat: PAT[id], x: m.x, y: m.y, t: W })
  m.st = MS_WINDUP
  m.mode = 2
  m.pat = PAT[id]
  m.t = W
  m.wmax = W
  m.aim = aim
  m.ax = ax
  m.ay = ay
  state.events.push({ type: 'windup', m: m.id, kind: m.kind, x: m.x, y: m.y })
  return true
}

/** 예고가 끝났다: 몸으로 하는 것(돌진 · 도약) · 쏘는 것 · 부르는 것. 범위는 제 스스로 터진다 */
function bossRelease(state: GameState, m: Monster, def: MonsterDef): void {
  const id = BOSS_PATS[m.pat ?? 0].id
  if (id === 'charge') {
    m.st = MS_CHARGE
    m.t = BP.charge.ticks
    m.tag = state.nextFxId++
    m.hitMask = 0
    return
  }
  if (id === 'leap') {
    m.st = MS_CHARGE
    m.t = BP.leap.fly
    return
  }
  if (id === 'fan') queenFan(state, m, def, m.stage >= 1 ? QUEEN.fanRage : QUEEN.fan)
  else if (id === 'nova') lordNova(state, m, def)
  else if (id === 'brood') summonKind(state, m, SPIDER_KIND, QUEEN.brood, QUEEN.broodMax, QUEEN.broodHp)
  else if (id === 'guards') summonKind(state, m, SHIELD_KIND, WARDEN.guards, WARDEN.guardMax, WARDEN.guardHp)
  else if (id === 'shades') summonKind(state, m, SHADE_KIND, LORD.shades, LORD.shadeMax, LORD.shadeHp)
  bossDone(state, m, def, 30)
}

/** 패턴 끝: 잠깐 숨을 고르고, 다음 패턴까지 쫓아와 휘두른다 */
function bossDone(state: GameState, m: Monster, def: MonsterDef, rec: number): void {
  const plan = BOSS_PLANS[def.id]
  m.st = MS_RECOVER
  m.t = rec
  m.mode = 0
  m.pat = -1
  m.scd = plan ? plan.every[Math.min(m.stage, plan.every.length - 1)] : 180
  m.cd = Math.max(m.cd, 20)
  void state
}

/** 보스 범위가 터진다: 모양 안의 사람만 (몬스터는 안 다친다). 줄(광선)은 벽을 뚫고, 나머지는 벽 뒤가 안전하다 */
function bossBlast(state: GameState, map: GameMap, z: Zone): void {
  state.events.push({ type: 'bzone', x: z.x, y: z.y, shape: z.shape ?? ZS_CIRCLE, r: z.r, r2: z.r2 ?? 0, a: z.a ?? 0, len: z.len ?? 0, arc: z.arc ?? 0, kill: z.kill })
  if (z.kill) {
    for (const p of state.players) {
      if (!isActive(p) || !inZone(z, p.x, p.y, PLAYER_RADIUS * 0.6)) continue
      if ((z.shape ?? ZS_CIRCLE) !== ZS_LINE && rayBlocked(map, z.x, z.y, p.x, p.y) && (z.shape ?? ZS_CIRCLE) !== ZS_RING) continue
      killOutright(state, p, z.from ?? -1)
    }
    return
  }
  const puller = z.pull !== undefined ? state.monsters.find((q) => q.id === z.pull && q.hp > 0) : undefined
  for (const p of state.players) {
    if (!isActive(p) || !inZone(z, p.x, p.y, PLAYER_RADIUS * 0.6)) continue
    if ((z.shape ?? ZS_CIRCLE) !== ZS_LINE && rayBlocked(map, z.x, z.y, p.x, p.y)) continue
    if (!hurtPct(state, p, z.pm ?? 0, z.from ?? -1, z.x, z.y)) continue
    if (z.slow && isActive(p)) p.legInjury = Math.max(p.legInjury, z.slow)
    if (puller && isActive(p)) {
      // 갈고리: 보스 바로 앞으로 끌어오고, 보스는 곧장 칼질한다
      const pr = bodyR(puller) + PLAYER_RADIUS + 6
      const dd = len(p.x - puller.x, p.y - puller.y) || 1
      const q = moveCircle(map, puller.x, puller.y, PLAYER_RADIUS, ((p.x - puller.x) / dd) * pr, ((p.y - puller.y) / dd) * pr)
      state.events.push({ type: 'hook', x: p.x, y: p.y, x2: q.x, y2: q.y })
      p.x = q.x
      p.y = q.y
      puller.cd = 0
    }
  }
}

/** 거미 여왕의 거미줄 부채: 예고 때 정한 방향으로 n 갈래를 고르게 벌려 쏜다 (맞으면 ‰ · 느려짐) */
function queenFan(state: GameState, m: Monster, def: MonsterDef, n: number): void {
  const base = atan2A(m.ay - m.y, m.ax - m.x)
  const step = deg((QUEEN.spread * 2) / (n - 1))
  const sp = def.shotSpeed ?? 5
  const pm = bossPm(state, m, BP.fan.pm)
  for (let i = 0; i < n; i++) {
    const a = (base - deg(QUEEN.spread) + step * i) & 1023
    const sx = m.x + cosA(a) * (bodyR(m) + 4)
    const sy = m.y + sinA(a) * (bodyR(m) + 4)
    state.mshots.push({ id: state.nextShotId++, kind: m.kind, by: m.id, slow: BP.fan.slow, x: sx, y: sy, vx: cosA(a) * sp, vy: sinA(a) * sp, life: def.shotLife ?? 80, dmg: 0, r: def.shotR ?? 6, pm })
  }
  state.events.push({ type: 'mshot', m: m.id, kind: m.kind, x: m.x, y: m.y })
}

/** 불꽃 고리: 군주 둘레로 고르게 (마지막 단계는 더 촘촘히) */
function lordNova(state: GameState, m: Monster, def: MonsterDef): void {
  const n = m.stage >= 2 ? LORD.novaRage : LORD.nova
  const sp = def.shotSpeed ?? 4
  const pm = bossPm(state, m, BP.nova.pm)
  for (let i = 0; i < n; i++) {
    const a = (m.aim + Math.round((i * 1024) / n)) & 1023
    state.mshots.push({ id: state.nextShotId++, kind: m.kind, by: m.id, slow: 0, x: m.x + cosA(a) * (bodyR(m) + 4), y: m.y + sinA(a) * (bodyR(m) + 4), vx: cosA(a) * sp, vy: sinA(a) * sp, life: def.shotLife ?? 100, dmg: 0, r: def.shotR ?? 8, pm })
  }
  state.events.push({ type: 'mshot', m: m.id, kind: m.kind, x: m.x, y: m.y })
}

/** 같은 무리에서 살아 있는 동료 수 (자기 빼고) */
function packAlive(state: GameState, m: Monster): number {
  let alive = 0
  for (const o of state.monsters) if (o.hp > 0 && o.pack === m.pack && o !== m) alive++
  return alive
}

/**
 * 부르기 (여왕의 새끼 · 관리인의 방패병 · 강령술사의 구울): kind 를 n 마리, 무리가 max 를 넘지 않게.
 * 체력은 부른 이의 층·인원 보정(정예·우두머리 배율은 뺀다) × hpFrac, 공격은 부른 이의 0.8배
 */
function summonKind(state: GameState, m: Monster, kind: number, n: number, max: number, hpFrac: number): void {
  const k = Math.min(n, max - packAlive(state, m))
  if (k <= 0) return
  const rank = m.elite & EA_UNIQUE ? UNIQUE.hp : m.elite ? ELITE.hp : 1
  const hpMul = (m.maxHp / MONSTER_LIST[m.kind].hp / rank) * hpFrac
  for (let i = 0; i < k; i++) spawns.push({ kind, x: m.x, y: m.y, pack: m.pack, hpMul, pow: Math.round(m.pow * 0.8), lvl: m.lvl })
  state.events.push({ type: 'summon', m: m.id, x: m.x, y: m.y })
}

function resolveAttack(state: GameState, m: Monster, def: MonsterDef): void {
  if (def.attack === 'heal') {
    // 주위의 다친 **동료**를 고친다 (보스·우두머리는 빼고 — 보스 싸움이 끝나지 않게).
    // 2026-09-20 사용자: "포자 늪 정예 버섯 주술사가 체력 차고 복제 늘어나 4명이 때려도 한 마리가 안 죽는다".
    // 원인은 주술사가 **자기 자신까지** 고치고 있던 것 — 정예는 체력 4배라 2.5초마다 제 최대 체력의 25%,
    // 4인 포자 늪이면 초당 235 씩 차올랐다(단단함이 붙으면 실효 391). 파티 화력이 그 선을 못 넘으면 **영원히 안 죽는다**.
    // ① 자기 자신 ② 다른 주술사(힐러끼리 서로 살리는 고리)를 대상에서 뺀다.
    const r = def.range
    for (const o of state.monsters) {
      if (o.id === m.id || o.hp <= 0 || o.st === MS_SLEEP || isBossLike(o)) continue
      if (MONSTER_LIST[o.kind].attack === 'heal') continue
      if (len(o.x - m.x, o.y - m.y) > r) continue
      o.hp = Math.min(o.maxHp, o.hp + Math.round(o.maxHp * (def.heal ?? 0.25)))
    }
    state.events.push({ type: 'mheal', m: m.id, x: m.x, y: m.y, r })
    m.st = MS_RECOVER
    m.t = def.recover
    m.cd = def.cooldown
    return
  }
  if (def.attack === 'melee') {
    state.events.push({ type: 'swipe', m: m.id, x: m.x, y: m.y, aim: m.aim })
    const reach = bodyR(m) + PLAYER_RADIUS + def.range + 8
    for (const p of state.players) {
      if (!isActive(p)) continue
      const dx = p.x - m.x
      const dy = p.y - m.y
      if (len(dx, dy) > reach) continue
      if (Math.abs(angleDiff(atan2A(dy, dx), m.aim)) > (def.arc ?? 180)) continue
      if (def.boss) hurtPct(state, p, bossPm(state, m, BOSS_SWIPE_PM), m.id, m.x, m.y)
      else hurtPlayer(state, p, Math.round((def.dmg * m.pow) / 100), m.id, m.x, m.y)
    }
    m.st = MS_RECOVER
    m.t = def.recover
    m.cd = def.cooldown
  } else if (def.attack === 'lob') {
    // 산성(토사꾼): 예고 때 정한 자리에 웅덩이 · 불덩이(포격 악마, blast): 그 자리에 폭발 예고 — 몬스터 편, 사람만 다친다
    const dmg = Math.round((def.dmg * m.pow) / 100)
    if (def.blast) state.zones.push({ id: state.nextFxId++, kind: ZONE_FUSE, owner: -1, x: m.ax, y: m.ay, r: def.blast, t: DEMON_FUSE, max: DEMON_FUSE, dmg })
    else state.zones.push({ id: state.nextFxId++, kind: ZONE_ACID, owner: -1, x: m.ax, y: m.ay, r: ACID.r, t: ACID.ticks, max: ACID.ticks, dmg })
    state.events.push({ type: 'mshot', m: m.id, kind: m.kind, x: m.x, y: m.y })
    m.st = MS_RECOVER
    m.t = def.recover
    m.cd = def.cooldown
  } else if (def.attack === 'ranged') {
    const a = atan2A(m.ay - m.y, m.ax - m.x)
    const sp = def.shotSpeed ?? 5
    const sx = m.x + cosA(a) * (def.r + 4)
    const sy = m.y + sinA(a) * (def.r + 4)
    state.mshots.push({ id: state.nextShotId++, kind: m.kind, by: m.id, slow: def.shotSlow ?? 0, x: sx, y: sy, vx: cosA(a) * sp, vy: sinA(a) * sp, life: def.shotLife ?? 80, dmg: Math.round((def.dmg * m.pow) / 100), r: def.shotR ?? 6 })
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
  // 막 보스는 **밀리지 않는다** (2026-09-24 사용자: "보스는 상태 이상을 받지 않는다고 했는데 캐릭터가 밀면 보스가 밀린다 —
  // 자기가 공격하거나 스킬을 쓰려고 움직이는 게 아니면 밀려서 움직이는 일이 없게"). 겹치면 상대(사람 · 졸개)가 비킨다
  const big = (m: Monster) => !!MONSTER_LIST[m.kind].boss
  for (let i = 0; i < ms.length; i++) {
    const a = ms[i]
    if (a.hp <= 0 || a.st === MS_SLEEP) continue
    const ra = bodyR(a)
    const q = big(a) ? ra + 40 : 40
    grid.query(a.x - q, a.y - q, a.x + q, a.y + q, (j) => {
      if (j <= i) return
      const b = ms[j]
      if (b.hp <= 0) return
      const rb = bodyR(b)
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d2 = dx * dx + dy * dy
      const rr = ra + rb
      if (d2 >= rr * rr) return
      const d = Math.sqrt(d2)
      // 완전히 겹치면 id 로 정한 방향으로 민다
      const nx = d > 0.001 ? dx / d : (a.id + b.id) % 2 === 0 ? 1 : -1
      const ny = d > 0.001 ? dy / d : 0
      // 보스와 겹치면 보스는 그대로 · 상대가 다 비킨다 (둘 다 보스면 반씩)
      const aFix = big(a) && !big(b)
      const bFix = (big(b) && !big(a)) || b.st === MS_SLEEP
      const pa = aFix ? 0 : bFix ? rr - d : (rr - d) * 0.5
      const pb = bFix ? 0 : aFix ? rr - d : (rr - d) * 0.5
      if (pa > 0) {
        const ra2 = moveCircle(map, a.x, a.y, ra, -nx * pa, -ny * pa)
        a.x = ra2.x
        a.y = ra2.y
      }
      if (pb > 0) {
        const rb2 = moveCircle(map, b.x, b.y, rb, nx * pb, ny * pb)
        b.x = rb2.x
        b.y = rb2.y
      }
    })
  }
  for (const p of state.players) {
    if (!p.alive || p.left) continue
    grid.query(p.x - 110, p.y - 110, p.x + 110, p.y + 110, (j) => {
      const m = ms[j]
      if (m.hp <= 0) return
      const r = bodyR(m)
      const dx = m.x - p.x
      const dy = m.y - p.y
      const d = len(dx, dy)
      const rr = r + PLAYER_RADIUS
      if (d >= rr) return
      const nx = d > 0.001 ? dx / d : 1
      const ny = d > 0.001 ? dy / d : 0
      if (big(m)) {
        // 보스는 그대로 — 사람이 밀려난다
        const rp = moveCircle(map, p.x, p.y, PLAYER_RADIUS, -nx * (rr - d), -ny * (rr - d))
        p.x = rp.x
        p.y = rp.y
        return
      }
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
        if (s.pm ? hurtPct(state, p, s.pm, s.by, px, py) : hurtPlayer(state, p, s.dmg, s.by, px, py)) {
          // 거미줄: 맞으면 느려진다 (다리 부상과 같은 0.7배)
          if (s.slow > 0 && isActive(p)) p.legInjury = Math.max(p.legInjury, s.slow)
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
    allies: state.allies?.map((m) => ({ id: m.id, x: m.x, y: m.y })),
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
