// 세계 = 이어진 지역들 (GUIDE 5장 — 디아블로 2 처럼). 게임에 들어가면 막의 **마을**에 서 있고, 걸어서 야외 → 던전 → 보스로 간다.
// 지역끼리는 출구로 이어지고(걸어 들어가면 그 사람만 건너간다), 웨이포인트와 타운 포털로 빠르게 오간다.
//
// 결정론: 이 표는 상수다. 지역의 맵은 (게임 시드, 지역 번호)로 만들고, 출구·웨이포인트 자리는 맵에서 계산한다
// (`areaLayout` — 같은 맵이면 모든 브라우저에서 같은 자리). 상태에는 지역 번호만 들어간다.

import { GameMap, TILE, TILE_FLOOR, buildMap, walkField } from './map'
import { MAPS, MapId } from './maps'
import { tierOf } from './monsters'

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
   * 이어진 지역. 순서가 출구 칸이다: 0 = 들어온 쪽(맵의 입구), 1 = 입구에서 가장 먼 곳(다음 지역).
   * **막마다 한 줄**(마을 → 1 → 2 → … → 보스): 갈림길 · 막다른 옆길은 두지 않는다 (2026-09-24 사용자 — "한 맵에서 다음 맵으로
   * 가는 게 두 개가 돼서 한쪽은 더 갈 수 없으면 유저는 당황한다. 설명이 있어도 읽지 않는다"). 예전 옆길 넷(굶주린 굴 · 늑대 굴 ·
   * 저수조 · 끓는 구덩이)은 큰길 사이에 넣었다. 마을은 TOWNS 의 자리를 쓴다.
   */
  links: number[]
  /** 웨이포인트가 있다 */
  wp?: boolean
  /** 무리 틀 (없으면 막의 기본) */
  packs?: PackDef[]
  /** 이름 있는 우두머리 (입구 · 출구 둘 다에서 먼 자리에서 기다린다) */
  unique?: { kind: number; name: string }
  /** 막 보스 (가장 먼 곳) */
  boss?: number
  /**
   * **다음 막으로 가는 문**이 있는 지역 (값 = 다음 막 마을의 지역 번호).
   * 보스를 쓰러뜨리면 보스가 서 있던 자리(`layout.special`)에 문이 열리고, 곁에서 F 로 건너간다.
   * 2026-09-20 사용자: "1막 보스를 잡았는데 어디로 가야 하는지 몰라 방을 새로 만드니 2막 야영지로 와지던데 이건 되게 이상해".
   * `links` 가 아니라 따로 둔 이유: links 는 양쪽으로 이어진 길이고(마을에서 보스 방으로 걸어 들어갈 수는 없다),
   * 이 문은 보스를 잡아야 열리는 **한 방향** 문이다.
   */
  gate?: number
  /** 무리 수 배율 (기본 1) */
  density?: number
  /** 들어설 때 배너 아래 한 줄 */
  lore?: string
  /**
   * 길에서 뺀 지역 (2026-09-27 — 1막 줄이기): 어디와도 이어지지 않아 갈 수 없다. 표에서 지우지 않는 것은 **지역 번호가 세이브에 남기 때문**
   * (웨이포인트 비트 · 퀘스트) — 지우면 뒤 번호가 한 칸씩 당겨져 세이브가 어긋난다. 도는 곳(시험 · 계측 도구)은 이것을 건너뛴다
   */
  retired?: boolean
}

// 몬스터 종류 번호 (monsters.ts 의 MONSTER_LIST 순서)
const GHOUL = 0
const ARCHER = 1
const BLOATER = 2
const BUTCHER = 3
const WOLF = 5
const SPIDER = 6
const SHAMAN = 7
const QUEEN = 8
const SHIELD = 9
const NECRO = 10
const SPITTER = 11
const WARDEN = 12
const SHADE = 13
const DEMON = 14
const LORD = 15

export interface ActDef {
  name: string
  /** 마을 지역 번호 */
  town: number
  packs: PackDef[]
  /**
   * 막의 무리 수 배율. 뒤 막 맵일수록 벽이 많아 바닥이 좁다(지역당 몬스터 1막 130 · 2막 100 · 3막 78 · 4막 85) —
   * 막마다 몬스터 수·걸리는 시간이 비슷하게 맞춘다 (D7 계측)
   */
  density: number
  /** 경험치 배율 (기본 1) — 1막은 지역을 줄여 한 지역에서 더 준다 (2026-09-27) */
  xp?: number
}

