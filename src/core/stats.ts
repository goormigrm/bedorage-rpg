// 통계 · 업적 (2026-09-25 사용자 고른 개선 9 — "잡은 수 · 걸린 시간 · 죽음 · 처음 잡은 보스 — 방송 이야깃거리").
// 캐릭터마다 모은다(Sheet.stats). 판(sim)이 세므로 모두의 화면에서 같다 — 창(J 퀘스트 기록)은 보여 주기만 한다.

// type (interface 가 아니라) — 방 통로(net/room.ts)로 Sheet 를 보낼 때 JSON 값으로 받아들여진다
export type Stats = {
  /** 내가 잡은 괴물 */
  kills: number
  /** 그중 정예 · 우두머리 */
  elites: number
  /** 보물 고블린 */
  goblins: number
  /** 쓰러뜨린 막 보스: 비트 (막 + 4 × 난이도) — 같은 지역에 있었으면 파티 모두 */
  bosses: number
  /** 던전에서 죽은 횟수 */
  deaths: number
  /** 주운 전설 · 신화 */
  legends: number
  mythics: number
  /** 주운 골드 */
  gold: number
}

export const emptyStats = (): Stats => ({ kills: 0, elites: 0, goblins: 0, bosses: 0, deaths: 0, legends: 0, mythics: 0, gold: 0 })

/** 받은 기록을 말이 되게 (세이브를 손댔거나 예전 세이브) */
export function sanitizeStats(o: unknown): Stats {
  const s = emptyStats()
  const r = (o ?? {}) as Partial<Record<keyof Stats, unknown>>
  for (const k of Object.keys(s) as (keyof Stats)[]) s[k] = Math.max(0, Math.floor(Number(r[k]) || 0))
  s.bosses &= 0xfff
  return s
}

/** 막 보스 비트 */
export const bossBit = (act: number, tier: number): number => 1 << (act + 4 * Math.max(0, Math.min(2, tier)))
/** 이 막의 보스를 난이도와 상관없이 쓰러뜨렸나 */
export const bossAnyTier = (s: Stats, act: number): boolean => [0, 1, 2].some((t) => (s.bosses & bossBit(act, t)) !== 0)

export interface Achievement {
  id: string
  name: string
  desc: string
  /** 지금 · 목표 (진행 막대) */
  goal: (s: Stats, level: number) => [number, number]
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'hunt100', name: '첫 사냥꾼', desc: '괴물 100마리', goal: (s) => [s.kills, 100] },
  { id: 'hunt1k', name: '떼 사냥꾼', desc: '괴물 1,000마리', goal: (s) => [s.kills, 1000] },
  { id: 'hunt10k', name: '끝없는 사냥', desc: '괴물 10,000마리', goal: (s) => [s.kills, 10000] },
  { id: 'elite100', name: '정예 사냥꾼', desc: '정예 · 우두머리 100마리', goal: (s) => [s.elites, 100] },
  { id: 'goblin10', name: '고블린 잡이', desc: '보물 고블린 10마리', goal: (s) => [s.goblins, 10] },
  { id: 'boss1', name: '도살장의 끝', desc: '1막 보스 도살자를 쓰러뜨린다', goal: (s) => [bossAnyTier(s, 0) ? 1 : 0, 1] },
  { id: 'boss2', name: '거미줄을 끊고', desc: '2막 보스 거미 여왕을 쓰러뜨린다', goal: (s) => [bossAnyTier(s, 1) ? 1 : 0, 1] },
  { id: 'boss3', name: '열쇠를 빼앗다', desc: '3막 보스 관리인을 쓰러뜨린다', goal: (s) => [bossAnyTier(s, 2) ? 1 : 0, 1] },
  { id: 'boss4', name: '종이 다시 울린다', desc: '최종 보스 심연의 군주를 쓰러뜨린다', goal: (s) => [bossAnyTier(s, 3) ? 1 : 0, 1] },
  { id: 'nightmare', name: '악몽을 넘어', desc: '악몽 난이도의 심연의 군주', goal: (s) => [(s.bosses & bossBit(3, 1)) !== 0 ? 1 : 0, 1] },
  { id: 'hell', name: '지옥을 넘어', desc: '지옥 난이도의 심연의 군주', goal: (s) => [(s.bosses & bossBit(3, 2)) !== 0 ? 1 : 0, 1] },
  { id: 'legend1', name: '첫 전설', desc: '전설 아이템을 줍는다', goal: (s) => [s.legends + s.mythics, 1] },
  { id: 'legend25', name: '전설 수집가', desc: '전설 아이템 25개를 줍는다', goal: (s) => [s.legends + s.mythics, 25] },
  { id: 'mythic1', name: '신화', desc: '신화 아이템을 줍는다', goal: (s) => [s.mythics, 1] },
  { id: 'gold100k', name: '금고지기', desc: '골드 100,000 을 줍는다', goal: (s) => [s.gold, 100000] },
  { id: 'lv30', name: '정점', desc: '레벨 30', goal: (_s, lv) => [lv, 30] },
]

export const achieved = (a: Achievement, s: Stats, level: number): boolean => {
  const [n, g] = a.goal(s, level)
  return n >= g
}

/** 이룬 업적 id 들 */
export function achievedIds(s: Stats, level: number): Set<string> {
  return new Set(ACHIEVEMENTS.filter((a) => achieved(a, s, level)).map((a) => a.id))
}
