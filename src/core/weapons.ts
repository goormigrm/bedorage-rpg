// 무기 밸런스 테이블. 시간 단위는 틱(60Hz), 거리는 px.
// 밸런스 원칙 (2026-09-04): 체력이 2배(170~300)라 총으로 여러 발 주고받아야 죽는다.
// 저격총만 한 방(몸 120, 머리 240)에 죽일 수 있고, 나머지는 한 번의 사격으로 죽지 않는다.

export type WeaponId = 'pistol' | 'smg' | 'rifle' | 'shotgun' | 'sniper' | 'mg' | 'pan'

/** 저격 조준경 탄이 반지름의 이 비율 바깥으로 지나가면 '스침' — 죽이지 않고 체력 grazeLeave 를 남긴다 */
export const SNIPER_GRAZE_FRAC = 0.7

/** 조준경 없이 쏠 때의 개머리판 후려치기 (저격총). 탄·재장전과 무관하게 언제나 된다 */
export interface BashDef {
  damage: number
  range: number
  arc: number
  interval: number
}

export interface WeaponDef {
  id: WeaponId
  name: string
  damage: number
  /** 조준경(ADS)으로 맞히면 한 방 — 스치면(반지름 바깥 SNIPER_GRAZE_FRAC) 체력을 grazeLeave 만 남긴다 (저격총, 2026-09-05) */
  lethalAds?: boolean
  grazeLeave?: number
  bash?: BashDef
  /** 발당 탄 수 (산탄) */
  pellets: number
  /** 발사 간격 (틱) */
  fireInterval: number
  /** 자동 연사 여부. 모든 무기가 꾹 누르면 발사 간격마다 계속 쏜다 (탄이 떨어지면 자동 재장전) */
  auto: boolean
  /** 0 이면 무한 (근접 무기) */
  magSize: number
  /** 재장전 틱 */
  reloadTicks: number
  /** 지향/조준 탄퍼짐 (1024 단계 각도 단위, ±) */
  spreadHip: number
  spreadAds: number
  /** 발당 반동 누적 (각도 단위) */
  recoil: number
  /** 틱당 반동 회복 */
  recoilRecover: number
  /** 탄속 px/tick */
  speed: number
  /** 수명 틱 */
  life: number
  /** 이동 속도 배율 */
  moveMul: number
  /** 렌더용 길이 */
  length: number
  color: number
  /** 거리 감쇠: 이 거리(px)까지는 100%, falloffEnd 에서 falloffMin 배율까지 선형 감소 */
  falloffStart: number
  falloffEnd: number
  falloffMin: number
  /** 근접 무기 (투사체 없이 부채꼴 판정) */
  melee?: boolean
  /** 근접 사거리 px */
  meleeRange?: number
  /** 근접 부채꼴 반각 (1024 단위) */
  meleeArc?: number
  /** 정조준 시 스코프 (시야가 멀어지고 화면에 조준경) */
  scope?: boolean
  /** 소음기: 발소리가 안 나고 총소리가 아주 작다 (권총 — 단군덕·우원덕, 2026-09-05) */
  suppressed?: boolean
}

/** 거리에 따른 피해 배율 */
export function falloff(w: WeaponDef, dist: number): number {
  if (dist <= w.falloffStart) return 1
  if (dist >= w.falloffEnd) return w.falloffMin
  const k = (dist - w.falloffStart) / (w.falloffEnd - w.falloffStart)
  return 1 - (1 - w.falloffMin) * k
}

