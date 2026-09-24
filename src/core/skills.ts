// 스킬 정의표: 캐릭터마다 스킬 2개(Q·E) + 궁극기 1개(R). 기존 특성(패시브)은 그대로 둔다.
// (2026-09-18 사용자 요청: "캐릭터마다 특성이 1개씩 있었는데 RPG 에서는 스킬 2개에 궁극기 1개 더")
// 효과 구현은 sim.ts castSkill — 여기는 이름·설명·재사용 시간·아이콘만. 시간은 틱(60Hz), 거리는 px.
//
// 설계 원칙: 슈팅의 손맛을 해치지 않게 **조준이 필요한 스킬**(수류탄·스포트라이트는 커서 지점, 관통·난사는 조준 방향)과
// **역할을 만드는 스킬**(도발·치유·부활·약화)을 섞었다. 궁극기는 한 층에 두세 번 쓰는 무게(60~90초).

import { CharacterId } from './characters'

/** 캐릭터 스킬 Q · E · R (효과 구현이 있는 바탕 스킬) */
export type BaseSkillId =
  | 'ironwall' | 'barrage' | 'roar'
  | 'pierce' | 'grenade' | 'composure'
  | 'broadcast' | 'fanfire' | 'spotlight'
  | 'firstaid' | 'flame' | 'surgery'
  | 'pancharge' | 'oil' | 'kitchen'
  | 'catstep' | 'railshot' | 'ninelives'
  | 'flash' | 'mirror' | 'supernova'
  | 'stunt' | 'curtain' | 'redcarpet'
  | 'overdrive' | 'shout' | 'kingrage'
  | 'advice' | 'cluck' | 'kenwang'
  | 'snack' | 'trap' | 'angelshot'
  | 'catwalk' | 'flashbulb' | 'encore' | 'bladewind'

/**
 * 스킬 트리(K)에서 더 배우는 스킬 — 캐릭터마다 셋, **모두 그 캐릭터만의 이름** (2026-09-19 요청
 * "스킬은 모든 캐릭터에 고유하게만 — K 로 배우는 스킬도. 비슷한 효과여도 이름은 다르게").
 * 예전에는 다른 캐릭터의 Q · E 를 그대로 빌려 이름이 겹쳤다. 효과는 바탕 스킬(base)의 구현을 그대로 쓴다.
 */
export type TreeSkillId =
  | 'cm_bulldoze' | 'cm_mortar' | 'cm_steel' | 'chim_volley' | 'chim_mark' | 'chim_fallback' | 'dg_cut' | 'dg_spill' | 'dg_replay' | 'mg_cast' | 'mg_xray' | 'mg_flask' | 'sw_lid' | 'sw_torch' | 'sw_chop' | 'ok_claw' | 'ok_hairball' | 'ok_knead' | 'jp_prism' | 'jp_overheat' | 'jp_glare' | 'uw_lead' | 'uw_exit' | 'uw_ng' | 'gy_rant' | 'gy_tantrum' | 'gy_glare' | 'pw_heat' | 'pw_breeze' | 'pw_gale' | 'td_drumstick' | 'td_flap' | 'td_crow' | 'jw_pose' | 'jw_turn' | 'jw_finale'

export type SkillId = BaseSkillId | TreeSkillId

