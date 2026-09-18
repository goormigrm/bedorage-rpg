// 캠페인 계측 (D7 — GUIDE 14장 "평균 6시간"): 보통 봇 파티가 세계를 막 · 지역 순서로 돈다.
// 지역마다 실제 맵 · 실제 무리 · 실제 몬스터 레벨. 봇은 가장 가까운 몬스터를 찾아 싸운다(bot.ts 의 스스로 돌기).
// 끝: 우두머리·보스를 잡고 몬스터의 85% 이상을 잡았을 때 · 또는 시간 상한(CAP_MIN).
// 지역 사이: 레벨·경험치를 이어 간다(시드 평균). 장비는 지역마다 "그 지역 레벨의 마법 등급 이상 한 벌"로 갈아입는다
// (주운 것·산 것을 끼는 사람의 근사). 스킬 포인트는 칸의 스킬 · 궁극기 · 패시브에 차례로 찍는다. 앞 막 퀘스트는 끝낸 것으로 친다.
// 사람은 봇보다 느리다(길 찾기 · 줍기 · 가방 · 마을) — 사람 시간 ≈ 봇 시간 × HUMAN + 지역마다 OVERHEAD 초로 어림한다.
//
//   npx vite-node tools/campaign.ts                          (혼자 · 시드 2)
//   npx vite-node tools/campaign.ts -- party=2 seeds=5 act=2  (둘 · 시드 5 · 2막만 — 레벨은 그 막 시작 레벨로 맞춘다)
import { botInput, makeBot } from '../src/core/bot'
import { CHARACTERS, CharacterId } from '../src/core/characters'
import { Input } from '../src/core/input'
import { Item, LEVEL_CAP, SLOT_COUNT, Sheet, emptySheet, rollItem, xpNeed } from '../src/core/items'
import { MONSTER_LIST, isBossLike } from '../src/core/monsters'
import { makeRng } from '../src/core/rng'
import { createState, step } from '../src/core/sim'
import { MAX_RANK, ULT_NODE, defaultBuild, freePoints } from '../src/core/skills'
import { AREAS, QUESTS, buildAreaMap, questPoints } from '../src/core/world'

const arg = (k: string, d: number) => Number(process.argv.find((a) => a.startsWith(k + '='))?.split('=')[1] ?? d)
const PARTY = arg('party', 1)
const SEEDS = Array.from({ length: arg('seeds', 2) }, (_, i) => 101 + i * 17)
const ONLY_ACT = arg('act', -1)
const CAP_MIN = arg('cap', 20)
/** 장비 한 벌의 등급 (0 = 맨몸 · 1 = 마법 이상) */
const GEAR = arg('gear', 1)
// 사람 어림 (가정 — 오픈 베타 기록으로 고친다): 처음 하는 사람은 봇의 두 배쯤 걸린다(어디로 갈지 · 조준 · 피하기 · 줍기 판단),
// 지역마다 2분은 마을 오가기(팔기 · 보관 · 도박 · 스킬 찍기) · 퀘스트 글 · 죽어서 돌아가기
const HUMAN = 2.0
const OVERHEAD = 120
const CLEAR = 0.85
// char=jupeol,pungwol — 파티 캐릭터를 직접 고른다 (없으면 침착·철면·매직·옥냥 순)
const CHAR_ARG = process.argv.find((a) => a.startsWith('char='))?.split('=')[1]
const CHARS: CharacterId[] = CHAR_ARG ? (CHAR_ARG.split(',') as CharacterId[]) : (['chim', 'cheolmyeon', 'magic', 'oknyang'] as CharacterId[]).slice(0, PARTY)
/** 막을 따로 잴 때 시작 레벨 (막 보스 앞 ≈ 지역 레벨이 목표 — GUIDE 7장) */
const ACT_START = [1, 8, 16, 24]

const totalXp = (level: number, xp: number) => {
  let t = xp
  for (let l = 1; l < level; l++) t += xpNeed(l)
  return t
}
const fromXp = (t: number): { level: number; xp: number } => {
  let level = 1
  while (level < LEVEL_CAP && t >= xpNeed(level)) {
    t -= xpNeed(level)
    level++
  }
  return { level, xp: Math.floor(t) }
}

/** 그 지역 레벨의 한 벌 (마법 이상) */
function gear(char: CharacterId, ilvl: number, seed: number): (Item | null)[] {
  const rng = makeRng(seed * 131 + ilvl * 7)
  const out: (Item | null)[] = []
  for (let slot = 0; slot < SLOT_COUNT; slot++) out.push(rollItem(rng, 900000 + slot, Math.max(1, ilvl), CHARACTERS[char].weapon, 0.1, 1, slot))
  return out
}

/** 스킬 포인트: 칸 스킬 · 궁극기 · 패시브를 차례로 한 점씩 */
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

const path = AREAS.filter((a) => a.kind !== 'town' && (ONLY_ACT < 0 || a.act === ONLY_ACT)).sort((x, y) => x.act - y.act || x.id - y.id)
let carry = ONLY_ACT >= 0 ? totalXp(ACT_START[ONLY_ACT], 0) : 0
const rows: { act: number; name: string; lv: number; lvIn: number; lvOut: number; sec: number; deaths: number; kill: number; capped: number }[] = []