const deg = (d: number) => Math.round((d / 360) * 1024)

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: {
    // 2026-09-05 오픈 베타: 소음기 달린 권총 — 발소리 없음·총소리 아주 작음, 피해 27 → 30 (보통 봇 표에서 권총 둘이 37~40% 바닥)
    id: 'pistol', name: '권총', damage: 30, suppressed: true, pellets: 1, fireInterval: 11, auto: true,
    magSize: 14, reloadTicks: 90, spreadHip: deg(5), spreadAds: deg(1.6), recoil: deg(2.2),
    recoilRecover: deg(0.55), speed: 15, life: 60, moveMul: 1.0, length: 14, color: 0x9aa0a6,
    falloffStart: 9999, falloffEnd: 9999, falloffMin: 1,
  },
  smg: {
    id: 'smg', name: 'SMG', damage: 16, pellets: 1, fireInterval: 5, auto: true,
    magSize: 32, reloadTicks: 110, spreadHip: deg(8), spreadAds: deg(4.2), recoil: deg(1.4),
    recoilRecover: deg(0.5), speed: 14, life: 55, moveMul: 0.96, length: 18, color: 0x7c8590,
    falloffStart: 320, falloffEnd: 700, falloffMin: 0.62,
  },
  // 2026-09-05 탄속 17 → 24 (사용자: 소총 밸런스 — 더 빠르게). 수명은 사거리(약 1200px)가 그대로이도록 70 → 50.
  // 빨라진 만큼 피해 23 → 20 (계측: 23 이면 소총 셋이 62~67% 로 최상위, 20 이면 48~58% 로 가운데)
  rifle: {
    // 2026-09-05 보통 봇 기준 재조정: 20 → 23 (소총 셋이 29~37% 로 바닥). 탄속 24 는 유지
    id: 'rifle', name: '소총', damage: 23, pellets: 1, fireInterval: 10, auto: true,
    magSize: 30, reloadTicks: 130, spreadHip: deg(6.5), spreadAds: deg(1.4), recoil: deg(2.6),
    recoilRecover: deg(0.5), speed: 24, life: 50, moveMul: 0.92, length: 24, color: 0x5f6b48,
    falloffStart: 420, falloffEnd: 820, falloffMin: 0.78,
  },
  // 근접에서 압도적(탄당 17×7 = 119), 멀면 급감. 한 방에 죽이지는 못한다
  shotgun: {
    id: 'shotgun', name: '산탄총', damage: 17, pellets: 7, fireInterval: 38, auto: true,
    magSize: 6, reloadTicks: 150, spreadHip: deg(7.5), spreadAds: deg(5), recoil: deg(4),
    recoilRecover: deg(0.4), speed: 14, life: 34, moveMul: 0.9, length: 26, color: 0x8b5a2b,
    falloffStart: 200, falloffEnd: 500, falloffMin: 0.35,
  },
  // 유일하게 한 방이 나오는 무기. 대신 재장전이 길고, 정조준(우클릭) 없이는 거의 맞지 않는다.
  // 2026-09-06: 112/260 → 120/225. 봇 1:1 1100판에서 통천덕이 38.0% 로 계속 바닥이었다.
  // 연사 간격(78)과 이동 배율(0.7)은 그대로 둔다 — 그쪽을 건드리면 저격이 단숨에 최상위로 올라간다(계측).
  // 2026-09-05 오픈 베타 제보 "저격이 너무 어렵다(기력이 늘어 다들 빠르다)": **조준경으로 맞히면 한 방**, 스치면 체력 10 남김,
  // 조준경 없이는 개머리판 후려치기(10, 재장전 중에도), 탄 5 → 6. damage 120 은 이제 봇 평가·표시용이고 실제 조준경 피해는 상대 체력이다.
  sniper: {
    id: 'sniper', name: '저격총', damage: 120, pellets: 1, fireInterval: 78, auto: true,
    magSize: 6, reloadTicks: 225, spreadHip: deg(15), spreadAds: deg(0.4), recoil: deg(7),
    recoilRecover: deg(0.35), speed: 26, life: 90, moveMul: 0.7, length: 32, color: 0x3d4a5c,
    falloffStart: 9999, falloffEnd: 9999, falloffMin: 1, scope: true,
    lethalAds: true, grazeLeave: 10, bash: { damage: 10, range: 55, arc: deg(70), interval: 20 },
  },
  // 명중률은 낮고 반동은 세지만 탄이 많아 계속 퍼붓는다
  mg: {
    // 2026-09-05 보통 봇 기준 재조정: 16 → 15 (철면덕 76% — 세게 두는 건 의도지만 너무 셌다 → 64%)
    id: 'mg', name: '기관총', damage: 15, pellets: 1, fireInterval: 5, auto: true,
    magSize: 80, reloadTicks: 210, spreadHip: deg(8), spreadAds: deg(4.5), recoil: deg(2.4),
    recoilRecover: deg(0.35), speed: 15, life: 60, moveMul: 0.9, length: 30, color: 0x4a4f45,
    falloffStart: 320, falloffEnd: 760, falloffMin: 0.55,
  },
  // 승빠덕 전용 근접 무기. 꾹 누르면 계속 휘두르고, 기력으로 총알을 막는다
  // 2026-09-05 피해 80 → 62. 봇 표에서는 빠져 있지만(근접을 못 쓴다) **사람 손에서는 승률이 계속 높다**(사용자).
  // 세 대(186) 로는 아무도 못 잡고 네 대(248) 부터. 같은 날 소총 하향으로 상대가 약해져 68 로는
  // tools/melee.ts 정면 대치가 5/10(권장 2~4)이라 62 까지 내렸다 → 3/10. 2026-09-05 오픈 베타 제보로 55 → 45 (다섯 대 225 — 체력 220 이하는 다섯 대, 매직덕 여섯, 철면덕 일곱)
  pan: {
    id: 'pan', name: '후라이팬', damage: 45, pellets: 1, fireInterval: 23, auto: true,
    magSize: 0, reloadTicks: 0, spreadHip: 0, spreadAds: 0, recoil: 0,
    recoilRecover: 0, speed: 0, life: 0, moveMul: 1.02, length: 20, color: 0x33383c,
    falloffStart: 9999, falloffEnd: 9999, falloffMin: 1,
    melee: true, meleeRange: 70, meleeArc: deg(60),
  },
}

