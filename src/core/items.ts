// 아이템 · 레벨 · 능력치. 디아블로식이지만 작게: 장비 5칸, 등급 4단계, 옵션 12종 (PLAN 5.5).
// 전리품 규칙(2026-09-18 사용자: "디아블로 방식대로") — 디아블로 3·4 를 확인해서 그대로 했다:
//  ① **개인 전리품**: 몬스터가 파티원마다 따로 굴려 떨어뜨리고, 자기 것만 보인다(줍기 싸움이 없다)
//  ② **스마트 루트**: 무기는 85% 가 내 무기 종류로 나온다(무기가 곧 직업이라 남의 무기는 못 낀다)
//  ③ **주운 뒤 버리면 모두에게 보인다** — 친구에게 주는 방법
// 아이템은 숫자만으로 된 작은 객체다(상태·해시·세이브가 가볍게). 생성은 sim 의 rng 로만(결정론).

import { Rng, rand, randInt } from './rng'
import { WeaponId } from './weapons'

export const SLOT_WEAPON = 0
export const SLOT_HELM = 1
export const SLOT_ARMOR = 2
export const SLOT_RING = 3
export const SLOT_AMULET = 4
export const SLOT_COUNT = 5
export const SLOT_NAMES = ['무기', '투구', '갑옷', '반지', '목걸이']
/** 가방 칸 수 */
export const BAG_SIZE = 30

export const WEAPON_IDS: WeaponId[] = ['pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'mg', 'pan']

/** 등급: 일반 · 마법 · 희귀 · 전설 (디아블로 색: 흰 · 파랑 · 노랑 · 주황) */
export const RARITY_NAMES = ['일반', '마법', '희귀', '전설']
export const RARITY_COLORS = ['#d8d8d8', '#6c9cff', '#ffd84a', '#ff8a2a']
/** 등급별 옵션 수 */
const AFFIX_COUNT = [0, 2, 3, 4]

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
}

/** 능력치 번호 (PlayerState.st 배열) */
export const ST_DMG = 0 // 피해 +%
export const ST_RATE = 1 // 연사 +%
export const ST_RELOAD = 2 // 재장전 속도 +%
export const ST_MAG = 3 // 탄창 +%
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
  { name: '재장전 속도', pct: true, base: 8, per: 0.6, slots: [SLOT_WEAPON, SLOT_HELM], cap: 70 },
  { name: '탄창', pct: true, base: 10, per: 1, slots: [SLOT_WEAPON], cap: 100 },
  { name: '치명타 피해', pct: true, base: 10, per: 1.5, slots: [SLOT_WEAPON, SLOT_RING, SLOT_HELM], cap: 200 },
  { name: '최대 체력', pct: false, base: 14, per: 3, slots: [SLOT_HELM, SLOT_ARMOR, SLOT_RING, SLOT_AMULET], cap: 400 },
  { name: '받는 피해 감소', pct: true, base: 3, per: 0.25, slots: [SLOT_ARMOR, SLOT_HELM], cap: 45 },
  { name: '이동 속도', pct: true, base: 3, per: 0.2, slots: [SLOT_ARMOR, SLOT_AMULET], cap: 30 },
  { name: '기력 회복', pct: true, base: 8, per: 0.8, slots: [SLOT_AMULET, SLOT_HELM], cap: 100 },
  { name: '스킬 재사용 감소', pct: true, base: 3, per: 0.3, slots: [SLOT_HELM, SLOT_AMULET], cap: 40 },
  { name: '처치 시 체력', pct: false, base: 3, per: 0.5, slots: [SLOT_WEAPON, SLOT_RING], cap: 60 },
  { name: '경험치', pct: true, base: 5, per: 0.5, slots: [SLOT_AMULET], cap: 100 },
]

/** 무기 이름 (등급별 앞말) · 방어구 이름 */
const BASE_NAMES = ['', '투구', '갑옷', '반지', '목걸이']
const WEAPON_NAMES: Record<WeaponId, string> = {
  pistol: '권총', smg: 'SMG', rifle: '소총', shotgun: '산탄총', sniper: '저격총', mg: '기관총', pan: '후라이팬',
}
const PREFIX = [
  ['낡은', '녹슨', '평범한'],
  ['단단한', '날렵한', '빛나는'],
  ['저주받은', '피에 젖은', '묘지기의'],
  ['야차의', '침착맨의', '배도라지의'],
]

export function itemName(it: Item): string {
  const base = it.slot === SLOT_WEAPON ? WEAPON_NAMES[WEAPON_IDS[it.wt] ?? 'rifle'] : BASE_NAMES[it.slot]
  const pre = PREFIX[it.rarity][it.uid % 3]
  return `${pre} ${base}`
}

/** 옵션 한 줄 */
export function affixText(id: number, v: number): string {
  const a = AFFIXES[id]
  return a.pct ? `${a.name} +${v}%` : `${a.name} +${v}`
}

/** 무기 아이템의 기본 피해 증가 (옵션과 별개 — 아이템 레벨이 높을수록 센 무기) */
export function weaponBaseDmg(it: Item): number {
  return it.slot === SLOT_WEAPON ? Math.round(it.ilvl * 2.2 + it.rarity * 4) : 0
}
/** 방어구의 기본 방어 (받는 피해 감소 %) */
export function armorBase(it: Item): number {
  return it.slot === SLOT_ARMOR || it.slot === SLOT_HELM ? Math.round(it.ilvl * 0.35 + it.rarity) : 0
}

