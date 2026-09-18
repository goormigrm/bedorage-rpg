// 밸런스 계측 도구. 봇끼리 전 조합을 돌려 승률·명중률·거리별 피해를 표로 뽑는다.
//   npx vite-node tools/balance.ts            (1:1 전 조합)
//   npx vite-node tools/balance.ts -- ffa     (4인 개인전 표본)
// 봇 실력은 사람과 다르므로 절대적인 값이 아니라 '어느 쪽이 크게 기우는가'를 보는 용도다.

import { Difficulty, botInput, makeBot } from '../src/core/bot'
import { BOT_BALANCE_LIST, CHARACTERS, CharacterId } from '../src/core/characters'
import { Input } from '../src/core/input'
import { buildMap } from '../src/core/map'
import { MapId } from '../src/core/maps'
import { createState, step } from '../src/core/sim'
import { GameState } from '../src/core/state'
import { PART_HEAD, WEAPONS, WeaponId } from '../src/core/weapons'

const DIFF: Difficulty = 'normal' // 2026-09-05: 사람들 실제 실력이 '보통' 과 비슷하다(사용자) — 어려움 봇으로 재던 표는 CHANGELOG v1.9.7 까지
const TARGET_KILLS = 3
const MAX_TICKS = 60 * 180
// seeds=5 처럼 주면 시드를 늘린다 (2시드 440판은 ±8% 흔들린다 — 최종 수치는 5시드로)
const seedArg = process.argv.find((a) => a.startsWith('seeds='))
const SEED_POOL = [11, 29, 47, 61, 83, 97, 113, 131]
const SEEDS = seedArg ? SEED_POOL.slice(0, Math.max(1, Math.min(SEED_POOL.length, Number(seedArg.slice(6)) || 2))) : process.argv.includes('ffa') ? [11, 29, 47] : [11, 29]
const MAPS: MapId[] = ['studio', 'yard']

interface CharStat {
  matches: number
  wins: number
  kills: number
  deaths: number
  dmgDealt: number
  dmgTaken: number
}

interface WeaponStat {
  shots: number // 방아쇠를 당긴 횟수
  pellets: number // 실제 발사된 탄 수
  hits: number
  heads: number
  dmg: number
  /** 거리 구간별 명중 수: <100, <200, <400, 그 이상 */
  band: [number, number, number, number]
}

const charStat = new Map<CharacterId, CharStat>()
const weaponStat = new Map<WeaponId, WeaponStat>()

function cs(id: CharacterId): CharStat {
  let v = charStat.get(id)
  if (!v) {
    v = { matches: 0, wins: 0, kills: 0, deaths: 0, dmgDealt: 0, dmgTaken: 0 }
    charStat.set(id, v)
  }
  return v
}
function ws(id: WeaponId): WeaponStat {
  let v = weaponStat.get(id)
  if (!v) {
    v = { shots: 0, pellets: 0, hits: 0, heads: 0, dmg: 0, band: [0, 0, 0, 0] }
    weaponStat.set(id, v)
  }
  return v
}

function collect(state: GameState): void {
  for (const e of state.events) {
    if (e.type === 'fire') {
      const w = ws(e.weapon)
      w.shots++
      w.pellets += WEAPONS[e.weapon].pellets
    } else if (e.type === 'hit') {
      const shooter = state.players[e.by]
      const w = ws(shooter.weapon)
      w.hits++
      w.dmg += e.dmg
      if (e.part === PART_HEAD) w.heads++
      const d = Math.hypot(shooter.x - e.x, shooter.y - e.y)
      w.band[d < 100 ? 0 : d < 200 ? 1 : d < 400 ? 2 : 3]++
      cs(shooter.char).dmgDealt += e.dmg
      cs(state.players[e.p].char).dmgTaken += e.dmg
    }
  }
}

