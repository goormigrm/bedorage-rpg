import type { Stats } from './stats'
import type { BotMemory } from './bot'
import { CharacterId } from './characters'
import type { Item, Sheet } from './items'
import { Rng } from './rng'
import { WeaponId } from './weapons'

export const TICK_RATE = 60
export const TICK_MS = 1000 / TICK_RATE
export const PLAYER_RADIUS = 14
/** 죽은 뒤 층 입구에서 다시 일어나기까지 (죽음 규칙이 하드코어가 아닐 때) */
export const RESPAWN_TICKS = 180
export const SPAWN_PROTECT_TICKS = 90
export const COUNTDOWN_TICKS = 180
export const DASH_TICKS = 10
export const DASH_SPEED = 9
/** 기력: 대시와 (근접 무기 보유 시) 막기에 쓴다 */
export const STAMINA_MAX = 100
/** 틱당 회복 (약 4.5초에 가득) */
export const STAMINA_REGEN = 22 / 60
export const DASH_COST = 34
/**
 * 달리기(Shift): 누르고 있는 동안 이동 속도 배율과 틱당 기력 소모.
 * 한 통(100)으로 약 3.3초 달린다. 달리는 동안에는 기력이 차지 않는다.
 */
export const SPRINT_MUL = 1.4
export const SPRINT_COST = 30 / 60
/** 다시 달리기 시작하려면 기력이 이만큼은 차 있어야 한다 (0 에서 한 틱 회복·한 틱 달리기 반복 방지 — 덕에서 겪음) */
export const SPRINT_MIN = 20
/** 후라이팬 방어: 피해 1 을 막는 데 드는 기력 */
export const BLOCK_COST = 0.55
/** 막은 뒤 기력이 다시 차기까지 (계속 맞으면 방어가 뚫리도록) */
export const BLOCK_LOCK_TICKS = 30
/** 앞에서 오는 몬스터 공격을 후라이팬으로 막을 확률 (덕 오픈 베타 값 그대로. PvE 에서는 M5 에서 다시 본다) */
export const BLOCK_CHANCE = 0.25
/** 통천란 패시브(치킨): 킬마다 최대 체력이 늘고 조금 회복한다. 죽으면 원래대로 (M7 에서 PvE 값으로) */
// 통천란 "치킨"(투기장): 잡을 때마다 최대 체력 · 회복. 2026-09-19 투기장 1:1 67%(혼자 높음) → 15/60/20 에서 줄였다
export const CHICKEN_MAXHP_PER_KILL = 10
export const CHICKEN_MAXHP_CAP = 30
export const CHICKEN_HEAL = 15
/** 침착란 패시브(침착): 탄퍼짐 배율 · 발당 반동 배율 · 반동 회복 배율 */
export const CHIM = { spreadMul: 0.55, recoilMul: 0.45, recoverMul: 3 }
/**
 * 풍월란 패시브(근성) — 2026-09-20 사용자: "풍월량은 바람과 상관없다" → 바람(자주 구르기)을 버리고 **탱커**가 됐다.
 * 실제 풍월량: 키 167cm · 92.5kg 단신 통통 체형(배도라지 '삼돼장'), 남들이 포기하는 게임을 끝까지 붙드는 근성.
 * 맞을 때마다 한 칸씩 단단해지고(받는 피해 -5%/칸), 2초간 안 맞으면 식는다. 기열란의 뇌절(연속 명중)과 거울쌍.
 * 투기장(역할 효과가 없는 곳)에서는 구르기 특혜를 뗀 만큼 27% 까지 떨어져, 피해 배율(CHAR_PVP) · 받는 피해로 따로 맞춘다.
 */
export const PUNGWOL = { gritPer: 0.05, gritMax: 6, gritCool: 120, pvpTaken: 0.88 }

/**
 * 캐릭터별 투기장 피해 배율 (`tools/arena.ts` 1:1 리그로 맞춘다 — 목표 45~55%).
 * 무기 계열의 `pvp` 로 맞추면 같은 무기를 쓰는 다른 캐릭터까지 흔들려서, 캐릭터 한 명만 올릴 때 쓴다.
 * 2026-09-20: 우원란 · 단군란은 권총(1.12 배율)에서 SMG 로 옮기며 27% 까지 떨어졌다. 풍월란은 탱커가 되며 구르기 특혜를 뗐다.
 */
export const CHAR_PVP: Partial<Record<CharacterId, number>> = { pungwol: 1.35, uwon: 1.22, dangun: 1.22, giyeol: 1.12 }
export const UWON = { invulnAfterDash: 24 }
/**
 * 던전 구르기 끝의 무적 유예 틱 (2026-09-25 사용자: "구르는 시간이 0.3초쯤 되나? 늘리면 너무 쉬워지지 않나 — 수치로 정해 줘").
 * 구르기 10틱(0.167초) + 5 = 0.25초. 사람 수준 계측(tools/bossfight.ts dodge=2 · 판 6개): 보스에게 받는 피해 15~22% ↓ ·
 * 3막 5/6 → 6/6 · 4막 3/6 → 4/6 (쓰러짐 3.3 → 2.0 — 여전히 가장 어렵다). +8(0.3초)은 +5 와 같은 결과인데 연타 무적만 늘어 5.
 * 사람 타이밍(오차 σ 90ms)으로 맞출 확률 65% → 84%, 계속 구를 때 무적인 시간 11% → 17%.
 * 투기장은 그대로(스태미나 · 1:1 판이 이미 맞춰져 있다). 승빠란은 구르기가 세 배 빨리 차서(대기 20) 늘리면
 * 계속 구를 때 무적이 47~68% 로 우원란(구른 뒤 무적이 패시브)보다 높아져 뺀다. 우원란은 이미 24 라 그대로
 */