/**
 * 아이템 하나를 굴린다. myWeapon = 주운 사람의 무기(스마트 루트 85%).
 * 등급 확률: 일반 55 · 마법 32 · 희귀 11 · 전설 2 (엘리트·보스는 bonus 로 위로)
 */
export function rollItem(rng: Rng, uid: number, ilvl: number, myWeapon: WeaponId, bonus = 0): Item {
  const slot = randInt(rng, 0, SLOT_COUNT)
  const r = rand(rng) - bonus
  const rarity = r < 0.02 ? 3 : r < 0.13 ? 2 : r < 0.45 ? 1 : 0
  let wt = -1
  if (slot === SLOT_WEAPON) {
    wt = rand(rng) < 0.85 ? WEAPON_IDS.indexOf(myWeapon) : randInt(rng, 0, WEAPON_IDS.length)
  }
  const aff: number[] = []
  const pool = AFFIXES.map((a, i) => ({ a, i })).filter(({ a }) => a.slots.includes(slot))
  const n = Math.min(AFFIX_COUNT[rarity], pool.length)
  for (let k = 0; k < n; k++) {
    const pick = pool.splice(randInt(rng, 0, pool.length), 1)[0]
    const max = pick.a.base + pick.a.per * ilvl
    // 전설은 옵션이 크다 (최대의 80~100%), 나머지는 50~100%
    const lo = rarity === 3 ? 0.8 : 0.5
    const v = Math.max(1, Math.round(max * (lo + rand(rng) * (1 - lo))))
    aff.push(pick.i, v)
  }
  return { uid, slot, wt, rarity, ilvl, aff }
}

// ---------- 레벨 ----------

export const LEVEL_CAP = 30

/**
 * 다음 레벨까지 필요한 경험치. 캠페인(12원정 · 36층)을 85% 잡으며 한 번 돌면 27 안팎 (tools/xpcurve.ts).
 * 몬스터 경험치가 레벨마다 20% 오르므로 곡선은 완만하다(1레벨 360 · 10레벨 4530 · 29레벨 14600)
 */
export function xpNeed(level: number): number {
  return Math.round(360 * Math.pow(level, 1.1))
}

/** 레벨마다 최대 체력 +6, 피해 +1.5% */
export const HP_PER_LEVEL = 6
export const DMG_PER_LEVEL = 1.5

/**
 * 장비 + 레벨로 능력치를 낸다. 결과는 PlayerState.st 에 들어간다(상태 안 — 결정론).
 * 합산 후 옵션마다 상한을 건다(받는 피해 감소 45%, 스킬 재사용 40% …).
 */
export function computeStats(level: number, equip: (Item | null)[]): number[] {
  const st = new Array(ST_COUNT).fill(0)
  for (const it of equip) {
    if (!it) continue
    for (let k = 0; k < it.aff.length; k += 2) st[it.aff[k]] += it.aff[k + 1]
    st[ST_DMG] += weaponBaseDmg(it)
    st[ST_DR] += armorBase(it)
  }
  st[ST_DMG] += (level - 1) * DMG_PER_LEVEL
  st[ST_HP] += (level - 1) * HP_PER_LEVEL
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
  /** 캠페인: 깬 원정 수 (다음에 열리는 원정 번호). 옛 세이브에는 없다 */
  prog?: number
}

export function emptySheet(): Sheet {
  return { level: 1, xp: 0, gold: 0, equip: new Array(SLOT_COUNT).fill(null), bag: [], prog: 0 }
}

/** 받은 기록이 말이 되는가 (깨진 데이터로 판이 어긋나지 않게 — 치트 방지가 아니라 사고 방지, PLAN 4.5) */
export function sanitizeSheet(s: unknown): Sheet {
  const e = emptySheet()
  if (!s || typeof s !== 'object') return e
  const o = s as Partial<Sheet>
  const okItem = (it: unknown): it is Item => {
    if (!it || typeof it !== 'object') return false
    const x = it as Item
    return Number.isInteger(x.uid) && x.slot >= 0 && x.slot < SLOT_COUNT && x.rarity >= 0 && x.rarity <= 3 && x.ilvl >= 1 && x.ilvl <= 60 && Array.isArray(x.aff) && x.aff.length <= 8 && x.aff.every((v) => Number.isFinite(v))
  }
  e.level = Math.max(1, Math.min(LEVEL_CAP, Math.floor(Number(o.level) || 1)))
  e.xp = Math.max(0, Math.floor(Number(o.xp) || 0))
  e.gold = Math.max(0, Math.floor(Number(o.gold) || 0))
  if (Array.isArray(o.equip)) for (let i = 0; i < SLOT_COUNT; i++) e.equip[i] = okItem(o.equip[i]) && o.equip[i]!.slot === i ? o.equip[i]! : null
  if (Array.isArray(o.bag)) e.bag = o.bag.filter(okItem).slice(0, BAG_SIZE)
  e.prog = Math.max(0, Math.min(99, Math.floor(Number(o.prog) || 0)))
  return e
}
