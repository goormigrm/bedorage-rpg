// 경험치 곡선 계산기: 세계(world.ts)를 막 순서대로 한 바퀴 도는 동안 레벨이 어떻게 오르는지 본다.
// 지역마다 실제로 맵을 만들고 몬스터를 채워(같은 코드 · 여러 시드) 경험치를 더하고, 잡는 비율(기본 85%)만큼 얻는다고 친다.
// 우두머리·보스는 늘 잡는다. 1~4막 실제 지역 표(v0.16.0)를 막 · 번호 순서로 돈다.
//
//   npx vite-node tools/xpcurve.ts            (혼자)
//   npx vite-node tools/xpcurve.ts -- 0.7     (잡는 비율 70%)
import { LEVEL_CAP, emptySheet, xpNeed } from '../src/core/items'
import { EA_UNIQUE, MONSTER_LIST, xpFor } from '../src/core/monsters'
import { createState } from '../src/core/sim'
import { AREAS, buildAreaMap } from '../src/core/world'

const KILL = Number(process.argv.find((a) => /^0?\.\d+$/.test(a)) ?? 0.85)
const SEEDS = [11, 22, 33]
let level = 1
let xp = 0
let total = 0
const gain = (v: number) => {
  xp += v
  total += v
  while (level < LEVEL_CAP && xp >= xpNeed(level)) {
    xp -= xpNeed(level)
    level++
  }
}

const path = AREAS.filter((a) => a.kind !== 'town').sort((x, y) => x.act - y.act || x.id - y.id)
console.log(`잡는 비율 ${Math.round(KILL * 100)}% · 시드 ${SEEDS.length}개 평균`)
console.log('지역                    지역Lv  들어갈 때Lv  나올 때Lv  얻은 경험치  몬스터')
for (const a of path) {
  const start = level
  const before = total
  let monsters = 0
  let got = 0
  for (const seed of SEEDS) {
    const s = createState({ seed, chars: ['chim'], area: a.id, sheets: [{ ...emptySheet(), level }] }, buildAreaMap(seed, a.id))
    monsters += s.monsters.length
    for (const m of s.monsters) {
      const must = (m.elite & EA_UNIQUE) !== 0 || !!MONSTER_LIST[m.kind].boss
      const lvl = Math.max(a.level, level - 3)
      got += xpFor({ ...m, lvl }) * (must ? 1 : KILL)
    }
  }
  gain(got / SEEDS.length)
  const name = `${a.act + 1}막 ${a.name}`
  console.log(
    `${name.padEnd(20)}  ${String(a.level).padStart(4)}  ${String(start).padStart(9)}  ${String(level).padStart(9)}  ${String(Math.round(total - before)).padStart(11)}  ${String(Math.round(monsters / SEEDS.length)).padStart(6)}`,
  )
}
let need = 0
for (let l = 1; l < LEVEL_CAP; l++) need += xpNeed(l)
console.log(`합계 ${Math.round(total)} · 만렙(${LEVEL_CAP})까지 ${need}`)
