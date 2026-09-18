// 몬스터 정의표. 수치는 틱(60Hz)·px 단위. 겉모습은 render3d/monsters3d.ts 가 kind 로 고른다.
// 분위기는 디아블로·다키스트 던전풍 고딕 호러(2026-09-18 사용자 결정) — 이름도 그쪽으로.
//
// 원형(archetype)이 행동을 정하고, 수치가 난이도를 정한다. 지역이 바뀌면 원형은 같고 겉모습·수치만 바꾼다(PLAN 5.3).

export type MonsterKindId = 'ghoul' | 'archer' | 'bloater' | 'butcher' | 'goblin'

/** 공격 방식. melee = 예고 뒤 부채꼴 · ranged = 예고 뒤 느린 투사체 · explode = 붙으면 부풀었다가 터짐 */
export type Attack = 'melee' | 'ranged' | 'explode' | 'flee'

export interface MonsterDef {
  id: MonsterKindId
  /** 배열 순서 = GameState 의 kind 번호 (바꾸면 안 된다 — 스냅샷에 번호로 들어간다) */
  idx: number
  name: string
  hp: number
  /** px/tick */
  speed: number
  /** 몸 반지름 px */
  r: number
  attack: Attack
  dmg: number
  /**
   * 공격 거리. melee = 몸 가장자리끼리의 틈(px), ranged = 쏘기 시작하는 거리,
   * explode = 부풀기 시작하는 거리(중심 사이)
   */
  range: number
  /** 예고(휘두르기 전 · 조준 · 부풀기) 틱. 이 동안 구르면 피한다 */
  windup: number
  /** 공격 뒤 멈춰 있는 틱 */
  recover: number
  /** 다음 공격까지 틱 */
  cooldown: number
  /** melee 부채꼴 반각 (1024 단위) */
  arc?: number
  /** ranged: 투사체 속도·수명·반지름 */
  shotSpeed?: number
  shotLife?: number
  shotR?: number
  /** ranged: 이만큼 떨어져 쏘려고 한다 (너무 붙으면 물러선다) */
  keepDist?: number
  /** explode: 폭발 반경 */
  blast?: number
  /** 넉백 저항 0..1 (1 이면 안 밀린다) */
  knockRes: number
  /** 쓰러뜨리면 떨어지는 회복 구슬 확률 */
  globe: number
  /** 경험치 */
  xp: number
  /** 쓰러뜨렸을 때 파티원마다 전리품이 떨어질 확률 (개인 전리품 — 각자 굴린다) */
  loot: number
  /** 보스: 화면 위 체력 바 · 돌진 공격 · 무리에 섞이지 않는다 */
  boss?: boolean
}

const deg = (d: number) => Math.round((d / 360) * 1024)

/**
 * 첫 세 원형. 체력은 소총(23)으로 구울 세 발 · 궁수 세 발 · 시체 여섯 발.
 * 구울은 사람(3.2)보다 조금 느린 2.7 — 걸어서는 겨우 떨어지고, 달리기·구르기로 벌린다.
 * 2026-09-18 첫 계측: 구울 2.3·피해 14 · 궁수 예고 36 이면 보통 봇 혼자 2분 19초에 106마리를 다 잡고 한 번도 안 쓰러졌다 → 올렸다.
 */
export const MONSTER_LIST: MonsterDef[] = [
  {
    id: 'ghoul', idx: 0, name: '구울',
    hp: 60, speed: 2.7, r: 13,
    attack: 'melee', dmg: 16, range: 14, windup: 14, recover: 22, cooldown: 36, arc: deg(70),
    knockRes: 0, globe: 0.05, xp: 6, loot: 0.07,
  },
  {
    // 해골 궁수: 멀리서 느린 화살. 예고(조준선) 동안 옆으로 비키면 빗나간다
    id: 'archer', idx: 1, name: '해골 궁수',
    hp: 50, speed: 1.7, r: 12,
    attack: 'ranged', dmg: 15, range: 330, windup: 30, recover: 26, cooldown: 80,
    shotSpeed: 5.8, shotLife: 72, shotR: 7, keepDist: 210,
    knockRes: 0.2, globe: 0.06, xp: 8, loot: 0.09,
  },
  {
    // 부푼 시체: 느리게 다가와 붙으면 부풀었다가 터진다. 쓰러뜨려도 터진다(약하게) — 멀리서 잡거나, 몬스터 무리 속에서 터뜨린다
    id: 'bloater', idx: 2, name: '부푼 시체',
    hp: 130, speed: 1.5, r: 16,
    attack: 'explode', dmg: 55, range: 62, windup: 45, recover: 0, cooldown: 0, blast: 88,
    knockRes: 0.6, globe: 0.12, xp: 10, loot: 0.14,
  },
  {
    // 보스 — 도살자: 마지막 층 깊은 곳. 붙으면 큰 칼질(±90°), 멀면 **예고선을 긋고 돌진**한다(옆으로 비키거나 구르면 산다)
    id: 'butcher', idx: 3, name: '도살자',
    hp: 1400, speed: 2.1, r: 24,
    attack: 'melee', dmg: 42, range: 20, windup: 26, recover: 34, cooldown: 55, arc: deg(90),
    knockRes: 0.92, globe: 1, xp: 240, loot: 1, boss: true,
  },
  {
    // 보물 고블린 (디아블로 3): 싸우지 않고 **도망친다** — 뛰면서 골드를 흘리고, 20초 안에 못 잡으면 문을 열고 사라진다.
    // 잡으면 전리품 분수 (골드 여덟 · 아이템 셋 · 물약)
    id: 'goblin', idx: 4, name: '보물 고블린',
    hp: 260, speed: 3.0, r: 12,
    attack: 'flee', dmg: 0, range: 0, windup: 0, recover: 0, cooldown: 0,
    knockRes: 0.3, globe: 0.3, xp: 30, loot: 0,
  },
]

