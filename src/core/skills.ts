// 스킬 정의표: 캐릭터마다 스킬 2개(Q·E) + 궁극기 1개(R). 기존 특성(패시브)은 그대로 둔다.
// (2026-09-18 사용자 요청: "캐릭터마다 특성이 1개씩 있었는데 RPG 에서는 스킬 2개에 궁극기 1개 더")
// 효과 구현은 sim.ts castSkill — 여기는 이름·설명·재사용 시간·아이콘만. 시간은 틱(60Hz), 거리는 px.
//
// 설계 원칙: 슈팅의 손맛을 해치지 않게 **조준이 필요한 스킬**(수류탄·스포트라이트는 커서 지점, 관통·난사는 조준 방향)과
// **역할을 만드는 스킬**(도발·치유·부활·약화)을 섞었다. 궁극기는 한 층에 두세 번 쓰는 무게(60~90초).

import { CharacterId } from './characters'

export type SkillId =
  | 'ironwall' | 'barrage' | 'roar'
  | 'pierce' | 'grenade' | 'composure'
  | 'broadcast' | 'fanfire' | 'spotlight'
  | 'firstaid' | 'flame' | 'surgery'
  | 'pancharge' | 'oil' | 'kitchen'
  | 'catstep' | 'railshot' | 'ninelives'
  | 'flash' | 'mirror' | 'supernova'
  | 'stunt' | 'curtain' | 'redcarpet'
  | 'overdrive' | 'shout' | 'kingrage'
  | 'gust' | 'windstep' | 'typhoon'
  | 'snack' | 'trap' | 'angelshot'
  | 'catwalk' | 'flashbulb' | 'encore'

export interface SkillDef {
  id: SkillId
  name: string
  /** 한두 문장. 수치는 넣되 짧게 (툴팁·로비 카드) */
  desc: string
  /** 재사용 대기 (틱) */
  cd: number
  /** 궁극기 */
  ult?: boolean
  /** 커서 지점에 쓰는 스킬의 최대 거리 (px). 없으면 내 자리·조준 방향 */
  reach?: number
}

const s = (sec: number) => Math.round(sec * 60)