export const ACTS: ActDef[] = [
  {
    name: '무너진 성당',
    town: 0,
    density: 1.15,
    // 1막을 보스 앞 지역 8 → 5 로 줄였다(2026-09-27 사용자: "1막 보스는 지루해지기 전에 빨리 — 그 뒤는 레벨에 맞게").
    // 지역이 줄어든 만큼 한 지역에서 경험치를 더 주어, 보스 앞 레벨이 전과 같게(8~9) — 2막부터는 전과 같은 레벨로 들어간다
    xp: 1.6,
    packs: [
      // 구울 떼 + 궁수 한둘
      { w: 0.55, groups: [[GHOUL, 5, 9], [ARCHER, 0, 2]] },
      // 궁수 무리를 구울이 지킨다
      { w: 0.25, groups: [[ARCHER, 3, 4], [GHOUL, 1, 2]] },
      // 부푼 시체 떼 — 구울 사이에서 터지면 구울도 날아간다
      { w: 0.2, groups: [[BLOATER, 2, 3], [GHOUL, 2, 3]] },
    ],
  },
  {
    name: '안개 숲',
    town: 10,
    density: 1.45,
    // 경험치 배율 — 보스 방에 들어설 때 레벨이 보스 레벨에 맞게 (2026-09-27 사용자: "그 뒤는 레벨에 맞게 만나도록 배분" · 전에는 2 ~ 3 레벨 모자랐다 — tools/campaign.ts)
    xp: 2.5,
    packs: [
      // 늑대 떼 — 빠르게 둘러싼다
      { w: 0.4, groups: [[WOLF, 5, 8]] },
      // 독거미 무리를 늑대가 지킨다 (거미줄에 걸리면 늑대를 못 떨친다)
      { w: 0.25, groups: [[SPIDER, 3, 5], [WOLF, 1, 2]] },
      // 주술사가 뒤에서 고친다 — 먼저 잡아라
      { w: 0.2, groups: [[SHAMAN, 1, 1], [WOLF, 3, 5], [SPIDER, 0, 1]] },
      // 숲까지 흘러나온 시체들
      { w: 0.15, groups: [[GHOUL, 4, 6], [BLOATER, 1, 2]] },
    ],
  },
  {
    name: '잠긴 지하도',
    town: 19,
    density: 1.6,
    // 경험치 배율 — 보스 방에 들어설 때 레벨이 보스 레벨에 맞게 (2026-09-27 사용자: "그 뒤는 레벨에 맞게 만나도록 배분" · 전에는 2 ~ 3 레벨 모자랐다 — tools/campaign.ts)
    xp: 1.9,
    packs: [
      // 방패 줄 뒤에서 토사꾼이 뱉는다 — 옆으로 돌아 들어가라
      { w: 0.3, groups: [[SHIELD, 2, 3], [SPITTER, 1, 2]] },
      // 강령술사가 구울을 일으킨다 — 먼저 잡아라
      { w: 0.25, groups: [[NECRO, 1, 1], [GHOUL, 4, 6], [SHIELD, 0, 1]] },
      // 토사꾼 떼 — 웅덩이를 피해 다녀야 한다
      { w: 0.2, groups: [[SPITTER, 2, 3], [GHOUL, 2, 4]] },
      // 방패 뒤의 궁수
      { w: 0.25, groups: [[SHIELD, 2, 3], [ARCHER, 2, 3]] },
    ],
  },
  {
    name: '심연',
    town: 28,
    density: 1.5,
    // 경험치 배율 — 보스 방에 들어설 때 레벨이 보스 레벨에 맞게 (2026-09-27 사용자: "그 뒤는 레벨에 맞게 만나도록 배분" · 전에는 2 ~ 3 레벨 모자랐다 — tools/campaign.ts)
    xp: 2.2,
    packs: [
      // 그림자 떼 — 도망쳐도 등 뒤에 나타난다
      { w: 0.3, groups: [[SHADE, 3, 5]] },
      // 방패 줄 뒤의 포격 악마
      { w: 0.25, groups: [[DEMON, 1, 2], [SHIELD, 2, 3]] },
      // 그림자가 붙잡고 악마가 쏜다
      { w: 0.25, groups: [[SHADE, 2, 3], [DEMON, 1, 1], [GHOUL, 3, 4]] },
      // 심연의 사제
      { w: 0.2, groups: [[NECRO, 1, 1], [SHADE, 2, 3], [SPITTER, 0, 1]] },
    ],
  },
]

const WOLVES: PackDef[] = [
  { w: 0.7, groups: [[WOLF, 6, 9]] },
  { w: 0.3, groups: [[WOLF, 3, 5], [SPIDER, 1, 2]] },
]
const SPORES: PackDef[] = [
  { w: 0.45, groups: [[SHAMAN, 1, 1], [GHOUL, 3, 5], [SPIDER, 1, 2]] },
  { w: 0.35, groups: [[SPIDER, 3, 5], [SHAMAN, 0, 1]] },
  { w: 0.2, groups: [[BLOATER, 2, 3], [SHAMAN, 1, 1]] },
]