/** 한 판. 반환은 이긴 팀(=인덱스) 또는 -1(시간 초과) */
function match(chars: CharacterId[], seed: number, mapId: MapId): { winner: number; ticks: number } {
  const map = buildMap(mapId, chars.length >= 4 ? 4 : 1, seed * 7919)
  const state = createState({ seed, targetKills: TARGET_KILLS, chars }, map)
  const bots = chars.map((_, i) => makeBot(seed ^ (i * 131 + 7)))
  let t = 0
  while (t < MAX_TICKS && state.phase !== 'over') {
    const inputs: Input[] = bots.map((b, i) => botInput(state, map, i, b, DIFF))
    step(state, map, inputs)
    collect(state)
    t++
  }
  for (let i = 0; i < chars.length; i++) {
    const st = cs(chars[i])
    st.matches++
    st.kills += state.players[i].kills
    st.deaths += state.players[i].deaths
    if (state.winner === i) st.wins++
  }
  return { winner: state.winner, ticks: t }
}

function pct(a: number, b: number): string {
  return b === 0 ? '  -  ' : `${((a / b) * 100).toFixed(1)}%`.padStart(6)
}

function run(): void {
  const ffa = process.argv.includes('ffa')
  // 승빠덕(근접)은 봇이 제대로 운용하지 못해 표가 실제와 반대로 나온다 → 표에서 빼고 tools/melee.ts 로 본다
  const ids = BOT_BALANCE_LIST.map((c) => c.id)
  let matches = 0
  let totalTicks = 0
  let timeouts = 0
  const t0 = Date.now()
  if (ffa) {
    for (const seed of SEEDS) {
      for (const mapId of MAPS) {
        // 인원 수만큼 조합을 돌려 모두가 골고루 만난다
        const n = ids.length
        const gap = Math.max(1, Math.floor(n / 4))
        for (let i = 0; i < n; i++) {
          const group = [ids[i], ids[(i + gap) % n], ids[(i + gap * 2) % n], ids[(i + gap * 3) % n]]
          const r = match(group, seed + i, mapId)
          matches++
          totalTicks += r.ticks
          if (r.winner < 0) timeouts++
        }
      }
    }
  } else {
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        for (const seed of SEEDS) {
          for (const mapId of MAPS) {
            const r1 = match([ids[a], ids[b]], seed, mapId)
            const r2 = match([ids[b], ids[a]], seed + 1, mapId)
            matches += 2
            totalTicks += r1.ticks + r2.ticks
            if (r1.winner < 0) timeouts++
            if (r2.winner < 0) timeouts++
          }
        }
      }
    }
  }

  console.log(`\n=== ${ffa ? '4인 개인전' : '1:1 전 조합'} · ${matches}판 · 봇 ${DIFF} · 목표 ${TARGET_KILLS}킬 ===`)
  console.log(`평균 경기 길이 ${(totalTicks / matches / 60).toFixed(1)}초 · 시간 초과 ${timeouts}판 · 실행 ${((Date.now() - t0) / 1000).toFixed(1)}s\n`)

  console.log('캐릭터           무기      체력  승률   K/D   준 피해  받은 피해')
  const rows = [...charStat.entries()].sort((x, y) => y[1].wins / y[1].matches - x[1].wins / x[1].matches)
  for (const [id, st] of rows) {
    const c = CHARACTERS[id]
    console.log(
      `${c.name.padEnd(8)} ${WEAPONS[c.weapon].name.padEnd(8)} ${String(c.maxHp).padStart(4)} ` +
        `${pct(st.wins, st.matches)} ${(st.kills / Math.max(1, st.deaths)).toFixed(2).padStart(5)} ` +
        `${Math.round(st.dmgDealt / st.matches).toString().padStart(7)} ${Math.round(st.dmgTaken / st.matches).toString().padStart(9)}`,
    )
  }

  console.log('\n무기       발사   탄수   명중   명중률  헤드샷  발당피해  근접/중간/원거리/초원거리 명중 비율')
  for (const [id, w] of weaponStat) {
    const tot = w.band[0] + w.band[1] + w.band[2] + w.band[3]
    const bands = w.band.map((b) => pct(b, tot)).join(' ')
    console.log(
      `${WEAPONS[id].name.padEnd(8)} ${String(w.shots).padStart(6)} ${String(w.pellets).padStart(6)} ${String(w.hits).padStart(6)} ` +
        `${pct(w.hits, w.pellets)} ${pct(w.heads, w.hits)} ${(w.dmg / Math.max(1, w.shots)).toFixed(1).padStart(8)}  ${bands}`,
    )
  }
  console.log('')
}

run()