export const PART_HEAD = 0
export const PART_BODY = 1
export const PART_LEGS = 2
export const PART_MULT = [2.0, 1.0, 0.6]

/** 산탄은 머리 배율을 낮춰 한 방에 죽지 않게 한다 */
export function headMult(w: WeaponDef): number {
  return w.pellets > 1 ? 1.5 : PART_MULT[PART_HEAD]
}

/** 머리로 치는 범위 (상대 반지름 대비). 모래주머니를 넘기는 '머리 조준' 판정도 이 값을 쓴다 */
export const HEAD_FRAC = 0.28
/**
 * 커서가 "상대 위에 있다" 고 보는 범위 (상대 반지름 대비, 0.5r ≈ 7px). 조준선이 금색으로 바뀌는 조건이자 **헤드샷 조건 그 자체**다.
 * 2026-09-05: 처음엔 여기에 "탄 궤적이 정중앙(0.28r)을 지나야" 도 붙어 있었는데, 탄퍼짐·반동 때문에 커서를 정확히 올리고 쏴도
 * 궤적이 3.9px 을 벗어나 몸통이 되곤 했다 → 금색인데 헤드샷이 안 난다(제보). 이제 **커서가 상대 위였고 그 상대를 맞히기만 하면 머리**다
 * (산탄총은 예외 — 탄 7개가 전부 머리가 되면 과해서, 정중앙을 지나는 탄만). 대신 범위를 0.7r → 0.5r 로 좁혔다.
 */
export const HEAD_AIM_FRAC = 0.5
const BODY_FRAC = 0.72

/**
 * 부위 판정 — 확률이 아니라 '얼마나 정확히 맞혔는가'로 정한다 (덕코프식).
 * d = 탄 궤적(직선)과 상대 중심 사이의 거리, r = 상대 반지름.
 * 정중앙을 지나면 머리, 가장자리를 스치면 다리.
 */
export function partForOffset(d: number, r: number, headScale = 1): number {
  if (d <= r * HEAD_FRAC * headScale) return PART_HEAD
  if (d <= r * BODY_FRAC) return PART_BODY
  return PART_LEGS
}
