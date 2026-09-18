// 세계 = 이어진 지역들 (GUIDE 5장 — 디아블로 2 처럼). 게임에 들어가면 막의 **마을**에 서 있고, 걸어서 야외 → 던전 → 보스로 간다.
// 지역끼리는 출구로 이어지고(걸어 들어가면 그 사람만 건너간다), 웨이포인트와 타운 포털로 빠르게 오간다.
//
// 결정론: 이 표는 상수다. 지역의 맵은 (게임 시드, 지역 번호)로 만들고, 출구·웨이포인트 자리는 맵에서 계산한다
// (`areaLayout` — 같은 맵이면 모든 브라우저에서 같은 자리). 상태에는 지역 번호만 들어간다.

import { GameMap, TILE, TILE_FLOOR, buildMap, walkField } from './map'
import { MapId } from './maps'

/** 무리 틀: 원형 [종류, 최소, 최대(포함)] 묶음. w = 뽑힐 비중 (틀 목록 안에서 합 1) */
export interface PackDef {
  w: number
  groups: [kind: number, min: number, max: number][]
}

export type AreaKind = 'town' | 'field' | 'dungeon' | 'boss'

export interface AreaDef {
  id: number
  act: number
  name: string
  kind: AreaKind
  /** 맵 생성기·테마 (maps.ts) */
  map: MapId
  /** 지역 레벨 (몬스터·아이템). 마을은 0 */
  level: number
  /**
   * 이어진 지역. 순서가 출구 칸이다: 0 = 들어온 쪽(맵의 입구), 1 = 입구에서 가장 먼 곳, 2 = 둘 다에서 먼 옆길.
   * 마을은 TOWNS 의 자리를 쓴다.
   */
  links: number[]
  /** 웨이포인트가 있다 */
  wp?: boolean
  /** 무리 틀 (없으면 막의 기본) */
  packs?: PackDef[]
  /** 이름 있는 우두머리 (옆길 자리에서 기다린다) */
  unique?: { kind: number; name: string }
  /** 막 보스 (가장 먼 곳) */
  boss?: number
  /** 무리 수 배율 (기본 1) */
  density?: number
  /** 들어설 때 배너 아래 한 줄 */
  lore?: string
}

// 몬스터 종류 번호 (monsters.ts 의 MONSTER_LIST 순서)
const GHOUL = 0
const ARCHER = 1
const BLOATER = 2
const BUTCHER = 3

export interface ActDef {
  name: string
  /** 마을 지역 번호 */
  town: number
  packs: PackDef[]
}

export const ACTS: ActDef[] = [
  {
    name: '무너진 성당',
    town: 0,
    packs: [
      // 구울 떼 + 궁수 한둘
      { w: 0.55, groups: [[GHOUL, 5, 9], [ARCHER, 0, 2]] },
      // 궁수 무리를 구울이 지킨다
      { w: 0.25, groups: [[ARCHER, 3, 4], [GHOUL, 1, 2]] },
      // 부푼 시체 떼 — 구울 사이에서 터지면 구울도 날아간다
      { w: 0.2, groups: [[BLOATER, 2, 3], [GHOUL, 2, 3]] },
    ],
  },
]

const GHOULS: PackDef[] = [
  { w: 0.75, groups: [[GHOUL, 6, 10]] },
  { w: 0.25, groups: [[GHOUL, 3, 5], [BLOATER, 1, 2]] },
]
const ARCHERS: PackDef[] = [
  { w: 0.45, groups: [[ARCHER, 3, 5], [GHOUL, 1, 3]] },
  { w: 0.35, groups: [[GHOUL, 5, 8], [ARCHER, 1, 2]] },
  { w: 0.2, groups: [[BLOATER, 2, 3], [ARCHER, 1, 2]] },
]

