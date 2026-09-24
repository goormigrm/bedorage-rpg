// 후원 이벤트 (2026-09-23 사용자: "치지직 후원 시 금액에 따라 중간보스나 쎈 보스가 즉시 소환" ·
// "어떤 금액이면 시야가 근접 아니면 안 보인다거나, 특정 금액에서 반동이 엄청 생긴다거나 — 특별한 이벤트 10가지 정도 금액에 비례해서").
// 게임에 영향을 주는 것은 모두 입력 명령(CMD_DONATE)으로 sim 에 들어간다 — 모두의 판에서 같은 틱에 같게 일어난다(락스텝).
// 금액은 방송인이 설정에서 바꾼다(game/stream.ts). 여기 amount 는 처음 값이다.
// 2026-09-23 사용자: "만오천 원은 없애고 2만 3만 5만 10만" → 스킬 봉인부터 한 칸씩 올렸다.

import { TICK_RATE } from './state'

export interface DonateEvent {
  /** 명령 arg 아래 네 비트 (1..15) */
  id: number
  key: 'horde' | 'shake' | 'dark' | 'elite' | 'invert' | 'unique' | 'seal' | 'rage' | 'boss' | 'hell' | 'cheer'
  name: string
  /** 표 · 배너에 쓰는 한 줄 */
  desc: string
  /** 처음 금액(원) */
  amount: number
}

export const DONATE_EVENTS: DonateEvent[] = [
  { id: 1, key: 'horde', name: '좀비 떼', desc: '졸개 여덟이 몰려온다', amount: 1000 },
  { id: 2, key: 'shake', name: '손 떨림', desc: '10초 동안 조준이 좌우로 흔들린다', amount: 2000 },
  { id: 3, key: 'dark', name: '암흑', desc: '30초 동안 코앞만 보인다', amount: 3000 },
  { id: 4, key: 'elite', name: '정예 무리', desc: '정예 하나 + 졸개 셋', amount: 5000 },
  { id: 5, key: 'invert', name: '거꾸로 걷기', desc: '20초 동안 이동이 반대로', amount: 7000 },
  { id: 6, key: 'unique', name: '중간보스', desc: '우두머리 + 호위 셋', amount: 10000 },
  { id: 7, key: 'seal', name: '스킬 봉인', desc: '30초 동안 스킬 · 궁극기 · 구르기 금지', amount: 20000 },
  { id: 8, key: 'rage', name: '광폭화', desc: '60초 동안 괴물이 1.5배 세고 빠르다', amount: 30000 },
  { id: 9, key: 'boss', name: '막 보스', desc: '이 막의 보스가 나타난다', amount: 50000 },
  { id: 10, key: 'hell', name: '지옥문', desc: '막 보스 + 중간보스 둘 + 암흑', amount: 100000 },
]

/**
 * 응원 (2026-09-23 사용자: "치지직과 연동해서 재미있는 기능을 더" → "응원도 가격에 따라서 효과를 다르게"). 금액표와 따로 —
 * 방송인을 괴롭히는 대신 **돕는다**. 후원 글에 "!응원" 을 쓰면 금액이 넘는 것 중 가장 비싼 단계가 일어난다(금액은 방송인이 정한다).
 * 번호 11~14 (명령 arg 아래 네 비트 안).
 *
 * 2026-09-24 사용자: "응원의 효과가 너무 별로야 — 체력 즉시 회복보다는 주변에 체력 회복 템을 소환하도록, 만 원은 큰 금액인 거에 비해
 * 별로야 — 체력 전부 · 부활 이런 거보다는 공격 속도 · 공격력 · 아군 몬스터 10초 소환 같은 효과로" →
 * 즉시 회복 · 부활 · 무적을 뺐다. 싼 단계는 **회복 구슬**(밟으면 25% · 곁의 동료 12% — 가득이면 줍지 않고 남는다),
 * 비싼 단계는 **공격 강화**(공격력 + 공격 속도)와 **아군 괴물**.
 */
