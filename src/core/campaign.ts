// 캠페인: 4막 × 3원정(스테이지) × 3층 = 36층, 평균 약 6시간 (2026-09-18 사용자: "평균 플레이 타임 6시간 정도").
// 원정마다 지역 레벨이 정해져 있고(디아블로 2 처럼), 캐릭터마다 어디까지 깼는지(Sheet.prog)를 기억한다.
// 1·2번째 원정의 끝은 이름 붙은 **우두머리**, 3번째 원정의 끝은 **막 보스**. 쓰러뜨리면 원정 완료 → 다음 원정이 열린다.
//
// 결정론: 여기 표는 상수다. 판은 stage 번호 하나만 들고 다니고(GameState.stage), 몬스터 구성·레벨·맵이 모두 여기서 나온다.

import { MapId } from './maps'

/** 무리 틀: 원형 [종류, 최소, 최대(포함)] 묶음. w = 뽑힐 비중 (막 안에서 합 1) */
export interface PackDef {
  w: number
  groups: [kind: number, min: number, max: number][]
}

export interface ActDef {
  name: string
  /** 로비 설명 */
  desc: string
  map: MapId
  packs: PackDef[]
}

export interface StageDef {
  act: number
  /** 막 안 번호 (0..2) */
  n: number
  name: string
  /** 첫 층의 지역 레벨 (층마다 +1) */
  level: number
  floors: number
  /** 마지막 층의 끝: 보스 종류 · 또는 우두머리(평범한 원형을 크게 키운 것) */
  boss?: number
  unique?: { kind: number; name: string }
  /** 들어갈 때 화면에 뜨는 두 줄 */
  intro: string
}

// 몬스터 종류 번호 (monsters.ts 의 MONSTER_LIST 순서)
const GHOUL = 0
const ARCHER = 1
const BLOATER = 2
const BUTCHER = 3
const WOLF = 4
const SPIDER = 5
const SHAMAN = 6
const QUEEN = 7

export const ACTS: ActDef[] = [
  {
    name: '무너진 성당',
    desc: '성당 아래 지하 묘지. 굶주린 시체들이 방과 복도마다 잠들어 있다.',
    map: 'crypt',
    packs: [
      // 구울 떼 + 궁수 한둘
      { w: 0.55, groups: [[GHOUL, 5, 9], [ARCHER, 0, 2]] },
      // 궁수 무리를 구울이 지킨다
      { w: 0.25, groups: [[ARCHER, 3, 4], [GHOUL, 1, 2]] },
      // 부푼 시체 떼 — 구울 사이에서 터지면 구울도 날아간다
      { w: 0.2, groups: [[BLOATER, 2, 3], [GHOUL, 2, 3]] },
    ],
  },
  {
    name: '안개 숲',
    desc: '마을 밖 숲. 늑대 떼와 독거미, 그리고 쓰러진 것을 다시 일으키는 버섯 주술사.',
    map: 'forest',
    packs: [
      // 늑대 떼 — 빠르게 둘러싼다
      { w: 0.4, groups: [[WOLF, 5, 8]] },
      // 독거미 무리를 늑대가 지킨다 (거미줄에 걸리면 늑대를 못 떨친다)
      { w: 0.25, groups: [[SPIDER, 3, 5], [WOLF, 1, 2]] },
      // 주술사가 뒤에서 고친다 — 먼저 잡아라
      { w: 0.2, groups: [[SHAMAN, 1, 1], [WOLF, 3, 5], [SPIDER, 0, 1]] },
      // 숲까지 흘러나온 시체들
      { w: 0.15, groups: [[GHOUL, 4, 6], [BLOATER, 1, 2]] },
    ],
  },
]

export const STAGES: StageDef[] = [
  {
    act: 0, n: 0, name: '묘지 입구', level: 1, floors: 3,
    unique: { kind: GHOUL, name: '묘지기 오스' },
    intro: '성당 종이 멈춘 밤, 묘지기가 돌아오지 않았다.\n지하에서 무언가 긁는 소리가 올라온다.',
  },
  {
    act: 0, n: 1, name: '납골당', level: 3, floors: 3,
    unique: { kind: ARCHER, name: '뼈활 레나' },
    intro: '뼈를 쌓아 둔 방마다 활시위 당기는 소리.\n죽은 자들이 줄을 맞춰 선다.',
  },
  {
    act: 0, n: 2, name: '도살장', level: 5, floors: 3,
    boss: BUTCHER,
    intro: '피 냄새가 가장 짙은 곳.\n갈고리에 걸린 것들 사이로 무언가 칼을 간다.',
  },
  {
    act: 1, n: 0, name: '늑대 길', level: 8, floors: 3,
    unique: { kind: WOLF, name: '회색 갈기' },
    intro: '성당을 빠져나온 길은 안개에 잠겼다.\n사방에서 늑대 울음이 좁혀 온다.',
  },
  {
    act: 1, n: 1, name: '포자 늪', level: 10, floors: 3,
    unique: { kind: SHAMAN, name: '포자 할멈' },
    intro: '사람 키만 한 버섯이 늪을 덮었다.\n쓰러진 것들이 포자를 뒤집어쓰고 다시 일어선다.',
  },
  {
    act: 1, n: 2, name: '거미 둥지', level: 12, floors: 3,
    boss: QUEEN,
    intro: '숲의 심장은 거미줄로 덮여 있다.\n알을 품은 여왕이 실을 당기며 기다린다.',
  },
]

export const STAGE_COUNT = STAGES.length

export function stageDef(i: number): StageDef {
  return STAGES[Math.max(0, Math.min(STAGES.length - 1, i | 0))]
}

/** "1-2 납골당" */
export function stageLabel(i: number): string {
  const s = stageDef(i)
  return `${s.act + 1}-${s.n + 1} ${s.name}`
}

/** 이 층의 몬스터 레벨: 지역 레벨 + (층 − 1). 파티가 훨씬 높으면 조금 따라 올라온다 (다시 와도 너무 쉽지 않게) */
export function areaLevel(stage: number, floor: number, partyLevel: number): number {
  const s = stageDef(stage)
  return Math.max(s.level + floor - 1, partyLevel - 3)
}

/** 캐릭터 진행(깬 원정 수)으로 고를 수 있는 가장 뒤 원정 */
export function maxStageFor(prog: number): number {
  return Math.max(0, Math.min(STAGE_COUNT - 1, prog | 0))
}
