// 밸런스 회귀 방지. 봇끼리 1:1 전 조합을 한 번 돌려 '한쪽으로 크게 기울지 않는지'만 본다.
// 세밀한 수치는 `npx vite-node tools/balance.ts` 로 본다 (표본이 4배 크다).
//
// 승빠덕(후라이팬)은 여기서 뺀다(`skipBotBalance`). 봇은 "굴러서 붙고 막으며 버티는" 근접 운용을 못 해서
// 표가 실제와 반대로 나온다 — 사람이 쓰면 강한데 표에서는 최하위로 찍히고, 상대 승률까지 부풀린다.
// 후라이팬은 `tools/melee.ts` 로 따로 본다.

import { describe, expect, it } from 'vitest'
import { botInput, makeBot } from '../src/core/bot'
import { BOT_BALANCE_LIST, CHARACTERS, CHARACTER_LIST, CharacterId } from '../src/core/characters'
import { Input } from '../src/core/input'
import { buildMap } from '../src/core/map'
import { createState, step } from '../src/core/sim'
import { WEAPONS, WeaponId } from '../src/core/weapons'

const TARGET_KILLS = 2
const MAX_TICKS = 60 * 150

interface Stat {
  matches: number
  wins: number
}

function play(chars: CharacterId[], seed: number, wins: Map<CharacterId, Stat>, hits: Map<WeaponId, number>): void {
  const map = buildMap('studio', 1, seed * 7919)
  const state = createState({ seed, targetKills: TARGET_KILLS, chars }, map)
  const bots = chars.map((_, i) => makeBot(seed ^ (i * 131 + 7)))
  let t = 0
  while (t < MAX_TICKS && state.phase !== 'over') {
    const inputs: Input[] = bots.map((b, i) => botInput(state, map, i, b, 'normal')) // 2026-09-05: 보통 난이도로 잰다(사람 실력에 가깝다)
    step(state, map, inputs)
    for (const e of state.events) {
      if (e.type === 'hit') {
        const w = state.players[e.by].weapon
        hits.set(w, (hits.get(w) ?? 0) + 1)
      }
    }
    t++
  }
  chars.forEach((c, i) => {
    const s = wins.get(c) ?? { matches: 0, wins: 0 }
    s.matches++
    if (state.winner === i) s.wins++
    wins.set(c, s)
  })
}

describe('밸런스', () => {
  it('1:1 전 조합에서 어느 캐릭터도 압도하거나 무력하지 않다', () => {
    const ids = BOT_BALANCE_LIST.map((c) => c.id)
    const wins = new Map<CharacterId, Stat>()
    const hits = new Map<WeaponId, number>()
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        // 시드 한 쌍(20판)으로는 ±15%p 가 흔들려 80% 경계에 걸리곤 했다 → 세 쌍(60판). 경계도 18~82% 로 조금 여유
        for (const seed of [11, 41, 71]) {
          play([ids[a], ids[b]], seed, wins, hits)
          play([ids[b], ids[a]], seed + 1, wins, hits)
        }
      }
    }
    const rows = [...wins.entries()].map(([id, s]) => ({ id, rate: s.wins / s.matches, matches: s.matches }))
    const summary = rows
      .sort((x, y) => y.rate - x.rate)
      .map((r) => `${CHARACTERS[r.id].name} ${(r.rate * 100).toFixed(0)}%`)
      .join(' · ')
    // eslint-disable-next-line no-console
    console.log(`[balance] ${summary}`)
    for (const r of rows) {
      expect(r.matches).toBe((ids.length - 1) * 6)
      expect(r.rate, `${CHARACTERS[r.id].name} 승률`).toBeGreaterThan(0.18)
      expect(r.rate, `${CHARACTERS[r.id].name} 승률`).toBeLessThan(0.82)
    }
    // 표에 넣은 캐릭터들의 무기는 실제로 쓸모가 있다 (한 무기가 아예 못 맞히는 상태 방지)
    const used = new Set(ids.map((id) => CHARACTERS[id].weapon))
    for (const w of Object.values(WEAPONS)) {
      if (!used.has(w.id)) continue
      expect(hits.get(w.id) ?? 0, `${w.name} 명중 수`).toBeGreaterThan(30)
    }
  }, 30000) // 60판이라 5초 기본 제한을 넘는다

  it('표에서 뺀 캐릭터는 승빠덕뿐이고, 나머지 11명은 다 들어간다', () => {
    const skipped = CHARACTER_LIST.filter((c) => c.skipBotBalance).map((c) => c.id)
    expect(skipped).toEqual(['seungwoo'])
    expect(BOT_BALANCE_LIST.length).toBe(CHARACTER_LIST.length - 1)
  })
})