const GUARDS: PackDef[] = [
  { w: 0.6, groups: [[SHIELD, 2, 3], [ARCHER, 1, 2], [GHOUL, 1, 2]] },
  { w: 0.4, groups: [[SHIELD, 2, 3], [SPITTER, 1, 2]] },
]
const SPITTERS: PackDef[] = [
  { w: 0.6, groups: [[SPITTER, 3, 4], [GHOUL, 2, 3]] },
  { w: 0.4, groups: [[SPITTER, 2, 3], [BLOATER, 1, 2]] },
]
// 포격 악마는 무리마다 하나 안팎 — 둘셋씩 넣으니 재의 들판에 45명(브라우저 확인), 화면이 폭발 예고로 덮였다
const FIRES: PackDef[] = [
  { w: 0.55, groups: [[DEMON, 1, 2], [GHOUL, 3, 5]] },
  { w: 0.45, groups: [[DEMON, 1, 1], [SPITTER, 1, 2], [SHIELD, 1, 2]] },
]
const SHADOWS: PackDef[] = [
  { w: 0.6, groups: [[SHADE, 3, 5], [GHOUL, 1, 2]] },
  { w: 0.4, groups: [[SHADE, 3, 4], [NECRO, 1, 1]] },
]
// 강령술사는 무리 열에 넷쯤 — 모두에게 붙이면 일으킨 구울이 지역을 덮는다(브라우저 확인: 2층에 강령술사 24)
const RITES: PackDef[] = [
  { w: 0.4, groups: [[NECRO, 1, 1], [GHOUL, 4, 6]] },
  { w: 0.35, groups: [[SHIELD, 2, 3], [ARCHER, 1, 2]] },
  { w: 0.25, groups: [[GHOUL, 5, 7], [SPITTER, 0, 1]] },
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
  { id: 0, act: 0, name: '순례자 야영지', kind: 'town', map: 'town1', level: 0, links: [1], wp: true, lore: '눈을 떠 보니 모닥불 곁이었다 — 여기가 어디인지는 아무도 모른다' },
  { id: 1, act: 0, name: '핏빛 들판', kind: 'field', map: 'fields', level: 1, links: [0, 2], wp: true, packs: GHOULS, lore: '성당 종이 멈춘 밤, 시체들이 들판으로 기어 나왔다' },
  { id: 2, act: 0, name: '굶주린 굴', kind: 'dungeon', map: 'cave', level: 2, links: [1, 3], packs: GHOULS, density: 1.2, lore: '굴 속에서 무언가 뼈를 씹는다' },
  { id: 3, act: 0, name: '묘지 길', kind: 'field', map: 'fields', level: 3, links: [2, 6], wp: true, unique: { kind: GHOUL, name: '묘지기 오스' }, lore: '묘지기는 돌아오지 않았다' },
  // 4 · 5 · 7 은 길에서 뺐다 (2026-09-27 — 1막 보스를 빨리: 보스 앞 지역 8 → 5, 사람 어림 45 → 25분쯤). 번호는 세이브 때문에 남긴다
  { id: 4, act: 0, name: '지하 묘지 1층', kind: 'dungeon', map: 'crypt', level: 4, links: [], retired: true },
  { id: 5, act: 0, name: '지하 묘지 2층', kind: 'dungeon', map: 'crypt', level: 5, links: [], retired: true },
  { id: 6, act: 0, name: '무너진 성당', kind: 'dungeon', map: 'cathedral', level: 5, links: [3, 8], wp: true, packs: ARCHERS, lore: '종은 멈췄고, 기둥 사이로 활시위가 당겨진다' },
  { id: 7, act: 0, name: '납골당 1층', kind: 'dungeon', map: 'crypt', level: 6, links: [], packs: ARCHERS, retired: true },
  { id: 8, act: 0, name: '납골당', kind: 'dungeon', map: 'crypt', level: 7, links: [6, 9], packs: ARCHERS, unique: { kind: ARCHER, name: '뼈활 레나' } },
  { id: 9, act: 0, name: '도살장', kind: 'boss', map: 'butchery', level: 8, links: [8], wp: true, boss: BUTCHER, gate: 10, density: 0.5, lore: '신선한 고기…!' },
  // ---------------- 2막 안개 숲 (지역 레벨 9~16) ----------------
  { id: 10, act: 1, name: '숲 가장자리 야영지', kind: 'town', map: 'town2', level: 0, links: [11], wp: true, lore: '늑대 울음이 밤새 목책을 두드린다' },
  { id: 11, act: 1, name: '안개 숲', kind: 'field', map: 'forest', level: 9, links: [10, 12], wp: true, lore: '안개 너머에서 무언가 따라온다' },
  { id: 12, act: 1, name: '늑대 굴', kind: 'dungeon', map: 'hollow', level: 10, links: [11, 13], packs: WOLVES, density: 1.2, lore: '뼈가 발목까지 쌓였다' },
  { id: 13, act: 1, name: '늑대 길', kind: 'field', map: 'forest', level: 11, links: [12, 14], packs: WOLVES, unique: { kind: WOLF, name: '회색 갈기' }, lore: '사방에서 울음이 좁혀 온다' },
  { id: 14, act: 1, name: '포자 늪', kind: 'field', map: 'swamp', level: 12, links: [13, 16], wp: true, packs: SPORES, lore: '쓰러진 것들이 포자를 뒤집어쓰고 다시 일어선다' },
  // (2026-09-27 사용자: "2 ~ 4막도 맵 개수를 줄이고 경험치를 늘려 줘 — 후원으로 몹 소환이 많아 플레이 시간이 길어질 수 있다") — 막마다 보스 앞 5지역
  { id: 15, act: 1, name: '버섯 동굴 1층', kind: 'dungeon', map: 'hollow', level: 13, links: [], packs: SPORES, retired: true },
  { id: 16, act: 1, name: '버섯 동굴', kind: 'dungeon', map: 'hollow', level: 14, links: [14, 18], packs: SPORES, unique: { kind: SHAMAN, name: '포자 할멈' } },
  // 17 거미 숲은 웨이포인트 자리(wp — 비트 순서)만 남기고 길에서 뺐다 — 창에 안 보이고 갈 수도 없다
  { id: 17, act: 1, name: '거미 숲', kind: 'field', map: 'forest', level: 15, links: [], wp: true, retired: true, lore: '나무마다 흰 실이 드리웠다' },
  { id: 18, act: 1, name: '거미 둥지', kind: 'boss', map: 'nest', level: 16, links: [16], wp: true, boss: QUEEN, gate: 19, density: 0.5, lore: '여왕이 실을 당긴다' },
  // ---------------- 3막 잠긴 지하도 (지역 레벨 17~24) ----------------
  { id: 19, act: 2, name: '수문 야영지', kind: 'town', map: 'town3', level: 0, links: [20], wp: true, lore: '누런 등불 아래, 물 떨어지는 소리만 들린다' },
  { id: 20, act: 2, name: '잠긴 수로', kind: 'field', map: 'sewer', level: 17, links: [19, 21], wp: true, lore: '도시의 오물이 흐르던 길 — 이제는 무언가 거슬러 올라온다' },
  { id: 21, act: 2, name: '저수조', kind: 'dungeon', map: 'cistern', level: 18, links: [20, 22], packs: SPITTERS, density: 1.2, lore: '고인 물이 부글거린다' },
  { id: 22, act: 2, name: '무너진 시장', kind: 'field', map: 'ruins', level: 19, links: [21, 23], packs: GUARDS, unique: { kind: SHIELD, name: '철문 브론' }, lore: '무너진 기둥 사이로 방패가 줄지어 섰다' },
  { id: 23, act: 2, name: '하수 광장', kind: 'field', map: 'sewer', level: 20, links: [22, 25], wp: true, lore: '광장의 분수가 검은 물을 뿜는다' },
  // (2026-09-27 사용자: "2 ~ 4막도 맵 개수를 줄이고 경험치를 늘려 줘 — 후원으로 몹 소환이 많아 플레이 시간이 길어질 수 있다") — 막마다 보스 앞 5지역
  { id: 24, act: 2, name: '의식의 회랑 1층', kind: 'dungeon', map: 'rite', level: 21, links: [], retired: true, packs: RITES, lore: '촛불이 저절로 켜진다' },
  { id: 25, act: 2, name: '의식의 회랑', kind: 'dungeon', map: 'rite', level: 22, links: [23, 27], packs: RITES, unique: { kind: NECRO, name: '검은 사제 모르가' } },
  // 26 봉인된 문서고도 웨이포인트 자리만 남긴다
  { id: 26, act: 2, name: '봉인된 문서고', kind: 'dungeon', map: 'archive', level: 23, links: [], wp: true, retired: true, lore: '누군가 봉인을 뜯었다' },
  { id: 27, act: 2, name: '관리인의 방', kind: 'boss', map: 'wardroom', level: 24, links: [25], wp: true, boss: WARDEN, gate: 28, density: 0.5, lore: '열쇠 꾸러미가 짤랑거린다' },
  // ---------------- 4막 심연 (지역 레벨 25~30) ----------------
  { id: 28, act: 3, name: '심연의 문', kind: 'town', map: 'town4', level: 0, links: [29], wp: true, lore: '문틈으로 붉은 빛이 샌다 — 여기가 마지막 불이다' },
  { id: 29, act: 3, name: '불타는 균열', kind: 'field', map: 'rift', level: 25, links: [28, 35], wp: true, lore: '땅이 갈라져 불을 토한다' },
  { id: 30, act: 3, name: '재의 들판', kind: 'field', map: 'ashen', level: 27, links: [35, 32], packs: FIRES, unique: { kind: DEMON, name: '불꽃 혀 가르' }, lore: '하늘에서 재가 내린다' },
  // (2026-09-27 사용자: "2 ~ 4막도 맵 개수를 줄이고 경험치를 늘려 줘 — 후원으로 몹 소환이 많아 플레이 시간이 길어질 수 있다") — 막마다 보스 앞 5지역
  { id: 31, act: 3, name: '그림자 미궁 1층', kind: 'dungeon', map: 'maze', level: 27, links: [], retired: true, packs: SHADOWS, lore: '벽이 숨을 쉰다' },
  { id: 32, act: 3, name: '그림자 미궁', kind: 'dungeon', map: 'maze', level: 28, links: [30, 33], wp: true, packs: SHADOWS, unique: { kind: SHADE, name: '속삭이는 자' } },
  { id: 33, act: 3, name: '군주의 계단', kind: 'dungeon', map: 'stair', level: 29, links: [32, 34], lore: '계단은 끝없이 아래로 이어진다' },
  { id: 34, act: 3, name: '심연의 옥좌', kind: 'boss', map: 'throne', level: 30, links: [33], wp: true, boss: LORD, density: 0.4, lore: '종이 처음 울린 곳' },
  { id: 35, act: 3, name: '끓는 구덩이', kind: 'dungeon', map: 'pit', level: 26, links: [29, 30], packs: FIRES, density: 1.2, lore: '바닥이 끓는다' },
]