console.log(`파티 ${CHARS.length}명(${CHARS.join('·')}) · 보통 봇 · 시드 ${SEEDS.length}개 · 끝 = 보스·우두머리 + ${CLEAR * 100}% · 상한 ${CAP_MIN}분`)
console.log('지역                    지역Lv  Lv(들어감→나옴)   봇 분   죽음  잡은%  상한')
for (const a of path) {
  const lv0 = fromXp(carry)
  const quests = QUESTS.map((q) => (q.act < a.act ? 3 : 0))
  let secs = 0
  let deaths = 0
  let killFrac = 0
  let capped = 0
  let gained = 0
  const hurtBy: Record<string, number> = {}
  for (const seed of SEEDS) {
    const sheets: Sheet[] = CHARS.map((c, i) => ({
      ...emptySheet(),
      level: lv0.level,
      xp: lv0.xp,
      equip: GEAR ? gear(c, a.level, seed + i) : new Array(SLOT_COUNT).fill(null),
      build: build(lv0.level, questPoints(quests)),
      quests,
      potMax: 4 + Math.min(4, a.act),
    }))
    const map = buildAreaMap(seed, a.id)
    const s = createState({ seed, chars: CHARS, area: a.id, sheets }, map)
    const bots = CHARS.map((_, i) => makeBot(seed * 31 + i))
    const start = s.monsters.length
    const cap = CAP_MIN * 60 * 60
    let t = 0
    for (; t < cap; t++) {
      const inputs: Input[] = CHARS.map((_, i) => botInput(s, map, i, bots[i], 'normal'))
      step(s, map, inputs)
      for (const e of s.events) {
        if (e.type === 'death') deaths++
        else if (e.type === 'hurt') {
          const m = e.by >= 0 ? s.monsters.find((q) => q.id === e.by) : null
          const k = m ? MONSTER_LIST[m.kind].id : '땅·폭발'
          hurtBy[k] = (hurtBy[k] ?? 0) + e.dmg
        }
      }
      if (t % 60 === 0) {
        const alive = s.monsters.filter((m) => m.hp > 0)
        if (!alive.some((m) => isBossLike(m)) && alive.length <= start * (1 - CLEAR)) break
      }
    }
    if (t >= cap) {
      capped++
      // 상한에 걸리면 남은 몬스터를 적어 둔다 (봇이 못 찾는 것인지, 못 이기는 것인지)
      const p = s.players[0]
      const left: Record<string, number> = {}
      for (const m of s.monsters) if (m.hp > 0) left[`${MONSTER_LIST[m.kind].id}:${m.st}`] = (left[`${MONSTER_LIST[m.kind].id}:${m.st}`] ?? 0) + 1
      const near = s.monsters.filter((m) => m.hp > 0).map((m) => Math.round(Math.hypot(m.x - p.x, m.y - p.y))).sort((x, y) => x - y).slice(0, 4)
      console.log(`   ⚠ 상한: 남은 ${JSON.stringify(left)} · 가까운 거리 ${near.join(',')} · 사람 (${Math.round(p.x)},${Math.round(p.y)}) hp ${p.hp}`)
    }
    secs += t / 60
    killFrac += 1 - s.monsters.filter((m) => m.hp > 0).length / Math.max(1, start)
    const p = s.players[0]
    gained += totalXp(p.level, p.xp) - totalXp(lv0.level, lv0.xp)
  }
  carry += gained / SEEDS.length
  const n = SEEDS.length
  const row = { act: a.act, name: `${a.act + 1}막 ${a.name}`, lv: a.level, lvIn: lv0.level, lvOut: fromXp(carry).level, sec: secs / n, deaths: deaths / n, kill: killFrac / n, capped }
  rows.push(row)
  if (row.deaths >= 3) {
    const tot = Object.values(hurtBy).reduce((a, b) => a + b, 0) || 1
    console.log('   받은 피해: ' + Object.entries(hurtBy).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k, v]) => `${k} ${Math.round((v / tot) * 100)}%`).join(' · '))
  }
  console.log(
    `${row.name.padEnd(20)}  ${String(row.lv).padStart(4)}  ${String(row.lvIn).padStart(6)} → ${String(row.lvOut).padEnd(6)}  ${(row.sec / 60).toFixed(1).padStart(6)}  ${row.deaths.toFixed(1).padStart(5)}  ${Math.round(row.kill * 100).toString().padStart(4)}%  ${capped ? '⚠' + capped : ''}`,
  )
}

console.log('\n막     봇 시간   사람 어림(×' + HUMAN + ' + 지역마다 ' + OVERHEAD + '초)   죽음')
let all = 0
for (let act = 0; act < 4; act++) {
  const r = rows.filter((x) => x.act === act)
  if (r.length === 0) continue
  const bot = r.reduce((s, x) => s + x.sec, 0)
  const human = bot * HUMAN + r.length * OVERHEAD
  all += human
  console.log(`${act + 1}막  ${(bot / 60).toFixed(0).padStart(5)}분   ${(human / 60).toFixed(0).padStart(5)}분 (${(human / 3600).toFixed(2)}시간)   ${r.reduce((s, x) => s + x.deaths, 0).toFixed(1)}`)
}
console.log(`합계 사람 어림 ${(all / 3600).toFixed(2)}시간`)
