// 무기 밸런스 테이블. 시간 단위는 틱(60Hz), 거리는 px.
//
// 2026-09-19 사용자: "시원한 슈팅 RPG 를 위해서 재장전을 없애고, 저격총은 오른쪽 마우스 줌을 없애자. 대신 각 총들 간에 밸런스를 맞춰줘.
// 더 다양한 무기 종류가 있다면 적용시켜줘" →
//   - **재장전·탄창 없음**: 꾹 누르면 발사 간격마다 끝없이 쏜다. 무기의 개성은 연사 · 사거리 · 퍼짐 · 관통 · 폭발 · 넉백으로 낸다.
//   - **저격총 조준경 없음**: 우클릭은 다른 총처럼 정조준(퍼짐↓ · 이동↓)만. 한 방 판정·개머리판도 없앴다. 대신 탄이 하나를 꿰뚫는다.
//   - **밸런스 기준 = 지속 DPS**(피해 × 탄 수 ÷ 발사 간격, 레벨·장비 배율 전). 예전 "탄창 + 재장전" 한 주기의 평균(약 1.6~2.0)을
//     그대로 두고(분량 6시간을 지키려고), 역할마다 조금씩 벌린다: 가까이 붙는 무기는 높게 · 멀리서 안전한 무기 · 여럿을 꿰뚫는 무기는 낮게.
//   - **계열(family) 안의 변형 무기**: 캐릭터는 제 계열 무기만 낀다(정체성 유지). 무기 칸 아이템의 종류가 곧 쏘는 총이다.
//     계열마다 기본 + 변형 하나 — 권총/리볼버 · SMG/화염방사기 · 소총/석궁 · 산탄총/더블배럴 · 저격총/레일건 · 기관총/유탄발사기 · 후라이팬/대형 웍.
//     변형은 아이템 레벨 6 부터 떨어진다(tools/weapons.ts 로 DPS 표를 본다).

export type WeaponId =
  | 'pistol' | 'smg' | 'rifle' | 'shotgun' | 'sniper' | 'mg' | 'pan'
  | 'revolver' | 'flamer' | 'crossbow' | 'doublebarrel' | 'railgun' | 'launcher' | 'wok'

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
  /** 계열 (캐릭터가 낄 수 있는지 — 캐릭터 기본 무기의 계열과 같아야 한다) */
  family: WeaponId
  /** 한 줄 설명 (가방 창 툴팁) */
  desc: string
  /** 탄이 기본으로 꿰뚫는 수 (석궁 · 저격 · 레일건 · 화염) */
  pierce?: number
  /** 맞거나 끝나면 터진다 (유탄): 반경 px · 폭발 피해 배율(탄 피해 기준) */
  boom?: { r: number; mul: number }
  damage: number
  /** 조준경(ADS)으로 맞히면 한 방 — 스치면(반지름 바깥 SNIPER_GRAZE_FRAC) 체력을 grazeLeave 만 남긴다 (저격총, 2026-09-05) */
  lethalAds?: boolean
  grazeLeave?: number
  bash?: BashDef
  /** 발당 탄 수 (산탄) */
  pellets: number
  /** 발사 간격 (틱) */
  fireInterval: number
  /** 자동 연사 여부. 모든 무기가 꾹 누르면 발사 간격마다 계속 쏜다 */
  auto: boolean
  /** 탄창 — 2026-09-19 재장전을 없애 모두 0(무한). 투기장 옛 규칙의 흔적이라 자리만 남긴다 */
  magSize: number
  /** 재장전 틱 — 모두 0 */
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
  /** 몬스터를 미는 힘 (px/틱, 탄 하나 기준). 몬스터의 넉백 저항만큼 줄어든다 */
  knock: number
}

/** 거리에 따른 피해 배율 */
export function falloff(w: WeaponDef, dist: number): number {
  if (dist <= w.falloffStart) return 1
  if (dist >= w.falloffEnd) return w.falloffMin
  const k = (dist - w.falloffStart) / (w.falloffEnd - w.falloffStart)
  return 1 - (1 - w.falloffMin) * k
}