/** 보물 고블린: 깨어 있는 틱 상한(20초) · 골드를 흘리는 간격 · 지역에 나올 확률 */
export const GOBLIN = { escape: 60 * 20, trail: 70, chance: 0.14 }
export const GOBLIN_KIND = 4

export const MONSTERS: Record<MonsterKindId, MonsterDef> = Object.fromEntries(MONSTER_LIST.map((m) => [m.id, m])) as Record<MonsterKindId, MonsterDef>

/** 쓰러뜨려서 터질 때는 이만큼만 (다가와 터질 때보다 약하게) */
export const DEATH_BLAST_MULT = 0.6

/** 보스 돌진: 예고 틱 · 속도 · 길이 · 피해 */
export const CHARGE = { windup: 48, speed: 10, ticks: 30, dmg: 55, every: 60 * 7 }
/** 정예: 무리 다섯에 하나, 우두머리가 된다 — 체력 4배 · 공격 1.4배 · 전리품 확정(등급 올림) · 경험치·골드 4배 */
export const ELITE = { hp: 4, pow: 1.4, xp: 4, lootBonus: 0.18 }

/**
 * 정예 접두 능력 (디아블로의 "빠른 · 불타는 …"). Monster.elite 는 비트 묶음 — 1 = 정예, 나머지 비트 = 능력.
 * 1~2층은 하나, 3층부터 둘. 무리 rng 로 고르므로 결정론.
 */
export const EA_FAST = 2
export const EA_STOUT = 4
export const EA_VOLATILE = 8
export const EA_SPLIT = 16
export const EA_VAMP = 32
/** 접두 능력이 아니라 표시: 이름 있는 **우두머리** (이름은 world.ts 의 지역 표에서) */
export const EA_UNIQUE = 64
/** 우두머리: 체력·공격·경험치 배율 · 접두 능력 수 · 전리품 등급 보너스 · 전리품 수 */
export const UNIQUE = { hp: 9, pow: 1.5, xp: 12, affixes: 3, lootBonus: 0.3, drops: 2 }
export const ELITE_AFFIXES: { bit: number; name: string; desc: string }[] = [
  { bit: EA_FAST, name: '빠름', desc: '이동 1.35배' },
  { bit: EA_STOUT, name: '단단함', desc: '받는 피해 0.6배' },
  { bit: EA_VOLATILE, name: '폭발', desc: '죽은 자리가 1초 뒤 터진다' },
  { bit: EA_SPLIT, name: '분열', desc: '죽으면 구울 셋이 기어 나온다' },
  { bit: EA_VAMP, name: '흡혈', desc: '때린 피해의 절반만큼 회복' },
]
export const AFFIX_TUNE = {
  fast: 1.35,
  stout: 0.6,
  /** 폭발: 예고 틱 · 반경 · 피해(정예 pow 를 곱한다) */
  fuseTicks: 60,
  fuseR: 84,
  fuseDmg: 40,
  /** 분열: 나오는 구울 수 · 체력 비율(층 보정 곱한 뒤) */
  splitN: 3,
  splitHp: 0.6,
  vamp: 0.5,
}

/**
 * 몬스터 레벨마다 경험치 +20% (tools/xpcurve.ts 로 맞춘 값 — 원정마다 지역 레벨 안팎으로 도착하고,
 * 캠페인 끝에 27 안팎이 되게 — 만렙 30 은 다시 돌며 채운다). 정예 ×4 · 우두머리 ×12.
 */
export const XP_PER_MLEVEL = 0.2
export function xpFor(m: { kind: number; elite: number; lvl: number }): number {
  const k = m.elite & EA_UNIQUE ? UNIQUE.xp : m.elite ? ELITE.xp : 1
  return MONSTER_LIST[m.kind].xp * k * (1 + XP_PER_MLEVEL * (Math.max(1, m.lvl) - 1))
}

/** 보스처럼 다룬다 (큰 체력 막대 · 쓰러뜨리면 원정 완료) */
export function isBossLike(m: { kind: number; elite: number }): boolean {
  return !!MONSTER_LIST[m.kind].boss || (m.elite & EA_UNIQUE) !== 0
}

/** 정예 능력 이름들 ("빠름 · 폭발") */
export function affixNames(elite: number): string {
  return ELITE_AFFIXES.filter((a) => elite & a.bit)
    .map((a) => a.name)
    .join(' · ')
}

/**
 * 인원 보정: 몬스터 체력 배율. 4인이면 2.8배 (PLAN 5.9).
 * 전리품이 개인별이라 사람이 늘어도 나눠 먹지 않는다 — 몬스터만 단단해진다.
 */
export function hpScaleFor(players: number): number {
  return 1 + 0.6 * Math.max(0, players - 1)
}