/** 1막 (GUIDE 5.1 표). 번호 = 배열 자리 */
export const AREAS: AreaDef[] = [
  { id: 0, act: 0, name: '순례자 야영지', kind: 'town', map: 'town1', level: 0, links: [1], wp: true, lore: '모닥불만이 밤을 버틴다' },
  { id: 1, act: 0, name: '핏빛 들판', kind: 'field', map: 'fields', level: 1, links: [0, 3, 2], wp: true, packs: GHOULS, lore: '성당 종이 멈춘 밤, 시체들이 들판으로 기어 나왔다' },
  { id: 2, act: 0, name: '굶주린 굴', kind: 'dungeon', map: 'cave', level: 2, links: [1], packs: GHOULS, density: 1.2, lore: '굴 속에서 무언가 뼈를 씹는다' },
  { id: 3, act: 0, name: '묘지 길', kind: 'field', map: 'fields', level: 3, links: [1, 4], wp: true, unique: { kind: GHOUL, name: '묘지기 오스' }, lore: '묘지기는 돌아오지 않았다' },
  { id: 4, act: 0, name: '지하 묘지 1층', kind: 'dungeon', map: 'crypt', level: 4, links: [3, 5] },
  { id: 5, act: 0, name: '지하 묘지 2층', kind: 'dungeon', map: 'crypt', level: 5, links: [4, 6] },
  { id: 6, act: 0, name: '무너진 성당', kind: 'dungeon', map: 'cathedral', level: 5, links: [5, 7], wp: true, packs: ARCHERS, lore: '종은 멈췄고, 기둥 사이로 활시위가 당겨진다' },
  { id: 7, act: 0, name: '납골당 1층', kind: 'dungeon', map: 'crypt', level: 6, links: [6, 8], packs: ARCHERS },
  { id: 8, act: 0, name: '납골당 2층', kind: 'dungeon', map: 'crypt', level: 7, links: [7, 9], packs: ARCHERS, unique: { kind: ARCHER, name: '뼈활 레나' } },
  { id: 9, act: 0, name: '도살장', kind: 'boss', map: 'butchery', level: 8, links: [8], boss: BUTCHER, density: 0.5, lore: '신선한 고기…!' },
]

export function areaDef(id: number): AreaDef {
  return AREAS[Math.max(0, Math.min(AREAS.length - 1, id | 0))]
}

export function isTown(id: number): boolean {
  return areaDef(id).kind === 'town'
}

/** 웨이포인트가 있는 지역 (순서 = 세이브의 비트 번호) */
export const WAYPOINTS: number[] = AREAS.filter((a) => a.wp).map((a) => a.id)

export function wpBit(area: number): number {
  const i = WAYPOINTS.indexOf(area)
  return i < 0 ? 0 : 1 << i
}

/** 이 지역의 몬스터 레벨: 지역 레벨 (파티가 훨씬 높으면 (파티 − 3) 까지 따라 올라온다 — 다시 와도 너무 쉽지 않게) */
export function areaLevel(area: number, partyLevel: number): number {
  return Math.max(areaDef(area).level, partyLevel - 3)
}

/** 지역 맵의 시드: 게임마다 다른 세계, 같은 게임이면 모든 브라우저에서 같은 맵 */
export function areaSeed(seed: number, area: number): number {
  return (seed ^ Math.imul(area + 1, 0x9e3779b1)) >>> 0
}

export function buildAreaMap(seed: number, area: number): GameMap {
  return buildMap(areaDef(area).map, 1, areaSeed(seed, area))
}

// ---------------------------------------------------------------- 퀘스트 (GUIDE 10장 — D5)

/**
 * 막마다 퀘스트 넷. 상태(캐릭터 세이브): 0 모름 · 1 받음 · 2 목표를 이룸(보고하러 가야 한다) · 3 끝.
 * 목표는 **같은 게임의 모두에게** 인정된다(디아블로 2). 보상은 촌장에게 말을 걸어 받는다.
 * 목표 종류: clear = 그 지역의 몬스터를 모두 쓰러뜨림 · kill = 그 지역의 우두머리·보스를 쓰러뜨림
 */
export interface QuestDef {
  name: string
  area: number
  goal: 'clear' | 'kill'
  /** 목표 추적에 뜨는 한 줄 */
  task: string
  /** 촌장이 맡길 때 · 보고할 때 */
  ask: string
  thanks: string
  reward: string
}

