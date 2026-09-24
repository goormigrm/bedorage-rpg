// 아이템 · 레벨 · 능력치. 디아블로식이지만 작게: 장비 5칸, 등급 4단계, 옵션 12종 (PLAN 5.5).
// 전리품 규칙(2026-09-18 사용자: "디아블로 방식대로") — 디아블로 3·4 를 확인해서 그대로 했다:
//  ① **개인 전리품**: 몬스터가 파티원마다 따로 굴려 떨어뜨리고, 자기 것만 보인다(줍기 싸움이 없다)
//  ② **스마트 루트**: 무기는 85% 가 내 무기 종류로 나온다(무기가 곧 직업이라 남의 무기는 못 낀다)
//  ③ **주운 뒤 버리면 모두에게 보인다** — 친구에게 주는 방법
// 아이템은 숫자만으로 된 작은 객체다(상태·해시·세이브가 가볍게). 생성은 sim 의 rng 로만(결정론).

import { Rng, rand, randInt } from './rng'
import { WEAPONS, WeaponId, familyOf } from './weapons'

export const SLOT_WEAPON = 0
export const SLOT_HELM = 1
export const SLOT_ARMOR = 2
export const SLOT_RING = 3
export const SLOT_AMULET = 4
export const SLOT_COUNT = 5
export const SLOT_NAMES = ['무기', '투구', '갑옷', '반지', '목걸이']
/** 가방 칸 수 */
export const BAG_SIZE = 30