export const DASH_GRACE = 5
/** 주펄란 패시브(빛남): 이 거리(px) 안의 상대에게 피해 배율 */
export const JUPEOL = { range: 200, mult: 1.35 }
/** 기열란 패시브(뇌절): 연속 명중마다 피해 배율이 오른다. 2026-09-19 재장전이 없어져 빗나가는 탄이 늘자(빗나가면 한 칸 식음)
 * 투기장 1:1 에서 17% 까지 떨어졌다 → 한 칸 6% → 8%, 최대 6 → 8 칸 (tools/arena.ts) */
export const GIYEOL = { perHit: 0.08, maxStacks: 8 }

/**
 * 회복 구슬(디아블로의 체력 구슬): 몬스터가 떨어뜨린다. 밟은 사람은 최대 체력의 25%,
 * 가까이 있던 동료도 12% 를 받는다(협동에서 "구슬 먹으러 들어가" 가 생긴다). 체력이 가득이면 줍지 않고 남는다.
 */
export const GLOBE_HEAL_FRAC = 0.25
/**
 * 회복은 **체력 구슬 하나로** (2026-09-19 "물약은 왜 있는 거야? 몬스터를 죽여서 할지 물약을 따로 가질지 정해서 정리") —
 * 물약(3)을 없앴다. 대신: 졸개 구슬 확률 ×1.5 · 정예는 하나 확정 · 우두머리·보스는 체력 25% 가 줄 때마다 큰 구슬, 쓰러지면 둘.
 */
export const GLOBE_DROP_MUL = 1.5
/** 우두머리·보스가 체력 25% 마다 떨어뜨리는 큰 구슬 */
export const GLOBE_BIG_FRAC = 0.35
export const GLOBE_SHARE_FRAC = 0.12
export const GLOBE_SHARE_RANGE = 260
export const GLOBE_TTL = 60 * 30
export const GLOBE_RADIUS = 22

/**
 * 쓰러짐(PLAN 5.8): 체력 0 이면 바로 죽지 않고 쓰러진다. 동료가 곁에서 F 를 누르고 있으면 일어난다.
 * 아무도 안 오면 BLEED_TICKS 뒤 죽는다. 일으켜 줄 사람이 아무도 없으면(혼자·전원 쓰러짐) 오래 기다릴 이유가 없어 SOLO_BLEED_TICKS.
 */
export const BLEED_TICKS = 60 * 12
export const SOLO_BLEED_TICKS = 60 * 2
export const REVIVE_TICKS = 150
export const REVIVE_RANGE = 52
export const REVIVE_HP_FRAC = 0.4

/** 한 방 최대 인원. 풀 메시·락스텝 지터 때문에 4 (덕 DESIGN 8.-1) */
export const MAX_PLAYERS = 4
/** 혼자 하기가 있으므로 1 */
export const MIN_PLAYERS = 1

/**
 * 죽음 규칙 (방장이 방을 만들 때 고른다 — 2026-09-18 사용자 결정)
 * 0 없음: 잃는 것 없음 · 1 소실: 골드·경험치 일부를 잃는다(M3) · 2 하드코어: 한 번 죽으면 그 원정은 끝(관전)
 */
export type DeathRule = 0 | 1 | 2
export const DEATH_RULE_LABEL = ['없음', '소실', '하드코어'] as const

export type Phase = 'countdown' | 'playing' | 'over'

/**
 * 판의 종류. dungeon = 협동 던전(PvE) · arena = 투기장(PvP — 배도라지 덕의 대전 규칙을 이식,
 * RPG 에서 키운 캐릭터끼리 싸운다. 2026-09-18 사용자: "배도라지덕의 방식을 RPG 안에 이식")
 */
export type GameMode = 'dungeon' | 'arena'

/** 투기장: 죽은 자리에 떨어지는 힐팩 (덕 그대로). 회복 구슬과 같은 배열을 쓰고 heal 로 구분한다 */
export const MEDKIT_HEAL_FRAC = 0.35
export const MEDKIT_TTL = 60 * 20
export const MEDKIT_RADIUS = 26
/** 투기장: 리스폰 후 이 틱 안에는 무적 (덕의 스폰 보호) */
export const ARENA_RESPAWN_TICKS = 180