export function areaDef(id: number): AreaDef {
  if (id >= RIFT_BASE) return riftDef(id)
  return AREAS[Math.max(0, Math.min(AREAS.length - 1, id | 0))]
}

// ---------------------------------------------------------------- 시련 (반복 끝 콘텐츠 — 2026-10-08 퀄리티 2차 7단계 D3)
//
// 디아블로 3 의 균열처럼: 마을의 **시련의 문**에서 단계를 골라 열면, 그 막의 맵 하나를 무작위로 골라 괴물을 가득 채운 지역이 생긴다.
// 괴물을 잡아 막대를 채우면 **시련의 수호자**(그 막의 보스 — 즉사기 없음)가 나오고, 10분 안에 잡으면 다음 단계가 열린다.
// 단계가 오를수록 괴물 체력 · 힘 · 전리품 · 경험치가 오른다. 보통 난이도의 심연의 군주를 쓰러뜨린 캐릭터부터 연다.
//
// 지역 번호 = RIFT_BASE + (판에서 몇 번째 시련) × 4 + 막 — 맵은 (게임 시드, 지역 번호)로 정해지니 열 때마다 다른 맵.
// AREAS 표에 없는 번호라 areaDef 가 여기서 만든다(링크 없음 · 웨이포인트 없음 — 드나드는 것은 시련의 문 · 타운 포털).

export const RIFT_BASE = 100
/** 단계 끝 (안전판 — 숫자가 터지지 않게) */
export const RIFT_MAX = 60
/** 제한 시간 (틱 — 10분) */
export const RIFT_TICKS = 60 * 60 * 10
/** 막마다 시련에 쓰는 맵 (보스 방 · 마을은 빼고) */
const RIFT_MAPS: MapId[][] = [
  ['fields', 'cave', 'cathedral', 'crypt'],
  ['forest', 'hollow', 'swamp'],
  ['sewer', 'cistern', 'ruins', 'rite', 'archive'],
  ['rift', 'ashen', 'pit', 'maze', 'stair'],
]
/** 화면 글 (밝은 분위기는 skinText 가 갈아 끼운다 — 시련 지역 이름이 이 값을 읽는다) */
export const RIFT_TEXT = { name: '시련의 균열', lore: '문 너머는 매번 다르다 — 끝까지 버틴 자만 더 깊이 내려간다' }

export const riftId = (n: number, act: number): number => RIFT_BASE + n * 4 + Math.max(0, Math.min(3, act))
export const isRift = (id: number): boolean => id >= RIFT_BASE

const riftDefs = new Map<number, AreaDef>()
function riftDef(id: number): AreaDef {
  let d = riftDefs.get(id)
  if (d) return d
  const k = id - RIFT_BASE
  const act = k % 4
  const n = Math.floor(k / 4)
  const maps = RIFT_MAPS[act]
  // 같은 막을 이어 열어도 맵이 돌아가며 바뀌게 (게임 시드는 맵 모양을 바꾼다)
  const map = maps[(n * 7 + 3) % maps.length]
  d = { id, act, kind: 'dungeon', map, level: 30, links: [], density: 1.3 } as unknown as AreaDef
  Object.defineProperty(d, 'name', { get: () => RIFT_TEXT.name, enumerable: true })
  Object.defineProperty(d, 'lore', { get: () => RIFT_TEXT.lore, enumerable: true })
  riftDefs.set(id, d)
  return d
}

/** 시련 단계 배율: 괴물 체력 · 힘 · 전리품(등급 오름) · 경험치 · 골드 */
export function riftScale(stage: number): { hp: number; pow: number; loot: number; xp: number; gold: number } {
  const s = Math.max(1, Math.min(RIFT_MAX, stage)) - 1
  return { hp: Math.pow(1.14, s), pow: Math.pow(1.06, s), loot: Math.min(0.3, 0.06 + 0.012 * s), xp: 1.3 + 0.1 * s, gold: 1.5 + 0.1 * s }
}

/** 이 캐릭터가 시련을 열 수 있나: 보통 난이도의 심연의 군주를 쓰러뜨렸다 (악몽 · 지옥 판이면 이미 넘었다) */
export function riftOpen(p: { quests: number[]; riftBest?: number }, tier: number): boolean {
  return tier > 0 || (p.riftBest ?? 0) > 0 || (p.quests[actBossQuest(ACTS.length - 1)] ?? 0) >= 2
}

export function isTown(id: number): boolean {
  return areaDef(id).kind === 'town'
}

/**
 * 웨이포인트가 있는 지역 (순서 = 세이브의 비트 번호 — 바꾸면 저장된 웨이포인트가 어긋난다).
 * 보스 방 웨이포인트(2026-09-24 사용자: "보스 도전 중에 실패해도 바로 보스방으로")는 **맨 뒤에** 붙였다 — 예전 비트는 그대로
 */
export const WAYPOINTS: number[] = [...AREAS.filter((a) => a.wp && a.kind !== 'boss'), ...AREAS.filter((a) => a.wp && a.kind === 'boss')].map((a) => a.id)

export function wpBit(area: number): number {
  const i = WAYPOINTS.indexOf(area)
  return i < 0 ? 0 : 1 << i
}

