import { CharacterId } from './characters'
import { Rng } from './rng'
import { WeaponId } from './weapons'

export const TICK_RATE = 60
export const TICK_MS = 1000 / TICK_RATE
export const PLAYER_RADIUS = 14
export const RESPAWN_TICKS = 180
export const SPAWN_PROTECT_TICKS = 90
export const COUNTDOWN_TICKS = 180
export const DASH_TICKS = 10
export const DASH_SPEED = 9
/** 기력: 대시와 (근접 무기 보유 시) 총알 막기에 쓴다 */
export const STAMINA_MAX = 100
/** 틱당 회복 (약 4.5초에 가득) */
export const STAMINA_REGEN = 22 / 60
export const DASH_COST = 34
/**
 * 달리기(Shift): 누르고 있는 동안 이동 속도 배율과 틱당 기력 소모.
 * 한 통(100)으로 약 3.3초 달린다. 구르기 세 번보다 조금 못한 값이라,
 * "달릴까 굴러 둘까" 를 계속 고르게 된다. 달리는 동안에는 기력이 차지 않는다.
 */
export const SPRINT_MUL = 1.4
export const SPRINT_COST = 30 / 60
/**
 * 다시 달리기 시작하려면 기력이 이만큼은 차 있어야 한다(약 0.9초).
 * 이게 없으면 기력 0 에서 **한 틱 회복 → 한 틱 달리기**가 반복돼 사실상 무한히 달린다
 * (회복 22/60 이 소모 30/60 과 비슷해서 그렇다). 달리던 중에는 0 까지 쓴다.
 */
export const SPRINT_MIN = 20
/** 후라이팬 방어: 피해 1 을 막는 데 드는 기력 (기력 한 통 = 피해 181) */
export const BLOCK_COST = 0.55
/** 막은 뒤 기력이 다시 차기까지 (계속 맞으면 방어가 뚫리도록) */
export const BLOCK_LOCK_TICKS = 30
/**
 * 앞에서 오는 탄을 후라이팬으로 막을 확률. 나머지는 그대로 맞는다.
 * 2026-09-06 50% → 2026-09-05 오픈 베타 제보("사람끼리는 아직 세다") 로 40% → 같은 날 두 번째 제보("숨었다 나타나면 총이 대응을 못 한다") 로 **25%**.
 * 대신 기력 통은 150 (characters.ts staminaMax).
 */
export const BLOCK_CHANCE = 0.25
/**
 * 통천덕 패시브(치킨): 킬마다 최대 체력이 늘고 조금 회복한다. 죽으면 원래대로.
 * 전에는 킬 시 50 회복이었다(2026-09-06 변경 — 회복은 줄이고 최대 체력을 올리는 쪽으로).
 */
export const CHICKEN_MAXHP_PER_KILL = 15
export const CHICKEN_MAXHP_CAP = 60
export const CHICKEN_HEAL = 20
/** 우원덕 패시브(연기): 구르기가 끝난 뒤에도 이만큼 무적이 이어진다 (틱). 계측 도구가 바꿔 볼 수 있게 객체 */
/**
 * 풍월덕 패시브(바람): 구르기 기력 34 → 22. 재사용 시간(25틱)만 짧아서는 소용이 없었다 — 기력 회복(22/60)이 구르기 한 번에 93틱이라
 * 세 번 구른 뒤에는 남들과 똑같이 1.5초에 한 번이었다(2026-09-05 확인). 22 면 한 통에 네 번, 이후 1초에 한 번.
 */
/**
 * 침착덕 패시브(침착): 탄퍼짐 배율 · 발당 반동 배율 · 반동 회복 배율.
 * 2026-09-05 확인: 소총은 발당 반동 7(2.6°)이 연사 간격 10틱 동안 회복(1/틱)으로 다 사라져 **반동이 쌓이지 않는다** —
 * 그래서 "회복 2배" 패시브는 봇 표에서 아무 효과가 없었다(39.5%, 바닥). 눈에 보이는 "흔들림" 은 탄퍼짐이라 그쪽을 줄인다.
 */