export interface SkillDef {
  id: SkillId
  /** 효과를 빌려 쓰는 바탕 스킬 (트리 스킬만) — sim · 연출 · 소리 · 아이콘은 바탕을 본다 */
  base?: BaseSkillId
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

const BASE_SKILLS: Record<BaseSkillId, SkillDef> = {
  // 철면란 — 탱커: 맞아 주고 끌어모은다
  ironwall: { id: 'ironwall', name: '철벽', desc: '4초간 받는 피해 -50%, 7칸 안의 괴물이 나만 노린다.', cd: s(14) },
  // 2026-09-19 철면란이 고기 바이올린(근접)을 든 뒤로 "탄막" → 격정 연주
  barrage: { id: 'barrage', name: '격정 연주', desc: '4초간 휘두르기 2배로 빠르게. 맞은 괴물은 느려진다.', cd: s(16) },
  roar: { id: 'roar', name: '야차의 포효', desc: '주변 5칸에 120 피해 · 밀쳐 내고 2초 기절. 8칸 안 동료는 6초간 받는 피해 -30%. 던전에서는 6칸 · 220 피해 · 3초 기절, 나는 6초간 받는 피해 -50%.', cd: s(70), ult: true },
  // 침착란 — 원거리: 정확하게, 줄지어 선 것을 꿰뚫는다
  pierce: { id: 'pierce', name: '관통탄', desc: '다음 6발이 괴물 3마리를 꿰뚫고 피해 +30%.', cd: s(10) },
  grenade: { id: 'grenade', name: '수류탄', desc: '커서 지점(9칸까지)에 던진다. 0.7초 뒤 3칸에 80 피해 · 1초 기절.', cd: s(12), reach: 9 * 32 },
  composure: { id: 'composure', name: '침착 모드', desc: '6초간 모든 탄이 치명타, 연사 1.5배, 반동 없음. 던전에서는 8초 · 연사 2배.', cd: s(60), ult: true },
  // 단군란 — 정찰: 보여 주고 약하게 만든다 (소음기라 무리를 깨우지 않는다)
  // 2026-09-19 권총 둘이 던전에서 떼에 둘러싸여 가장 많이 죽었다(단군 195 · 우원 421, 다른 캐릭터 31~119) —
  // 권총 수치 대신 스킬로 살아남게 한다(사용자 요청): 생중계 = 받는 피해 감소, 난사 = 밀쳐 내기. 투기장은 그대로
  broadcast: { id: 'broadcast', name: '생중계', desc: '18칸 안의 괴물을 8초간 드러내고(벽 너머도) 받는 피해 +25%. 던전에서는 그동안 나와 8칸 안 동료가 받는 피해 -30%.', cd: s(16) },
  fanfire: { id: 'fanfire', name: '난사', desc: '조준 방향 30° 부채꼴로 8발을 한꺼번에 쏜다. 던전에서는 한 발 28 피해로 하나를 더 꿰뚫고, 앞쪽 3칸 안의 괴물을 밀쳐 내 1.5초 느리게.', cd: s(8) },
  spotlight: { id: 'spotlight', name: '스포트라이트', desc: '커서 지점(10칸까지)에 8초짜리 무대. 안의 괴물은 절반 속도 · 받는 피해 +50%, 안의 동료는 연사 +30%. 던전에서는 무대 5칸 · 켜지는 순간 1.5초 기절 · 0.5초마다 30 피해.', cd: s(60), ult: true, reach: 10 * 32 },
  // 매직란 — 치유: 파티를 살린다
  // 2026-09-19 저격 둘 · 매직 · 우재가 3·4막에서 다른 캐릭터의 두세 배 죽었다(붙은 떼를 떼어내지 못함) — 권총 둘처럼 스킬로, 던전에서만
  firstaid: { id: 'firstaid', name: '응급 처치', desc: '나와 6칸 안의 동료가 최대 체력 25% 를 회복한다. 던전에서는 4초간 받는 피해 -30%.', cd: s(15) },
  flame: { id: 'flame', name: '소독 화염', desc: '앞 4칸 부채꼴에 60 피해 · 밀쳐 낸다. 던전에서는 앞만이 아니라 둘레 4칸 모두를 친다.', cd: s(9) },
  surgery: { id: 'surgery', name: '대수술', desc: '8칸 안의 쓰러진 동료를 바로 일으키고, 모두 체력 가득 · 3초 무적. 던전에서는 12칸 · 그 뒤 8초간 받는 피해 -50%.', cd: s(90), ult: true },
  // 승빠란 — 근접: 들어가서 휘젓는다
  pancharge: { id: 'pancharge', name: '후라이팬 돌진', desc: '조준 방향으로 5칸 돌진. 지나는 괴물에 60 피해 · 밀침, 돌진 중 무적.', cd: s(7) },
  oil: { id: 'oil', name: '기름 튀기기', desc: '주변 3칸에 50 피해 · 2.5초간 절반 속도.', cd: s(10) },
  kitchen: { id: 'kitchen', name: '주방 대참사', desc: '5초간 회전하며 0.25초마다 주변 2.4칸에 35 피해. 이동 +30% · 받는 피해 -50%. 던전에서는 7초 · 3칸 · 65 피해.', cd: s(60), ult: true },
  // 옥냥란 — 보스 딜: 한 방을 크게
  catstep: { id: 'catstep', name: '고양이 걸음', desc: '뒤로 4칸 도약(무적). 다음 한 발 피해 2배. 던전에서는 뛰며 원래 자리 3칸을 할퀴고(40 피해 · 2초 기절) 착지 뒤 2초간 받는 피해 -30% · 재사용 7초.', cd: s(9) },
  railshot: { id: 'railshot', name: '관통 저격', desc: '모든 괴물을 꿰뚫는 한 발 — 200 피해, 약점을 겨누면 치명타. 던전에서는 260 피해에 방패도 뚫는다.', cd: s(12) },
  ninelives: { id: 'ninelives', name: '아홉 목숨', desc: '8초간 연사 3배 · 탄이 2마리를 더 꿰뚫고 퍼짐이 거의 없다. 던전에서는 그동안 모든 탄이 치명타 · 받는 피해 -30%.', cd: s(70), ult: true },
  // ---- D7 나머지 여섯 (2026-09-18) ----
  // 주펄란 — 빛: 붙어서 눈부시게
  flash: { id: 'flash', name: '섬광', desc: '주변 3.5칸에 25 피해 · 1.5초 기절.', cd: s(11) },
  // 2026-09-19 주펄란 = 힐러: 반사광 → 후광(동료 치유 · 피해 감소), 초신성에 치유를 더한다
  mirror: { id: 'mirror', name: '후광', desc: '3초간 받는 피해 -60% · 나를 때린 괴물은 그 피해의 1.5배를 돌려받는다. 던전에서는 7칸 안 동료(나 포함)가 체력 15% 를 회복하고 5초간 받는 피해 -30%.', cd: s(14) },
  supernova: { id: 'supernova', name: '초신성', desc: '주변 6칸에 200 피해 · 밀쳐 내고 2.5초 기절. 던전에서는 7칸 · 380 피해 · 3초 기절, 9칸 안 동료(나 포함)가 체력 40% 를 회복한다.', cd: s(75), ult: true },
  // 우원란 — 배우: 구르고 무대를 지배한다
  // 2026-09-19 스턴트는 조준 방향(= 괴물 쪽)으로 굴러 떼 한가운데로 뛰어들었다 → 뒤로 구르며 앞으로 쏜다. 커튼콜에 1초 기절
  stunt: { id: 'stunt', name: '스턴트', desc: '뒤로 구르며(무적) 조준 방향 부채꼴로 6발을 쏜다. 던전에서는 8발 · 한 발 28 피해 · 하나를 더 꿰뚫는다.', cd: s(9) },
  curtain: { id: 'curtain', name: '커튼콜', desc: '7칸 안의 괴물이 1초 기절하고, 4초간 절반 속도 · 드러남 · 받는 피해 +20%. 던전에서는 40 피해도 준다.', cd: s(14) },
  redcarpet: { id: 'redcarpet', name: '레드카펫', desc: '8초간 구르기가 줄지 않고, 구를 때마다 주변 2.5칸에 70 피해 · 0.5초 기절. 던전에서는 구를 때마다 160 피해 · 1초 기절.', cd: s(70), ult: true },
  // 기열란 — 뇌절: 쌓아서 터뜨린다
  overdrive: { id: 'overdrive', name: '폭주', desc: '뇌절을 바로 가득 채우고 5초간 연사 +30%.', cd: s(14) },
  // 2026-09-19 기열란 = 딜러 (탱커였을 때 붙였던 도발 · 피해 감소는 뺐다): 던전 고함이 뇌절을 쌓는다
  shout: { id: 'shout', name: '고함', desc: '앞 5칸 부채꼴에 50 피해 · 멀리 밀치고 2초 느리게. 던전에서는 앞 6칸 · 120 피해이고, 맞힌 괴물 하나마다 뇌절이 한 칸 찬다.', cd: s(10) },
  kingrage: { id: 'kingrage', name: '킹의 분노', desc: '8초간 모든 탄이 2마리를 꿰뚫고 피해 +30% · 뇌절이 두 배로 쌓인다. 던전에서는 10초 · 연사 1.5배.', cd: s(70), ult: true },
  // 풍월란 — 근성 탱커 (2026-09-20 사용자 "풍월량은 바람과 상관없다"): 끌어모으고, 버티고, 안 끈다
  advice: { id: 'advice', name: '훈수', desc: '채팅창의 훈수가 쏟아진다 — 8칸 안 괴물이 5초간 나만 노리고 받는 피해 +25%. 던전에서는 10칸 · 6초.', cd: s(12) },
  cluck: { id: 'cluck', name: '꼬꼬꼬', desc: '주변 3.5칸에 70 피해 · 밀치고 1.5초 느리게. 맞힌 하나마다 체력 6% 를 회복한다(다섯까지). 던전에서는 4칸 · 120 피해 · 하나마다 8%.', cd: s(11) },
  kenwang: { id: 'kenwang', name: '켠왕', desc: '깰 때까지 안 끈다 — 10초간 받는 피해 -60%, 8칸 안 괴물이 계속 나만 노리고, 6칸 안 동료는 받는 피해 -30%. 던전에서는 12초, 그동안 쓰러질 만큼 맞아도 한 번은 체력 1 로 버틴다.', cd: s(70), ult: true },
  // 통천란 — 치킨: 버티며 한 방
  // 2026-09-19 통천란 = 힐러: 혼자 먹던 치킨을 나눈다
  snack: { id: 'snack', name: '치킨 나눔', desc: '나와 7칸 안 동료가 체력 25% 를 회복하고, 나는 4초간 연사 +30%. 던전에서는 모두 4초간 받는 피해 -30% · 나는 이동 +40%.', cd: s(15) },
  trap: { id: 'trap', name: '덫', desc: '커서 지점(7칸까지)에 덫(20초). 처음 밟은 괴물 둘레 2칸(던전 3칸)에 120 피해 · 3초 기절.', cd: s(12), reach: 7 * 32 },
  angelshot: { id: 'angelshot', name: '천사의 한 발', desc: '모든 것을 꿰뚫는 거대한 한 발 — 400 피해, 약점을 겨누면 치명타. 던전에서는 조준 방향 18칸을 빛의 기둥이 훑는다 — 줄 위의 모든 괴물에 900 피해 · 2초 기절(벽 · 방패도 뚫음), 12칸 안 동료(나 포함)는 체력 40% 를 회복하고 6초간 받는 피해 -30%.', cd: s(70), ult: true },
  // 우재란 — 런웨이: 길게 가로지른다
  catwalk: { id: 'catwalk', name: '런웨이 워크', desc: '조준 방향으로 7칸 긴 돌진(무적). 지나는 괴물에 60 피해 · 밀침. 던전에서는 출발할 때 둘레 3칸을 밀쳐 내고 1.5초 느리게.', cd: s(8) },
  flashbulb: { id: 'flashbulb', name: '플래시 세례', desc: '커서 지점(9칸까지) 3칸(던전 4칸)에 20 피해(던전 40) · 2초 기절 · 6초간 드러남과 받는 피해 +30%.', cd: s(12), reach: 9 * 32 },
  encore: { id: 'encore', name: '앙코르', desc: '다른 스킬의 재사용 대기를 모두 끝내고 집중을 가득 · 6초간 공격 속도 +50%. 던전에서는 8칸 안 동료도 6초간 공격 속도 +50%, 나는 공격 속도 2배 · 받는 피해 -30%.', cd: s(80), ult: true },
  // 우재란 트리 스킬 "칼바람" 의 바탕 (2026-09-20 풍월란이 바람을 버리면서 옛 '돌풍' 을 이리로 옮겼다 — 트리에서만 쓴다)
  bladewind: { id: 'bladewind', name: '칼바람', desc: '주변 4칸의 괴물을 멀리 날리고 30 피해 · 1초 기절.', cd: s(9) },
}

/** 트리 스킬: 이름 · 설명만 따로, 재사용 · 거리 · 궁극기 여부는 바탕을 따른다 */
const TREE_SKILLS: { id: TreeSkillId; base: BaseSkillId; name: string; desc: string }[] = [
  { id: 'cm_bulldoze', base: 'pancharge', name: '철갑 돌진', desc: '조준 방향으로 5칸 몸통 박치기. 지나는 괴물에 60 피해 · 밀침, 돌진 중 무적.' },
  { id: 'cm_mortar', base: 'grenade', name: '박격 탄', desc: '커서 지점(9칸까지)에 박격 탄. 0.7초 뒤 3칸에 80 피해 · 1초 기절.' },
  { id: 'cm_steel', base: 'firstaid', name: '강철 의지', desc: '나와 6칸 안의 동료가 최대 체력 25% 를 회복한다. 던전에서는 4초간 받는 피해 -30%.' },
  { id: 'chim_volley', base: 'fanfire', name: '속사 부채', desc: '조준 방향 30° 부채꼴로 8발을 한꺼번에. 던전에서는 한 발 28 피해로 하나를 더 꿰뚫고, 앞쪽 3칸 괴물을 밀쳐 내 1.5초 느리게.' },
  { id: 'chim_mark', base: 'broadcast', name: '표적 지정', desc: '18칸 안의 괴물을 8초간 드러내고(벽 너머도) 받는 피해 +25%. 던전에서는 그동안 나와 8칸 안 동료가 받는 피해 -30%.' },
  { id: 'chim_fallback', base: 'catstep', name: '전술 후퇴', desc: '뒤로 4칸 도약(무적). 다음 한 발 피해 2배. 던전에서는 떠난 자리 3칸의 괴물에 40 피해 · 2초 기절, 착지 뒤 2초간 받는 피해 -30% · 재사용 7초.' },
  { id: 'dg_cut', base: 'catstep', name: '편집점', desc: '뒤로 4칸 도약(무적) — 장면 전환. 다음 한 발 피해 2배. 던전에서는 떠난 자리 3칸의 괴물에 40 피해 · 2초 기절, 착지 뒤 2초간 받는 피해 -30% · 재사용 7초.' },
  { id: 'dg_spill', base: 'oil', name: '커피 쏟기', desc: '주변 3칸에 뜨거운 커피 — 50 피해 · 2.5초간 절반 속도.' },
  { id: 'dg_replay', base: 'pierce', name: '슬로 리플레이', desc: '다음 6발이 괴물 3마리를 꿰뚫고 피해 +30%.' },
  { id: 'mg_cast', base: 'ironwall', name: '깁스', desc: '4초간 받는 피해 -50%, 7칸 안의 괴물이 나만 노린다.' },
  { id: 'mg_xray', base: 'broadcast', name: '엑스레이', desc: '18칸 안의 괴물을 8초간 드러내고(벽 너머도) 받는 피해 +25%. 던전에서는 그동안 나와 8칸 안 동료가 받는 피해 -30%.' },
  { id: 'mg_flask', base: 'grenade', name: '약병 투척', desc: '커서 지점(9칸까지)에 약병을 던진다. 0.7초 뒤 3칸에 80 피해 · 1초 기절.' },
  { id: 'sw_lid', base: 'ironwall', name: '냄비 뚜껑 방패', desc: '4초간 받는 피해 -50%, 7칸 안의 괴물이 나만 노린다.' },
  { id: 'sw_torch', base: 'flame', name: '토치 불맛', desc: '앞 4칸 부채꼴에 60 피해 · 밀쳐 낸다. 던전에서는 둘레 4칸 모두를 친다.' },
  { id: 'sw_chop', base: 'barrage', name: '다지기 연타', desc: '4초간 휘두르기 2배로 빠르게. 맞은 괴물은 느려진다.' },
  { id: 'ok_claw', base: 'pierce', name: '발톱 탄', desc: '다음 6발이 괴물 3마리를 꿰뚫고 피해 +30%.' },
  { id: 'ok_hairball', base: 'oil', name: '털뭉치 폭탄', desc: '주변 3칸에 털뭉치가 터진다 — 50 피해 · 2.5초간 절반 속도.' },
  { id: 'ok_knead', base: 'fanfire', name: '꾹꾹이 난사', desc: '조준 방향 30° 부채꼴로 8발을 한꺼번에. 던전에서는 한 발 28 피해로 하나를 더 꿰뚫고, 앞쪽 3칸 괴물을 밀쳐 내 1.5초 느리게.' },
  { id: 'jp_prism', base: 'fanfire', name: '프리즘 산개', desc: '조준 방향 30° 부채꼴로 빛줄기 8발. 던전에서는 한 발 28 피해로 하나를 더 꿰뚫고, 앞쪽 3칸 괴물을 밀쳐 내 1.5초 느리게.' },
  { id: 'jp_overheat', base: 'barrage', name: '과열 연사', desc: '4초간 연사 2배. 맞은 괴물은 느려진다.' },
  { id: 'jp_glare', base: 'oil', name: '눈부심 장막', desc: '주변 3칸에 눈부신 빛 — 50 피해 · 2.5초간 절반 속도.' },
  { id: 'uw_lead', base: 'broadcast', name: '주연 조명', desc: '18칸 안의 괴물을 8초간 드러내고(벽 너머도) 받는 피해 +25%. 던전에서는 그동안 나와 8칸 안 동료가 받는 피해 -30%.' },
  { id: 'uw_exit', base: 'catstep', name: '퇴장 인사', desc: '뒤로 4칸 도약(무적). 다음 한 발 피해 2배. 던전에서는 떠난 자리 3칸의 괴물에 40 피해 · 2초 기절, 착지 뒤 2초간 받는 피해 -30% · 재사용 7초.' },
  { id: 'uw_ng', base: 'fanfire', name: 'NG 난사', desc: '조준 방향 30° 부채꼴로 8발을 한꺼번에. 던전에서는 한 발 28 피해로 하나를 더 꿰뚫고, 앞쪽 3칸 괴물을 밀쳐 내 1.5초 느리게.' },
  { id: 'gy_rant', base: 'pierce', name: '뇌절 관통탄', desc: '다음 6발이 괴물 3마리를 꿰뚫고 피해 +30%.' },
  { id: 'gy_tantrum', base: 'grenade', name: '분노 투척', desc: '커서 지점(9칸까지)에 던진다. 0.7초 뒤 3칸에 80 피해 · 1초 기절.' },
  { id: 'gy_glare', base: 'flashbulb', name: '째려보기', desc: '커서 지점(9칸까지) 3칸(던전 4칸)에 20 피해(던전 40) · 2초 기절 · 6초간 드러남과 받는 피해 +30%.' },
  { id: 'pw_heat', base: 'flame', name: '매운맛', desc: '앞 4칸 부채꼴에 60 피해 · 밀쳐 낸다. 던전에서는 둘레 4칸 모두를 친다.' },
  { id: 'pw_breeze', base: 'firstaid', name: '과자 포션', desc: '과자를 한 봉 뜯는다 — 나와 6칸 안의 동료가 최대 체력 25% 를 회복한다. 던전에서는 4초간 받는 피해 -30%.' },
  { id: 'pw_gale', base: 'pancharge', name: '견자단', desc: '몸으로 밀고 조준 방향으로 5칸 돌진. 지나는 괴물에 60 피해 · 밀침, 돌진 중 무적.' },
  { id: 'td_drumstick', base: 'railshot', name: '닭다리 관통탄', desc: '모든 괴물을 꿰뚫는 한 발 — 200 피해, 약점을 겨누면 치명타. 던전에서는 260 피해에 방패도 뚫는다.' },
  { id: 'td_flap', base: 'catstep', name: '날개 퍼덕', desc: '뒤로 4칸 도약(무적). 다음 한 발 피해 2배. 던전에서는 떠난 자리 3칸의 괴물에 40 피해 · 2초 기절, 착지 뒤 2초간 받는 피해 -30% · 재사용 7초.' },
  { id: 'td_crow', base: 'broadcast', name: '새벽 울음', desc: '18칸 안의 괴물을 8초간 드러내고(벽 너머도) 받는 피해 +25%. 던전에서는 그동안 나와 8칸 안 동료가 받는 피해 -30%.' },
  // 2026-09-19 우재란이 검을 든 뒤로 총 스킬 둘을 검 스킬로
  { id: 'jw_pose', base: 'oil', name: '회전 베기', desc: '검을 크게 돌려 주변 3칸에 50 피해 · 2.5초간 절반 속도.' },
  { id: 'jw_turn', base: 'bladewind', name: '칼바람', desc: '검풍으로 주변 4칸의 괴물을 멀리 날리고 30 피해 · 1초 기절.' },
  { id: 'jw_finale', base: 'curtain', name: '피날레', desc: '7칸 안의 괴물이 1초 기절하고, 4초간 절반 속도 · 드러남 · 받는 피해 +20%. 던전에서는 40 피해도 준다.' },
]

export const SKILLS: Record<SkillId, SkillDef> = {
  ...BASE_SKILLS,
  ...(Object.fromEntries(TREE_SKILLS.map((t) => [t.id, { ...BASE_SKILLS[t.base], id: t.id, base: t.base, name: t.name, desc: t.desc }])) as Record<TreeSkillId, SkillDef>),
}

/**
 * 스킬을 쓰면 머리 위에 외치는 말 (2026-09-24 사용자: "스킬을 쓸 때 스킬명을 외치도록 — 말풍선으로. 특히 범위로 아군에게 이로운
 * 효과를 줄 때는 이쪽으로 오라는 식의 외침도"). 우리 편에게 닿는 범위 스킬(치유 · 피해 감소 · 공격 속도 · 부활)은 스킬명 뒤에
 * 모이라는 말을 붙인다 — 초록 말풍선. 트리 스킬은 바탕 스킬의 말을 쓴다(이름은 자기 것).
 */
export const ALLY_CALL: Partial<Record<BaseSkillId, string>> = {
  roar: '내 곁으로 모여!',
  broadcast: '내 곁으로 붙어!',
  spotlight: '무대 안으로 들어와!',
  firstaid: '치료한다, 이쪽으로 와!',
  surgery: '다 일으킨다, 이쪽으로!',
  mirror: '이쪽으로 와, 고쳐 줄게!',
  supernova: '빛 안으로 모여!',
  kenwang: '내 곁에 붙어!',
  snack: '치킨 나눠 줄게, 이쪽으로!',
  angelshot: '빛 곁으로 모여!',
  encore: '다들 모여, 한 번 더!',
}

/** 외침: 스킬명 + (우리 편 범위면) 모이라는 말. ally = 초록 말풍선 */
export function skillShout(id: SkillId): { text: string; ally: boolean } | null {
  const def = SKILLS[id]
  if (!def) return null
  const call = ALLY_CALL[baseSkill(id)]
  return { text: call ? `${def.name}! ${call}` : `${def.name}${def.ult ? '!!' : '!'}`, ally: !!call }
}

/** 효과를 내는 바탕 스킬 (트리 스킬이면 그 바탕, 아니면 자기) */
export function baseSkill(id: SkillId): BaseSkillId {
  return SKILLS[id]?.base ?? (id as BaseSkillId)
}

/** 캐릭터별 [Q, E, X]. 1차 6명 밖의 캐릭터는 무기가 같은 1차 캐릭터 것을 빌린다(M7 에서 제 것을 준다) */
/**
 * 스킬 트리 (GUIDE 8장 — D4). 캐릭터마다 10칸: 0~4 액티브(자기 Q·E + 그 캐릭터만의 트리 스킬 셋 — TREE_SKILLS) · 5 궁극기 · 6~9 패시브.
 * 랭크 1~5 — 레벨마다 포인트 하나. 액티브·궁극기는 랭크마다 위력 +15% · 재사용 -4%.
 * 3랭크에서 [위력 +25% | 재사용 -20%], 5랭크에서 [위력 +25% | 집중 -35%] 중 하나를 고른다.
 */
export const TREE_ACTIVE: Record<string, SkillId[]> = {
  cheolmyeon: ['ironwall', 'barrage', 'cm_bulldoze', 'cm_mortar', 'cm_steel'],
  chim: ['pierce', 'grenade', 'chim_volley', 'chim_mark', 'chim_fallback'],
  dangun: ['broadcast', 'fanfire', 'dg_cut', 'dg_spill', 'dg_replay'],
  magic: ['firstaid', 'flame', 'mg_cast', 'mg_xray', 'mg_flask'],
  seungwoo: ['pancharge', 'oil', 'sw_lid', 'sw_torch', 'sw_chop'],
  oknyang: ['catstep', 'railshot', 'ok_claw', 'ok_hairball', 'ok_knead'],
  jupeol: ['flash', 'mirror', 'jp_prism', 'jp_overheat', 'jp_glare'],
  uwon: ['stunt', 'curtain', 'uw_lead', 'uw_exit', 'uw_ng'],
  giyeol: ['overdrive', 'shout', 'gy_rant', 'gy_tantrum', 'gy_glare'],
  pungwol: ['advice', 'cluck', 'pw_heat', 'pw_breeze', 'pw_gale'],
  tongdak: ['snack', 'trap', 'td_drumstick', 'td_flap', 'td_crow'],
  juwoojae: ['catwalk', 'flashbulb', 'jw_pose', 'jw_turn', 'jw_finale'],
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
  pungwol: ['advice', 'cluck', 'kenwang'],
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
/** 탄막(철면란 E) 중 — 맞은 괴물이 느려진다 (재장전이 없어진 뒤로 "탄을 안 씀" 은 뜻이 없다) */
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
/** 반사광 (주펄란): 받는 피해 -60% · 때린 괴물에게 1.5배 */
export const FX_REFLECT = 8
/** 레드카펫 (우원란): 구르기가 줄지 않고 구를 때마다 주변을 친다 */
export const FX_CARPET = 9
/** 킹의 분노 (기열란): 탄 관통 2 · 피해 +30% · 뇌절 두 배 */
export const FX_KING = 10
/** 이동 +40% (통천란 치킨 나눔) */
export const FX_SWIFT = 11
/** 켠왕 (풍월란): 받는 피해 -60% · 계속 도발 · 던전에서는 한 번 버틴다 */
export const FX_KENWANG = 12
export const FX_COUNT = 13