export interface PlayerState {
  /** 플레이어 인덱스 0..MAX_PLAYERS-1 */
  id: number
  /** 협동이라 모두 0. 덕에서 물려받은 필드 — 시야 공유가 이 값으로 동료를 가린다 */
  team: number
  char: CharacterId
  x: number
  y: number
  aim: number
  hp: number
  maxHp: number
  /** 판 위에 있는가. 쓰러진 사람도 true (downed 로 구분), 죽으면 false */
  alive: boolean
  /** 쓰러짐 — 움직이지도 쏘지도 못하고, 몬스터도 노리지 않는다 */
  downed: boolean
  /** 쓰러진 뒤 죽기까지 남은 틱 */
  downTimer: number
  /** 동료가 일으켜 주는 진행 (0..REVIVE_TICKS) */
  revive: number
  /** 하드코어에서 죽었다 — 이번 원정은 관전만 */
  out: boolean
  respawnTimer: number
  weapon: WeaponId
  ammo: number
  reloadTimer: number
  fireCooldown: number
  recoil: number
  ads: boolean
  /** 조준점(커서)까지의 거리 px (입력에서 온다). 0 = 조준점 없음 */
  aimDist: number
  dashTimer: number
  dashCooldown: number
  dashDx: number
  dashDy: number
  lastHitTick: number
  prevFire: boolean
  /** 쓰러뜨린 몬스터 수 */
  kills: number
  deaths: number
  legInjury: number
  invuln: number
  /** 보스 공격에 맞은 뒤 다시 맞지 않는 틱 (부채 여러 갈래 · 겹친 광선이 한꺼번에 들어오지 않게 — 2026-09-23) */
  bossCd?: number
  /** 이번 틱 이동 여부 (렌더 걷기 애니메이션용) */
  moving: boolean
  sprinting: boolean
  /** 스폰 이후 살아있는 틱 수 (렌더용) */
  aliveTicks: number
  /** 경기 도중 나간 사람 */
  left: boolean
  /** 아직 아무도 앉지 않은 자리 (left 와 함께 true) */
  vacant: boolean
  /** 덕의 캐릭터 고르기 — RPG 에서는 원정 중에 캐릭터를 바꾸지 않는다(캐릭터 = 세이브 칸). 늘 false */
  choosing: boolean
  /** 연속 명중 수 (기열란 패시브) */
  streak: number
  /** 연속 피격 칸 (풍월란 패시브 '근성' — 맞을수록 단단해진다) */
  grit: number
  stamina: number
  staminaMax: number
  blockLock: number
  /** 결과 화면 통계. sim 안에 두어야 리싱크·재접속에도 값이 어긋나지 않는다 */
  shots: number
  hits: number
  /** 약점(치명타) 명중 수 */
  heads: number
  dmgDealt: number
  dmgTaken: number
  bestStreak: number
  killStreak: number
  /** 동료를 일으킨 횟수 */
  revives: number
  /** 스킬 재사용 대기 [Q, E, X] (틱) */
  cd: number[]
  /** 버프 남은 틱 (skills.ts 의 FX_* 번호) */
  fx: number[]
  /** FX_RATE 동안의 연사 배율 (가장 큰 것) */
  rateMul: number
  /** 관통탄이 남은 발 수 (침착란 Q) */
  pierceShots: number
  /** 다음 발 피해 배율이 남은 발 수 (옥냥란 Q) */
  empowerShots: number
  /** 돌진 중 한 번씩만 맞히려고 쓰는 효과 번호 */
  chargeTag: number
  /** RPG 성장 (세이브에서 온다 — 투기장에도 그대로 실린다) */
  level: number
  xp: number
  gold: number
  /** 장비 5칸 · 가방 (상태 안에 있어야 장착이 모두의 화면에서 같다) */
  equip: (Item | null)[]
  bag: Item[]
  /** 가방 칸 수 (상인에게 골드로 늘린다 — 2026-09-25). 세이브에 남는다 */
  bagMax: number
  /** 도박 천장: 전설 이상 없이 뽑은 수 (items.ts GAMBLE_PITY — 2026-09-25) */
  gpity: number
  /** 통계 (core/stats.ts — 업적의 바탕 · 세이브에 남는다. 2026-09-25) */
  stats: Stats
  /** 장비 + 레벨로 낸 능력치 (items.ts ST_*) */
  st: number[]
  /** 탄창 크기 (탄창 옵션 반영) */
  magSize: number
  /** 이번 판에서 얻은 경험치·골드 (결과표) */
  xpGain: number
  goldGain: number
  /** 이번 판에서 주운 아이템 수 · 그중 가장 높은 등급(-1 = 없음) */
  found: number
  bestFound: number
  /** 지금 있는 지역 (world.ts). 투기장은 0 */
  area: number
  /** 연 웨이포인트 (world.ts WAYPOINTS 순서의 비트) — 세이브에 남는다 */
  wps: number
  /** 지난 틱의 버튼 (누른 순간을 가린다 — 포털 · F) */
  btnPrev: number
  /** 출구를 막 지나왔다 (틱) — 들어서자마자 되돌아가지 않게 */
  exitLock: number
  /** 타운 포털 시전 남은 틱 (0 = 안 함) */
  portalCast: number
  /** 따라가는 사람 (용병·동료 봇 — 그 사람이 다른 지역으로 가면 곁으로 따라간다). -1 = 없음 */
  follow: number
  /** 밟으면 줍는 아이템 등급(비트 1 << 등급, 기본 AUTOPICK_ALL). 내 전리품만 — 버려진 것·남에게 준 것은 F */
  autoPick: number
  /** 물약: 남은 칸 · 칸 수 · 회복 남은 틱 · 다시 마실 때까지 */
  potions: number
  potMax: number
  potHot: number
  potCd: number
  /** 제단 축복 종류 · 남은 틱 */
  shrine: number
  shrineT: number
  /** 보관함 (캐릭터 공유 · 마을의 보관함 곁에서 넣고 꺼낸다) */
  stash: Item[]
  /** 보관함 칸 수 (관리인에게 골드로 늘린다 — 2026-09-25) */
  stashMax: number
  /** 낀 전설 효과 비트 묶음 (items.ts LEGENDS) · 불굴 재사용 대기 */
  legs: number
  legCd: number
  /** 자원 "집중" (0~100): 총이 맞으면 차고, 스킬(궁극기 빼고)이 쓴다 (GUIDE 7장) */
  focus: number
  /** 구르기 충전 (던전 — 최대 2, dashCooldown 이 다시 차는 시간) */
  dashCharges: number
  /** 레드카펫 한 번 피해 (시전 때의 스킬 위력으로 정한다) */
  carpetDmg: number
  /** 스킬 트리 빌드 */
  build: { r: number[]; m3: number[]; m5: number[]; s: number[] }
  /** 퀘스트로 받은 스킬 포인트 (D5) */
  spBonus: number
  /** 능력치에 쓴 포인트 [힘, 민첩, 활력, 정신] (C 창 · 세이브 Sheet.attr) */
  attr: number[]
  /** 퀘스트 상태 (world.ts QUESTS: 0 모름 · 1 받음 · 2 이룸 · 3 끝) */
  quests: number[]
  /** 용병이면 고용한 사람 (-1 = 사람) · 용병의 봇 기억 (sim 안에서 결정론으로 움직인다) */
  merc: number
  bot?: BotMemory
  /** 화면용 사본에서만: 다른 지역에 있다 (sim 은 쓰지 않는다) */
  away?: boolean
  /** 후원 효과 남은 틱 (core/donate.ts DON_* 칸 — 손 떨림 · 암흑 · 거꾸로 · 봉인). 처음 걸릴 때 만든다 */
  don?: number[]
  /** 영상용 손님 (tools/trailer.js 마지막 "12명이 함께" — 정원 밖, sim 안의 봇). 파티 창에 넣지 않는다 */
  cameo?: boolean
  /** 응원 "공격 강화" 의 공격력: 남은 틱 · 배율 (2026-09-24 — 처음 걸릴 때 만든다) */
  cpow?: number
  cpowMul?: number
}

