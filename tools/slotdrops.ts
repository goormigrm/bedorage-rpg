// 부위별 드롭 수 (2026-10-23 사용자: "1막에서 투구만 안 나온다 — 완전 랜덤인데 이렇게 된 건가?"): 봇 하나가 1막 지역을 돌며
// 바닥에 떨어진 아이템을 부위마다 센다. 판(sim)이 실제로 뿌린 것 그대로.
//   npx vite-node tools/slotdrops.ts -- seeds=4 min=6
import { botInput, makeBot } from '../src/core/bot'
import { SLOT_NAMES, emptySheet } from '../src/core/items'
import { createState, step } from '../src/core/sim'
import { AREAS, buildAreaMap } from '../src/core/world'

const arg = (k: string, d: number) => Number(process.argv.find((a) => a.startsWith(k + '='))?.split('=')[1] ?? d)
const SEEDS = arg('seeds', 4)
const TICKS = arg('min', 6) * 60 * 60
const count = new Array(SLOT_NAMES.length).fill(0)
/** 희귀 이상 (자동 줍기 처음 값이 줍는 것) */
const good = new Array(SLOT_NAMES.length).fill(0)
for (const a of AREAS.filter((x) => x.act === 0 && x.kind !== 'town' && !x.retired)) {
  for (let k = 0; k < SEEDS; k++) {
    const seed = 101 + k * 17
    const map = buildAreaMap(seed, a.id)
    const s = createState({ seed, chars: ['chim'], area: a.id, sheets: [{ ...emptySheet(), level: a.level + 2 }] }, map)
    const bot = makeBot(seed)
    const seen = new Set<number>()
    for (let t = 0; t < TICKS; t++) {
      step(s, map, [botInput(s, map, 0, bot, 'normal')])
      for (const d of s.drops) {
        if (!d.item || seen.has(d.id)) continue
        seen.add(d.id)
        count[d.item.slot]++
        if (d.item.rarity >= 2) good[d.item.slot]++
      }
    }
  }
}
const total = count.reduce((x, y) => x + y, 0)
console.log(`1막 · 시드 ${SEEDS} · 아이템 ${total}개`)
count.forEach((n, i) => console.log(`  ${SLOT_NAMES[i]} ${n} (${((n / Math.max(1, total)) * 100).toFixed(1)}%) · 희귀 이상 ${good[i]}`))