export const SKILLS: Record<SkillId, SkillDef> = {
  // 철면덕 — 탱커: 맞아 주고 끌어모은다
  ironwall: { id: 'ironwall', name: '철벽', desc: '4초간 받는 피해 -50%, 7칸 안의 괴물이 나만 노린다.', cd: s(14) },
  barrage: { id: 'barrage', name: '탄막', desc: '4초간 연사 2배. 맞은 괴물은 느려진다.', cd: s(16) },
  roar: { id: 'roar', name: '야차의 포효', desc: '주변 5칸에 120 피해 · 밀쳐 내고 2초 기절. 8칸 안 동료는 6초간 받는 피해 -30%.', cd: s(70), ult: true },
  // 침착덕 — 원거리: 정확하게, 줄지어 선 것을 꿰뚫는다
  pierce: { id: 'pierce', name: '관통탄', desc: '다음 6발이 괴물 3마리를 꿰뚫고 피해 +30%.', cd: s(10) },
  grenade: { id: 'grenade', name: '수류탄', desc: '커서 지점(9칸까지)에 던진다. 0.7초 뒤 3칸에 80 피해 · 1초 기절.', cd: s(12), reach: 9 * 32 },
  composure: { id: 'composure', name: '침착 모드', desc: '6초간 모든 탄이 치명타, 연사 1.5배, 반동 없음.', cd: s(60), ult: true },
  // 단군덕 — 정찰: 보여 주고 약하게 만든다 (소음기라 무리를 깨우지 않는다)
  broadcast: { id: 'broadcast', name: '생중계', desc: '18칸 안의 괴물을 8초간 드러내고(벽 너머도) 받는 피해 +25%.', cd: s(16) },
  fanfire: { id: 'fanfire', name: '난사', desc: '조준 방향 30° 부채꼴로 8발을 한꺼번에 쏜다.', cd: s(8) },
  spotlight: { id: 'spotlight', name: '스포트라이트', desc: '커서 지점(10칸까지)에 8초짜리 무대. 안의 괴물은 절반 속도 · 받는 피해 +50%, 안의 동료는 연사 +30%.', cd: s(60), ult: true, reach: 10 * 32 },
  // 매직덕 — 치유: 파티를 살린다
  firstaid: { id: 'firstaid', name: '응급 처치', desc: '나와 6칸 안의 동료가 최대 체력 25% 를 회복한다.', cd: s(15) },
  flame: { id: 'flame', name: '소독 화염', desc: '앞 4칸 부채꼴에 60 피해 · 밀쳐 낸다.', cd: s(9) },
  surgery: { id: 'surgery', name: '대수술', desc: '8칸 안의 쓰러진 동료를 바로 일으키고, 모두 체력 가득 · 3초 무적.', cd: s(90), ult: true },
  // 승빠덕 — 근접: 들어가서 휘젓는다
  pancharge: { id: 'pancharge', name: '후라이팬 돌진', desc: '조준 방향으로 5칸 돌진. 지나는 괴물에 60 피해 · 밀침, 돌진 중 무적.', cd: s(7) },
  oil: { id: 'oil', name: '기름 튀기기', desc: '주변 3칸에 50 피해 · 2.5초간 절반 속도.', cd: s(10) },
  kitchen: { id: 'kitchen', name: '주방 대참사', desc: '5초간 회전하며 0.25초마다 주변 2.4칸에 35 피해. 이동 +30% · 받는 피해 -50%.', cd: s(60), ult: true },
  // 옥냥덕 — 보스 딜: 한 방을 크게
  catstep: { id: 'catstep', name: '고양이 걸음', desc: '뒤로 4칸 도약(무적). 다음 한 발 피해 2배.', cd: s(9) },
  railshot: { id: 'railshot', name: '관통 저격', desc: '모든 괴물을 꿰뚫는 한 발 — 200 피해, 약점을 겨누면 치명타.', cd: s(12) },
  ninelives: { id: 'ninelives', name: '아홉 목숨', desc: '8초간 연사 3배 · 탄이 2마리를 더 꿰뚫고 퍼짐이 거의 없다.', cd: s(70), ult: true },
  // ---- D7 나머지 여섯 (2026-09-18) ----
  // 주펄덕 — 빛: 붙어서 눈부시게
  flash: { id: 'flash', name: '섬광', desc: '주변 3.5칸에 25 피해 · 1.5초 기절.', cd: s(11) },
  mirror: { id: 'mirror', name: '반사광', desc: '3초간 받는 피해 -60% · 나를 때린 괴물은 그 피해의 1.5배를 돌려받는다.', cd: s(14) },
  supernova: { id: 'supernova', name: '초신성', desc: '주변 6칸에 200 피해 · 밀쳐 내고 2.5초 기절.', cd: s(75), ult: true },
  // 우원덕 — 배우: 구르고 무대를 지배한다
  stunt: { id: 'stunt', name: '스턴트', desc: '조준 방향으로 구르며(무적) 부채꼴로 6발을 쏜다.', cd: s(9) },
  curtain: { id: 'curtain', name: '커튼콜', desc: '7칸 안의 괴물이 4초간 절반 속도 · 드러남 · 받는 피해 +20%.', cd: s(14) },
  redcarpet: { id: 'redcarpet', name: '레드카펫', desc: '8초간 구르기가 줄지 않고, 구를 때마다 주변 2.5칸에 70 피해 · 0.5초 기절.', cd: s(70), ult: true },
  // 기열덕 — 뇌절: 쌓아서 터뜨린다
  overdrive: { id: 'overdrive', name: '폭주', desc: '뇌절을 바로 가득 채우고 5초간 연사 +30%.', cd: s(14) },
  shout: { id: 'shout', name: '고함', desc: '앞 5칸 부채꼴에 50 피해 · 멀리 밀치고 2초 느리게.', cd: s(10) },
  kingrage: { id: 'kingrage', name: '킹의 분노', desc: '8초간 모든 탄이 2마리를 꿰뚫고 피해 +30% · 뇌절이 두 배로 쌓인다.', cd: s(70), ult: true },
  // 풍월덕 — 바람: 휩쓸고 지나간다
  gust: { id: 'gust', name: '돌풍', desc: '주변 4칸의 괴물을 멀리 날리고 30 피해 · 1초 기절.', cd: s(9) },
  windstep: { id: 'windstep', name: '순풍', desc: '구르기가 모두 차고 4초간 이동 +40%.', cd: s(12) },
  typhoon: { id: 'typhoon', name: '태풍', desc: '커서 지점(8칸까지)에 6초 소용돌이 — 안의 괴물을 가운데로 끌어당기고 0.5초마다 30 피해.', cd: s(70), ult: true, reach: 8 * 32 },
  // 통천덕 — 치킨: 버티며 한 방
  snack: { id: 'snack', name: '치킨 한 입', desc: '체력 30% 회복 · 4초간 연사 +30%.', cd: s(15) },
  trap: { id: 'trap', name: '덫', desc: '커서 지점(7칸까지)에 덫(20초). 처음 밟은 괴물 둘레 2칸에 120 피해 · 3초 기절.', cd: s(12), reach: 7 * 32 },
  angelshot: { id: 'angelshot', name: '천사의 한 발', desc: '모든 것을 꿰뚫는 거대한 한 발 — 400 피해, 약점을 겨누면 치명타.', cd: s(70), ult: true },
  // 우재덕 — 런웨이: 길게 가로지른다
  catwalk: { id: 'catwalk', name: '런웨이 워크', desc: '조준 방향으로 7칸 긴 돌진(무적). 지나는 괴물에 60 피해 · 밀침.', cd: s(8) },
  flashbulb: { id: 'flashbulb', name: '플래시 세례', desc: '커서 지점(9칸까지) 3칸에 20 피해 · 2초 기절 · 6초간 드러남과 받는 피해 +30%.', cd: s(12), reach: 9 * 32 },
  encore: { id: 'encore', name: '앙코르', desc: '다른 스킬의 재사용 대기를 모두 끝내고 집중을 가득 · 6초간 연사 +50%.', cd: s(80), ult: true },
}

