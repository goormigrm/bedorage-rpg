// 경험치 곡선 계산기: 캠페인을 처음부터 끝까지 한 번 도는 동안 레벨이 어떻게 오르는지 본다.
// 원정마다 실제로 층을 만들어(같은 코드 · 여러 시드) 몬스터 경험치를 더하고, 잡는 비율(기본 85%)만큼 얻는다고 친다.
// 아직 콘텐츠가 없는 막은 계획한 지역 레벨(PLANNED)로 1막 구성을 빌려 계산한다.
//
//   npx vite-node tools/xpcurve.ts            (혼자)
//   npx vite-node tools/xpcurve.ts -- 0.7     (잡는 비율 70%)
import { STAGES, stageDef } from '../src/core/campaign'
import { floorSeed } from '../src/core/dungeon'
import { LEVEL_CAP, emptySheet, xpNeed } from '../src/core/items'
import { buildMap } from '../src/core/map'
import { EA_UNIQUE, MONSTER_LIST, xpFor } from '../src/core/monsters'
import { ACTS } from '../src/core/campaign'
import { createState, enterFloor } from '../src/core/sim'

/** 캠페인 계획의 지역 레벨 (12원정). 표에 있는 원정은 표의 값을 쓴다 */
const PLANNED = [1, 3, 5, 8, 10, 12, 15, 17, 19, 22, 24, 26]
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

console.log(`잡는 비율 ${Math.round(KILL * 100)}% · 시드 ${SEEDS.length}개 평균`)
console.log('원정          지역Lv  들어갈 때Lv  나올 때Lv  얻은 경험치  몬스터/층')
for (let si = 0; si < PLANNED.length; si++) {
  const real = si < STAGES.length
  const sd = real ? stageDef(si) : { ...stageDef(si % 3), level: PLANNED[si], act: Math.floor(si / 3) }
  const start = level
  const before = total
  let monsters = 0
  for (const seed of SEEDS) {
    let got = 0
    for (let f = 1; f <= sd.floors; f++) {
      const mapId = ACTS[real ? sd.act : 0].map
      const map = buildMap(mapId, 1, floorSeed(seed, f))
      // 원정 번호를 빌려 구성을 만들고, 지역 레벨만 계획 값으로 바꿔 계산한다
      const s = createState({ seed, chars: ['chim'], stage: real ? si : si % 3, sheets: [{ ...emptySheet(), level }] }, map)
      if (f > 1) enterFloor(s, map, f, seed)
      const lvlShift = real ? 0 : PLANNED[si] - stageDef(si % 3).level
      monsters += s.monsters.length
      for (const m of s.monsters) {
        const must = (m.elite & EA_UNIQUE) !== 0 || !!MONSTER_LIST[m.kind].boss
        got += xpFor({ ...m, lvl: m.lvl + lvlShift }) * (must ? 1 : KILL)
      }
    }
    gain(got / SEEDS.length)
  }
  const name = real ? `${sd.act + 1}-${sd.n + 1} ${sd.name}` : `${sd.act + 1}-${(si % 3) + 1} (계획)`
  console.log(
    `${name.padEnd(12)}  ${String(sd.level).padStart(4)}  ${String(start).padStart(9)}  ${String(level).padStart(9)}  ${String(Math.round(total - before)).padStart(11)}  ${String(Math.round(monsters / SEEDS.length / sd.floors)).padStart(8)}`,
  )
}
let need = 0
for (let l = 1; l < LEVEL_CAP; l++) need += xpNeed(l)
console.log(`합계 ${Math.round(total)} · 만렙(${LEVEL_CAP})까지 ${need}`)
