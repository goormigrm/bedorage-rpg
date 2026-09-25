// 막 보스 싸움 계측 (2026-09-23 — 보스 패턴 · % 피해): 보통 봇 파티가 보스 결투장에서 보스와만 싸운다.
// 걸린 시간 · 패턴마다 쓴 횟수 · 보스에게 받은 피해(파티 최대 체력 합의 몇 배) · 쓰러짐 · 죽음.
//
//   npx vite-node tools/bossfight.ts -- party=4 seeds=3                (탱 · 딜 · 딜 · 힐 — 철면 · 침착 · 옥냥 · 매직)
//   npx vite-node tools/bossfight.ts -- party=1 seeds=3 char=chim      (혼자)
//   npx vite-node tools/bossfight.ts -- dodge=0                        (봇이 전혀 안 피한다 — "안 피하면 어려운가")
//   npx vite-node tools/bossfight.ts -- dodge=2                        (사람 수준 — 0.4초 늦게 · 예고 넷에 하나는 놓친다)
//   npx vite-node tools/bossfight.ts -- table=1 seeds=4                (잘 피함 · 사람 수준 · 안 피함을 보스마다 표로)
import { botInput, makeBot } from '../src/core/bot'
import { CHARACTERS, CharacterId } from '../src/core/characters'
import { Input } from '../src/core/input'
import { Item, SLOT_COUNT, Sheet, emptySheet, rollItem } from '../src/core/items'
import { BOSS_PATS, MONSTER_LIST } from '../src/core/monsters'
import { makeRng } from '../src/core/rng'
import { autoAttr, createState, step } from '../src/core/sim'
import { MS_WINDUP } from '../src/core/state'
import { MAX_RANK, ULT_NODE, defaultBuild, freePoints } from '../src/core/skills'
import { AREAS, QUESTS, buildAreaMap, questPoints } from '../src/core/world'

const arg = (k: string, d: number) => Number(process.argv.find((a) => a.startsWith(k + '='))?.split('=')[1] ?? d)
const PARTY = arg('party', 4)
const SEEDS = Array.from({ length: arg('seeds', 3) }, (_, i) => 301 + i * 13)
const CAP_MIN = arg('cap', 10)
/** 0 이면 봇이 땅 범위를 전혀 안 피한다 (예고를 무시하는 사람 흉내) · 2 = 사람 수준(아래 HUMAN) */
const DODGE = arg('dodge', 1)
/**
 * table=1: 잘 피함 · 사람 수준 · 안 피함 셋을 보스마다 표로 (2026-09-25 사용자 고른 개선 12 — "봇 계측은 쉬운데 사람은 어렵다"는 차이가 되풀이됐다).
 * 사람 수준 = 예고를 **0.4초 늦게** 알아채고(반응), **넷에 하나는 놓친다**(예고 번호로 정해 같은 판은 같다)
 */
const TABLE = arg('table', 0)
const HUMAN = { react: 24, miss: 0.25 }
const CHAR_ARG = process.argv.find((a) => a.startsWith('char='))?.split('=')[1]
const CHARS: CharacterId[] = CHAR_ARG ? (CHAR_ARG.split(',') as CharacterId[]) : (['cheolmyeon', 'chim', 'oknyang', 'magic'] as CharacterId[]).slice(0, PARTY)
const ONLY = arg('area', -1)

function gear(char: CharacterId, ilvl: number, seed: number): (Item | null)[] {
  const rng = makeRng(seed * 131 + ilvl * 7)
  const out: (Item | null)[] = []
  for (let slot = 0; slot < SLOT_COUNT; slot++) out.push(rollItem(rng, 900000 + slot, Math.max(1, ilvl), CHARACTERS[char].weapon, 'elite', 0, 1, slot))
  return out
}

/** 스킬 찍기 (tools/campaign.ts 와 같다) */
function build(level: number, bonus: number) {
  const b = defaultBuild()
  const order = [0, 1, ULT_NODE, 2, 3, 6, 7, 8, 9]
  for (const n of [2, 3]) if (b.r[n] === 0) b.r[n] = 1
  let k = 0
  let guard = 0
  while (freePoints(level, b, bonus) > 0 && guard++ < 500) {
    const n = order[k++ % order.length]
    if (b.r[n] < MAX_RANK) b.r[n]++
  }
  return b
}

type Area = (typeof AREAS)[number]
type Result = { secs: number; won: number; n: number; downs: number; deaths: number; taken: number; casts: Record<string, number> }

/** 봇에게 보이는 예고: 1 = 다 · 0 = 없음 · 2 = 사람 수준(늦게 · 가끔 놓침) */
function visibleZones<T extends { id: number; t: number; max?: number }>(zones: T[], dodge: number): T[] {
  if (dodge === 1) return zones
  if (dodge === 0) return []
  return zones.filter((z) => (z.max ?? z.t) - z.t >= HUMAN.react && ((z.id * 2654435761) >>> 0) / 2 ** 32 >= HUMAN.miss)
}