/** 캐릭터별 [Q, E, X]. 1차 6명 밖의 캐릭터는 무기가 같은 1차 캐릭터 것을 빌린다(M7 에서 제 것을 준다) */
/**
 * 스킬 트리 (GUIDE 8장 — D4). 캐릭터마다 10칸: 0~4 액티브(자기 Q·E + 다른 캐릭터에게서 배우는 셋) · 5 궁극기 · 6~9 패시브.
 * 랭크 1~5 — 레벨마다 포인트 하나. 액티브·궁극기는 랭크마다 위력 +15% · 재사용 -4%.
 * 3랭크에서 [위력 +25% | 재사용 -20%], 5랭크에서 [위력 +25% | 집중 -35%] 중 하나를 고른다.
 */
export const TREE_ACTIVE: Record<string, SkillId[]> = {
  cheolmyeon: ['ironwall', 'barrage', 'pancharge', 'grenade', 'firstaid'],
  chim: ['pierce', 'grenade', 'fanfire', 'broadcast', 'catstep'],
  dangun: ['broadcast', 'fanfire', 'catstep', 'oil', 'pierce'],
  magic: ['firstaid', 'flame', 'ironwall', 'broadcast', 'grenade'],
  seungwoo: ['pancharge', 'oil', 'ironwall', 'flame', 'barrage'],
  oknyang: ['catstep', 'railshot', 'pierce', 'oil', 'fanfire'],
  jupeol: ['flash', 'mirror', 'fanfire', 'barrage', 'oil'],
  uwon: ['stunt', 'curtain', 'broadcast', 'catstep', 'fanfire'],
  giyeol: ['overdrive', 'shout', 'pierce', 'grenade', 'flashbulb'],
  pungwol: ['gust', 'windstep', 'flame', 'firstaid', 'pancharge'],
  tongdak: ['snack', 'trap', 'railshot', 'catstep', 'broadcast'],
  juwoojae: ['catwalk', 'flashbulb', 'pierce', 'stunt', 'curtain'],
}
export const PASSIVES: { name: string; desc: string }[] = [
  { name: '총기 숙련', desc: '피해 +4% / 랭크' },
  { name: '강인함', desc: '최대 체력 +6% / 랭크' },
  { name: '민첩', desc: '이동 +2% · 구르기 충전 -6% / 랭크' },
  { name: '정신 집중', desc: '집중 획득 +10% · 재사용 대기 -2% / 랭크' },
]
export const TREE_SIZE = 10
export const ULT_NODE = 5
export const MAX_RANK = 5
export const MOD_NAMES = [['위력 (+25%)', '신속 (재사용 -20%)'], ['극대화 (+25%)', '절약 (집중 -35%)']]