/**
 * 이 지역의 몬스터 레벨 = **지역 레벨 고정** (+ 난이도). 아이템 레벨도 이것 (GUIDE 5장 — 디아블로 2).
 * 예전(~v0.53.0)에는 파티가 훨씬 높으면 (파티 평균 − 3) 까지 따라 올라왔다 → 2026-09-24 사용자: "30 레벨인데 1 레벨 던전으로
 * 갔는데 피가 많이 닳는다" (1 레벨 들판의 괴물이 27 레벨이었다). 이제 낮은 곳은 쉽고, 대신 경험치가 거의 없다(monsters.ts xpGapMul).
 */
export function areaLevel(area: number, tier = 0): number {
  return areaDef(area).level + tierOf(tier).lvl
}

/** 지역 맵의 시드: 게임마다 다른 세계, 같은 게임이면 모든 브라우저에서 같은 맵 */
export function areaSeed(seed: number, area: number): number {
  return (seed ^ Math.imul(area + 1, 0x9e3779b1)) >>> 0
}

export function buildAreaMap(seed: number, area: number): GameMap {
  const def = areaDef(area)
  // 시련(☀ 도전 놀이): 그 막의 맵 모습(테마)은 그대로, 뼈대는 **트인 싸움터** — 상자 · 모래주머니 없이 짧은 벽 조각만 드문드문
  // (2026-10-08 사용자: "구조물이 너무 많아 보스가 나왔을 때 이동 자체가 어렵고 보스도 제대로 공격을 못 한다 — 전투가 가능하게").
  // 굴 · 미로 · 지하 묘지 같은 방 · 통로 맵이 걸리면 거대한 수호자가 통로에 끼었다
  if (isRift(area)) {
    const base = MAPS[def.map]
    return buildMap({ ...base, gen: { style: 'scatter', density: 3, crates: 0, sandbags: 0, maxLen: 4, forts: false } }, 1, areaSeed(seed, area))
  }
  return buildMap(def.map, 1, areaSeed(seed, area))
}

// ---------------------------------------------------------------- 퀘스트 (GUIDE 10장 — D5)

/**
 * 막마다 퀘스트 넷. 상태(캐릭터 세이브): 0 모름 · 1 받음 · 2 목표를 이룸(보고하러 가야 한다) · 3 끝.
 * 목표는 **같은 게임의 모두에게** 인정된다(디아블로 2). 보상은 촌장에게 말을 걸어 받는다.
 * 목표 종류: clear = 그 지역의 몬스터를 모두 쓰러뜨림 · kill = 그 지역의 우두머리·보스를 쓰러뜨림
 */
export interface QuestDef {
  name: string
  act: number
  area: number
  goal: 'clear' | 'kill'
  /** 목표 추적에 뜨는 한 줄 */
  task: string
  /** 촌장이 맡길 때 · 보고할 때 */
  ask: string
  thanks: string
  reward: string
  /** 보상: 스킬 포인트 · 골드 · 전설 확정 · 상인 할인 */
  sp?: number
  gold?: number
  legend?: boolean
  discount?: boolean
}