function runArea(a: Area, dodge: number): Result {
  let secs = 0
  let downs = 0
  let deaths = 0
  let taken = 0
  let won = 0
  let maxHpSum = 0
  const casts: Record<string, number> = {}
  for (const seed of SEEDS) {
    const quests = QUESTS.map((q) => (q.act < a.act ? 3 : 0))
    const sheets: Sheet[] = CHARS.map((c, i) => ({
      ...emptySheet(),
      level: a.level,
      xp: 0,
      equip: gear(c, a.level, seed + i),
      build: build(a.level, questPoints(quests)),
      attr: (() => {
        const q = { char: c, level: a.level, attr: [0, 0, 0, 0] }
        autoAttr(q)
        return q.attr
      })(),
      quests,
      potMax: 4 + Math.min(4, a.act),
    }))
    const map = buildAreaMap(seed, a.id)
    const s = createState({ seed, chars: CHARS, area: a.id, sheets }, map)
    const boss = s.monsters.find((m) => MONSTER_LIST[m.kind].boss)!
    // 보스만 (결투장 앞 무리는 뺀다) — 파티는 결투장 입구에서 시작
    for (const m of s.monsters) if (m !== boss) m.hp = 0
    const ar = map.arena!
    s.players.forEach((p, i) => {
      p.x = ar.x - ar.r + 60
      p.y = ar.y + (i - 1.5) * 30
    })
    const bots = CHARS.map((_, i) => makeBot(seed * 31 + i))
    const maxSum = s.players.reduce((t, p) => t + p.maxHp, 0)
    let lastPat = -1
    let t = 0
    for (; t < CAP_MIN * 3600; t++) {
      // 봇이 못 본 예고는 잠깐 치워 두었다가 되돌린다 (판은 그대로 — 봇의 눈만 가린다)
      const all = s.zones
      if (dodge !== 1) s.zones = visibleZones(all, dodge)
      const inputs: Input[] = CHARS.map((_, i) => botInput(s, map, i, bots[i], 'normal'))
      s.zones = all
      step(s, map, inputs)
      for (const e of s.events) {
        if (e.type === 'down') downs++
        else if (e.type === 'death') deaths++
        else if (e.type === 'hurt' && e.by >= 0) {
          const m = s.monsters.find((q) => q.id === e.by)
          if (m && MONSTER_LIST[m.kind].boss) taken += e.dmg
        }
      }
      const pat = boss.st === MS_WINDUP ? (boss.pat ?? -1) : -1
      if (pat >= 0 && pat !== lastPat) casts[BOSS_PATS[pat].id] = (casts[BOSS_PATS[pat].id] ?? 0) + 1
      lastPat = pat
      if (boss.hp <= 0) {
        won++
        break
      }
      if (s.players.every((p) => !p.alive || p.downed)) break
    }
    secs += t / 60
    maxHpSum += maxSum
  }
  return { secs, won, n: SEEDS.length, downs, deaths, taken: taken / maxHpSum, casts }
}

const bosses = AREAS.filter((x) => x.kind === 'boss' && (ONLY < 0 || x.id === ONLY))
if (TABLE) {
  const PROFILES: [string, number][] = [
    ['잘 피함', 1],
    ['사람 수준', 2],
    ['안 피함', 0],
  ]
  console.log(`파티 ${CHARS.length}명(${CHARS.join('·')}) · 보통 봇 · 시드 ${SEEDS.length}개 · 상한 ${CAP_MIN}분 · 사람 수준 = 반응 ${(HUMAN.react / 60).toFixed(1)}초 · 예고 ${Math.round(HUMAN.miss * 100)}% 놓침`)
  console.log(`| 보스 | ${PROFILES.map(([n]) => n).join(' | ')} |`)
  console.log(`|---|${PROFILES.map(() => '---').join('|')}|`)
  for (const a of bosses) {
    const cells = PROFILES.map(([, d]) => {
      const r = runArea(a, d)
      return `잡음 ${r.won}/${r.n} · ${Math.round(r.secs / r.n)}초 · 쓰러짐 ${(r.downs / r.n).toFixed(1)} · 죽음 ${(r.deaths / r.n).toFixed(1)}`
    })
    console.log(`| ${a.act + 1}막 ${a.name} (Lv${a.level}) | ${cells.join(' | ')} |`)
  }
} else {
  console.log(`파티 ${CHARS.length}명(${CHARS.join('·')}) · 보통 봇${DODGE === 0 ? ' (안 피함)' : DODGE === 2 ? ' (사람 수준)' : ''} · 시드 ${SEEDS.length}개 · 상한 ${CAP_MIN}분`)
  for (const a of bosses) {
    const r = runArea(a, DODGE)
    const cs = Object.entries(r.casts)
      .map(([k, v]) => `${k} ${(v / r.n).toFixed(1)}`)
      .join(' · ')
    console.log(
      `${a.act + 1}막 ${a.name.padEnd(8)} Lv${a.level}  ${Math.round(r.secs / r.n)}초  잡음 ${r.won}/${r.n}  쓰러짐 ${(r.downs / r.n).toFixed(1)}  죽음 ${(r.deaths / r.n).toFixed(1)}  보스 피해 = 파티 체력 × ${r.taken.toFixed(2)}`,
    )
    console.log(`   패턴: ${cs}`)
  }
}