/** 스킬 빌드 (세이브 · 판에 들어간다): 칸별 랭크 · 3·5랭크 변형(0 안 고름, 1·2) · 스킬 칸 Q·E·1·2 에 건 칸 번호 */
export type Build = { r: number[]; m3: number[]; m5: number[]; s: number[] }

export function defaultBuild(): Build {
  const r = new Array(TREE_SIZE).fill(0)
  r[0] = 1
  r[1] = 1
  r[ULT_NODE] = 1
  return { r, m3: new Array(TREE_SIZE).fill(0), m5: new Array(TREE_SIZE).fill(0), s: [0, 1, 2, 3] }
}

/** 받은 빌드가 말이 되는가 (사고 방지) */
export function sanitizeBuild(b: unknown): Build {
  const d = defaultBuild()
  if (!b || typeof b !== 'object') return d
  const o = b as Partial<Build>
  const num = (v: unknown, lo: number, hi: number, def: number) => (Number.isInteger(v) ? Math.max(lo, Math.min(hi, v as number)) : def)
  for (let i = 0; i < TREE_SIZE; i++) {
    d.r[i] = num(o.r?.[i], i === 0 || i === 1 || i === ULT_NODE ? 1 : 0, MAX_RANK, d.r[i])
    d.m3[i] = d.r[i] >= 3 ? num(o.m3?.[i], 0, 2, 0) : 0
    d.m5[i] = d.r[i] >= 5 ? num(o.m5?.[i], 0, 2, 0) : 0
  }
  for (let k = 0; k < 4; k++) d.s[k] = num(o.s?.[k], 0, 4, k)
  return d
}

/** 쓴 포인트 (처음 공짜 셋은 빼고) */
export function spentPoints(b: Build): number {
  return b.r.reduce((a, v) => a + v, 0) - 3
}

/** 쓸 수 있는 포인트: 레벨마다 하나 + 퀘스트 보상 */
export function freePoints(level: number, b: Build, bonus = 0): number {
  return level - 1 + bonus - spentPoints(b)
}

/** 칸의 위력 배율 · 재사용 배율 · 집중 비용 배율 */
export function nodePow(b: Build, n: number): number {
  return 1 + 0.15 * Math.max(0, b.r[n] - 1) + (b.m3[n] === 1 ? 0.25 : 0) + (b.m5[n] === 1 ? 0.25 : 0)
}
export function nodeCd(b: Build, n: number): number {
  return (1 - 0.04 * Math.max(0, b.r[n] - 1)) * (b.m3[n] === 2 ? 0.8 : 1)
}
export function focusCost(def: SkillDef, b: Build, n: number): number {
  if (def.ult) return 0
  const base = Math.max(15, Math.min(40, Math.round((def.cd / 60) * 2.5)))
  return Math.round(base * (b.m5[n] === 2 ? 0.65 : 1))
}