export const QUESTS: QuestDef[] = [
  {
    name: '굴 속의 것들', act: 0, area: 2, goal: 'clear', sp: 1,
    task: '핏빛 들판 너머 굶주린 굴을 비워라',
    ask: '깨어나자마자 이런 부탁을 해 미안하오. 허나 당신들 같은 사람이 전에도 몇 있었소 — 종이 멈춘 밤에 떨어져, 굴로 물을 길러 갔다가 돌아오지 않았지. 굴 속의 것들을 치워 주시오.',
    thanks: '굴이 조용해졌군. 그 둘의 넋도 이제 쉬겠지… 받으시오. 여기서 살아 나가려면 싸우는 법부터 늘려야 하오.',
    reward: '스킬 포인트 1',
  },
  {
    name: '묘지기', act: 0, area: 3, goal: 'kill', discount: true,
    task: '묘지 길의 묘지기 오스를 쓰러뜨려라',
    ask: '성당 묘지기 오스는 착한 사람이었소. 종이 멈춘 밤, 그가 무덤을 파헤치는 걸 봤다는 사람이 있소. 그가 이제 무엇이 됐든… 멈춰 주시오.',
    thanks: '오스가… 그랬군. 상인 말린에게 말해 두겠소. 이제부터 당신에게는 싸게 팔 거요.',
    reward: '상인 값 20% 할인',
  },
  {
    name: '뼈활 레나', act: 0, area: 8, goal: 'kill', legend: true,
    task: '납골당의 뼈활 레나를 쓰러뜨려라',
    ask: '성당 아래 납골당에서 활시위 소리가 끊이질 않소. 레나 — 옛날 이 마을을 지키던 궁수요. 죽어서도 활을 놓지 못하는 모양이오.',
    thanks: '레나의 활이 마침내 쉬는군. 그녀가 지니던 것이오 — 당신이라면 제대로 쓰겠지.',
    reward: '전설 아이템 하나',
  },
  {
    name: '도살자', act: 0, area: 9, goal: 'kill', sp: 1, gold: 500,
    task: '납골당 밑 도살장의 도살자를 쓰러뜨려라',
    ask: '성당 종은 도살장 아래로 끌려갔소. 그 종이 당신들을 이 땅에 떨어뜨렸고, 돌아가는 길도 그 종뿐이오. 피 냄새가 가장 짙은 곳으로 가시오.',
    thanks: '종은… 세 조각이 나 있었군. 하나는 여기, 둘은 누군가 가져갔소. 숲에서 종소리가 들린다는 소문이 있소 — 준비가 되면 말하시오, 숲 가장자리 야영지로 보내 주겠소.',
    reward: '스킬 포인트 1 · 골드 500 · 2막',
  },
  // ---------------- 2막 ----------------
  {
    name: '늑대 굴', act: 1, area: 12, goal: 'clear', sp: 1,
    task: '안개 숲 너머 늑대 굴을 비워라',
    ask: '사냥꾼 셋이 늑대 굴에 들어가 돌아오지 않았소. 늑대가 아니오 — 늑대처럼 생긴 무언가지. 굴을 비워 주시오.',
    thanks: '굴에서 사냥꾼들의 활을 찾았다고? …고맙소. 이걸 익혀 두시오.',
    reward: '스킬 포인트 1',
  },
  {
    name: '회색 갈기', act: 1, area: 13, goal: 'kill', gold: 1000,
    task: '늑대 길의 회색 갈기를 쓰러뜨려라',
    ask: '무리를 이끄는 놈이 있소. 회색 갈기 — 화살을 스무 대 맞고도 달렸다오. 놈을 잡으면 숲길이 트일 거요.',
    thanks: '회색 갈기의 가죽이군! 사냥꾼들이 돈을 모았소. 받으시오.',
    reward: '골드 1000',
  },
  {
    name: '포자 할멈', act: 1, area: 16, goal: 'kill', legend: true,
    task: '버섯 동굴의 포자 할멈을 쓰러뜨려라',
    ask: '늪의 버섯은 할멈이 기르는 거요. 쓰러진 것들을 포자로 다시 일으키지. 할멈을 멈추지 않으면 죽은 이가 끝이 없소.',
    thanks: '포자가 가라앉는구려. 할멈의 동굴에서 이것이 나왔소 — 아무나 쥘 물건이 아니오.',
    reward: '전설 아이템 하나',
  },
  {
    name: '거미 여왕', act: 1, area: 18, goal: 'kill', sp: 1, gold: 1500,
    task: '버섯 동굴 너머 거미 둥지의 여왕을 쓰러뜨려라',
    ask: '숲의 심장에 여왕이 있소. 놋쇠 냄새가 나는 실을 잔뜩 감아 두었다지 — 당신들이 찾는 <b>종의 몸통</b>이 거기 있소. 여왕을 끊고 가져오시오.',
    thanks: '종의 몸통이군! 하나 남았소 — 종을 치는 혀. 도시 아래에서 그 소리가 난다는구려. 준비가 되면 말하시오, 지하도 수문까지 길을 내 주겠소.',
    reward: '스킬 포인트 1 · 골드 1500 · 3막',
  },
  // ---------------- 3막 ----------------
  {
    name: '막힌 저수조', act: 2, area: 21, goal: 'clear', sp: 1,
    task: '잠긴 수로 너머 저수조를 비워라',
    ask: '수문이 막힌 건 저수조 때문이오. 산을 뱉는 것들이 그 안에 둥지를 틀었지. 저수조를 비우면 물길이 다시 트일 거요.',
    thanks: '물이 다시 흐르는 소리가 들리는구려. 고맙소 — 이걸 익혀 두시오.',
    reward: '스킬 포인트 1',
  },
  {
    name: '철문 브론', act: 2, area: 22, goal: 'kill', gold: 2000,
    task: '무너진 시장의 철문 브론을 쓰러뜨려라',
    ask: '브론은 지하도 경비대장이었소. 방패를 한 번도 내려놓지 않았다지 — 죽어서도. 정면으로는 안 되오. 옆으로 돌아가시오.',
    thanks: '브론의 방패가 마침내 내려졌군. 경비대가 모아 둔 돈이오. 받으시오.',
    reward: '골드 2000',
  },
  {
    name: '검은 사제', act: 2, area: 25, goal: 'kill', legend: true,
    task: '의식의 회랑의 검은 사제 모르가를 쓰러뜨려라',
    ask: '회랑에서 종소리가 나는 건 모르가가 의식을 올리기 때문이오. 쓰러진 것들을 일으켜 세우는 의식 — 그를 멈추시오.',
    thanks: '의식이 끊겼구려. 모르가의 제단에서 이것이 나왔소. 조심해서 쓰시오.',
    reward: '전설 아이템 하나',
  },
  {
    name: '관리인', act: 2, area: 27, goal: 'kill', sp: 1, gold: 2500,
    task: '의식의 회랑 끝, 관리인의 방의 관리인을 쓰러뜨려라',
    ask: '관리인의 열쇠 꾸러미에 <b>종의 혀</b>가 섞여 있소. 쇠붙이를 모으는 버릇이 있는 자지. 그것까지 찾으면 종은 다시 울릴 수 있소.',
    thanks: '이제 종은 갖췄소. 허나 울리지 않는구려 — 소리를 누군가 삼켜 버렸소. 그 목구멍이 이 문 너머, 심연이오. 가겠다면 말하시오, 문 앞까지 데려다 주겠소.',
    reward: '스킬 포인트 1 · 골드 2500 · 4막',
  },
  // ---------------- 4막 ----------------
  {
    name: '끓는 구덩이', act: 3, area: 35, goal: 'clear', sp: 1,
    task: '불타는 균열 너머 끓는 구덩이를 비워라',
    ask: '균열 옆 구덩이에서 악마들이 불덩이를 빚고 있소. 구덩이를 비우지 않으면 이 야영지도 오래 못 버티오.',
    thanks: '불덩이가 멎었구려. 고맙소 — 이걸 익혀 두시오. 마지막까지 쓸 데가 있을 거요.',
    reward: '스킬 포인트 1',
  },
  {
    name: '불꽃 혀 가르', act: 3, area: 30, goal: 'kill', gold: 3000,
    task: '재의 들판의 불꽃 혀 가르를 쓰러뜨려라',
    ask: '재의 들판에서 가장 큰 불덩이를 쏘는 놈이 있소. 가르 — 야영지를 세 번이나 태웠지. 놈을 멈춰 주시오.',
    thanks: '가르가 쓰러졌다니! 야영지 사람들이 가진 걸 다 모았소. 받으시오.',
    reward: '골드 3000',
  },
  {
    name: '속삭이는 자', act: 3, area: 32, goal: 'kill', legend: true,
    task: '그림자 미궁의 속삭이는 자를 쓰러뜨려라',
    ask: '미궁에서 누군가 이름을 부른다오. 대답한 자는 모두 그림자가 됐소. 속삭이는 자를 찾아 입을 다물게 하시오.',
    thanks: '속삭임이 그쳤구려. 그가 쥐고 있던 것이오 — 심연에서 온 물건이지만, 당신 손에서는 쓸 만할 거요.',
    reward: '전설 아이템 하나',
  },
  {
    name: '심연의 군주', act: 3, area: 34, goal: 'kill', sp: 1, gold: 5000,
    task: '군주의 계단 끝, 심연의 옥좌의 군주를 쓰러뜨려라',
    ask: '종소리를 삼킨 것이 옥좌에 앉아 있소. 그것을 끝내면 종은 울리고, 울리면 — 당신들은 집으로 돌아가게 될 거요. 우리에게는 아침이 오고.',
    thanks: '종소리가 돌아왔소. 들판에도, 숲에도, 도시 아래에도. 이제 당신들 차례요 — 그 소리를 따라가시오. 이 땅은 당신들을 기억하겠소.',
    reward: '스킬 포인트 1 · 골드 5000 · 엔딩',
  },
]

