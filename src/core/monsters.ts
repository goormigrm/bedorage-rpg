// 몬스터 정의표. 수치는 틱(60Hz)·px 단위. 겉모습은 render3d/monsters3d.ts 가 kind 로 고른다.
// 분위기는 디아블로·다키스트 던전풍 고딕 호러(2026-09-18 사용자 결정) — 이름도 그쪽으로.
//
// 원형(archetype)이 행동을 정하고, 수치가 난이도를 정한다. 지역이 바뀌면 원형은 같고 겉모습·수치만 바꾼다(PLAN 5.3).

export type MonsterKindId = 'ghoul' | 'archer' | 'bloater'

/** 공격 방식. melee = 예고 뒤 부채꼴 · ranged = 예고 뒤 느린 투사체 · explode = 붙으면 부풀었다가 터짐 */
export type Attack = 'melee' | 'ranged' | 'explode'

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
  /** 경험치 (M3) */
  xp: number
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
    hp: 70, speed: 2.7, r: 13,
    attack: 'melee', dmg: 16, range: 14, windup: 14, recover: 22, cooldown: 36, arc: deg(70),
    knockRes: 0, globe: 0.05, xp: 6,
  },
  {
    // 해골 궁수: 멀리서 느린 화살. 예고(조준선) 동안 옆으로 비키면 빗나간다
    id: 'archer', idx: 1, name: '해골 궁수',
    hp: 50, speed: 1.7, r: 12,
    attack: 'ranged', dmg: 15, range: 330, windup: 30, recover: 26, cooldown: 80,
    shotSpeed: 5.8, shotLife: 72, shotR: 7, keepDist: 210,
    knockRes: 0.2, globe: 0.06, xp: 8,
  },
  {
    // 부푼 시체: 느리게 다가와 붙으면 부풀었다가 터진다. 쓰러뜨려도 터진다(약하게) — 멀리서 잡거나, 몬스터 무리 속에서 터뜨린다
    id: 'bloater', idx: 2, name: '부푼 시체',
    hp: 130, speed: 1.5, r: 16,
    attack: 'explode', dmg: 55, range: 62, windup: 45, recover: 0, cooldown: 0, blast: 88,
    knockRes: 0.6, globe: 0.12, xp: 10,
  },
]

export const MONSTERS: Record<MonsterKindId, MonsterDef> = Object.fromEntries(MONSTER_LIST.map((m) => [m.id, m])) as Record<MonsterKindId, MonsterDef>

/** 쓰러뜨려서 터질 때는 이만큼만 (다가와 터질 때보다 약하게) */
export const DEATH_BLAST_MULT = 0.6

/**
 * 인원 보정: 몬스터 체력 배율. 4인이면 2.8배 (PLAN 5.9).
 * 전리품이 개인별이라 사람이 늘어도 나눠 먹지 않는다 — 몬스터만 단단해진다.
 */
export function hpScaleFor(players: number): number {
  return 1 + 0.6 * Math.max(0, players - 1)
}
