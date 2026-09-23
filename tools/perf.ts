// sim 성능 계측 (2026-09-23 사용자: "서버 없는 게임이니 4명이 해도 렉이 없게"). 락스텝이라 **가장 느린 사람의 한 틱**이 모두를 멈춘다.
// 4인 봇 파티를 지역에 세우고, 후원 떼처럼 괴물을 더 붙인 채로 틱마다 sim.step 시간을 잰다 (봇 입력 계산은 따로).
// 60틱/초 — 한 틱이 16.7ms 를 넘으면 그 사람 화면이 밀리고, 락스텝은 모두가 기다린다. 목표: 괴물 200 마리에서 한 틱 평균 2ms 아래.
//
//   npx vite-node tools/perf.ts                     (1막 들판 · 괴물 +150)
//   npx vite-node tools/perf.ts -- area=30 extra=250 ticks=3000
import { botInput, makeBot } from '../src/core/bot'
import { CharacterId } from '../src/core/characters'
import { makeMonster } from '../src/core/dungeon'
import { Input } from '../src/core/input'
import { MONSTER_LIST } from '../src/core/monsters'
import { createState, step } from '../src/core/sim'
import { AREAS, buildAreaMap } from '../src/core/world'

const arg = (k: string, d: number) => Number(process.argv.find((a) => a.startsWith(k + '='))?.split('=')[1] ?? d)
const AREA = arg('area', 1)
const EXTRA = arg('extra', 150)
const TICKS = arg('ticks', 2400)
const SEED = arg('seed', 7)
const CHARS: CharacterId[] = ['chim', 'cheolmyeon', 'magic', 'oknyang']

const a = AREAS[AREA]
const map = buildAreaMap(SEED, a.id)
const s = createState({ seed: SEED, chars: CHARS, area: a.id }, map)
const bots = CHARS.map((_, i) => makeBot(SEED * 31 + i))
// 이 막에 나오는 괴물 종류로 떼를 붙인다 (플레이어 둘레 4~12칸)
const kinds = [...new Set(s.monsters.map((m) => m.kind))].filter((k) => !MONSTER_LIST[k].boss)
const p0 = s.players[0]
let placed = 0
for (let i = 0; placed < EXTRA && i < EXTRA * 20; i++) {
  const ang = i * 2.399
  const d = (4 + (i % 9)) * 32
  const x = p0.x + Math.cos(ang) * d
  const y = p0.y + Math.sin(ang) * d
  const tx = Math.floor(x / 32)
  const ty = Math.floor(y / 32)
  if (tx < 1 || ty < 1 || tx >= map.w - 1 || ty >= map.h - 1 || map.tiles[ty * map.w + tx] !== 0) continue
  const k = kinds.length ? kinds[placed % kinds.length] : 0
  const m = makeMonster(s, k, x, y, 1, 60, 60, Math.max(1, a.level))
  s.monsters.push(m)
  placed++
}

const times: number[] = []
const botT: number[] = []
for (let t = 0; t < TICKS; t++) {
  // 죽지 않게 (계측이 끝까지 가게)
  for (const p of s.players) {
    p.hp = p.maxHp
    p.alive = true
    p.downed = false
  }
  const b0 = performance.now()
  const inputs: Input[] = CHARS.map((_, i) => botInput(s, map, i, bots[i], 'normal'))
  const b1 = performance.now()
  step(s, map, inputs)
  const b2 = performance.now()
  botT.push(b1 - b0)
  times.push(b2 - b1)
}
const alive = s.monsters.filter((m) => m.hp > 0).length
const sorted = [...times].sort((x, y) => x - y)
const avg = times.reduce((x, y) => x + y, 0) / times.length
const pct = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
console.log(`${a.name}(${a.id}) · 괴물 시작 ${s.monsters.length} (붙인 것 ${placed}) · 끝에 산 것 ${alive} · 틱 ${TICKS}`)
console.log(`sim.step  평균 ${avg.toFixed(3)}ms · 중앙 ${pct(0.5).toFixed(3)} · 99% ${pct(0.99).toFixed(3)} · 최대 ${sorted[sorted.length - 1].toFixed(2)}`)
console.log(`봇 입력 4명 평균 ${(botT.reduce((x, y) => x + y, 0) / botT.length).toFixed(3)}ms`)