/** 퀘스트 보상으로 받은 스킬 포인트 */
export function questPoints(q: number[]): number {
  return QUESTS.reduce((a, d, i) => a + (q[i] === 3 ? (d.sp ?? 0) : 0), 0)
}

/** 상인 할인 (묘지기) */
export function questDiscount(q: number[]): number {
  return QUESTS.some((d, i) => d.discount && q[i] === 3) ? 0.8 : 1
}

/** 막 보스 퀘스트 번호 (막마다 마지막 것) */
export function actBossQuest(act: number): number {
  let last = -1
  QUESTS.forEach((d, i) => {
    if (d.act === act) last = i
  })
  return last
}

/** 난이도 t 가 이 캐릭터에게 열렸나: 앞 난이도의 마지막 퀘스트(심연의 군주)를 이뤘으면 */
export function tierOpen(sheet: { quests?: number[]; tq?: number[][] }, t: number): boolean {
  if (t <= 0) return true
  const prev = t === 1 ? sheet.quests : sheet.tq?.[t - 1]
  return (prev?.[actBossQuest(ACTS.length - 1)] ?? 0) >= 2
}

/** 난이도 t 의 퀘스트 상태 (보통은 quests, 악몽·지옥은 tq[t]) */
export function tierQuests(sheet: { quests?: number[]; tq?: number[][] }, t: number): number[] {
  return (t <= 0 ? sheet.quests : sheet.tq?.[t]) ?? []
}

/** 이 캐릭터가 갈 수 있는 가장 뒤 막: 앞 막의 보스를 쓰러뜨렸으면 (퀘스트 이룸 이상) 다음 막이 열린다 */
export function actReached(q: number[]): number {
  let act = 0
  while (act + 1 < ACTS.length && (q[actBossQuest(act)] ?? 0) >= 2) act++
  return act
}

/** 지역 사이 가장 짧은 길 (출구 links — 양쪽으로). from 부터 to 까지 지역 번호들, 없으면 null */
export function areaPath(from: number, to: number): number[] | null {
  if (from === to) return [from]
  const prev = new Map<number, number>([[from, -1]])
  const queue = [from]
  const nbr = (id: number): number[] => {
    const out = new Set(AREAS[id]?.links ?? [])
    for (const a of AREAS) if (a.links.includes(id)) out.add(a.id)
    return [...out]
  }
  for (let h = 0; h < queue.length; h++) {
    const cur = queue[h]
    for (const n of nbr(cur)) {
      if (prev.has(n)) continue
      prev.set(n, cur)
      if (n === to) {
        const path = [to]
        let k = cur
        while (k !== -1) {
          path.unshift(k)
          k = prev.get(k) ?? -1
        }
        return path
      }
      queue.push(n)
    }
  }
  return null
}

/**
 * 퀘스트 길 안내 (2026-09-25 사용자 고른 개선 4 — "막 안에서 어디로 가야 할지 헤매지 않게"): 지금 가야 할 곳.
 * ① 이 막에서 진행 중인 퀘스트의 지역 ② 이 막에서 아직 안 맡은 퀘스트가 있으면 촌장.
 * 이룬 퀘스트(보고만 남은 것)는 가리키지 않는다(같은 날 사용자). 다른 막의 지역은 가리키지 않는다(웨이포인트 · 촌장으로 건너간다)
 */
export function questGuide(q: number[], cur: number): { area: number; npc?: NpcId; quest?: number; label: string } | null {
  const act = areaDef(cur).act
  const town = ACTS[act].town
  // 이룬 퀘스트(보고만 남은 것)는 가리키지 않는다 — 다음 할 일로 (2026-09-25 사용자: "완료 건을 안내하는 건 맞지 않다")
  const doing = QUESTS.findIndex((d, i) => d.act === act && (q[i] ?? 0) === 1)
  if (doing >= 0) return { area: QUESTS[doing].area, quest: doing, label: QUESTS[doing].name }
  if (QUESTS.some((d, i) => d.act === act && (q[i] ?? 0) === 0)) return { area: town, npc: 'elder', label: '촌장에게 퀘스트 받기' }
  return null
}

/**
 * 촌장이 줄 · 받을 일이 있나 — **어느 야영지의 촌장이든 모든 막의 퀘스트를 맡고 보상한다** (2026-09-25 사용자:
 * "1막을 끝내고 2막 야영지로 가면 1막 퀘스트 보상을 받으러 1막 야영지로 다시 가야 한다 — 촌장의 퀘스트는 모든 야영지에서 공유").
 * 아직 못 간 막의 퀘스트는 세지 않는다 (예전에는 1막에서도 4막 퀘스트 때문에 늘 "!" 가 떴다)
 */
export function elderMarks(q: number[]): { report: boolean; offer: boolean } {
  const reach = actReached(q)
  let report = false
  let offer = false
  QUESTS.forEach((d, i) => {
    if (d.act > reach) return
    const st = q[i] ?? 0
    if (st === 2) report = true
    else if (st === 0) offer = true
  })
  return { report, offer }
}

// ---------------------------------------------------------------- 마을 배치 (손으로 짠 자리, 타일 단위)

interface TownSpots {
  spawn: [number, number]
  wp: [number, number]
  /** links 순서대로의 출구 */
  exits: [number, number][]
  /** 타운 포털이 서는 자리 — 자리 번호(주인)마다 하나 */
  portals: [number, number][]
  /** 웨이포인트 곁의 들판 문 — 성문과 같은 곳(첫 링크)으로 간다 (2026-10-08 사용자: "다음 필드로 쉽게 이동하도록") */
  fieldGate?: [number, number]
  /** NPC 자리 (천막 앞) */
  npcs: Record<NpcId, [number, number]>
}

/** 마을 사람들 (GUIDE 4장): 상인 · 대장장이 · 도박꾼 · 보관함 · 촌장(퀘스트, D5) · 용병 대장(D4) */
export type NpcId = 'merchant' | 'smith' | 'gambler' | 'stash' | 'elder' | 'captain' | 'trial'
export const NPC_NAMES: Record<NpcId, string> = {
  merchant: '상인 말린',
  smith: '대장장이 그룬',
  gambler: '도박꾼 엘자',
  stash: '보관함',
  elder: '촌장 카인',
  captain: '용병 대장 바르',
  trial: '시련의 문',
}
/** NPC 와 이야기할 수 있는 거리 (px) */
export const NPC_RANGE = 70