/**
 * 응원으로 온 **아군 괴물** (2026-09-24 사용자: "아군 몬스터 10초 소환"). 정해진 시간 동안 둘레의 괴물을 치고 사라진다.
 * 괴물 배열과 **따로** 둔다 — 사람의 탄 · 스킬 · 괴물의 공격 · 봇 · 퀘스트 · 전리품이 모두 괴물 배열만 보므로
 * 아군은 맞지도 · 막지도 · 세어지지도 않는다. 번호는 괴물과 같은 칸(nextMonsterId)에서 받는다 — 화면이 같은 표에 그린다.
 */
export interface Ally {
  id: number
  /** MONSTER_LIST 번호 (그 막의 괴물 모습 — 초록으로 빛난다) */
  kind: number
  x: number
  y: number
  aim: number
  /** 남은 틱 */
  t: number
  /** 다음 공격까지 */
  cd: number
  /** 노리는 괴물 id (-1 없음) */
  target: number
  /** 부른 사람 (처치 · 전리품은 이 사람 몫) · 후원 번호 (이름표) */
  by: number
  seq: number
  /** 한 번 칠 때 피해 · 둘레를 함께 치는 반지름(px, 0 이면 하나만) */
  dmg: number
  splash: number
  /** 이번 틱에 움직였나 (렌더 걷기) */
  moving: number
}

/**
 * 지역 하나의 움직이는 것 전부 (GUIDE 12장). 사람이 있는 지역만 틱을 돌리고, 나머지는 얼려 둔다(최근 셋까지).
 * step 은 지역마다 이 배열들을 GameState 의 같은 이름 칸에 **묶어** 기존 전투 코드를 그대로 돌린다(`withArea`).
 */
export type MoveHow = 'exit' | 'wp' | 'portal' | 'town' | 'follow'

export interface AreaState {
  id: number
  objects: MapObj[]
  monsters: Monster[]
  mshots: MShot[]
  bullets: Bullet[]
  globes: Globe[]
  zones: Zone[]
  throws: Throw[]
  drops: Drop[]
  monstersTotal: number
  /** 응원 아군 괴물 (없으면 비어 있다 — 사람이 떠난 지역에서는 사라진다) */
  allies?: Ally[]
  /** 마지막으로 사람이 있던 틱 (얼린 지역을 버리는 순서) */
  seen: number
}

/** 타운 포털: 주인마다 하나. 들판 쪽은 (area, x, y), 마을 쪽은 마을의 포털 자리 */
export interface Portal {
  owner: number
  area: number
  x: number
  y: number
}

export interface Bullet {
  /** 폭발 반경 (유탄 — 0 이면 안 터진다) */
  boom: number
  /** 방패를 뚫는다 (던전의 관통 저격 · 천사의 한 발 — 2026-09-19 저격 둘이 방패병 무리에서 가장 많이 죽었다) */
  breaker?: boolean
  id: number
  owner: number
  x: number
  y: number
  px: number
  py: number
  vx: number
  vy: number
  life: number
  damage: number
  ads: boolean
  ox: number
  oy: number
  weapon: WeaponId
  hitSomeone: boolean
  /** 모래주머니를 끝까지 넘어가는 탄 (투기장 — 머리를 정확히 겨눈 탄) */
  over: boolean
  /** 투기장: 쏠 때 커서가 올라가 있던 적 플레이어 (-1 = 없음). 이 사람을 맞히면 헤드샷 (덕 규칙) */
  headTarget: number
  /** 던전: 쏠 때 커서가 약점 위에 있던 몬스터 id (-1 = 없음). 이 몬스터를 맞히면 치명타 */
  critMon: number
  overR: number
  /** 더 꿰뚫을 수 있는 수 (관통탄·관통 저격) */
  pierce: number
  /** 방금 맞힌 것 (꿰뚫는 탄이 같은 몸을 두 틱 연속 맞히지 않게) — 몬스터 id, 플레이어는 -(번호+1) */
  lastHit: number
  /** 피해 배율 (스킬) */
  mul: number
  /** 맞히면 무조건 치명타 (침착 모드) */
  forceCrit: boolean
}

/**
 * 몬스터. **기억(표적·상태·타이머)이 전부 여기 있다** — 스냅샷만 받으면 누구나 같은 결정을 내린다(DESIGN 2장 6).
 * 필드는 숫자만 둔다(해시·스냅샷이 가볍게).
 */
