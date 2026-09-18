// 투기장(PvP) 계측: 12명을 1:1 로 모두 짝지어 보통 봇끼리 싸운다 — 캐릭터(= 무기 계열)별 승률.
// 레벨 1 · 맨몸(같은 조건). 목표 킬 5, 상한 4분(넘기면 킬이 많은 쪽, 같으면 무승부).
// 2026-09-19 재장전·저격 한 방을 없앤 뒤 PvP 밸런스를 다시 보려고 만들었다 (덕의 계측 원칙: 보통 봇 · 한 캐릭터 45~55% 가 목표).
//
//   npx vite-node tools/arena.ts              (시드 3)
//   npx vite-node tools/arena.ts -- seeds=6 map=garage
//   npx vite-node tools/arena.ts -- pvp=sniper:0.7,pistol:1.2   (배율을 바꿔 보기)
import { PLAYABLE, CHARACTERS, CharacterId } from '../src/core/characters'
import { buildMap } from '../src/core/map'
import { MapId } from '../src/core/maps'
import { makePvpBot, pvpBotInput } from '../src/core/pvpbot'
import { createState, step } from '../src/core/sim'
import { WEAPONS } from '../src/core/weapons'

const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(k + '='))?.split('=')[1] ?? d
const SEEDS = Array.from({ length: Number(arg('seeds', '3')) }, (_, i) => 7 + i * 13)
const MAP = arg('map', 'yard') as MapId
// 시험용: pvp=sniper:0.7,pistol:1.2 — 무기의 투기장 배율을 이번 계측에서만 바꿔 본다
for (const kv of arg('pvp', '').split(',').filter(Boolean)) {
  const [id, v] = kv.split(':')
  if (WEAPONS[id as keyof typeof WEAPONS]) WEAPONS[id as keyof typeof WEAPONS].pvp = Number(v)
}
const KILLS = 5
const CAP = 60 * 60 * 4

const win: Record<string, number> = {}
const games: Record<string, number> = {}
for (const c of PLAYABLE) {
  win[c] = 0
  games[c] = 0
}
let draws = 0
for (let i = 0; i < PLAYABLE.length; i++) {
  for (let j = i + 1; j < PLAYABLE.length; j++) {
    for (const seed of SEEDS) {
      // 자리를 번갈아 (스폰 자리 편향을 없앤다)
      const pair: CharacterId[] = seed % 2 ? [PLAYABLE[i], PLAYABLE[j]] : [PLAYABLE[j], PLAYABLE[i]]
      const map = buildMap(MAP, 2, seed)
      const s = createState({ seed, chars: pair, mode: 'arena', targetKills: KILLS, area: 0 }, map)
      const bots = pair.map((_, k) => makePvpBot(seed * 7 + k))
      for (let t = 0; t < CAP && s.phase !== 'over'; t++) step(s, map, pair.map((_, k) => pvpBotInput(s, map, k, bots[k], 'normal')))
      const k0 = s.players[0].kills
      const k1 = s.players[1].kills
      games[pair[0]]++
      games[pair[1]]++
      if (k0 === k1) {
        draws++
        win[pair[0]] += 0.5
        win[pair[1]] += 0.5
      } else win[k0 > k1 ? pair[0] : pair[1]]++
    }
  }
}
console.log(`투기장 1:1 · ${MAP} · 보통 봇 · 시드 ${SEEDS.length}개 · ${KILLS}킬 · 무승부 ${draws}`)
for (const c of [...PLAYABLE].sort((a, b) => win[b] / games[b] - win[a] / games[a])) {
  const pct = Math.round((win[c] / games[c]) * 100)
  console.log(`${CHARACTERS[c].name.padEnd(5)}  ${WEAPONS[CHARACTERS[c].weapon].name.padEnd(5)}  ${String(pct).padStart(3)}%  ${'■'.repeat(Math.round(pct / 4))}`)
}
