import { CharacterId } from './characters'
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
  over: boolean
  /** 쏠 때 커서가 약점 위에 있던 몬스터 id (-1 = 없음). 이 몬스터를 맞히면 치명타 */
  headTarget: number
  overR: number
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
}

/** 몬스터 상태 */
export const MS_SLEEP = 0
export const MS_CHASE = 1
export const MS_WINDUP = 2
export const MS_RECOVER = 3

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

/** 회복 구슬 */
export interface Globe {
  id: number
  x: number
  y: number
  ttl: number
}

export type SimEvent =
  | { type: 'fire'; p: number; x: number; y: number; aim: number; weapon: WeaponId }
  /** 저격총 개머리판 후려치기 (조준경 없이 쏠 때) */
  | { type: 'bash'; p: number; x: number; y: number; aim: number }
  /** 플레이어가 맞음 (by = 몬스터 id, 플레이어가 아니다) */
  | { type: 'hurt'; p: number; by: number; x: number; y: number; dmg: number }
  | { type: 'down'; p: number; x: number; y: number }
  | { type: 'revive'; p: number; by: number; x: number; y: number }
  | { type: 'death'; p: number; x: number; y: number; out: boolean }
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
  /** 끝: winner 0 = 층 정리, 1 = 전멸 */
  | { type: 'over'; winner: number }

export interface MatchConfig {
  seed: number
  /** 자리 수 = 길이 (1..MAX_PLAYERS). 아직 아무도 안 들어온 자리도 포함한다 */
  chars: CharacterId[]
  /** 아직 사람이 없는 자리 (true 면 `left` 로 시작) — 자리를 처음부터 잡아 두어 배열을 늘리지 않는다 */
  absent?: boolean[]
  /** 죽음 규칙 (기본 0) */
  deathRule?: DeathRule
  /** 몬스터 배치를 끈다 (시험용) */
  noMonsters?: boolean
}

export interface GameState {
  tick: number
  rng: Rng
  phase: Phase
  phaseTimer: number
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
  /** 층 입구 (px) — 죽은 사람이 여기서 일어난다 */
  entryX: number
  entryY: number
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