export const QUESTS: QuestDef[] = [
  {
    name: '굴 속의 것들', area: 2, goal: 'clear',
    task: '핏빛 들판 옆 굶주린 굴을 비워라',
    ask: '들판 옆 바위굴에서 밤마다 뼈 씹는 소리가 들리오. 순례자 둘이 물을 길으러 갔다가 돌아오지 않았지. 굴 속의 것들을 모두 치워 주시오.',
    thanks: '굴이 조용해졌군. 그 둘의 넋도 이제 쉬겠지… 받으시오, 싸우는 법을 하나 더 깨우칠 게요.',
    reward: '스킬 포인트 1',
  },
  {
    name: '묘지기', area: 3, goal: 'kill',
    task: '묘지 길의 묘지기 오스를 쓰러뜨려라',
    ask: '성당 묘지기 오스는 착한 사람이었소. 종이 멈춘 밤, 그가 무덤을 파헤치는 걸 봤다는 사람이 있소. 그가 이제 무엇이 됐든… 멈춰 주시오.',
    thanks: '오스가… 그랬군. 상인 말린에게 말해 두겠소. 이제부터 당신에게는 싸게 팔 거요.',
    reward: '상인 값 20% 할인',
  },
  {
    name: '뼈활 레나', area: 8, goal: 'kill',
    task: '납골당 2층의 뼈활 레나를 쓰러뜨려라',
    ask: '성당 아래 납골당에서 활시위 소리가 끊이질 않소. 레나 — 옛날 이 마을을 지키던 궁수요. 죽어서도 활을 놓지 못하는 모양이오.',
    thanks: '레나의 활이 마침내 쉬는군. 그녀가 지니던 것이오 — 당신이라면 제대로 쓰겠지.',
    reward: '전설 아이템 하나',
  },
  {
    name: '도살자', area: 9, goal: 'kill',
    task: '납골당 밑 도살장의 도살자를 쓰러뜨려라',
    ask: '모든 것의 밑바닥에 그것이 있소. 피 냄새가 가장 짙은 곳 — 도살장. 그것을 끝내지 않으면 이 땅은 다시 일어서지 못하오.',
    thanks: '끝났구려… 정말로 끝났어. 하지만 숲 너머에서 또 다른 종소리가 들린다는 소문이 있소. (2막은 준비 중입니다)',
    reward: '스킬 포인트 1 · 골드 500',
  },
]

/** 퀘스트 보상으로 받은 스킬 포인트 */
export function questPoints(q: number[]): number {
  return (q[0] === 3 ? 1 : 0) + (q[3] === 3 ? 1 : 0)
}

/** 상인 할인 (묘지기) */
export function questDiscount(q: number[]): number {
  return q[1] === 3 ? 0.8 : 1
}

// ---------------------------------------------------------------- 마을 배치 (손으로 짠 자리, 타일 단위)

interface TownSpots {
  spawn: [number, number]
  wp: [number, number]
  /** links 순서대로의 출구 */
  exits: [number, number][]
  /** 타운 포털이 서는 자리 (자리 번호마다 옆으로 2칸씩) */
  portal: [number, number]
  /** NPC 자리 (천막 앞) */
  npcs: Record<NpcId, [number, number]>
}

/** 마을 사람들 (GUIDE 4장): 상인 · 대장장이 · 도박꾼 · 보관함 · 촌장(퀘스트, D5) · 용병 대장(D4) */
export type NpcId = 'merchant' | 'smith' | 'gambler' | 'stash' | 'elder' | 'captain'
export const NPC_NAMES: Record<NpcId, string> = {
  merchant: '상인 말린',
  smith: '대장장이 그룬',
  gambler: '도박꾼 엘자',
  stash: '보관함',
  elder: '촌장 카인',
  captain: '용병 대장 바르',
}
/** NPC 와 이야기할 수 있는 거리 (px) */
export const NPC_RANGE = 70

const TOWNS: Record<number, TownSpots> = {
  0: {
    spawn: [9, 17], wp: [15, 13], exits: [[44, 17]], portal: [17, 21],
    npcs: { merchant: [10, 9], smith: [22, 8], gambler: [34, 9], stash: [18, 17], elder: [10, 23], captain: [34, 23] },
  },
}

/** 마을이면 NPC 자리 (px) */
export function townNpcs(area: number): { id: NpcId; x: number; y: number }[] {
  const t = TOWNS[area]
  if (!t) return []
  return (Object.keys(t.npcs) as NpcId[]).map((id) => ({ id, x: t.npcs[id][0] * TILE + TILE / 2, y: t.npcs[id][1] * TILE + TILE / 2 }))
}

/** p 곁의 NPC (없으면 null) */
export function npcNear(area: number, x: number, y: number): NpcId | null {
  for (const n of townNpcs(area)) if ((n.x - x) ** 2 + (n.y - y) ** 2 <= NPC_RANGE * NPC_RANGE) return n.id
  return null
}

// ---------------------------------------------------------------- 맵에서 계산하는 자리

export interface Spot {
  x: number
  y: number
}

export interface AreaLayout {
  /** 처음 들어올 때(웨이포인트가 없을 때) · 마을에서 되살아날 때 */
  spawn: Spot
  /** links 순서대로의 출구 자리와, 그 출구로 **들어왔을 때** 서는 자리 */
  exits: (Spot & { to: number; arrive: Spot })[]
  wp: Spot | null
  /** 웨이포인트로 왔을 때 서는 자리 */
  wpArrive: Spot | null
  /** 우두머리·보스 자리 */
  special: Spot
  /** 타운 포털 자리 (마을만) */
  portal: Spot | null
}

const layouts = new WeakMap<GameMap, AreaLayout>()

const center = (t: number, w: number): Spot => ({ x: (t % w) * TILE + TILE / 2, y: Math.floor(t / w) * TILE + TILE / 2 })