const deg = (d: number) => Math.round((d / 360) * 1024)

/** 무기 계열 공통 값 (모두 무한 탄) */
const INF = { magSize: 0, reloadTicks: 0, auto: true }

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  // ---------------- 권총 계열 (단군덕 · 우원덕) — 중거리 · 정확 · 소음기 ----------------
  // DPS 20/11 = 1.82. 소음기라 총소리가 무리를 깨우지 않는다(정찰)
  pistol: {
    ...INF, id: 'pistol', family: 'pistol', name: '권총', desc: '소음기 권총 — 조용하고 정확하다. 총소리가 무리를 깨우지 않는다.',
    knock: 1.2, damage: 20, suppressed: true, pellets: 1, fireInterval: 11,
    spreadHip: deg(4), spreadAds: deg(1.4), recoil: deg(1.8), recoilRecover: deg(0.55),
    speed: 15, life: 60, moveMul: 1.0, length: 14, color: 0x9aa0a6, falloffStart: 9999, falloffEnd: 9999, falloffMin: 1,
  },
  // 리볼버: 느리고 한 발이 크다(46). 소음기가 없어 시끄럽다. DPS 1.92
  revolver: {
    ...INF, id: 'revolver', family: 'pistol', name: '리볼버', desc: '한 발 한 발이 크다(권총의 두 배 남짓). 대신 느리고 시끄럽다.',
    knock: 2.4, damage: 46, pellets: 1, fireInterval: 24,
    spreadHip: deg(3), spreadAds: deg(0.9), recoil: deg(4), recoilRecover: deg(0.6),
    speed: 18, life: 55, moveMul: 1.0, length: 16, color: 0xb08a50, falloffStart: 9999, falloffEnd: 9999, falloffMin: 1,
  },
  // ---------------- SMG 계열 (주펄덕) — 근접 난사 ----------------
  // DPS 11/5 = 2.2 (가까이). 멀면 0.62 배
  smg: {
    ...INF, id: 'smg', family: 'smg', name: 'SMG', desc: '빠르게 퍼붓는다. 가까울수록 세다.',
    knock: 0.6, damage: 11, pellets: 1, fireInterval: 5,
    spreadHip: deg(7), spreadAds: deg(4), recoil: deg(1.2), recoilRecover: deg(0.5),
    speed: 14, life: 55, moveMul: 0.96, length: 18, color: 0x7c8590, falloffStart: 320, falloffEnd: 700, falloffMin: 0.62,
  },
  // 화염방사기: 약 4칸만 닿지만 불길이 셋을 꿰뚫는다. 한 마리 DPS 2.5 · 무리에 강하다. 가까이 붙어야 해서 위험하다
  flamer: {
    ...INF, id: 'flamer', family: 'smg', name: '화염방사기', desc: '가까운 부채꼴을 태운다(약 4칸). 불길이 셋을 꿰뚫는다.',
    knock: 0.3, damage: 5, pellets: 2, fireInterval: 4, pierce: 2,
    spreadHip: deg(10), spreadAds: deg(7), recoil: 0, recoilRecover: 0,
    speed: 9, life: 17, moveMul: 0.95, length: 20, color: 0xff7a2a, falloffStart: 9999, falloffEnd: 9999, falloffMin: 1,
  },
  // ---------------- 소총 계열 (침착덕 · 기열덕 · 우재덕) — 멀리서 정확 ----------------
  // DPS 18/10 = 1.8, 멀어도 0.78 배까지만 준다
  rifle: {
    ...INF, id: 'rifle', family: 'rifle', name: '소총', desc: '멀리서도 정확하다. 탄이 빠르다.',
    knock: 1.0, damage: 18, pellets: 1, fireInterval: 10,
    spreadHip: deg(5.5), spreadAds: deg(1.4), recoil: deg(2.2), recoilRecover: deg(0.5),
    speed: 24, life: 50, moveMul: 0.92, length: 24, color: 0x5f6b48, falloffStart: 420, falloffEnd: 820, falloffMin: 0.78,
  },
  // 석궁: 느린 화살(44)이 둘을 더 꿰뚫는다. 한 마리 DPS 1.69 · 줄 선 무리에 강하다
  crossbow: {
    ...INF, id: 'crossbow', family: 'rifle', name: '석궁', desc: '느린 화살이 둘을 더 꿰뚫는다. 줄지어 오는 무리에 강하다.',
    knock: 1.8, damage: 44, pellets: 1, fireInterval: 26, pierce: 2,
    spreadHip: deg(3), spreadAds: deg(0.8), recoil: deg(2), recoilRecover: deg(0.5),
    speed: 20, life: 60, moveMul: 0.95, length: 22, color: 0x7a5a38, falloffStart: 9999, falloffEnd: 9999, falloffMin: 1,
  },
  // ---------------- 산탄 계열 (매직덕 · 풍월덕) — 근접 폭발력 ----------------
  // DPS 12×7/38 = 2.21 (가까이). 멀면 0.35 배
  shotgun: {
    ...INF, id: 'shotgun', family: 'shotgun', name: '산탄총', desc: '가까이서 한 번에 크게. 멀면 급격히 약해진다.',
    knock: 0.9, damage: 12, pellets: 7, fireInterval: 38,
    spreadHip: deg(7.5), spreadAds: deg(5), recoil: deg(4), recoilRecover: deg(0.4),
    speed: 14, life: 34, moveMul: 0.9, length: 26, color: 0x8b5a2b, falloffStart: 200, falloffEnd: 500, falloffMin: 0.35,
  },
  // 더블배럴: 두 발을 한꺼번에 — 12알 × 11. 느리지만 한 번이 크고 멀리 밀친다. DPS 2.06
  doublebarrel: {
    ...INF, id: 'doublebarrel', family: 'shotgun', name: '더블배럴', desc: '두 발을 한꺼번에(12알). 느리지만 한 번이 크고 멀리 밀친다.',
    knock: 1.5, damage: 11, pellets: 12, fireInterval: 64,
    spreadHip: deg(11), spreadAds: deg(8), recoil: deg(6), recoilRecover: deg(0.4),
    speed: 14, life: 30, moveMul: 0.9, length: 28, color: 0x6a4a2a, falloffStart: 160, falloffEnd: 420, falloffMin: 0.3,
  },
  // ---------------- 저격 계열 (옥냥덕 · 통천덕) — 한 발 · 관통 ----------------
  // 2026-09-19: 조준경·한 방·개머리판을 없앴다. 80 피해 · 0.8초마다 · 하나를 더 꿰뚫는다. 한 마리 DPS 1.67
  sniper: {
    ...INF, id: 'sniper', family: 'sniper', name: '저격총', desc: '멀리서 한 발(80) — 탄이 하나를 더 꿰뚫고 멀리 밀친다.',
    knock: 4, damage: 80, pellets: 1, fireInterval: 48, pierce: 1,
    spreadHip: deg(2.5), spreadAds: deg(0.4), recoil: deg(5), recoilRecover: deg(0.4),
    speed: 30, life: 70, moveMul: 0.8, length: 32, color: 0x3d4a5c, falloffStart: 9999, falloffEnd: 9999, falloffMin: 1,
  },
  // 레일건: 모든 것을 꿰뚫는 150 · 1.6초마다. 한 마리 DPS 1.56 · 줄에는 무한
  railgun: {
    ...INF, id: 'railgun', family: 'sniper', name: '레일건', desc: '모든 것을 꿰뚫는 한 발(150). 느리다.',
    knock: 3, damage: 150, pellets: 1, fireInterval: 96, pierce: 99,
    spreadHip: deg(1.5), spreadAds: deg(0.3), recoil: deg(6), recoilRecover: deg(0.4),
    speed: 44, life: 50, moveMul: 0.78, length: 34, color: 0x5ac8ff, falloffStart: 9999, falloffEnd: 9999, falloffMin: 1,
  },
  // ---------------- 기관총 계열 (철면덕) — 버티며 퍼붓기 ----------------
  // DPS 10/5 = 2.0. 퍼짐이 크고 느리게 걷는다
  mg: {
    ...INF, id: 'mg', family: 'mg', name: '기관총', desc: '끝없이 퍼붓는다. 퍼짐이 크고 무겁다.',
    knock: 0.5, damage: 10, pellets: 1, fireInterval: 5,
    spreadHip: deg(7.5), spreadAds: deg(4.5), recoil: deg(2), recoilRecover: deg(0.35),
    speed: 15, life: 60, moveMul: 0.9, length: 30, color: 0x4a4f45, falloffStart: 320, falloffEnd: 760, falloffMin: 0.55,
  },
  // 유탄발사기: 맞거나 멈추면 반경 72 에 터진다(탄 피해 36 + 폭발 36). 한 마리 1.44 · 무리에 강하다
  launcher: {
    ...INF, id: 'launcher', family: 'mg', name: '유탄발사기', desc: '맞거나 멈추면 둘레 약 2칸에 터진다. 무리에 강하고 느리다.',
    knock: 2, damage: 36, pellets: 1, fireInterval: 50, boom: { r: 72, mul: 1 },
    spreadHip: deg(3), spreadAds: deg(1.5), recoil: deg(4), recoilRecover: deg(0.4),
    speed: 11, life: 55, moveMul: 0.88, length: 26, color: 0x5a6a3a, falloffStart: 9999, falloffEnd: 9999, falloffMin: 1,
  },
  // ---------------- 근접 (승빠덕) ----------------
  // 후라이팬: 45 · 23틱 = 1.96. 기력으로 앞에서 오는 공격을 막는다
  pan: {
    ...INF, id: 'pan', family: 'pan', name: '후라이팬', desc: '휘두르고 막는다. 앞에서 오는 공격을 기력으로 막는다.',
    knock: 5, damage: 45, pellets: 1, fireInterval: 23, magSize: 0, reloadTicks: 0,
    spreadHip: 0, spreadAds: 0, recoil: 0, recoilRecover: 0,
    speed: 0, life: 0, moveMul: 1.02, length: 20, color: 0x33383c, falloffStart: 9999, falloffEnd: 9999, falloffMin: 1,
    melee: true, meleeRange: 70, meleeArc: deg(60),
  },
  // 대형 웍: 넓게(±90°) · 멀리 · 세게 — 느리다. 72 · 34틱 = 2.12
  wok: {
    ...INF, id: 'wok', family: 'pan', name: '대형 웍', desc: '더 넓고 멀리 휘두른다. 느리지만 세게 밀친다.',
    knock: 7, damage: 72, pellets: 1, fireInterval: 34,
    spreadHip: 0, spreadAds: 0, recoil: 0, recoilRecover: 0,
    speed: 0, life: 0, moveMul: 0.98, length: 26, color: 0x2a2a2e, falloffStart: 9999, falloffEnd: 9999, falloffMin: 1,
    melee: true, meleeRange: 82, meleeArc: deg(90),
  },
}

/** 계열의 무기들 (기본이 먼저) */
export function familyOf(id: WeaponId): WeaponId[] {
  const f = WEAPONS[id].family
  return (Object.keys(WEAPONS) as WeaponId[]).filter((k) => WEAPONS[k].family === f)
}

/** 한 마리를 칠 때의 지속 DPS (피해 × 탄 ÷ 간격, 가까운 거리 · 레벨·장비 배율 전) — 표·툴팁용 */
export function weaponDps(w: WeaponDef): number {
  return (w.damage * w.pellets * (w.boom ? 1 + w.boom.mul : 1)) / w.fireInterval
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