export interface Monster {
  id: number
  /** MONSTER_LIST 번호 */
  kind: number
  x: number
  y: number
  hp: number
  maxHp: number
  /** 바라보는 방향 0..1023 */
  aim: number
  /** 상태: MS_* */
  st: number
  /** 상태 타이머 */
  t: number
  /** 다음 공격까지 */
  cd: number
  /** 노리는 플레이어 (-1 없음) */
  target: number
  /** 예고 때 정한 공격 지점 (궁수 조준점) */
  ax: number
  ay: number
  /** 넉백 속도 (틱마다 줄어든다) */
  kx: number
  ky: number
  /** 기절·경직 남은 틱 */
  stun: number
  /** 마지막으로 맞은 틱 (렌더 체력 바) */
  hitTick: number
  /** 마지막으로 때린 플레이어 (처치 기록) */
  lastBy: number
  /** 무리 번호. 하나가 깨면 무리가 같이 깬다 */
  pack: number
  /** 표적이 직접 보이는가 (10틱마다 갱신 — 레이캐스트를 아낀다) */
  los: number
  /** 이번 틱에 움직였나 (렌더 걷기) */
  moving: number
  /** 둔화 남은 틱 (절반 속도) */
  slow: number
  /** 받는 피해 증가 남은 틱 · 배율(%) — 생중계 25 · 스포트라이트 50, 큰 쪽 */
  vuln: number
  vulnPct: number
  /** 드러남 남은 틱 (생중계 — 시야 밖이어도 보인다) */
  mark: number
  /** 도발 남은 틱 (target 을 바꾸지 않는다) */
  taunt: number
  /** 마지막으로 맞은 효과 번호 (돌진처럼 한 번만 맞아야 하는 효과) */
  tag: number
  /** 공격력 배율 ×100 (지역 레벨 · 난이도로 세진다) */
  pow: number
  /** 몬스터 레벨 (지역 레벨) — 경험치가 이것으로 오른다 */
  lvl: number
  /** 보스 특수 패턴 재사용 대기 (틱) — 보통 공격(cd)과 따로 센다 */
  scd: number
  /** 막 보스 즉사기까지 남은 틱 (처음 깨어 패턴을 쓸 때 정한다 — monsters.ts BOSS_ULT_CD) */
  kcd?: number
  /** 보스가 특수 패턴을 몇 번 썼나 (번갈아 쓰기 · 단계) */
  phase: number
  /** 정예 (무리의 우두머리) */
  elite: number
  /** 보스 공격 방식: 0 보통 · 1 돌진 (예고 중 · 돌진 중) · 2 이상 특수 예고 */
  mode: number
  /** 보스 단계 (심연의 군주: 0 → 1 → 2, 체력 2/3 · 1/3 에서 오른다) */
  stage: number
  /** 보물 고블린: 사람에게 들켰다 (그때부터 도망 · 골드 흘리기 · 사라지는 시계) */
  seen?: number
  /** 후원 소환 (2026-09-23): 후원 번호 + 1 · 부른 사람. 있으면 쓰러뜨려도 막 보스 처치 · 퀘스트로 치지 않는다 */
  sum?: number
  sumBy?: number
  /** 광폭화 남은 틱 (후원 이벤트 — pow 를 RAGE_POW 배로 올려 두고, 끝나면 되돌린다) */
  rage?: number
  /** 지금 예고(MS_WINDUP)의 길이 — 렌더 동작이 예고 비율을 잰다 (보스 패턴은 보통 공격보다 길다) */
  wmax?: number
  /** 보스 패턴 번호 (monsters.ts BOSS_PATS — 예고 · 돌진 · 도약 중에만, 아니면 -1) */
  pat?: number
  /** 돌진 중에 이미 친 사람 (자리 번호 비트) — 한 번 돌진에 한 번만 */
  hitMask?: number
}

/** 몬스터 상태 */
export const MS_SLEEP = 0
export const MS_CHASE = 1
export const MS_WINDUP = 2
export const MS_RECOVER = 3
/** 보스 돌진 중 */
export const MS_CHARGE = 4

/** 몬스터 투사체 (느리다 — 보고 피하라고) */
export interface MShot {
  id: number
  /** 쏜 몬스터 종류 (렌더 색) */
  kind: number
  /** 쏜 몬스터 id (흡혈 정예) */
  by: number
  /** 맞으면 느려지는 틱 (거미줄) */
  slow: number
  x: number
  y: number
  vx: number
  vy: number
  life: number
  dmg: number
  r: number
  /** 보스 탄: dmg 대신 맞은 사람 최대 체력의 ‰ (방어 무시 — Zone.pm 과 같다) */
  pm?: number
}

/** 회복 구슬 (던전) · 힐팩 (투기장) */
export interface Globe {
  id: number
  x: number
  y: number
  ttl: number
  /** 회복량 (최대 체력 비율 × 100). 던전 구슬 25 · 투기장 힐팩 35 */
  heal: number
  /** 가까운 동료에게도 나눠 주는가 (던전 구슬만) */
  share: boolean
}

/**
 * 바닥의 전리품. owner = 주인 플레이어(개인 전리품 — 주인에게만 보이고 주인만 줍는다), -1 = 누구나(버린 것).
 * lock = 버린 직후 다시 줍지 않게 막는 틱
 */
/** 바닥의 전리품: 아이템(F 로 줍는다) · 골드 더미 · 물약(밟으면 줍는다). 주인에게만 보이고 주인만 줍는다(-1 = 누구나) */
export interface Drop {
  id: number
  owner: number
  x: number
  y: number
  item: Item | null
  /** 골드 더미면 금액 */
  gold: number
  /** 물약이면 1 */
  pot: number
  ttl: number
  lock: number
}

/** 지역의 물건: 상자 · 금빛 상자 · 항아리(쏘거나 F 로 깬다) · 제단(F → 30초 축복) */
export interface MapObj {
  id: number
  kind: number
  x: number
  y: number
  /** 이미 열었다·깨졌다·썼다 */
  used: boolean
  /** 제단 종류 등 */
  v: number
}
export const OBJ_CHEST = 0
export const OBJ_GOLDCHEST = 1
export const OBJ_URN = 2
export const OBJ_SHRINE = 3
/** 제단 축복: 전투(피해 +25%) · 수호(받는 피해 -25%) · 지혜(경험치 +50%) · 신속(이동 +20%) */
export const SHRINE_NAMES = ['전투의 제단', '수호의 제단', '지혜의 제단', '신속의 제단']
export const SHRINE_TICKS = 60 * 30

