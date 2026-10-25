// 후원 이벤트 (2026-09-23 사용자: "치지직 후원 시 금액에 따라 중간보스나 쎈 보스가 즉시 소환" ·
// "어떤 금액이면 시야가 근접 아니면 안 보인다거나, 특정 금액에서 반동이 엄청 생긴다거나 — 특별한 이벤트 10가지 정도 금액에 비례해서").
// 게임에 영향을 주는 것은 모두 입력 명령(CMD_DONATE)으로 sim 에 들어간다 — 모두의 판에서 같은 틱에 같게 일어난다(락스텝).
// 금액은 방송인이 설정에서 바꾼다(game/stream.ts). 여기 amount 는 처음 값이다.
// 2026-09-23 사용자: "만오천 원은 없애고 2만 3만 5만 10만" → 스킬 봉인부터 한 칸씩 올렸다.
// 2026-10-22 사용자: "500원 단위 후원 이벤트는 없애고 1만 원 이하는 천 원마다 더 다양한 이벤트로 · 거꾸로 걷기 5초" →
//   같은 날 "거꾸로 걷기 · 화면 흔들림은 5천 원 아래로(더 자주) · 시야 축소 20초 · 그 자리로 올라간 괴물 소환은 값에 맞게 더 많고 세게" →
//   1천 좀비 떼 · 2천 화면 흔들림 · 3천 정예 무리 · 4천 거꾸로 걷기 · 5천 막 보스 · 6천 총잡이 무리(여섯) · 7천 중간보스(호위 다섯) · 8천 시야 축소 ·
//   9천 괴물 대행진 · 1만 스킬 봉인 · 2만 광폭화 · 3만 지옥문. 번호 15 넘는 것은 CMD_DONATE_HI 로 (명령 arg 한 바이트 — 아래 네 비트가 번호)

import { TICK_RATE } from './state'

export interface DonateEvent {
  /** 1..15 = CMD_DONATE · 16..31 = CMD_DONATE_HI (arg 아래 네 비트 = 번호 - 16) */
  id: number
  key: 'horde' | 'shake' | 'dark' | 'elite' | 'invert' | 'unique' | 'seal' | 'rage' | 'boss' | 'hell' | 'gun' | 'march'
  name: string
  /** 표 · 배너에 쓰는 한 줄 */
  desc: string
  /** 처음 금액(원) */
  amount: number
}

export const DONATE_EVENTS: DonateEvent[] = [
  { id: 1, key: 'horde', name: '좀비 떼', desc: '이 지역 괴물 열이 몰려온다', amount: 1000 },
  { id: 2, key: 'shake', name: '화면 흔들림', desc: '5초 동안 화면이 떨린다', amount: 2000 },
  // 이름 암흑 → 시야 축소 (2026-10-07 사용자) — 효과 · 금액 · 번호는 그대로
  { id: 3, key: 'dark', name: '시야 축소', desc: '20초 동안 코앞만 보인다', amount: 8000 },
  { id: 4, key: 'elite', name: '정예 무리', desc: '정예 하나 + 졸개 셋', amount: 3000 },
  { id: 5, key: 'invert', name: '거꾸로 걷기', desc: '5초 동안 이동이 반대로', amount: 4000 },
  { id: 6, key: 'unique', name: '중간보스', desc: '우두머리 + 호위 다섯', amount: 7000 },
  { id: 7, key: 'seal', name: '스킬 봉인', desc: '30초 동안 스킬 금지 (궁극기 · 구르기는 된다)', amount: 10000 },
  { id: 8, key: 'rage', name: '광폭화', desc: '60초 동안 괴물이 1.5배 세고 빠르다', amount: 20000 },
  { id: 9, key: 'boss', name: '막 보스', desc: '이 막의 보스 — 체력 절반 · 즉사기 없음', amount: 5000 },
  { id: 10, key: 'hell', name: '지옥문', desc: '막 보스(체력 절반) + 중간보스 둘 + 시야 축소', amount: 30000 },
  { id: 15, key: 'gun', name: '총잡이 무리', desc: '총 쏘는 괴물 여섯이 몰려온다', amount: 6000 },
  { id: 16, key: 'march', name: '괴물 대행진', desc: '괴물 스물 + 정예 무리', amount: 9000 },
]

/**
 * 후원으로 부른 막 보스(막 보스 · 지옥문)의 체력 배율 (2026-09-27 사용자: "소환 막 보스는 체력을 반으로" — 즉사기도 쓰지 않는다, sim bossThink).
 * 분당 2.5건이면 4막 심연의 군주 소환에 파티가 거듭 쓰러져 한 바퀴가 1시간 넘게 늘었다
 */
export const SUMMON_BOSS_HP = 0.5
/** 소환하는 이벤트 (소환 상한에 걸리면 자리가 날 때까지 기다린다) */
export const SUMMON_KEYS = new Set<DonateEvent['key']>(['horde', 'elite', 'unique', 'boss', 'hell', 'gun', 'march'])
/** 괴물 대행진이 한 번에 부르는 수 (소환 상한 안에 들어갈 때만 — session.canRunDonation) */
export const MARCH_SIZE = 24

export const donateEvent = (id: number): DonateEvent | undefined => DONATE_EVENTS.find((e) => e.id === id)