export interface CheerDef extends DonateEvent {
  /** 부른 사람 둘레에 떨어뜨리는 회복 구슬 수 */
  globes: number
  /** 같은 지역 우리 편: 공격 속도 배율 · 공격력 배율 (1 이면 없음) · 길이(틱) */
  rate: number
  pow: number
  ticks: number
  /** 아군 괴물: 수 · 머무는 틱 · 막 보스 모습인가 */
  allies: number
  allyTicks: number
  allyBoss: boolean
}
// 이름 = 효과 (2026-09-24 사용자: "힘내라 · 함성 · 기적 이런 건 직관적이지 않다 — 무슨 효과인지 간단하게")
export const CHEER_EVENTS: CheerDef[] = [
  { id: 11, key: 'cheer', name: '회복 구슬 3개', desc: '둘레에 회복 구슬 셋 (밟으면 체력 25%)', amount: 1000, globes: 3, rate: 1, pow: 1, ticks: 0, allies: 0, allyTicks: 0, allyBoss: false },
  { id: 12, key: 'cheer', name: '회복 구슬 5개 + 공격 속도', desc: '회복 구슬 다섯 · 우리 편 20초 공격 속도 +30%', amount: 5000, globes: 5, rate: 1.3, pow: 1, ticks: 20 * TICK_RATE, allies: 0, allyTicks: 0, allyBoss: false },
  { id: 13, key: 'cheer', name: '아군 괴물 넷 + 공격 강화', desc: '아군 괴물 넷이 10초 싸운다 · 우리 편 30초 공격력 · 공격 속도 +40%', amount: 10000, globes: 0, rate: 1.4, pow: 1.4, ticks: 30 * TICK_RATE, allies: 4, allyTicks: 10 * TICK_RATE, allyBoss: false },
  { id: 14, key: 'cheer', name: '아군 보스 + 공격 강화', desc: '막 보스가 20초 우리 편 · 우리 편 40초 공격력 · 공격 속도 +60% · 회복 구슬 다섯', amount: 30000, globes: 5, rate: 1.6, pow: 1.6, ticks: 40 * TICK_RATE, allies: 1, allyTicks: 20 * TICK_RATE, allyBoss: true },
]
/** 아군 괴물 한 번 치는 피해: 그 지역 구울 체력의 이만큼 (보스 모습은 둘레 ALLY_BOSS_SPLASH 를 함께 친다) */
export const ALLY_HIT = 0.35
export const ALLY_BOSS_HIT = 1.2
export const ALLY_BOSS_SPLASH = 70
/** 공격 간격 (틱) · 괴물을 찾는 거리(부른 사람에게서, px) */
export const ALLY_CD = 36
export const ALLY_BOSS_CD = 45
export const ALLY_SEEK = 9 * 32
export const cheerEvent = (id: number): CheerDef | undefined => CHEER_EVENTS.find((e) => e.id === id)
/** 후원 글에 이것이 있으면 응원 */
export const CHEER_RE = /!\s*(응원|힐|cheer)/i
/** 소환하는 이벤트 (소환 상한에 걸리면 자리가 날 때까지 기다린다) */
export const SUMMON_KEYS = new Set<DonateEvent['key']>(['horde', 'elite', 'unique', 'boss', 'hell'])

export const donateEvent = (id: number): DonateEvent | undefined => cheerEvent(id) ?? DONATE_EVENTS.find((e) => e.id === id)

/** 사람에게 거는 효과의 칸 (PlayerState.don) */
export const DON_SHAKE = 0
export const DON_DARK = 1
export const DON_INVERT = 2
export const DON_SEAL = 3
export const DON_SLOTS = 4

/** 효과 길이 (틱). 같은 것이 또 오면 이어 붙이되 DON_MAX 까지 (손 떨림은 SHAKE_MAX) */
export const DON_TICKS: Record<number, number> = {
  // 손 떨림 30 → 10초 (2026-09-24 사용자: "2000원으로 저렴한 거에 비해 너무 길고 방해 효과가 너무 크다")
  [DON_SHAKE]: 10 * TICK_RATE,
  [DON_DARK]: 30 * TICK_RATE,
  [DON_INVERT]: 20 * TICK_RATE,
  [DON_SEAL]: 30 * TICK_RATE,
}
export const DON_MAX = 120 * TICK_RATE
/** 지옥문의 암흑 */
export const HELL_DARK_TICKS = 20 * TICK_RATE
/** 광폭화: 길이 · 공격력 · 이동 배율 */
export const RAGE_TICKS = 60 * TICK_RATE
export const RAGE_POW = 1.5
export const RAGE_SPEED = 1.3
/**
 * 손 떨림: 조준이 좌우로 천천히 흔들린다 — 약 ±7°(1024 단계 20), 0.8초에 한 번 오간다 + 틱마다 ±1.4° 잔떨림.
 * 예전(v0.50)에는 틱마다 ±20° 를 아무렇게나 튀어 30초 동안 거의 맞힐 수 없었다 (2026-09-24 사용자 — 싼 것에 비해 너무 세다)
 */
export const SHAKE_AIM = 20
export const SHAKE_JITTER = 4
/** 손 떨림이 몰려도 이어 붙는 끝 (30초) */
export const SHAKE_MAX = 30 * TICK_RATE
/** 암흑일 때 시야 (타일 — 보통 13) */
export const DARK_VIEW_TILES = 2.6