/** 땅에 깔리는 효과 (스포트라이트 무대) */
export interface Zone {
  id: number
  kind: number
  owner: number
  x: number
  y: number
  r: number
  t: number
  max: number
  /** 폭발 예고(ZONE_FUSE)가 터질 때의 피해 */
  dmg: number
  /**
   * 보스 패턴 (2026-09-23 사용자: "보스는 퍼센트 데미지 — 탱커든 딜러든 힐러든 동일하게"): 있으면 dmg 대신 **맞은 사람 최대 체력의 ‰**.
   * 방어력 · 역할 · 막기 · 피해 감소를 모두 무시한다 (구르기 · 무적은 피한다)
   */
  pm?: number
  /** 모양 (ZS_*, 없으면 원). 원 = r · 고리 = r2 ~ r · 줄 = (x, y) 에서 a 방향으로 len, 폭 ±r · 부채 = a 방향 ±arc, 반지름 r */
  shape?: number
  a?: number
  len?: number
  r2?: number
  arc?: number
  /** 이만큼(틱) 기다렸다가 나타난다 (연속 패턴 — 첫 줄이 터진 뒤 둘째 줄) */
  wait?: number
  /** 맞은 사람을 이 몬스터 앞으로 끌어온다 (도살자 갈고리) */
  pull?: number
  /** 깐 보스 (몬스터 id — 누가 때렸나 · 반사광) */
  from?: number
  /** 맞으면 느려진다(틱) */
  slow?: number
  /** 즉사기 범위: 맞으면 무엇과도 상관없이 쓰러진다 (그리기도 검붉게 다르다) */
  kill?: boolean
}
export const ZONE_SPOTLIGHT = 0
/** 폭발 정예가 죽은 자리: t 가 0 이 되면 터진다 (몬스터 편 — 플레이어만 다친다) */
export const ZONE_FUSE = 1
/** 산성 웅덩이(토사꾼): 안에 선 사람이 ACID.every 틱마다 다친다 (몬스터 편) */
export const ZONE_ACID = 2
/** 태풍 (풍월란): 안의 괴물을 가운데로 끌어당기고 30틱마다 친다 (플레이어 편, dmg = 한 번 피해) */
export const ZONE_VORTEX = 3
/** 덫 (통천란): 처음 밟은 괴물 둘레를 치고 사라진다 (플레이어 편) */
export const ZONE_TRAP = 4
/** 보스 예고만 (피해 없음 — 도살자 돌진 길처럼 몸으로 치는 패턴의 길을 보여 준다) */
export const ZONE_WARN = 5
/** 예고 범위 모양 */
export const ZS_CIRCLE = 0
export const ZS_RING = 1
export const ZS_LINE = 2
export const ZS_CONE = 3

/** 던진 것 (수류탄) — t 가 0 이 되면 터진다 */
export interface Throw {
  id: number
  owner: number
  x0: number
  y0: number
  x: number
  y: number
  t: number
  max: number
}

