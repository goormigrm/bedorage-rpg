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
  { id: 2, key: 'shake', name: '손 떨림', desc: '30초 동안 조준이 마구 흔들린다', amount: 2000 },
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
 * 응원 (2026-09-23 사용자: "치지직과 연동해서 재미있는 기능을 더"). 금액표에 없는 이벤트 — 방송인을 괴롭히는 대신 **돕는다**.
 * 후원 글에 "!응원" 을 쓰면(금액은 가장 싼 이벤트 이상) · 치지직 구독이 오면 · 시청자 투표에서 "축복" 이 이기면 일어난다.
 */
export const CHEER_EVENT: DonateEvent = { id: 11, key: 'cheer', name: '응원', desc: '우리 편 체력 50% 회복 · 20초 공격 속도 +25%', amount: 0 }
/** 응원: 회복 비율 · 공격 속도 버프 (길이 · 배율) */
export const CHEER_HEAL = 0.5
export const CHEER_TICKS = 20 * TICK_RATE
export const CHEER_RATE = 1.25
/** 후원 글에 이것이 있으면 응원 */
export const CHEER_RE = /!\s*(응원|힐|cheer)/i
/** 소환하는 이벤트 (소환 상한에 걸리면 자리가 날 때까지 기다린다) */
export const SUMMON_KEYS = new Set<DonateEvent['key']>(['horde', 'elite', 'unique', 'boss', 'hell'])

export const donateEvent = (id: number): DonateEvent | undefined => (id === CHEER_EVENT.id ? CHEER_EVENT : DONATE_EVENTS.find((e) => e.id === id))

/** 사람에게 거는 효과의 칸 (PlayerState.don) */
export const DON_SHAKE = 0
export const DON_DARK = 1
export const DON_INVERT = 2
export const DON_SEAL = 3
export const DON_SLOTS = 4

/** 효과 길이 (틱). 같은 것이 또 오면 이어 붙이되 DON_MAX 까지 */
export const DON_TICKS: Record<number, number> = {
  [DON_SHAKE]: 30 * TICK_RATE,
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
/** 손 떨림: 매 틱 조준이 이만큼(1024 단계) 안에서 흔들린다 — 약 ±20° */
export const SHAKE_AIM = 56
/** 암흑일 때 시야 (타일 — 보통 13) */
export const DARK_VIEW_TILES = 2.6