/** 사람에게 거는 효과의 칸 (PlayerState.don) */
export const DON_SHAKE = 0
export const DON_DARK = 1
export const DON_INVERT = 2
export const DON_SEAL = 3
export const DON_SLOTS = 4

/** 효과 길이 (틱). 같은 것이 또 오면 이어 붙이되 DON_MAX 까지 (화면 흔들림은 SHAKE_MAX) */
export const DON_TICKS: Record<number, number> = {
  // 손 떨림 30 → 10초 (2026-09-24 사용자: "2000원으로 저렴한 거에 비해 너무 길고 방해 효과가 너무 크다")
  // 10 → 5초 (2026-09-26 사용자: 화면 흔들림이 "너무 멀미 난다 — 작게 · 시간도 줄여")
  [DON_SHAKE]: 5 * TICK_RATE,
  // 30 → 20초 (2026-10-22 사용자: "시야 축소는 20초만")
  [DON_DARK]: 20 * TICK_RATE,
  // 20 → 5초 (2026-10-22 사용자: "거꾸로 걷기도 5초로 줄여줘")
  [DON_INVERT]: 5 * TICK_RATE,
  [DON_SEAL]: 30 * TICK_RATE,
}
export const DON_MAX = 120 * TICK_RATE
/**
 * 같은 방해 효과가 이어 붙는 한도(초) — **방송인이 정한다** (2026-09-25 사용자 고른 방송 개선 5: 암흑 · 거꾸로 · 봉인이 몰리면 2분까지 이어 붙었다).
 * 후원을 받은 사람(방송인)의 값으로 파티 모두에게 건다. CMD_DONCAP 의 arg = 초 / 10. 화면 흔들림은 SHAKE_MAX(15초)를 넘지 않는다. 넘는 후원은 버리지 않고 기다린다(effectFits — 2026-09-27)
 */
export const DON_CAP_CHOICES = [30, 60, 90, 120]
export const DON_CAP_DEFAULT = 60
/** 지옥문의 암흑 */
export const HELL_DARK_TICKS = 20 * TICK_RATE
/** 광폭화: 길이 · 공격력 · 이동 배율 */
export const RAGE_TICKS = 60 * TICK_RATE
export const RAGE_POW = 1.5
export const RAGE_SPEED = 1.3
/**
 * 화면 흔들림 (2026-09-26 사용자: "승빠란으로 손 떨림을 받아도 안 느껴진다 — 캐릭터만 약간 좌우로 움직인다 · 화면 떨림으로"):
 * 전에는 sim 이 조준을 ±7° 흔들었다 — 넓게 휘두르는 근접(후라이팬 · 검)에는 거의 상관이 없었다. 이제 **화면(카메라)만** 출렁인다
 * (render3d/renderer3d.ts updateCamera). 판은 그대로이고, 마우스 조준점이 화면을 따라 움직여 총은 겨누기도 어렵다
 */
/** 화면 흔들림이 몰려도 이어 붙는 끝 (30 → 15초 — 2026-09-26 멀미) */
export const SHAKE_MAX = 15 * TICK_RATE
/**
 * 사람에게 거는 효과(화면 흔들림 · 암흑 · 거꾸로 · 봉인)가 한도에 걸리면 **버리지 않고 기다린다** (2026-09-27 사용자: "후원 시 최대 시간에
 * 의해서 아예 버려지는 건 별로 — 시간만큼 기다렸다가 누적해 놨다가 계속 반영되도록"). 지금 남은 길이 + 이번 길이가 한도 안일 때만 판에 넣는다
 * → 앞 효과가 줄어드는 대로 차례로 이어진다(후원자 이름 알림도 그때 뜬다). 지옥문의 암흑도 같다.
 * 광폭화는 걸려 있는 동안 기다린다(겹치면 60초로 다시 채울 뿐이라 앞 것이 버려졌다). 소환 자리 · 막 보스 하나는 session.canRunDonation 이 본다.
 * don = 방송인(후원을 받은 사람)의 PlayerState.don · capSec = 그 사람의 한도(초) · rageLeft = 그 지역 괴물의 가장 긴 광폭화(틱)
 */
export function effectFits(id: number, don: readonly number[] | undefined, capSec: number, rageLeft: number): boolean {
  const e = donateEvent(id)
  if (!e) return true
  if (e.key === 'rage') return rageLeft <= 0
  const slot = e.key === 'shake' ? DON_SHAKE : e.key === 'dark' || e.key === 'hell' ? DON_DARK : e.key === 'invert' ? DON_INVERT : e.key === 'seal' ? DON_SEAL : -1
  if (slot < 0) return true
  const ticks = e.key === 'hell' ? HELL_DARK_TICKS : DON_TICKS[slot]
  const cap = Math.min(DON_MAX, capSec * TICK_RATE)
  const max = slot === DON_SHAKE ? Math.min(SHAKE_MAX, cap) : cap
  const left = don?.[slot] ?? 0
  // 한 번 길이가 한도 이상이면(생기지 않지만) 다 끝난 뒤에 — 영영 못 들어가지 않게
  return left <= 0 || left + ticks <= max
}
/** 암흑일 때 시야 (타일 — 보통 13) */
export const DARK_VIEW_TILES = 2.6