export type SimEvent =
  | { type: 'fire'; p: number; x: number; y: number; aim: number; weapon: WeaponId }
  /** 저격총 개머리판 후려치기 (조준경 없이 쏠 때) */
  | { type: 'bash'; p: number; x: number; y: number; aim: number }
  /** 플레이어가 맞음 (by = 몬스터 id, 플레이어가 아니다) */
  | { type: 'hurt'; p: number; by: number; x: number; y: number; dmg: number }
  | { type: 'down'; p: number; x: number; y: number }
  | { type: 'revive'; p: number; by: number; x: number; y: number }
  /** 죽음. by = 죽인 플레이어 (투기장), 던전은 -1 */
  | { type: 'death'; p: number; by: number; x: number; y: number; out: boolean }
  /** 투기장: 플레이어가 플레이어에게 맞음 (덕의 'hit') */
  | { type: 'hit'; p: number; by: number; x: number; y: number; part: number; dmg: number }
  /** 스킬 사용 (slot 0=Q 1=E 2=R). tx·ty = 커서 지점 스킬의 목표 */
  | { type: 'skill'; p: number; slot: number; id: string; x: number; y: number; aim: number; tx: number; ty: number; rid?: string }
  /** 계단: 내려가기 시작 · 다음 층에 들어섬 */
  /** 다른 지역으로 건너갔다 (출구 · 웨이포인트 · 포털 · 마을에서 되살아남 · 따라감) */
  | { type: 'areaEnter'; p: number; area: number; from: number; how: MoveHow }
  | { type: 'wpFound'; p: number; area: number }
  | { type: 'portalCast'; p: number; x: number; y: number }
  | { type: 'portalOpen'; p: number; area: number; x: number; y: number }
  /** 우두머리·보스가 쓰러졌다 */
  | { type: 'bossDown'; area: number; kind: number }
  /** 후원 이벤트 ev 가 p 에게 일어났다 (seq = 후원 번호 · m = 부른 괴물 중 우두머리, 없으면 -1) */
  | { type: 'donate'; p: number; ev: number; seq: number; m: number }
  /** 골드 더미를 주웠다 · 물약을 주웠다 · 물약을 마셨다 */
  | { type: 'gold'; p: number; n: number; x: number; y: number }
  | { type: 'potGet'; p: number; x: number; y: number }
  | { type: 'potion'; p: number }
  /** 상자를 열었다 · 항아리가 깨졌다 · 제단의 축복 */
  | { type: 'objOpen'; p: number; kind: number; x: number; y: number }
  | { type: 'shrine'; p: number; kind: number; x: number; y: number }
  /** 마을 NPC 와 거래했다 (what: sell · buy · gamble · stash · stashAll · bagUp · stashUp · shopNew) */
  | { type: 'trade'; p: number; what: string; gold: number; uid: number }
  /** 도박꾼에게서 뽑았다 — 뭐가 나왔는지 창에 카드로 (2026-09-25 요청). uids = 나온 차례대로 */
  | { type: 'gamble'; p: number; uids: number[]; n: number; gold: number }
  /** 벼리기 결과 (2026-09-20): 등급이 올랐나(up) · 나온 등급 · 만든 물건 uid — 화면 가운데 연출에 쓴다 */
  | { type: 'forge'; p: number; uid: number; rarity: number; up: boolean }
  /** 보물 고블린이 문을 열고 사라졌다 · 연쇄 번개 (from → to) */
  | { type: 'goblinGone'; x: number; y: number }
  /** 보물 고블린을 사람이 처음 보았다 (그때부터 도망 시계가 돈다) */
  | { type: 'goblinSeen'; x: number; y: number }
  /** 용병 고용 · 내보냄 */
  | { type: 'hire'; p: number; by: number; on: boolean }
  /** 퀘스트: 목표를 이뤘다(모두) · 보상을 받았다(한 사람) */
  | { type: 'questDone'; q: number }
  | { type: 'questReward'; p: number; q: number }
  | { type: 'chain'; x: number; y: number; x2: number; y2: number }
  /** 전리품이 떨어짐 (owner 에게만 보인다) */
  | { type: 'loot'; owner: number; x: number; y: number; rarity: number }
  /** 주웠다 */
  | { type: 'pickup'; p: number; rarity: number; uid: number }
  /** 자동 줍기를 하려는데 가방이 가득 (2초에 한 번) */
  | { type: 'bagFull'; p: number }
  /** 능력치를 올렸다 · 되돌렸다 (C 창) */
  | { type: 'attr'; p: number }
  | { type: 'levelup'; p: number; level: number }
  /** 장비를 바꿨다 */
  | { type: 'equip'; p: number; slot: number }
  /** 스킬 범위 효과가 터짐 (렌더 링·소리) */
  | { type: 'aoe'; p: number; id: string; x: number; y: number; r: number }
  | { type: 'respawn'; p: number; x: number; y: number }
  | { type: 'dash'; p: number }
  | { type: 'reload'; p: number }
  | { type: 'wall'; x: number; y: number; aim: number }
  | { type: 'leave'; p: number }
  /** 빈 자리에 사람이 들어왔다 (난입) */
  | { type: 'join'; p: number; char: CharacterId }
  | { type: 'break'; tx: number; ty: number }
  /** 후라이팬으로 막음 */
  | { type: 'block'; p: number; x: number; y: number }
  /** 몬스터가 맞음 */
  | { type: 'mhit'; m: number; by: number; x: number; y: number; dmg: number; crit: boolean }
  /** 몬스터가 쓰러짐 */
  | { type: 'mdeath'; m: number; kind: number; by: number; x: number; y: number; aim: number }
  /** 몬스터가 깨어남 (무리 단위로 한 번) */
  | { type: 'wake'; pack: number; x: number; y: number; kind?: number }
  /** 몬스터 공격 예고 시작 (소리·연출) */
  | { type: 'windup'; m: number; kind: number; x: number; y: number }
  /** 몬스터 근접 공격이 휘둘러짐 */
  | { type: 'swipe'; m: number; x: number; y: number; aim: number }
  /** 몬스터 투사체 발사 */
  | { type: 'mshot'; m: number; kind: number; x: number; y: number }
  /** 투사체가 벽에 맞아 사라짐 */
  | { type: 'shotEnd'; x: number; y: number; kind: number }
  /** 폭발 */
  | { type: 'boom'; x: number; y: number; r: number }
  /** 주술사가 주위 동료를 고쳤다 (초록 고리) · 보스가 새끼를 불렀다 */
  | { type: 'mheal'; m: number; x: number; y: number; r: number }
  /** 동료를 고치거나 지켜 주는 스킬이 닿은 범위 (초록 고리 — 적의 범위 공격 빨강과 헷갈리지 않게, 2026-09-23) */
  | { type: 'allyfx'; p: number; x: number; y: number; r: number }
  | { type: 'summon'; m: number; x: number; y: number }
  /** 방패병이 탄을 막았다 */
  | { type: 'mblock'; m: number; x: number; y: number }
  /** 그림자가 순간이동했다 (x0,y0 → x,y) */
  | { type: 'blink'; m: number; x0: number; y0: number; x: number; y: number }
  /** 보스가 분노했다 (단계가 올랐다 — 도살자 · 여왕 · 관리인 체력 절반, 심연의 군주 2/3 · 1/3) */
  | { type: 'bossRage'; m: number; kind: number; stage: number; x: number; y: number }
  /** 보스 범위 패턴이 터졌다 (모양 그대로 번쩍 — Zone 의 모양 칸과 같다) */
  | { type: 'bzone'; x: number; y: number; shape: number; r: number; r2: number; a: number; len: number; arc: number; kill?: boolean }
  /** 막 보스가 즉사기를 쓰기 시작했다 (대사 · 화면 경고 · 경보음). t = 예고 틱 */
  | { type: 'bossUlt'; m: number; kind: number; pat: number; x: number; y: number; t: number }
  /** 즉사기에 맞아 쓰러졌다 */
  | { type: 'ultHit'; p: number; x: number; y: number }
  /** 도살자 갈고리가 사람을 끌어왔다 (x, y → x2, y2) */
  | { type: 'hook'; x: number; y: number; x2: number; y2: number }
  | { type: 'drop'; x: number; y: number }
  | { type: 'heal'; p: number; x: number; y: number; amount: number }
  | { type: 'start' }
  /** 끝: 던전 winner 0 = 층 정리 · 1 = 전멸 / 투기장 winner = 이긴 팀 */
  | { type: 'over'; winner: number }