// 타운 포털은 마을 가운데 모닥불(22 ~ 23, 16 ~ 17)을 둘러싼다 — 화면에서 모닥불의 아래 · 오른쪽 · 왼쪽 · 위
// (2026-10-08 사용자: "타운 포털이 불필요하게 멀리 떨어져 있다 — 마을 가운데로". 전에는 서쪽 아래 17, 21 에서 주인마다 동쪽으로 2칸씩).
// 화면 아래 = 월드 (+1, +1) · 화면 오른쪽 = (+1, −1). 왼쪽 자리는 보관함 곁을 피해 한 칸 아래로
const CAMP: TownSpots = {
  spawn: [9, 17], wp: [15, 13], exits: [[44, 17]], portals: [[25, 19], [25, 14], [20, 20], [20, 14]],
  // 들판 문: 웨이포인트의 화면 오른쪽(성문 쪽) 두 칸 — 처음 자리에서도 몇 걸음
  fieldGate: [17, 11],
  npcs: { merchant: [10, 9], smith: [22, 8], gambler: [34, 9], stash: [18, 17], elder: [10, 23], captain: [34, 23], trial: [30, 20] },
}
/**
 * 막마다 다른 마을 (2026-10-08 퀄리티 2차 7단계 D4 — 전에는 넷이 CAMP 배치를 같이 썼다). 맵은 maps.ts town2Rows ~ town4Rows.
 * 타운 포털은 모닥불 둘레(아래 · 오른쪽 · 왼쪽 · 위) · 들판 문은 웨이포인트의 화면 오른쪽(+2, −2) · NPC 는 천막 앞
 */
const FOREST: TownSpots = {
  spawn: [4, 18], wp: [21, 12], exits: [[24, 1]], portals: [[19, 18], [19, 14], [14, 19], [14, 14]],
  fieldGate: [23, 10],
  npcs: { merchant: [9, 17], smith: [15, 8], gambler: [29, 8], stash: [17, 22], elder: [11, 23], captain: [32, 22], trial: [25, 21] },
}
const SLUICE: TownSpots = {
  spawn: [6, 19], wp: [22, 10], exits: [[44, 29]], portals: [[25, 22], [25, 17], [20, 23], [20, 17]],
  fieldGate: [24, 8],
  npcs: { merchant: [8, 9], smith: [20, 8], gambler: [35, 9], stash: [17, 20], elder: [8, 22], captain: [35, 22], trial: [30, 19] },
}
const LASTGATE: TownSpots = {
  spawn: [23, 7], wp: [17, 15], exits: [[22, 32]], portals: [[25, 14], [25, 10], [20, 14], [20, 10]],
  fieldGate: [19, 13],
  npcs: { merchant: [17, 7], smith: [29, 7], gambler: [7, 16], stash: [28, 12], elder: [39, 16], captain: [8, 19], trial: [29, 17] },
}
const TOWNS: Record<number, TownSpots> = { 0: CAMP, 10: FOREST, 19: SLUICE, 28: LASTGATE }

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
  /**
   * links 순서대로의 출구 자리와, 그 출구로 **들어왔을 때** 서는 자리. 마을은 맨 앞에 **들판 문**(gate — 웨이포인트 곁)이
   * 하나 더 있다 — 같은 곳(첫 링크)으로 가고, 들판에서 돌아오면 그 앞에 선다(find 가 앞의 것을 고른다)
   */
  exits: (Spot & { to: number; arrive: Spot; gate?: boolean })[]
  wp: Spot | null
  /** 웨이포인트로 왔을 때 서는 자리 */
  wpArrive: Spot | null
  /** 우두머리·보스 자리 */
  special: Spot
  /** 타운 포털 자리 — 주인(자리 번호)마다 하나 (마을만 · 나머지는 빈 배열) */
  portals: Spot[]
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
 * 입구 = 맵의 첫 스폰(왼쪽 위의 트인 곳) · 가장 먼 곳(다음 지역) = 입구에서 걸음 수가 가장 큰 트인 칸 · 우두머리 자리 = 둘 다에서 먼 칸.
 */
export function areaLayout(area: number, map: GameMap): AreaLayout {
  const cached = layouts.get(map)
  if (cached) return cached
  const def = areaDef(area)
  let out: AreaLayout
  const town = TOWNS[def.id]
  if (def.kind === 'town' && town) {
    const at = ([x, y]: [number, number]): Spot => ({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 })
    const exits: AreaLayout['exits'] = def.links.map((to, i) => {
      const e = at(town.exits[i] ?? town.exits[0])
      const d = walkField(map, tileOf(map, e))
      return { ...e, to, arrive: nearSteps(map, d, 3) }
    })
    if (town.fieldGate && def.links.length > 0) {
      const g = at(town.fieldGate)
      exits.unshift({ ...g, to: def.links[0], arrive: nearSteps(map, walkField(map, tileOf(map, g)), 2), gate: true })
    }
    const wp = at(town.wp)
    out = {
      spawn: at(town.spawn),
      exits,
      wp,
      wpArrive: nearSteps(map, walkField(map, tileOf(map, wp)), 2),
      special: at(town.spawn),
      portals: town.portals.map(at),
    }
  } else {
    // 입구 모서리를 지역마다 바꾼다 (늘 왼쪽 위에서 오른쪽 아래로 가면 지역이 다 같아 보인다).
    // 보스 결투장이 있는 방은 결투장에서 가장 먼 곳 (복도를 지나 결투장으로 — 들어서자마자 보스 앞이 아니게)
    const arena = map.arena
    const entry = arena
      ? map.spawns.reduce((a, b) => ((b.x - arena.x) ** 2 + (b.y - arena.y) ** 2 > (a.x - arena.x) ** 2 + (a.y - arena.y) ** 2 ? b : a))
      : (map.spawns[def.id % Math.max(1, Math.min(4, map.spawns.length))] ?? { x: map.pw / 2, y: map.ph / 2 })
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
    // 보스는 결투장 가운데(없으면 가장 먼 곳 — 보스 방은 출구가 하나뿐이라 비어 있다), 우두머리는 입구 · 출구 둘 다에서 먼 자리
    const bossAt = arena ? { x: arena.x, y: arena.y } : farS
    out = { spawn: wpArrive ?? exits[0]?.arrive ?? entry, exits, wp, wpArrive, special: def.boss !== undefined ? bossAt : midS, portals: [] }
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