export const CHIM = { spreadMul: 0.55, recoilMul: 0.45, recoverMul: 3 }
export const PUNGWOL = { dashCost: 22 }
export const UWON = { invulnAfterDash: 24 } // 2026-09-05: 12 → 18 → 24 (0.4초). 어려움 봇 기준으로는 24 가 60% 였지만 보통 봇 기준 37%(바닥)라 올렸다
/** 주펄덕 패시브(빛남): 이 거리(px) 안의 상대에게 피해 배율 */
export const JUPEOL = { range: 200, mult: 1.35 } // 2026-09-05: 150px·1.2 → 200px·1.35. 배율보다 범위가 효과적이었다(봇은 150 안에서 잘 안 싸운다)
/** 기열덕 패시브(뇌절): 연속 명중마다 피해 배율이 오른다. 빗나가면 한 단계 내려간다 (계측 도구가 바꿔 볼 수 있게 객체) */
export const GIYEOL = { perHit: 0.06, maxStacks: 6 } // 2026-09-05: 소총으로 바꾸며 9% → 6% (최대 +36%)
/** 죽은 자리에 떨어지는 힐팩: 회복량(최대 체력 비율) · 유지 시간 · 줍는 반경 */
export const MEDKIT_HEAL_FRAC = 0.35
export const MEDKIT_TTL = 60 * 20
export const MEDKIT_RADIUS = 26

/** 리스폰 후 이 틱 안에는 Tab 으로 캐릭터를 바꿀 수 있다 (3초) */
export const SWAP_GRACE_TICKS = 180
/** 한 경기 최대 인원 (방 정원) */
/**
 * 한 방 최대 인원. 6~8명도 계산·대역폭은 여유지만(8인 기준 틱당 0.03ms · 22KB/s),
 * **풀 메시 연결 수**가 8인이면 28쌍이라 TURN 없이 전부 뚫릴 확률이 떨어지고,
 * 락스텝이라 한 사람의 지터가 전원에게 퍼진다. 실제로 3인 테스트에서 한 명이 무선이면 끊김이 체감됐다.
 * 그래서 4로 둔다. (측정값은 CHANGELOG v1.4 참고)
 */
export const MAX_PLAYERS = 4
export const MIN_PLAYERS = 2

export type Phase = 'countdown' | 'playing' | 'over'

export interface PlayerState {
  /** 플레이어 인덱스 0..MAX_PLAYERS-1 */
  id: number
  /** 팀 번호. 개인전(FFA)에서는 자기 인덱스와 같다 → 모두가 서로 적. 팀전에서는 0/1 */
  team: number
  char: CharacterId
  x: number
  y: number
  aim: number
  hp: number
  /** 지금의 최대 체력. 보통 캐릭터 값과 같고, 통천덕은 킬마다 늘어난다(죽으면 원래대로) */
  maxHp: number
  alive: boolean
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
  kills: number
  deaths: number
  legInjury: number
  invuln: number
  /** 이번 틱 이동 여부 (렌더 걷기 애니메이션용) */
  moving: boolean
  /** 이번 틱 달리는 중 (Shift). 기력을 쓰고, 그동안 기력이 차지 않는다 */
  sprinting: boolean
  /** 스폰 이후 살아있는 틱 수 (렌더용) */
  aliveTicks: number
  /** 경기 도중 나간 사람. 더 이상 리스폰하지 않고 표적에서도 제외 */
  left: boolean
  /** 아직 아무도 앉지 않은 자리 (left 와 함께 true). 화면에 "나감" 이 아니라 "빈 자리" 로 보인다 */
  vacant: boolean
  /** 캐릭터 고르는 중: 소환되지 않아 맞지도 않는다. 고르면 먼 곳에 리스폰 */
  choosing: boolean
  /** 연속 명중 수 (기열덕 패시브). 빗나가면 0 */
  streak: number
  /** 기력 0..staminaMax */
  stamina: number
  /** 기력 통 크기. 보통 STAMINA_MAX(100), 승빠덕은 150 — 막기를 약하게 하는 대신 더 구르고 달리라고 (2026-09-05) */
  staminaMax: number
  /** 총알을 막은 직후 기력이 다시 차지 않는 틱 수. 계속 맞으면 방어가 결국 뚫린다 */
  blockLock: number
  /** 결과 화면 통계. sim 안에 두어야 리싱크·재접속에도 값이 어긋나지 않는다 */
  shots: number
  hits: number
  heads: number
  dmgDealt: number
  dmgTaken: number
  /** 한 판에서 죽지 않고 이어 간 최다 킬 */
  bestStreak: number
  /** 지금 연속 킬 (죽으면 0) */
  killStreak: number
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
  /** 누군가를 맞혔는가 (빗나감 판정용) */
  hitSomeone: boolean
  /** 모래주머니를 끝까지 넘어가는 탄 (머리를 정확히 겨눈 탄) */
  over: boolean
  /** 쏠 때 커서가 올라가 있던 적 (-1 = 없음). 이 사람을 정중앙으로 맞혀야 머리다 */
  headTarget: number
  /**
   * 엄폐 사격이 모래주머니를 넘기는 거리(총구 기준, 0 이면 없음).
   * 기대 못 넘게 하는 것은 **내가 기대고 있는 그 자루**뿐이다.
   * 전에는 엄폐 중이면 맵의 모든 모래주머니를 통과해서, 멀리 있는 자루도 뚫렸다.
   */
  overR: number
}