export interface MatchConfig {
  seed: number
  /** 판 종류 (기본 dungeon) */
  mode?: GameMode
  /** 투기장: 팀 배정 (없으면 개인전 — 각자 자기 번호가 팀) */
  teams?: number[]
  /** 투기장: 목표 킬 */
  targetKills?: number
  /** 자리 수 = 길이 (1..MAX_PLAYERS). 아직 아무도 안 들어온 자리도 포함한다 */
  chars: CharacterId[]
  /** 아직 사람이 없는 자리 (true 면 `left` 로 시작) — 자리를 처음부터 잡아 두어 배열을 늘리지 않는다 */
  absent?: boolean[]
  /** 죽음 규칙 (기본 0) */
  deathRule?: DeathRule
  /** 난이도 0 보통 · 1 악몽 · 2 지옥 (monsters.ts TIERS) */
  tier?: number
  /** 몬스터 배치를 끈다 (시험용) */
  noMonsters?: boolean
  /** 자리별 캐릭터 기록 (레벨·장비·가방·골드). 없으면 1레벨 맨몸 */
  sheets?: (Sheet | undefined)[]
  /** 시작 지역 (기본 = 1막 마을). 시험은 전투 지역에서 바로 시작한다 */
  area?: number
  /** 자리별로 따라가는 사람 (용병·동료 봇). 없거나 -1 이면 혼자 다닌다 */
  follow?: number[]
}

export interface GameState {
  tick: number
  /** 게임 시드 — 지역을 처음 채울 때 쓴다 (지역 맵과 같은 시드에서) */
  seed: number
  rng: Rng
  phase: Phase
  phaseTimer: number
  mode: GameMode
  /** 투기장 목표 킬 (던전은 0) */
  targetKills: number
  deathRule: DeathRule
  /** 난이도 (MatchConfig.tier) */
  tier: number
  players: PlayerState[]
  bullets: Bullet[]
  nextBulletId: number
  monsters: Monster[]
  nextMonsterId: number
  mshots: MShot[]
  nextShotId: number
  globes: Globe[]
  nextGlobeId: number
  zones: Zone[]
  throws: Throw[]
  drops: Drop[]
  nextDropId: number
  /** 새 아이템 번호 (판마다 시드에서 시작 — 세이브의 번호와 겹치지 않게 크게) */
  nextItemUid: number
  /** 효과 번호 (구역·던진 것·돌진 태그) */
  nextFxId: number
  /** 묶인 지역의 처음 몬스터 수 (진행 표시) */
  monstersTotal: number
  /** 묶인 지역의 물건 (상자·항아리·제단) */
  objects: MapObj[]
  nextObjId: number
  /** 묶인 지역의 응원 아군 괴물 (Ally — 없으면 undefined) */
  allies?: Ally[]
  /**
   * 지금 묶인 지역 (step 이 지역마다 그 배열들을 위의 칸에 묶는다). step 밖에서는 -1 이고 위의 칸들은 비어 있다 —
   * 화면·봇은 `areaView(state, 지역)` 로 본다
   */
  curArea: number
  /** 묶이지 않은 지역들 (번호 순) */
  areas: AreaState[]
  /** 지금 막 */
  act: number
  /** 우두머리·보스를 쓰러뜨린 지역 (지역을 다시 채워도 다시 나오지 않는다) */
  killed: number[]
  portals: Portal[]
  /** 상인 진열 (게임마다 새로 — 모두가 같은 진열을 보고, 먼저 산 사람이 가져간다) */
  shop: Item[]
  /** 이벤트가 어느 지역 것인지: [시작, 끝, 지역] 셋씩. 해시·스냅샷 대상 아님 */
  evSpans: number[]
  /** 0 = 층 정리, 1 = 전멸. -1 = 아직 */
  winner: number
  /** 살아있는 모래주머니: 타일 인덱스 → 남은 내구도 (던전에는 없다 — 덕 코드 호환) */
  sandbags: Record<number, number>
  /** 이번 step 에서 발생한 이벤트. 해시/스냅샷 대상 아님. */
  events: SimEvent[]
}

/** 판에서 움직일 수 있는 사람 (쓰러지지 않고 살아 있음) */
export function isActive(p: PlayerState): boolean {
  return p.alive && !p.downed && !p.left
}

/** 사람이 조작하는 자리인가 — 봇(대장을 따라다닌다 · follow ≥ 0) · 용병(merc ≥ 0) · 영상의 크루(cameo)가 아니면 */
export function isHumanSeat(p: PlayerState | undefined): boolean {
  return !!p && p.follow < 0 && p.merc < 0 && !p.cameo
}

/** 서로 적인가 (던전은 모두 0팀이라 언제나 false) */
export function isEnemy(a: PlayerState, b: PlayerState): boolean {
  return a.id !== b.id && a.team !== b.team
}

/** 팀 킬 합계 (투기장) */
export function teamKills(state: GameState, team: number): number {
  let k = 0
  for (const p of state.players) if (p.team === team) k += p.kills
  return k
}

/** 팀전인가 (같은 팀이 둘 이상 — 투기장 2v2) */
export function isTeamMatch(state: GameState): boolean {
  if (state.mode !== 'arena') return false
  const seen = new Set<number>()
  for (const p of state.players) {
    if (seen.has(p.team)) return true
    seen.add(p.team)
  }
  return false
}