/** 3×3 이 트인 바닥인가 */
function open3(map: GameMap, t: number): boolean {
  const tx = t % map.w
  const ty = Math.floor(t / map.w)
  if (tx < 2 || ty < 2 || tx >= map.w - 2 || ty >= map.h - 2) return false
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (map.tiles[(ty + dy) * map.w + tx + dx] !== TILE_FLOOR) return false
  return true
}

/** 걸음 거리 d 에서 want 에 가장 가까운 트인 칸 (격자 순서 — 결정론) */
function nearSteps(map: GameMap, d: Float64Array, want: number): Spot {
  let best = -1
  let bestE = Infinity
  for (let t = 0; t < d.length; t++) {
    if (!Number.isFinite(d[t]) || !open3(map, t)) continue
    const e = Math.abs(d[t] - want)
    if (e < bestE) {
      bestE = e
      best = t
    }
  }
  return best < 0 ? { x: map.pw / 2, y: map.ph / 2 } : center(best, map.w)
}

const tileOf = (map: GameMap, s: Spot) => Math.floor(s.y / TILE) * map.w + Math.floor(s.x / TILE)

/**
 * 지역의 자리들. 마을은 손으로 정한 자리, 나머지는 맵에서:
 * 입구 = 맵의 첫 스폰(왼쪽 위의 트인 곳) · 가장 먼 곳 = 입구에서 걸음 수가 가장 큰 트인 칸 · 옆길 = 둘 다에서 먼 칸.
 */
export function areaLayout(area: number, map: GameMap): AreaLayout {
  const cached = layouts.get(map)
  if (cached) return cached
  const def = areaDef(area)
  let out: AreaLayout
  const town = TOWNS[def.id]
  if (def.kind === 'town' && town) {
    const at = ([x, y]: [number, number]): Spot => ({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 })
    const exits = def.links.map((to, i) => {
      const e = at(town.exits[i] ?? town.exits[0])
      const d = walkField(map, tileOf(map, e))
      return { ...e, to, arrive: nearSteps(map, d, 3) }
    })
    const wp = at(town.wp)
    out = {
      spawn: at(town.spawn),
      exits,
      wp,
      wpArrive: nearSteps(map, walkField(map, tileOf(map, wp)), 2),
      special: at(town.spawn),
      portal: at(town.portal),
    }
  } else {
    // 입구 모서리를 지역마다 바꾼다 (늘 왼쪽 위에서 오른쪽 아래로 가면 지역이 다 같아 보인다)
    const entry = map.spawns[def.id % Math.max(1, Math.min(4, map.spawns.length))] ?? { x: map.pw / 2, y: map.ph / 2 }
    const dE = walkField(map, tileOf(map, entry))
    let far = -1
    for (let t = 0; t < dE.length; t++) if (Number.isFinite(dE[t]) && open3(map, t) && (far < 0 || dE[t] > dE[far])) far = t
    const farS = far < 0 ? entry : center(far, map.w)
    const dF = walkField(map, tileOf(map, farS))
    let mid = -1
    let midV = -1
    for (let t = 0; t < dE.length; t++) {
      if (!Number.isFinite(dE[t]) || !Number.isFinite(dF[t]) || !open3(map, t)) continue
      const v = Math.min(dE[t], dF[t])
      if (v > midV) {
        midV = v
        mid = t
      }
    }
    const midS = mid < 0 ? farS : center(mid, map.w)
    const slots = [entry, farS, midS]
    const exits = def.links.map((to, i) => {
      const e = slots[Math.min(i, slots.length - 1)]
      return { ...e, to, arrive: nearSteps(map, walkField(map, tileOf(map, e)), 3) }
    })
    let wp: Spot | null = null
    let wpArrive: Spot | null = null
    if (def.wp) {
      wp = nearSteps(map, dE, 6)
      wpArrive = nearSteps(map, walkField(map, tileOf(map, wp)), 2)
    }
    // 보스는 가장 먼 곳(보스 방은 출구가 하나뿐이라 비어 있다), 우두머리는 옆길 자리
    out = { spawn: wpArrive ?? exits[0]?.arrive ?? entry, exits, wp, wpArrive, special: def.boss !== undefined ? farS : midS, portal: null }
  }
  layouts.set(map, out)
  return out
}

/** 몬스터를 두지 않을 자리 (출구·웨이포인트 곁 — 들어서자마자 둘러싸이지 않게) */
export function safeSpots(l: AreaLayout): Spot[] {
  const s: Spot[] = l.exits.map((e) => ({ x: e.x, y: e.y }))
  if (l.wp) s.push(l.wp)
  return s
}