export type SimEvent =
  | { type: 'fire'; p: number; x: number; y: number; aim: number; weapon: WeaponId }
  /** 저격총 개머리판 후려치기 (조준경 없이 쏠 때) */
  | { type: 'bash'; p: number; x: number; y: number; aim: number }
  | { type: 'hit'; p: number; by: number; x: number; y: number; part: number; dmg: number }
  | { type: 'death'; p: number; by: number; x: number; y: number }
  | { type: 'respawn'; p: number; x: number; y: number }
  | { type: 'dash'; p: number }
  | { type: 'reload'; p: number }
  | { type: 'wall'; x: number; y: number; aim: number }
  | { type: 'leave'; p: number }
  /** 빈 자리에 사람이 들어왔다 (난입) */
  | { type: 'join'; p: number; char: CharacterId }
  /** 모래주머니 파괴 */
  | { type: 'break'; tx: number; ty: number }
  /** 근접 무기로 총알을 막음 */
  | { type: 'block'; p: number; x: number; y: number }
  /** 힐팩이 떨어짐 */
  | { type: 'drop'; x: number; y: number }
  /** 힐팩을 주움 */
  | { type: 'heal'; p: number; x: number; y: number; amount: number }
  /** 캐릭터 선택 화면 진입 (소환 해제) */
  | { type: 'choose'; p: number }
  /** 캐릭터가 바뀜 */
  | { type: 'swap'; p: number; char: CharacterId }
  | { type: 'start' }
  | { type: 'over'; winner: number }

export interface MatchConfig {
  seed: number
  targetKills: number
  /** 자리 수 = 길이 (2..MAX_PLAYERS). 아직 아무도 안 들어온 자리도 포함한다 */
  chars: CharacterId[]
  /** 팀 배정. 생략하면 개인전(각자 자기 인덱스가 팀) */
  teams?: number[]
  /**
   * 아직 사람이 없는 자리. true 면 `left` 로 시작해 판에 나오지 않는다.
   * 자리 수를 처음부터 최대로 잡아 두면 **중간에 배열을 늘리지 않아도** 난입을 받을 수 있다
   * (배열 크기가 바뀌면 모두가 정확히 같은 틱에 같은 방식으로 늘려야 해서 어긋나기 쉽다).
   */
  absent?: boolean[]
}
/** 맵은 GameState 밖(정적)이라 MatchConfig 에 넣지 않고 세션 설정으로 따로 전달한다 */

/** 죽은 자리에 떨어지는 힐팩. 이긴 쪽이 이어서 싸울 수 있게 해 준다 */
export interface Medkit {
  id: number
  x: number
  y: number
  /** 남은 틱 */
  ttl: number
}

export interface GameState {
  tick: number
  rng: Rng
  phase: Phase
  phaseTimer: number
  targetKills: number
  players: PlayerState[]
  bullets: Bullet[]
  nextBulletId: number
  /** 이긴 팀 (개인전이면 플레이어 인덱스). -1 = 아직 */
  winner: number
  /** 살아있는 모래주머니: 타일 인덱스 → 남은 내구도 */
  sandbags: Record<number, number>
  /** 바닥에 떨어진 힐팩 */
  medkits: Medkit[]
  nextMedkitId: number
  /** 이번 step 에서 발생한 이벤트. 해시/스냅샷 대상 아님. */
  events: SimEvent[]
}

/** 팀 킬 합계 */
export function teamKills(state: GameState, team: number): number {
  let k = 0
  for (const p of state.players) if (p.team === team) k += p.kills
  return k
}

/** 팀전인가 (같은 팀이 둘 이상) */
export function isTeamMatch(state: GameState): boolean {
  const seen = new Set<number>()
  for (const p of state.players) {
    if (seen.has(p.team)) return true
    seen.add(p.team)
  }
  return false
}

/** 서로 적인가 */
export function isEnemy(a: PlayerState, b: PlayerState): boolean {
  return a.id !== b.id && a.team !== b.team
}