/** 스킬 칸(0 Q · 1 E · 2 R · 3 [1] · 4 [2]) → 트리 칸 번호 (배우지 않았으면 -1) */
export function slotNode(p: { build: Build }, slot: number): number {
  if (slot === 2) return ULT_NODE
  const n = p.build.s[slot < 2 ? slot : slot - 1] ?? -1
  return n >= 0 && n < 5 && p.build.r[n] > 0 ? n : -1
}

/** 트리 칸 → 스킬 */
export function nodeSkill(p: { char: CharacterId }, node: number): SkillId {
  if (node === ULT_NODE) return CHAR_SKILLS[p.char][2]
  return (TREE_ACTIVE[p.char] ?? CHAR_SKILLS[p.char])[node] ?? CHAR_SKILLS[p.char][0]
}

export const CHAR_SKILLS: Record<CharacterId, [SkillId, SkillId, SkillId]> = {
  cheolmyeon: ['ironwall', 'barrage', 'roar'],
  chim: ['pierce', 'grenade', 'composure'],
  dangun: ['broadcast', 'fanfire', 'spotlight'],
  magic: ['firstaid', 'flame', 'surgery'],
  seungwoo: ['pancharge', 'oil', 'kitchen'],
  oknyang: ['catstep', 'railshot', 'ninelives'],
  jupeol: ['flash', 'mirror', 'supernova'],
  uwon: ['stunt', 'curtain', 'redcarpet'],
  giyeol: ['overdrive', 'shout', 'kingrage'],
  pungwol: ['gust', 'windstep', 'typhoon'],
  tongdak: ['snack', 'trap', 'angelshot'],
  juwoojae: ['catwalk', 'flashbulb', 'encore'],
}

/** 스킬 칸 키 (칸 번호 = PlayerState.cd 번호: 0 Q · 1 E · 2 R · 3 [1] · 4 [2]) — 궁극기는 X 였다가 R (2026-09-19) */
export const SKILL_KEYS = ['Q', 'E', 'R', '1', '2'] as const

/** 판이 시작될 때 궁극기는 절반쯤 차 있다 — 첫 큰 싸움에서 한 번은 쓸 수 있게 */
export const ULT_START_FRAC = 0.5

export function skillsOf(char: CharacterId): SkillDef[] {
  return CHAR_SKILLS[char].map((id) => SKILLS[id])
}

// ---------- 버프 (플레이어 fx 배열 번호) ----------
/** 받는 피해 -50% (철벽) */
export const FX_GUARD = 0
/** 연사 배율이 걸린 시간 (탄막 2배 · 침착 1.5배 · 스포트라이트 1.3배 · 아홉 목숨 3배 — 가장 큰 것) */
export const FX_RATE = 1
/** 탄막(철면덕 E) 중 — 맞은 괴물이 느려진다 (재장전이 없어진 뒤로 "탄을 안 씀" 은 뜻이 없다) */
export const FX_FREEAMMO = 2
/** 모든 탄이 치명타 · 반동 없음 (침착 모드) */
export const FX_CRIT = 3
/** 회전 공격 중 (주방 대참사) — 받는 피해 -50% · 이동 +30% */
export const FX_WHIRL = 4
/** 파티 받는 피해 -30% (야차의 포효) */
export const FX_PARTYDR = 5
/** 저격 강화 (아홉 목숨) — 관통 2 · 정조준 퍼짐 */
export const FX_SNIPE = 6
/** 돌진·도약 중 (움직임은 dashTimer 가 맡고, 이 값은 돌진 피해를 준다) */
export const FX_CHARGE = 7
/** 반사광 (주펄덕): 받는 피해 -60% · 때린 괴물에게 1.5배 */
export const FX_REFLECT = 8
/** 레드카펫 (우원덕): 구르기가 줄지 않고 구를 때마다 주변을 친다 */
export const FX_CARPET = 9
/** 킹의 분노 (기열덕): 탄 관통 2 · 피해 +30% · 뇌절 두 배 */
export const FX_KING = 10
/** 순풍 (풍월덕): 이동 +40% */
export const FX_SWIFT = 11
export const FX_COUNT = 12