// 뒤에만 붙인다 — 세이브의 아이템이 번호(wt)로 무기 종류를 들고 있다
// 번호가 세이브에 들어간다 — 새 무기는 끝에 붙인다 (2026-09-19 고기 바이올린 · 첼로 · 장검 · 태도)
export const WEAPON_IDS: WeaponId[] = ['pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'mg', 'pan', 'revolver', 'flamer', 'crossbow', 'doublebarrel', 'railgun', 'launcher', 'wok', 'violin', 'cello', 'rapier', 'katana']
/** 변형 무기(리볼버 · 화염방사기 …)가 떨어지기 시작하는 아이템 레벨 */
export const VARIANT_ILVL = 6

/**
 * 등급: 일반 · 마법 · 희귀 · 전설 · **신화** (디아블로 색: 흰 · 파랑 · 노랑 · 주황 · 보라).
 * 신화는 2026-09-19 "아이템 단계를 하나 더" — 전설 고유 효과 + 옵션 최대로. 우두머리·보스에서만 드물게.
 */
export const RARITY_NAMES = ['일반', '마법', '희귀', '전설', '신화']
export const RARITY_MYTHIC = 4
/** 자동 줍기 등급 비트(1 << 등급) — 기본은 모두 (2026-09-19 요청 "아이템은 기본적으로 자동 수집, 등급별로 조절") */
export const AUTOPICK_ALL = 0b11111
export const RARITY_COLORS = ['#d8d8d8', '#6c9cff', '#ffd84a', '#ff8a2a', '#e060ff']
/** 등급별 옵션 수: 무기는 이만큼, 방어구·장신구는 기본 옵션(바탕 종류) 하나 + 이만큼 */
const AFFIX_COUNT_WEAPON = [0, 2, 3, 4, 5]
const AFFIX_COUNT_EXTRA = [0, 1, 2, 3, 4]
/** 강화 최대 단계 · 단계마다 옵션 · 기본 피해/방어 +10% */
export const UPGRADE_MAX = 5
export const UPGRADE_STEP = 0.1

/** type 별칭인 이유: 방 메시지(Trystero)가 JSON 호환 타입을 요구하는데, interface 는 인덱스 시그니처가 없어 안 맞는다 */
export type Item = {
  uid: number
  /** 칸 종류 SLOT_* */
  slot: number
  /** 무기면 WEAPON_IDS 번호, 아니면 -1 */
  wt: number
  rarity: number
  /** 아이템 레벨 (옵션 크기) */
  ilvl: number
  /** 옵션: [번호, 값, 번호, 값 …] */
  aff: number[]
  /** 전설 고유 효과 번호 (LEGENDS · 전설 · 신화) */
  leg?: number
  /** 방어구·장신구의 바탕 종류 (BASE_TYPES[칸] 번호 — 기본 옵션 하나가 정해진다). 무기 · 옛 아이템은 없음 */
  bt?: number
  /** 강화 단계 0~5 (대장장이 — 같은 부위 · 같은 등급을 녹여서) */
  up?: number
  /** 잠금 (2026-09-20): 팔기 · 버리기 · 강화 재료 · 벼리기 재료에서 빠진다. "전부 팔기" 의 안전장치 */
  lk?: 1
}

/** 능력치 번호 (PlayerState.st 배열) */
export const ST_DMG = 0 // 피해 +%
export const ST_RATE = 1 // 연사 +%
// 2026-09-19 재장전·탄창을 없애며 이 두 칸을 바꿨다 (번호는 그대로 — 세이브의 옵션이 번호로 남아 있다)
export const ST_SKILLPOW = 2 // 스킬 위력 +% (옛 재장전 속도)
export const ST_ELITEDMG = 3 // 정예·우두머리·보스에게 주는 피해 +% (옛 탄창)
export const ST_CRIT = 4 // 치명타 피해 +%
export const ST_HP = 5 // 최대 체력 +
export const ST_DR = 6 // 받는 피해 -%
export const ST_SPEED = 7 // 이동 속도 +%
export const ST_STAMINA = 8 // 기력 회복 +%
export const ST_CDR = 9 // 스킬 재사용 -%
export const ST_LIFEKILL = 10 // 처치 시 체력 +
export const ST_XP = 11 // 경험치 +%
export const ST_COUNT = 12

interface AffixDef {
  name: string
  /** 표시: % 인가 */
  pct: boolean
  /** 아이템 레벨 1 에서의 최대값, 레벨마다 더해지는 값 */
  base: number
  per: number
  /** 붙을 수 있는 칸 */
  slots: number[]
  /** 상한 (합산 후) */
  cap: number
}

export const AFFIXES: AffixDef[] = [
  { name: '피해', pct: true, base: 6, per: 0.8, slots: [SLOT_WEAPON, SLOT_RING], cap: 150 },
  { name: '연사 속도', pct: true, base: 4, per: 0.4, slots: [SLOT_WEAPON, SLOT_RING], cap: 60 },
  { name: '스킬 위력', pct: true, base: 4, per: 0.5, slots: [SLOT_WEAPON, SLOT_HELM], cap: 60 },
  { name: '정예·보스 피해', pct: true, base: 6, per: 0.8, slots: [SLOT_WEAPON], cap: 100 },
  { name: '치명타 피해', pct: true, base: 10, per: 1.5, slots: [SLOT_WEAPON, SLOT_RING, SLOT_HELM], cap: 200 },
  { name: '최대 체력', pct: false, base: 14, per: 3, slots: [SLOT_HELM, SLOT_ARMOR, SLOT_RING, SLOT_AMULET], cap: 400 },
  { name: '받는 피해 감소', pct: true, base: 3, per: 0.25, slots: [SLOT_ARMOR, SLOT_HELM], cap: 45 },
  { name: '이동 속도', pct: true, base: 3, per: 0.2, slots: [SLOT_ARMOR, SLOT_AMULET], cap: 30 },
  { name: '기력 회복', pct: true, base: 8, per: 0.8, slots: [SLOT_AMULET, SLOT_HELM], cap: 100 },
  { name: '스킬 재사용 감소', pct: true, base: 3, per: 0.3, slots: [SLOT_HELM, SLOT_AMULET], cap: 40 },
  { name: '처치 시 체력', pct: false, base: 3, per: 0.5, slots: [SLOT_WEAPON, SLOT_RING], cap: 60 },
  { name: '경험치', pct: true, base: 5, per: 0.5, slots: [SLOT_AMULET], cap: 100 },
]

/** 옛 아이템(바탕 종류 없음)의 이름 */
const BASE_NAMES = ['', '투구', '갑옷', '반지', '목걸이']
/**
 * 방어구·장신구 바탕 종류 (2026-09-19 "각 옵션에 따라서 다양한 아이템이 존재하도록") — 종류마다 **기본 옵션**(imp) 하나가 늘 붙는다.
 * 무기는 무기 종류(계열 · 변형)가 곧 바탕이다.
 */
export const BASE_TYPES: { name: string; imp: number }[][] = [
  [],
  [{ name: '가죽 두건', imp: 8 }, { name: '철 투구', imp: 6 }, { name: '사제 두건', imp: 9 }, { name: '사냥꾼 모자', imp: 4 }],
  [{ name: '누빈 옷', imp: 7 }, { name: '사슬 갑옷', imp: 5 }, { name: '판금 갑옷', imp: 6 }],
  [{ name: '구리 반지', imp: 0 }, { name: '은 반지', imp: 1 }, { name: '뼈 반지', imp: 10 }, { name: '루비 반지', imp: 5 }],
  [{ name: '나무 부적', imp: 11 }, { name: '은 목걸이', imp: 7 }, { name: '성물 목걸이', imp: 9 }, { name: '호박 목걸이', imp: 8 }],
]
/** 옵션에서 이름을 짓는다: 첫 옵션 → 앞말, 둘째 → "~의" (옵션 번호 = AFFIXES 순서) */
const AFFIX_PREFIX = ['날카로운', '속사', '주문 새긴', '거인 사냥꾼의', '치명적인', '튼튼한', '단단한', '날렵한', '끈질긴', '영창하는', '흡혈하는', '현자의']
const AFFIX_SUFFIX = ['파괴', '속사', '주문', '거인 사냥', '치명', '생명', '수호', '바람', '인내', '영창', '흡혈', '지혜']
const WEAPON_NAMES: Record<WeaponId, string> = {
  pistol: '권총', smg: 'SMG', rifle: '소총', shotgun: '산탄총', sniper: '저격총', mg: '기관총', pan: '후라이팬',
  revolver: '리볼버', flamer: '화염방사기', crossbow: '석궁', doublebarrel: '더블배럴', railgun: '레일건', launcher: '유탄발사기', wok: '대형 웍',
  violin: '고기 바이올린', cello: '고기 첼로', rapier: '장검', katana: '태도',
}

/**
 * 전설 고유 효과 (GUIDE 8장 — "빌드의 나머지 절반"). 전설 아이템마다 하나. 같은 효과를 둘 껴도 한 번만.
 * 효과는 sim 의 해당 자리에서 `hasLeg(p, 번호)` 로 본다.
 */
export const LEGENDS: { name: string; desc: string }[] = [
  { name: '피의 갈증', desc: '적중 피해의 3% 만큼 체력을 회복한다' },
  { name: '시체 폭탄', desc: '처치하면 25% 확률로 시체가 터진다 (주위 적에게 그 적 최대 체력의 30%)' },
  { name: '서리탄', desc: '명중하면 20% 확률로 적이 1.5초 느려진다' },
  { name: '연쇄 번개', desc: '치명타가 가장 가까운 다른 적에게 번개로 튄다 (피해 50%)' },
  { name: '불굴', desc: '체력이 30% 아래로 떨어지면 2초 무적 (40초에 한 번)' },
  { name: '광란', desc: '처치하면 3초 동안 연사 속도 +25%' },
  { name: '수호자', desc: '받는 피해 -8% · 쓰러진 동료를 두 배 빨리 일으킨다' },
  { name: '관통 탄띠', desc: '처치하면 다음 3발이 3마리를 꿰뚫고 피해 +30%' },
  { name: '집중', desc: '스킬 재사용 대기 -15%' },
  { name: '황금 손', desc: '골드 +50% · 골드를 주우면 체력 2% 회복' },
]
export const LEG_BLOOD = 0
export const LEG_CORPSE = 1
export const LEG_FROST = 2
export const LEG_CHAIN = 3
export const LEG_UNDYING = 4
export const LEG_FRENZY = 5
export const LEG_GUARD = 6
export const LEG_AMMO = 7
export const LEG_FOCUS = 8
export const LEG_GOLD = 9

/** 낀 장비의 전설 효과 비트 묶음 */
export function legMask(equip: (Item | null)[]): number {
  let m = 0
  for (const it of equip) if (it && it.rarity >= 3 && it.leg !== undefined && it.leg >= 0) m |= 1 << it.leg
  return m
}

/** 방어구·장신구에 바탕 종류가 있어 첫 옵션이 기본 옵션인가 */
export function hasImplicit(it: Item): boolean {
  return it.slot !== SLOT_WEAPON && it.bt !== undefined && it.bt >= 0 && !!BASE_TYPES[it.slot]?.[it.bt]
}

/** 바탕 이름: 무기 종류 · 방어구 바탕 종류 */
export function baseName(it: Item): string {
  if (it.slot === SLOT_WEAPON) return WEAPON_NAMES[WEAPON_IDS[it.wt] ?? 'rifle']
  return hasImplicit(it) ? BASE_TYPES[it.slot][it.bt!].name : BASE_NAMES[it.slot]
}

/**
 * 이름은 옵션에서 짓는다: 일반 = 바탕 · 마법 = 앞말 + 바탕 · 희귀 = "~의" + 앞말 + 바탕 · 전설·신화 = 「고유 효과」 + 바탕. 강화면 +N.
 * 예: 사슬 갑옷 · 날카로운 구리 반지 · 생명의 치명적인 사냥꾼 모자 · 「광란」 판금 갑옷
 */
export function itemName(it: Item): string {
  const base = baseName(it)
  const up = it.up ? `+${it.up} ` : ''
  if (it.rarity >= 3 && it.leg !== undefined && LEGENDS[it.leg]) return `${up}「${LEGENDS[it.leg].name}」 ${base}`
  const rolled: number[] = []
  for (let k = hasImplicit(it) ? 2 : 0; k < it.aff.length; k += 2) rolled.push(it.aff[k])
  if (it.rarity === 0 || rolled.length === 0) return `${up}${base}`
  const pre = AFFIX_PREFIX[rolled[0]] ?? ''
  if (it.rarity === 1 || rolled.length < 2) return `${up}${pre} ${base}`
  return `${up}${AFFIX_SUFFIX[rolled[1]] ?? ''}의 ${pre} ${base}`
}

/** 옵션 한 줄 */
export function affixText(id: number, v: number): string {
  const a = AFFIXES[id]
  return a.pct ? `${a.name} +${v}%` : `${a.name} +${v}`
}

/** 강화 배율 (단계마다 +10%) */
export function upMul(it: Item): number {
  return 1 + UPGRADE_STEP * Math.min(UPGRADE_MAX, Math.max(0, it.up ?? 0))
}
/** 무기 아이템의 기본 피해 증가 (옵션과 별개 — 아이템 레벨이 높을수록 센 무기, 강화 포함) */
export function weaponBaseDmg(it: Item): number {
  return it.slot === SLOT_WEAPON ? Math.round((it.ilvl * 2.2 + it.rarity * 4) * upMul(it)) : 0
}
/** 방어구의 기본 방어 (받는 피해 감소 %, 강화 포함) */
export function armorBase(it: Item): number {
  return it.slot === SLOT_ARMOR || it.slot === SLOT_HELM ? Math.round((it.ilvl * 0.35 + it.rarity) * upMul(it)) : 0
}
/** 옵션 한 칸의 실제 값 (강화 포함) */
export function affixValue(it: Item, k: number): number {
  return Math.round(it.aff[k + 1] * upMul(it))
}

/**
 * 어디서 나온 전리품인가 → 등급 확률 (일반 · 마법 · 희귀 · 전설 · 신화).
 * 2026-09-19 "희귀·전설이 너무 쉽게 떨어진다 — 정예나 보스에서만, 확률도 더 낮게":
 *  졸개는 일반·마법만 · 정예부터 희귀·전설 · 신화는 우두머리·보스(와 도박)에서만.
 *  예전: 졸개도 희귀 11% · 전설 2%, 우두머리·보스는 한 개에 전설 27% 였다.
 */
// 2026-09-24 사용자: "지금도 너무 쉽게 저렙 구간에서도 전설 · 희귀가 나온다 — 드랍 확률을 더 낮게" →
//  정예 희귀 19 → 10% · 전설 4 → 2% / 보스 분수 희귀 44 → 36% · 전설 12 → 8% / 금빛 상자 희귀 30 → 18% · 전설 5 → 2%,
//  그리고 **지역(아이템) 레벨이 낮을수록 더 낮게**(lootLevelMul) — 첫 막 초반에는 희귀 이상이 드물다.
export type LootSource = 'normal' | 'elite' | 'boss' | 'chest' | 'goldchest' | 'gamble' | 'shop' | 'forge'
export const DROP_TABLE: Record<LootSource, number[]> = {
  normal: [0.7, 0.3, 0, 0, 0],
  elite: [0.35, 0.53, 0.1, 0.02, 0],
  boss: [0, 0.55, 0.36, 0.08, 0.01],
  chest: [0.55, 0.45, 0, 0, 0],
  goldchest: [0.2, 0.6, 0.18, 0.02, 0],
  gamble: [0, 0.55, 0.35, 0.095, 0.005],
  shop: [0.25, 0.6, 0.15, 0, 0],
  // 벼리기: 등급은 벼리기 쪽에서 정해 minRarity 로 넘긴다 (forgeOdds) — 표는 쓰지 않는다
  forge: [1, 0, 0, 0, 0],
}
/** 떨어지는 전리품이 레벨로 줄어드는 곳 (도박 · 상점 · 벼리기는 값을 치르므로 그대로) */
const LEVEL_SCALED: LootSource[] = ['normal', 'elite', 'boss', 'chest', 'goldchest']
/**
 * 아이템 레벨이 낮을수록 희귀 이상의 몫을 줄인다: 레벨 1 에서 0.4배 → 13 부터 1배 (전설 · 신화는 이것을 한 번 더 곱한다).
 * 1막(지역 레벨 1~8)에서는 희귀가 드물고 전설은 아주 드물다 — 좋은 템은 뒤 막 · 악몽 · 벼리기에서
 */
export function lootLevelMul(ilvl: number): number {
  return Math.min(1, Math.max(0.4, 0.35 + ilvl * 0.05))
}

/**
 * 등급을 고른다. up = 난이도 전리품 보너스(악몽 0.08 · 지옥 0.16) — 희귀 이상의 몫을 (1 + up × 6) 배.
 * ilvl = 아이템 레벨 (주면 떨어지는 전리품은 레벨이 낮을수록 희귀 이상이 줄어든다 — lootLevelMul)
 */
export function pickRarity(rng: Rng, src: LootSource, up = 0, ilvl = 99): number {
  const k = LEVEL_SCALED.includes(src) ? lootLevelMul(ilvl) : 1
  const w = DROP_TABLE[src].map((v, i) => (i >= 2 ? v * (1 + up * 6) * (i >= 3 ? k * k : k) : v))
  let r = rand(rng) * w.reduce((a, b) => a + b, 0)
  for (let i = 0; i < w.length; i++) {
    r -= w[i]
    if (r < 0) return i
  }
  return 0
}

/**
 * 아이템 하나를 굴린다. myWeapon = 주운 사람의 무기(스마트 루트 85%). src = 어디서 나왔나(DROP_TABLE) · up = 난이도 보너스.
 */
export function rollItem(rng: Rng, uid: number, ilvl: number, myWeapon: WeaponId, src: LootSource = 'chest', up = 0, minRarity = 0, forceSlot = -1): Item {
  const slot = forceSlot >= 0 ? forceSlot : randInt(rng, 0, SLOT_COUNT)
  const rarity = Math.max(minRarity, pickRarity(rng, src, up, ilvl))
  const leg = rarity >= 3 ? randInt(rng, 0, LEGENDS.length) : undefined
  let wt = -1
  if (slot === SLOT_WEAPON) {
    // 스마트 루트 85%: 내 계열 무기 — 아이템 레벨 6 부터는 계열의 변형도 (절반쯤). 나머지 15% 는 아무 종류(팔거나 동료에게)
    if (rand(rng) < 0.85) {
      const fam = familyOf(myWeapon)
      const pool = ilvl >= VARIANT_ILVL ? fam : fam.slice(0, 1)
      wt = WEAPON_IDS.indexOf(pool[randInt(rng, 0, pool.length)])
    } else {
      // 아무 종류 (팔거나 동료에게) — 물러난 무기(권총 계열)는 빼고 (2026-09-20)
      const all = WEAPON_IDS.filter((id) => !WEAPONS[id].retired)
      wt = WEAPON_IDS.indexOf(all[randInt(rng, 0, all.length)])
    }
  }
  const aff: number[] = []
  // 옵션 크기: 신화는 최대, 전설은 80~100%, 나머지는 50~100%
  const lo = rarity >= RARITY_MYTHIC ? 1 : rarity === 3 ? 0.8 : 0.5
  const roll = (i: number) => {
    const a = AFFIXES[i]
    const max = a.base + a.per * ilvl
    aff.push(i, Math.max(1, Math.round(max * (lo + rand(rng) * (1 - lo)))))
  }
  // 방어구·장신구: 바탕 종류를 고르고 그 기본 옵션부터
  let bt: number | undefined
  if (slot !== SLOT_WEAPON) {
    bt = randInt(rng, 0, BASE_TYPES[slot].length)
    roll(BASE_TYPES[slot][bt].imp)
  }
  const taken = new Set(aff.filter((_, k) => k % 2 === 0))
  const pool = AFFIXES.map((_, i) => i).filter((i) => AFFIXES[i].slots.includes(slot) && !taken.has(i))
  const n = Math.min(slot === SLOT_WEAPON ? AFFIX_COUNT_WEAPON[rarity] : AFFIX_COUNT_EXTRA[rarity], pool.length)
  for (let k = 0; k < n; k++) roll(pool.splice(randInt(rng, 0, pool.length), 1)[0])
  const it: Item = { uid, slot, wt, rarity, ilvl, aff }
  if (leg !== undefined) it.leg = leg
  if (bt !== undefined) it.bt = bt
  return it
}

/** 상인에게 파는 값 (골드): 아이템 레벨 × 등급 × 강화 */
export function itemValue(it: Item): number {
  return Math.round((6 + it.ilvl * 3) * ([1, 2.5, 6, 15, 30][it.rarity] ?? 1) * (1 + 0.25 * (it.up ?? 0)))
}

/** 마을 값 (GUIDE 9장): 상인 진열은 파는 값의 4배 · 대장장이 강화 = 파는 값의 절반 × 다음 단계 · 도박 = 60 + 레벨×25 */
export const buyPrice = (it: Item) => itemValue(it) * 4
export const gamblePrice = (level: number) => 60 + level * 25
export const potUpPrice = (potMax: number) => 200 * (potMax - 3) ** 2
/** 보관함 칸 (캐릭터 공유) */
export const STASH_SIZE = 60

/**
 * 대장장이 **강화** (2026-09-19 "옵션 변경 NPC 를 없애고 강화 — 동일 단계의 아이템 부위를 모아 오면 소모해서 강화"):
 * 같은 부위(칸) · 같은 등급의 아이템을 (지금 단계 + 1)개 녹여 한 단계 올린다. 단계마다 옵션 · 기본 피해/방어 +10%, 최대 +5.
 */
export const upgradeNeed = (it: Item) => (it.up ?? 0) + 1
export const upgradePrice = (it: Item) => Math.round(itemValue(it) * 0.5 * ((it.up ?? 0) + 1))
/**
 * **전설 벼리기** (2026-09-20 사용자: "희귀템을 몇 개 이상 모아 NPC 에게 가져가면 확률적으로 전설템을 만들어 주는 식").
 * 대장장이에게 **희귀 다섯**과 골드를 주면 고른 부위의 물건 하나가 나온다 — `forge` 표대로 전설 30% · 신화 2% · 나머지는 희귀.
 *
 * 배율 근거: 정예가 전설을 떨구는 확률이 4% · 보스 12% · 도박 9.5% 다. 희귀 다섯이면 전설 하나에 희귀 약 17개가 든다.
 * 희귀 다섯의 판매값(아이템 레벨 20 기준 약 2,000골드)에 벼리는 값을 더하면 도박으로 전설 하나를 노리는 값과 비슷한데,
 * 벼리기는 **부위를 고를 수 있고 아이템 레벨이 재료를 따라간다**. 그만큼만 낫게 두려고 30% 로 맞췄다.
 */
/**
 * 벼리기는 **등급 사다리**다 (2026-09-20 사용자: "전설 벼리기만 있고 신화 벼리기는 없다 —
 * 그냥 아이템 벼리기로 재료 단계를 고르고 그 윗 단계를 만들 수 있는 게 좋겠다. 신화는 확률을 더 낮추고").
 *
 * | 재료 | 개수 | 윗 등급이 나올 확률 | 값 |
 * |---|---|---|---|
 * | 마법 | 5 | 45% → 희귀 | 싸다(×0.5) |
 * | 희귀 | 5 | 30% → 전설 | ×1 |
 * | 전설 | 3 | 20% → 신화 | ×2.5 |
 *
 * 실패해도 **재료와 같은 등급**이 하나 나온다 — 통째로 사라지지 않게. 신화는 위가 없어 재료가 되지 않는다.
 * 전설 셋에 20% 면 신화 하나에 전설 열다섯이 든다. 신화는 보스에게서도 1% 뿐이라 이 길이 주된 통로가 된다.
 */
export const FORGE_MIN = 1
export const FORGE_MAX = 3
const FORGE_NEED_BY: Record<number, number> = { 1: 5, 2: 5, 3: 3 }
const FORGE_ODDS_BY: Record<number, number> = { 1: 0.45, 2: 0.3, 3: 0.2 }
const FORGE_COST_BY: Record<number, number> = { 1: 0.5, 2: 1, 3: 2.5 }
/** 그 등급으로 벼리려면 몇 개가 드나 */
export const forgeNeed = (rarity: number) => FORGE_NEED_BY[rarity] ?? 5
/** 윗 등급이 나올 확률 */
export const forgeOdds = (rarity: number) => FORGE_ODDS_BY[rarity] ?? 0
/** 벼리는 값 (재료를 모으는 수고가 주된 비용이라 값 자체는 무겁지 않다) */
export const forgePrice = (ilvl: number, rarity: number) => Math.round((6 + ilvl * 3) * 6 * 0.6 * (FORGE_COST_BY[rarity] ?? 1))
/**
 * 재료 칸 번호: 가방은 `i`, **보관함은 `STASH_AT + i`**
 * (2026-09-20 사용자: "벼리기·강화 재료를 창고에 들어 있는 것으로도 쓰게" — 모아 둔 재료는 보통 거기 있다).
 * 벼리기와 강화가 같이 쓴다.
 */
export const STASH_AT = 1000
/** 재료가 될 칸 (가방 + 보관함에서 그 등급만, 싼 것부터 — 결정론) */
export function forgeMaterials(bag: Item[], stash: Item[] = [], rarity = 2): number[] {
  return [...bag.map((it, i) => ({ it, k: i })), ...stash.map((it, i) => ({ it, k: STASH_AT + i }))]
    .filter(({ it }) => it.rarity === rarity && !it.lk)
    .sort((a, b) => itemValue(a.it) - itemValue(b.it) || a.k - b.k)
    .map((o) => o.k)
}
/** 벼려 나올 아이템 레벨 — 재료 평균 + 1 (좋은 재료를 넣을 값어치가 있게) */
export function forgeIlvl(bag: Item[], stash: Item[], mats: number[]): number {
  if (mats.length === 0) return 1
  const avg = mats.reduce((a, k) => a + (matAt(bag, stash, k)?.ilvl ?? 1), 0) / mats.length
  return Math.max(1, Math.min(60, Math.round(avg) + 1))
}

/**
 * 가방 · 보관함 정렬 (2026-09-20 요청): **등급이 높은 것부터** — 같으면 부위 · 아이템 레벨 · 강화 · uid 순.
 * uid 까지 보므로 어디서 돌려도 같은 차례가 나온다(락스텝).
 */
export function sortItems(list: Item[]): Item[] {
  return [...list].sort(
    (a, b) => b.rarity - a.rarity || a.slot - b.slot || b.ilvl - a.ilvl || (b.up ?? 0) - (a.up ?? 0) || a.uid - b.uid,
  )
}

/** 잡템 = 일반 · 마법 (전부 팔기의 "쓸 것만 남기기") */
export const isJunk = (it: Item) => it.rarity <= 1

/**
 * 재료가 될 칸 (가방 + **보관함**, 대상은 빼고, 싼 것부터 — 결정론).
 * 칸 번호는 벼리기와 같다: 가방 `i` · 보관함 `STASH_AT + i` (2026-09-20 요청).
 */
export function upgradeMaterials(bag: Item[], stash: Item[], target: Item): number[] {
  return [...bag.map((it, i) => ({ it, k: i })), ...stash.map((it, i) => ({ it, k: STASH_AT + i }))]
    .filter(({ it }) => it !== target && !it.lk && it.slot === target.slot && it.rarity === target.rarity)
    .sort((a, b) => itemValue(a.it) - itemValue(b.it) || a.k - b.k)
    .map((o) => o.k)
}

/** 재료 칸 하나 꺼내기 (가방 · 보관함 공용) */
export function matAt(bag: Item[], stash: Item[], k: number): Item | undefined {
  return k >= STASH_AT ? stash[k - STASH_AT] : bag[k]
}

/** 재료로 쓴 칸들을 지운다 (뒤에서부터 — 앞 칸 번호가 밀리지 않게. 보관함 칸이 1000 대라 보관함부터 지워진다) */
export function takeMaterials(bag: Item[], stash: Item[], mats: number[]): void {
  for (const k of [...mats].sort((a, b) => b - a)) {
    if (k >= STASH_AT) stash.splice(k - STASH_AT, 1)
    else bag.splice(k, 1)
  }
}

// ---------- 레벨 ----------

export const LEVEL_CAP = 30

/**
 * 다음 레벨까지 필요한 경험치. 캠페인(12원정 · 36층)을 85% 잡으며 한 번 돌면 27 안팎 (tools/xpcurve.ts).
 * 몬스터 경험치가 레벨마다 20% 오르므로 곡선은 완만하다(1레벨 360 · 10레벨 4530 · 29레벨 14600)
 */
/** 1레벨 필요 경험치 (무리 수가 바뀌면 같이 맞춘다 — tools/xpcurve.ts) */
export const XP_BASE = 560
export function xpNeed(level: number): number {
  // 24 레벨부터 가파르게 (D7): 4막(지역 25~30)이 경험치가 많아 한 바퀴에 만렙이 됐다 → 4막 끝 27~28 · 만렙은 악몽에서
  const tail = level >= 24 ? 1 + 0.35 * (level - 23) : 1
  return Math.round(XP_BASE * Math.pow(level, 1.1) * tail)
}

/**
 * 능력치 (C 창 — 2026-09-19 "레벨업 시 세부 능력치 포인트를 줘서 올리고, 추천 능력치도 같이"). 레벨마다 3점.
 * 힘 = 피해 · 민첩 = 연사 · 치명타 · 활력 = 체력 · 정신 = 스킬 위력 · 재사용. 추천은 characters.ts ATTR_REC.
 */
export const ATTR_NAMES = ['힘', '민첩', '활력', '정신']
export const ATTR_DESC = ['피해 +0.8% / 점', '연사 +0.4% · 치명타 피해 +0.8% / 점', '최대 체력 +3 / 점', '스킬 위력 +0.8% · 스킬 재사용 -0.2% / 점']
export const ATTR_PER_LEVEL = 3
export const attrPoints = (level: number) => Math.max(0, level - 1) * ATTR_PER_LEVEL
/** 남은 능력치 포인트 */
export const attrFree = (level: number, attr: number[]) => attrPoints(level) - attr.reduce((a, b) => a + b, 0)

/**
 * **템 수준** — 낀 장비를 숫자 하나로 (2026-09-20 사용자: "방 목록에 레벨과 템 수준을 숫자로 — 강화 등을 포함해서").
 * 칸마다 `아이템 레벨 + 강화 × 2 + 등급값`(일반 0 · 마법 1 · 희귀 3 · 전설 6 · 신화 9)을 더해 **다섯 칸 평균**.
 * 빈 칸은 0 으로 세므로 맨몸이면 0 이다. 방을 고를 때 "나와 비슷한가" 만 보면 되니 정확한 전투력이 아니라 **견줄 수 있는 수**면 된다.
 */
const RARITY_GS = [0, 1, 3, 6, 9]
export function gearScore(equip: (Item | null)[] | undefined): number {
  if (!equip || equip.length === 0) return 0
  let sum = 0
  for (let i = 0; i < SLOT_COUNT; i++) {
    const it = equip[i]
    if (!it) continue
    sum += it.ilvl + (it.up ?? 0) * 2 + (RARITY_GS[it.rarity] ?? 0)
  }
  return Math.round(sum / SLOT_COUNT)
}
/** 능력치가 능력치 칸(st)에 더하는 값 */
function addAttr(st: number[], attr: number[]): void {
  st[ST_DMG] += (attr[0] ?? 0) * 0.8
  st[ST_RATE] += (attr[1] ?? 0) * 0.4
  st[ST_CRIT] += (attr[1] ?? 0) * 0.8
  st[ST_HP] += (attr[2] ?? 0) * 3
  st[ST_SKILLPOW] += (attr[3] ?? 0) * 0.8
  st[ST_CDR] += (attr[3] ?? 0) * 0.2
}

/** 레벨마다 최대 체력 +6, 피해 +1.5% */
export const HP_PER_LEVEL = 6
export const DMG_PER_LEVEL = 1.5

/**
 * 장비 + 레벨로 능력치를 낸다. 결과는 PlayerState.st 에 들어간다(상태 안 — 결정론).
 * 합산 후 옵션마다 상한을 건다(받는 피해 감소 45%, 스킬 재사용 40% …).
 */
export function computeStats(level: number, equip: (Item | null)[], attr: number[] = []): number[] {
  const st = new Array(ST_COUNT).fill(0)
  for (const it of equip) {
    if (!it) continue
    for (let k = 0; k < it.aff.length; k += 2) st[it.aff[k]] += affixValue(it, k)
    st[ST_DMG] += weaponBaseDmg(it)
    st[ST_DR] += armorBase(it)
  }
  st[ST_DMG] += (level - 1) * DMG_PER_LEVEL
  st[ST_HP] += (level - 1) * HP_PER_LEVEL
  addAttr(st, attr)
  for (let i = 0; i < ST_COUNT; i++) st[i] = Math.min(st[i], AFFIXES[i].cap + (i === ST_DMG ? LEVEL_CAP * DMG_PER_LEVEL + 70 : i === ST_HP ? LEVEL_CAP * HP_PER_LEVEL : i === ST_DR ? 0 : 0))
  st[ST_DR] = Math.min(st[ST_DR], 60)
  return st
}

/** 캐릭터 기록 (세이브 · 방 메시지로 오간다) */
export type Sheet = {
  level: number
  xp: number
  gold: number
  equip: (Item | null)[]
  bag: Item[]
  /** 연 웨이포인트 (world.ts WAYPOINTS 순서의 비트) */
  wps?: number
  /** 물약 칸 수 (상인에게서 늘린다, 기본 4 · 최대 8) */
  potMax?: number
  /** 보관함 (캐릭터끼리 공유 — 세이브는 따로 두고, 판에 들어올 때 내 기록에 실어 온다) */
  stash?: Item[]
  /** 스킬 트리 빌드 (skills.ts Build) */
  build?: { r: number[]; m3: number[]; m5: number[]; s: number[] }
  /** 퀘스트 상태 (world.ts QUESTS 순서: 0 모름 · 1 받음 · 2 이룸 · 3 끝) — 보통 난이도 */
  quests?: number[]
  /** 악몽 · 지옥의 퀘스트 상태 (tq[1] 악몽 · tq[2] 지옥 — 0 은 비워 둔다) */
  tq?: number[][]
  /** 악몽 · 지옥의 웨이포인트 (twps[1] · twps[2]) */
  twps?: number[]
  /** 플레이 시간(초) 막마다 — 보통 난이도 한 바퀴 시간을 실제 기록으로 맞추려고 (D7 · GUIDE 7장) */
  playSec?: number[]
  /** 능력치에 쓴 포인트 [힘, 민첩, 활력, 정신] (C 창) */
  attr?: number[]
}

export function emptySheet(): Sheet {
  return { level: 1, xp: 0, gold: 0, equip: new Array(SLOT_COUNT).fill(null), bag: [], wps: 0 }
}

/** 받은 기록이 말이 되는가 (깨진 데이터로 판이 어긋나지 않게 — 치트 방지가 아니라 사고 방지, PLAN 4.5) */
export function sanitizeSheet(s: unknown): Sheet {
  const e = emptySheet()
  if (!s || typeof s !== 'object') return e
  const o = s as Partial<Sheet>
  const okItem = (it: unknown): it is Item => {
    if (!it || typeof it !== 'object') return false
    const x = it as Item
    if (x && x.leg !== undefined && !(Number.isInteger(x.leg) && x.leg >= 0 && x.leg < LEGENDS.length)) return false
    if (x && x.lk !== undefined && x.lk !== 1) return false
    return Number.isInteger(x.uid) && x.slot >= 0 && x.slot < SLOT_COUNT && x.rarity >= 0 && x.rarity <= RARITY_MYTHIC && (x.up === undefined || (Number.isInteger(x.up) && x.up >= 0 && x.up <= UPGRADE_MAX)) && (x.bt === undefined || (Number.isInteger(x.bt) && x.bt >= -1 && x.bt < 8)) && x.ilvl >= 1 && x.ilvl <= 60 && Array.isArray(x.aff) && x.aff.length <= 12 && x.aff.every((v) => Number.isFinite(v))
  }
  e.level = Math.max(1, Math.min(LEVEL_CAP, Math.floor(Number(o.level) || 1)))
  e.xp = Math.max(0, Math.floor(Number(o.xp) || 0))
  e.gold = Math.max(0, Math.floor(Number(o.gold) || 0))
  if (Array.isArray(o.equip)) for (let i = 0; i < SLOT_COUNT; i++) e.equip[i] = okItem(o.equip[i]) && o.equip[i]!.slot === i ? o.equip[i]! : null
  if (Array.isArray(o.bag)) e.bag = o.bag.filter(okItem).slice(0, BAG_SIZE)
  // 웨이포인트는 19개(보스 방 넷을 뒤에 붙였다) — 예전 16비트(0xffff)로 잘라 거미 둥지 · 관리인의 방 · 심연의 옥좌가 저장 때마다 지워졌다 (2026-09-24)
  e.wps = Math.max(0, Math.floor(Number(o.wps) || 0)) & 0x3fffffff
  if (Array.isArray(o.playSec)) e.playSec = o.playSec.slice(0, 8).map((v) => Math.max(0, Math.floor(Number(v) || 0)))
  if (Array.isArray(o.twps)) e.twps = o.twps.slice(0, 3).map((v) => Math.max(0, Math.floor(Number(v) || 0)) & 0x3fffffff)
  if (Array.isArray(o.tq)) e.tq = o.tq.slice(0, 3).map((q) => (Array.isArray(q) ? q.slice(0, 32).map((v) => Math.max(0, Math.min(3, Math.floor(Number(v) || 0)))) : []))
  e.potMax = Math.max(4, Math.min(8, Math.floor(Number(o.potMax) || 4)))
  e.stash = Array.isArray(o.stash) ? o.stash.filter(okItem).slice(0, STASH_SIZE) : []
  // 빌드는 sim 이 sanitizeBuild 로 한 번 더 본다 (여기서는 모양만)
  if (o.build && typeof o.build === 'object') e.build = o.build
  e.quests = Array.from({ length: 32 }, (_, i) => Math.max(0, Math.min(3, Math.floor(Number(o.quests?.[i]) || 0))))
  // 능력치: 네 칸 · 음수 없음 · 레벨이 준 포인트보다 많으면 모두 되돌린다
  const at = Array.from({ length: 4 }, (_, i) => Math.max(0, Math.floor(Number(o.attr?.[i]) || 0)))
  e.attr = attrFree(e.level, at) >= 0 ? at : [0, 0, 0, 0]
  return e
}
