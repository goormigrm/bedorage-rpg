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
/** 통천덕 패시브(치킨): 킬마다 최대 체력이 늘고 조금 회복한다. 죽으면 원래대로 (M7 에서 PvE 값으로) */
export const CHICKEN_MAXHP_PER_KILL = 15
export const CHICKEN_MAXHP_CAP = 60
export const CHICKEN_HEAL = 20
/** 침착덕 패시브(침착): 탄퍼짐 배율 · 발당 반동 배율 · 반동 회복 배율 */
export const CHIM = { spreadMul: 0.55, recoilMul: 0.45, recoverMul: 3 }
export const PUNGWOL = { dashCost: 22 }
export const UWON = { invulnAfterDash: 24 }
/** 주펄덕 패시브(빛남): 이 거리(px) 안의 상대에게 피해 배율 */
export const JUPEOL = { range: 200, mult: 1.35 }
/** 기열덕 패시브(뇌절): 연속 명중마다 피해 배율이 오른다 */
export const GIYEOL = { perHit: 0.06, maxStacks: 6 }

/**
 * 회복 구슬(디아블로의 체력 구슬): 몬스터가 떨어뜨린다. 밟은 사람은 최대 체력의 25%,
 * 가까이 있던 동료도 12% 를 받는다(협동에서 "구슬 먹으러 들어가" 가 생긴다). 체력이 가득이면 줍지 않고 남는다.
 */
export const GLOBE_HEAL_FRAC = 0.25
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
  /** 연속 명중 수 (기열덕 패시브) */
  streak: number
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
  /** 관통탄이 남은 발 수 (침착덕 Q) */
  pierceShots: number
  /** 다음 발 피해 배율이 남은 발 수 (옥냥덕 Q) */
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
  /** 장비 + 레벨로 낸 능력치 (items.ts ST_*) */
  st: number[]
  /** 탄창 크기 (탄창 옵션 반영) */
  magSize: number
  /** 이번 판에서 얻은 경험치·골드 (결과표) */
  xpGain: number
  goldGain: number
}

export interface Bullet {
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
  /** 공격력 배율 ×100 (파티 레벨로 세진다) */
  pow: number
  /** 정예 (무리의 우두머리) */
  elite: number
  /** 보스 공격 방식: 0 보통 · 1 돌진 (예고 중 · 돌진 중) */
  mode: number
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
  x: number
  y: number
  vx: number
  vy: number
  life: number
  dmg: number
  r: number
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
export interface Drop {
  id: number
  owner: number
  x: number
  y: number
  item: Item
  ttl: number
  lock: number
}

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
}
export const ZONE_SPOTLIGHT = 0

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
  /** 스킬 사용 (slot 0=Q 1=E 2=X). tx·ty = 커서 지점 스킬의 목표 */
  | { type: 'skill'; p: number; slot: number; id: string; x: number; y: number; aim: number; tx: number; ty: number }
  /** 계단: 내려가기 시작 · 다음 층에 들어섬 */
  | { type: 'descendStart'; p: number }
  | { type: 'floor'; n: number }
  /** 전리품이 떨어짐 (owner 에게만 보인다) */
  | { type: 'loot'; owner: number; x: number; y: number; rarity: number }
  /** 주웠다 */
  | { type: 'pickup'; p: number; rarity: number; uid: number }
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
  | { type: 'wake'; pack: number; x: number; y: number }
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
  /** 몬스터 배치를 끈다 (시험용) */
  noMonsters?: boolean
  /** 자리별 캐릭터 기록 (레벨·장비·가방·골드). 없으면 1레벨 맨몸 */
  sheets?: (Sheet | undefined)[]
  /** 원정 층 수 (기본 FLOORS). 시험용으로 줄일 수 있다 */
  floors?: number
}

export interface GameState {
  tick: number
  rng: Rng
  phase: Phase
  phaseTimer: number
  mode: GameMode
  /** 투기장 목표 킬 (던전은 0) */
  targetKills: number
  deathRule: DeathRule
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
  /** 층 입구 (px) — 죽은 사람이 여기서 일어난다 */
  entryX: number
  entryY: number
  /** 지금 층 (1부터) · 마지막 층(보스) */
  floor: number
  floorMax: number
  /** 계단 (없으면 -1 — 보스 층) */
  stairX: number
  stairY: number
  /** 내려가기 카운트다운 (틱, -1 = 아님) */
  descend: number
  /** 다음 층으로 넘어가야 한다 (세션이 새 맵을 만들어 enterFloor 를 부른다 — 모두 같은 틱에) */
  pendingFloor: number
  /** 이 층의 처음 몬스터 수 (진행 표시) */
  monstersTotal: number
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
