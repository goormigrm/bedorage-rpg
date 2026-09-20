// 몬스터 정의표. 수치는 틱(60Hz)·px 단위. 겉모습은 render3d/monsters3d.ts 가 kind 로 고른다.
// 분위기는 디아블로·다키스트 던전풍 고딕 호러(2026-09-18 사용자 결정) — 이름도 그쪽으로.
//
// 원형(archetype)이 행동을 정하고, 수치가 난이도를 정한다. 지역이 바뀌면 원형은 같고 겉모습·수치만 바꾼다(PLAN 5.3).

export type MonsterKindId = 'ghoul' | 'archer' | 'bloater' | 'butcher' | 'goblin' | 'wolf' | 'spider' | 'shaman' | 'queen' | 'shield' | 'necro' | 'spitter' | 'warden' | 'shade' | 'demon' | 'lord'

/** 공격 방식. melee = 예고 뒤 부채꼴 · ranged = 예고 뒤 느린 투사체 · explode = 붙으면 부풀었다가 터짐 */
export type Attack = 'melee' | 'ranged' | 'explode' | 'flee' | 'heal' | 'lob'

/** 보스 특수 패턴 (MS_CHASE 에서 특수 재사용 대기 scd 가 0 이면) */
export type Special = 'charge' | 'queen' | 'raise' | 'warden' | 'blink' | 'lord'

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
  /** explode: 폭발 반경 · lob: 있으면 산성 웅덩이 대신 이 반경의 폭발 예고(ZONE_FUSE) */
  blast?: number
  /** 넉백 저항 0..1 (1 이면 안 밀린다) */
  knockRes: number
  /** 쓰러뜨리면 떨어지는 회복 구슬 확률 */
  globe: number
  /** 경험치 */
  xp: number
  /** 쓰러뜨렸을 때 파티원마다 전리품이 떨어질 확률 (개인 전리품 — 각자 굴린다) */
  loot: number
  /** 보스: 화면 위 체력 바 · 무리에 섞이지 않는다 */
  boss?: boolean
  /** 보스 특수 패턴 */
  special?: Special
  /** ranged: 맞으면 이만큼(틱) 느려진다 (거미줄 — 다리 부상과 같은 0.7배) */
  shotSlow?: number
  /** 투사체 색 (기본 붉은빛) */
  shotColor?: number
  /** heal: 한 번에 주위 동료 체력의 이 비율을 채운다 (반경 = range) */
  heal?: number
  /** 방패: 정면 ±guard(1024 단위)에서 온 탄은 막는다 (GUARD.mult 만 들어간다) */
  guard?: number
  /** 정예가 됐을 때의 체력 배율 (없으면 ELITE.hp). 주술사처럼 **먼저 잡아야 하는** 것은 낮게 둔다 */
  eliteHp?: number
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
    knockRes: 0.92, globe: 1, xp: 240, loot: 1, boss: true, special: 'charge',
  },
  {
    // 보물 고블린 (디아블로 3): 싸우지 않고 **도망친다** — 뛰면서 골드를 흘리고, 20초 안에 못 잡으면 문을 열고 사라진다.
    // 잡으면 전리품 분수 (골드 여덟 · 아이템 셋 · 물약)
    id: 'goblin', idx: 4, name: '보물 고블린',
    hp: 260, speed: 3.0, r: 12,
    attack: 'flee', dmg: 0, range: 0, windup: 0, recover: 0, cooldown: 0,
    knockRes: 0.3, globe: 0.3, xp: 30, loot: 0,
  },
  // ---------------- 2막 안개 숲 ----------------
  {
    // 늑대: 빠르고 약하다. 떼로 둘러싼다 — 달리기만으로는 못 떨친다(사람 3.2 · 늑대 3.3). 구르기·넉백으로 벌린다
    id: 'wolf', idx: 5, name: '굶주린 늑대',
    hp: 48, speed: 3.3, r: 12,
    attack: 'melee', dmg: 11, range: 12, windup: 10, recover: 18, cooldown: 30, arc: deg(60),
    knockRes: 0, globe: 0.04, xp: 5, loot: 0.1,
  },
  {
    // 독거미: 거미줄을 뱉는다 — 맞으면 3초 느려진다. 늑대와 같이 나오면 위험하다
    id: 'spider', idx: 6, name: '독거미',
    hp: 58, speed: 2.3, r: 12,
    attack: 'ranged', dmg: 9, range: 300, windup: 26, recover: 22, cooldown: 90,
    shotSpeed: 5.2, shotLife: 70, shotR: 9, keepDist: 190, shotSlow: 180, shotColor: 0xd8f0c8,
    knockRes: 0.1, globe: 0.06, xp: 7, loot: 0.12,
  },
  {
    // 버섯 주술사: 싸우지 않고 무리 뒤에서 다친 동료를 고친다(주위 동료 체력 25%, 초록 고리). 먼저 잡아라
    id: 'shaman', idx: 7, name: '버섯 주술사',
    hp: 85, speed: 1.8, r: 14,
    // 2026-09-20: 자기 자신·다른 주술사는 못 고친다(sim.resolveAttack). 회복도 25% → 14% · 2.5초 → 3.2초로 내렸다.
    // 정예가 되어도 체력은 2.5배만 (힐러가 단단하기까지 하면 먼저 잡으라는 뜻이 사라진다)
    attack: 'heal', dmg: 0, range: 230, windup: 40, recover: 30, cooldown: 190, keepDist: 260, heal: 0.14, eliteHp: 2.5,
    knockRes: 0.2, globe: 0.1, xp: 12, loot: 0.18,
  },
  {
    // 보스 — 거미 여왕: 가까우면 물기, 번갈아 **거미줄 부채**(7갈래 · 맞으면 느려짐 · 예고선)와 **새끼 거미 부르기**
    id: 'queen', idx: 8, name: '거미 여왕',
    hp: 2200, speed: 1.9, r: 26,
    attack: 'melee', dmg: 38, range: 18, windup: 22, recover: 30, cooldown: 50, arc: deg(60),
    shotSpeed: 5, shotLife: 84, shotR: 9, shotSlow: 150, shotColor: 0xd8f0c8,
    knockRes: 0.95, globe: 1, xp: 300, loot: 1, boss: true, special: 'queen',
  },
  // ---------------- 3막 잠긴 지하도 ----------------
  {
    // 방패병: 큰 방패로 앞을 막는다(정면 ±50° 에서 온 탄은 40% 만). 방패가 무거워 **천천히 돈다**(GUARD.turn) — 옆·뒤로 돌아 들어가거나,
    // 폭발·스킬·근접으로 친다. 잠들어 있을 땐 못 막는다.
    // D7 계측(2026-09-18): 피해 24 · 간격 44 · 속도 2.1 · 15% 면 보통 봇이 무너진 시장에서 76번 죽고 우두머리를 20분에 못 잡았다.
    // 무리를 늘린 뒤에도 3막 받은 피해의 50~90% 가 방패병이었다 → 피해 12 · 막힌 탄 40%
    id: 'shield', idx: 9, name: '방패병',
    hp: 110, speed: 1.8, r: 15,
    attack: 'melee', dmg: 12, range: 14, windup: 22, recover: 30, cooldown: 60, arc: deg(70), guard: deg(50),
    knockRes: 0.7, globe: 0.08, xp: 12, loot: 0.14,
  },
  {
    // 강령술사: 멀리서 보랏빛 저주탄 · 6초마다 구울 둘을 일으킨다(무리에 여섯까지). 먼저 잡아라
    id: 'necro', idx: 10, name: '강령술사',
    hp: 95, speed: 1.7, r: 13,
    attack: 'ranged', dmg: 14, range: 320, windup: 30, recover: 26, cooldown: 100,
    shotSpeed: 4.6, shotLife: 80, shotR: 8, keepDist: 250, shotColor: 0xb07aff,
    knockRes: 0.2, globe: 0.1, xp: 15, loot: 0.2, special: 'raise',
  },
  {
    // 산성 토사꾼: 조준한 자리에 산을 뱉는다(예고 원 — 그 안에서 비켜라) → 3초 동안 산성 웅덩이(밟고 있으면 계속 다친다)
    id: 'spitter', idx: 11, name: '산성 토사꾼',
    hp: 120, speed: 1.6, r: 15,
    attack: 'lob', dmg: 6, range: 300, windup: 36, recover: 30, cooldown: 130, keepDist: 220,
    knockRes: 0.4, globe: 0.1, xp: 13, loot: 0.16,
  },
  {
    // 보스 — 관리인: 지하도의 문지기. 쇠곤봉 휘두르기 + 번갈아 **내려찍기**(주위 원 · 예고) · **방패병 부르기**
    id: 'warden', idx: 12, name: '관리인',
    hp: 2800, speed: 2.0, r: 26,
    attack: 'melee', dmg: 46, range: 20, windup: 26, recover: 32, cooldown: 55, arc: deg(90),
    knockRes: 0.95, globe: 1, xp: 380, loot: 1, boss: true, special: 'warden',
  },
  // ---------------- 4막 심연 ----------------
  {
    // 그림자: 떨어진 표적의 **등 뒤로 순간이동**(예고: 나타날 자리에 보랏빛 원)하고 곧장 할퀸다. 멀리 도망쳐도 소용없다
    // D7 계측: 피해 20 · 떼 5~7 · 4초마다면 그림자 미궁에서 보통 봇 혼자 16~23번 죽었다(받은 피해의 57~66%) → 피해 14 · 6초
    id: 'shade', idx: 13, name: '그림자',
    hp: 90, speed: 2.6, r: 13,
    attack: 'melee', dmg: 14, range: 12, windup: 12, recover: 20, cooldown: 34, arc: deg(70),
    knockRes: 0.1, globe: 0.06, xp: 13, loot: 0.16, special: 'blink',
  },
  {
    // 포격 악마: 멀리서 불덩이를 쏘아 올린다 → 떨어질 자리에 붉은 원이 차오르다 터진다(두 번 예고 — 원 밖으로)
    id: 'demon', idx: 14, name: '포격 악마',
    hp: 170, speed: 1.7, r: 17,
    // D7 계측: 피해 34 · 폭발 예고 46틱이면 재의 들판 받은 피해의 91% 가 불덩이였다 → 26 · 56틱
    attack: 'lob', dmg: 26, range: 380, windup: 22, recover: 30, cooldown: 120, keepDist: 280, blast: 72,
    knockRes: 0.6, globe: 0.12, xp: 18, loot: 0.2,
  },
  {
    // 최종 보스 — 심연의 군주: 휘두르기 + 번갈아 **불꽃 고리**(사방 탄) · **불비**(사람마다 폭발 예고 둘) · (분노 뒤) **그림자 부르기**.
    // 체력 2/3 · 1/3 에서 분노 — 그림자를 부르고, 마지막 단계는 빨라지고 더 자주 쓴다
    id: 'lord', idx: 15, name: '심연의 군주',
    hp: 4800, speed: 2.1, r: 30,
    attack: 'melee', dmg: 55, range: 22, windup: 24, recover: 30, cooldown: 50, arc: deg(100),
    shotSpeed: 4.2, shotLife: 110, shotR: 9, shotColor: 0xff6a2a,
    knockRes: 0.97, globe: 1, xp: 500, loot: 1, boss: true, special: 'lord',
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

/** 거미 여왕: 부채(갈래 · 벌어짐 · 예고 · 피해 배율)와 새끼(한 번에 · 상한 · 체력 배율), 특수 간격. 둘을 번갈아 (Monster.phase) */
export const QUEEN = { fan: 7, spread: 36, fanWindup: 40, fanDmg: 0.45, brood: 4, broodMax: 8, broodHp: 0.4, broodWindup: 34, every: 60 * 4 }
export const SPIDER_KIND = 6
export const GHOUL_KIND = 0
export const SHIELD_KIND = 9
/** 방패병: 정면에서 막은 탄의 피해 배율 */
export const GUARD = { mult: 0.4, turn: 0.25 }
/** 강령술사: 한 번에 일으키는 구울 · 무리 상한 · 체력 배율 · 예고 · 간격 */
export const RAISE = { n: 2, max: 6, hp: 0.5, windup: 40, every: 60 * 6 }
/** 산성 웅덩이: 반경 · 지속 틱 · 피해 간격(틱) */
export const ACID = { r: 58, ticks: 180, every: 30 }
/** 관리인: 내려찍기(예고 · 반경 · 피해 배율) · 방패병 부르기(수 · 상한 · 체력 배율 · 예고) · 특수 간격 */
/** 그림자 순간이동: 표적과의 거리(최소·최대) · 등 뒤 거리 · 예고 · 간격 */
export const BLINK = { min: 110, max: 420, behind: 50, windup: 22, every: 60 * 6 }
export const SHADE_KIND = 13
export const LORD_KIND = 15
/** 포격 악마: 떨어질 자리의 폭발 예고 틱 */
export const DEMON_FUSE = 56
/** 심연의 군주: 불꽃 고리(갈래 · 분노 갈래 · 피해 배율 · 예고) · 불비(예고 · 반경 · 폭발 예고 · 피해 배율) · 그림자(수 · 상한 · 체력) · 간격 · 분노 간격 · 분노 속도 */
export const LORD = {
  nova: 16, novaRage: 24, novaDmg: 0.5, novaWindup: 40,
  meteorWindup: 30, meteorR: 70, meteorT: 50, meteorDmg: 0.9,
  shades: 2, shadeMax: 4, shadeHp: 0.5, callWindup: 34,
  every: 60 * 3.5, rageEvery: 60 * 2.5, rageSpeed: 1.3,
}
export const WARDEN = { slamWindup: 44, slamR: 150, slamDmg: 1.1, guards: 2, guardMax: 4, guardHp: 0.5, callWindup: 36, every: 60 * 4 }
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
// D7(2026-09-18): 0.2 면 2막 끝 13 · 3막 끝 19 로 지역 레벨보다 3~5 낮았다 → 0.3 (tools/xpcurve.ts)
export const XP_PER_MLEVEL = 0.3

/**
 * 몬스터 레벨 보정: 레벨마다 체력 +7.5% · 피해 +4.5%.
 * 2026-09-18 D7 계측: 체력 +10% 이면 플레이어 피해(레벨 1.5% + 무기 기본 2.2/ilvl + 옵션)보다 빨리 자라
 * 3막부터 한 마리 잡는 데 1막의 1.6배가 걸렸다 → 7.5% (4막 끝에서 1.35배 — 조금씩만 어려워진다)
 */
export const LEVEL_HP = 0.075
// 피해 +6% 면 3·4막에서 보통 봇 혼자 지역마다 10~36번 죽었다(무리를 1.8배로 늘린 뒤) → 4.5%
export const LEVEL_POW = 0.045
/** 모든 몬스터 체력 배율 (D7 계측: 소총 세 발 구울 → 네 발 — 싸움 한 번이 너무 짧았다) */
export const HP_BASE = 1.35
/**
 * 난이도 (GUIDE 5장 — 디아블로 2 의 보통 · 악몽 · 지옥): 같은 세계를 지역 레벨을 통째로 올려 다시 돈다.
 * lvl = 지역 레벨에 더함 · hp = 체력 배율(레벨 보정 위에) · affix = 정예·우두머리 접두 능력 더 · loot = 전리품 등급 올림 · gold = 골드 배율.
 * 보통 4막을 끝내면 악몽, 악몽 4막을 끝내면 지옥이 열린다(캐릭터마다 · 퀘스트는 난이도마다 따로).
 */
// 2026-09-19 사용자 "보통인데 꽤 어렵다" → 보통만 쉽게 (악몽·지옥은 그대로):
//   pow = 몬스터 피해 배율(레벨 보정 위에) — 보통 0.75
//   guard = 방패 정면으로 들어가는 피해 비율(GUARD.mult) — 보통 0.6. 3막 무너진 시장(방패병 무리)에서 봇이 12~23번씩 죽었다
export const TIERS = [
  { lvl: 0, hp: 1, affix: 0, loot: 0, gold: 1, pow: 0.75, guard: 0.6 },
  { lvl: 10, hp: 1.3, affix: 1, loot: 0.08, gold: 1.6, pow: 1, guard: GUARD.mult },
  { lvl: 20, hp: 1.7, affix: 2, loot: 0.16, gold: 2.2, pow: 1, guard: GUARD.mult },
]
export const TIER_LABEL = ['보통', '악몽', '지옥']
export const tierOf = (t: number | undefined) => TIERS[Math.max(0, Math.min(TIERS.length - 1, t ?? 0))]
export const levelHp = (level: number) => HP_BASE * (1 + LEVEL_HP * (level - 1))
export const levelPow = (level: number) => Math.round(100 * (1 + LEVEL_POW * (level - 1)))
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
