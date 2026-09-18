// 스킬 정의표: 캐릭터마다 스킬 2개(Q·E) + 궁극기 1개(X). 기존 특성(패시브)은 그대로 둔다.
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
  barrage: { id: 'barrage', name: '탄막', desc: '4초간 연사 2배 · 탄을 쓰지 않는다. 맞은 괴물은 느려진다.', cd: s(16) },
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
  catstep: { id: 'catstep', name: '고양이 걸음', desc: '뒤로 4칸 도약(무적). 다음 저격 한 발 피해 2배.', cd: s(9) },
  railshot: { id: 'railshot', name: '관통 저격', desc: '모든 괴물을 꿰뚫는 한 발 — 200 피해, 약점을 겨누면 치명타.', cd: s(12) },
  ninelives: { id: 'ninelives', name: '아홉 목숨', desc: '8초간 저격 연사 3배 · 재장전 즉시 · 탄이 2마리를 꿰뚫고 조준경 없이도 정확.', cd: s(70), ult: true },
}

/** 캐릭터별 [Q, E, X]. 1차 6명 밖의 캐릭터는 무기가 같은 1차 캐릭터 것을 빌린다(M7 에서 제 것을 준다) */
export const CHAR_SKILLS: Record<CharacterId, [SkillId, SkillId, SkillId]> = {
  cheolmyeon: ['ironwall', 'barrage', 'roar'],
  chim: ['pierce', 'grenade', 'composure'],
  dangun: ['broadcast', 'fanfire', 'spotlight'],
  magic: ['firstaid', 'flame', 'surgery'],
  seungwoo: ['pancharge', 'oil', 'kitchen'],
  oknyang: ['catstep', 'railshot', 'ninelives'],
  // 아직 고를 수 없는 캐릭터 (무기 기준으로 빌림)
  jupeol: ['pierce', 'fanfire', 'composure'],
  uwon: ['broadcast', 'fanfire', 'spotlight'],
  giyeol: ['pierce', 'grenade', 'composure'],
  pungwol: ['firstaid', 'flame', 'surgery'],
  tongdak: ['catstep', 'railshot', 'ninelives'],
  juwoojae: ['pierce', 'grenade', 'composure'],
}

export const SKILL_KEYS = ['Q', 'E', 'X'] as const

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
/** 탄을 쓰지 않는다 (탄막) */
export const FX_FREEAMMO = 2
/** 모든 탄이 치명타 · 반동 없음 (침착 모드) */
export const FX_CRIT = 3
/** 회전 공격 중 (주방 대참사) — 받는 피해 -50% · 이동 +30% */
export const FX_WHIRL = 4
/** 파티 받는 피해 -30% (야차의 포효) */
export const FX_PARTYDR = 5
/** 저격 강화 (아홉 목숨) — 재장전 즉시 · 관통 2 · 조준경 없이 정확 */
export const FX_SNIPE = 6
/** 돌진·도약 중 (움직임은 dashTimer 가 맡고, 이 값은 돌진 피해를 준다) */
export const FX_CHARGE = 7
export const FX_COUNT = 8
