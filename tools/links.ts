// 지역 연결 검사 (2026-09-19 사용자: "굶주린 굴에서 다음 맵으로 넘어가는 포탈이 없어 — 맵이 모두 잘 이어지는지 전체 검토").
// 모든 지역 × 시드 여럿으로 맵을 만들어 본다:
//   ① 링크가 양쪽으로 이어졌나 · 마을에서 모든 지역에 닿나
//   ② 출구 · 도착 자리 · 웨이포인트 · 처음 자리가 벽 속이 아닌가
//   ③ 처음 자리에서 모든 출구 · 웨이포인트까지 걸어갈 수 있나 (흐름장)
//   ④ 출구로 들어와 서는 자리가 어느 출구의 F 거리(52px) 안이 아닌가 (들어와서 누른 F 가 출구로 가지 않게)
//   ⑤ 막다른 곳(링크 하나 · 보스 방 · 마을 아님)이 없나 — 2026-09-24 막마다 한 줄
//
//   npx vite-node tools/links.ts            (시드 8개)
//   npx vite-node tools/links.ts -- seeds=30
import { flowField } from '../src/core/flow'
import { TILE, isWallAt } from '../src/core/map'
import { ACTS, AREAS, areaLayout, buildAreaMap, isTown } from '../src/core/world'

const arg = (k: string, d: number) => Number(process.argv.find((a) => a.startsWith(k + '='))?.split('=')[1] ?? d)
const SEEDS = Array.from({ length: arg('seeds', 8) }, (_, i) => 1 + i * 7919)
/** 출구 곁에서 F 가 먹는 거리 (sim EXIT_USE_R) */
const EXIT_R = 52

const problems: string[] = []
const bad = (s: string) => problems.push(s)

// ① 링크 양방향 · 마을에서 닿기
for (const a of AREAS) {
  for (const l of a.links) {
    if (!AREAS[l]) bad(`${a.id} ${a.name}: 없는 지역 ${l} 로 이어짐`)
    else if (!AREAS[l].links.includes(a.id)) bad(`${a.id} ${a.name} → ${l} ${AREAS[l].name}: 되돌아오는 링크가 없다`)
  }
}
const seen = new Set<number>([ACTS[0].town])
const queue = [ACTS[0].town]
while (queue.length) {
  const id = queue.shift()!
  for (const l of AREAS[id].links) if (!seen.has(l)) (seen.add(l), queue.push(l))
  // 막 보스를 잡으면 촌장이 다음 막 마을로 보낸다 — 그 길도 잇는다
  const act = ACTS.findIndex((c) => c.town === id)
  if (act >= 0 && ACTS[act + 1] && !seen.has(ACTS[act + 1].town)) (seen.add(ACTS[act + 1].town), queue.push(ACTS[act + 1].town))
}
for (const a of AREAS) if (!seen.has(a.id)) bad(`${a.id} ${a.name}: 마을에서 닿지 않는다`)

// ②~④ 맵마다
const tileOf = (map: { w: number }, p: { x: number; y: number }) => Math.floor(p.y / TILE) * map.w + Math.floor(p.x / TILE)
let maps = 0
for (const a of AREAS) {
  for (const seed of SEEDS) {
    const map = buildAreaMap(seed, a.id)
    const l = areaLayout(a.id, map)
    maps++
    const tag = `${a.id} ${a.name} (시드 ${seed})`
    if (l.exits.length !== a.links.length) bad(`${tag}: 출구 ${l.exits.length}개 · 링크 ${a.links.length}개`)
    const spots: [string, { x: number; y: number }][] = [['처음 자리', l.spawn]]
    if (l.wp) spots.push(['웨이포인트', l.wp])
    if (l.wpArrive) spots.push(['웨이포인트 도착', l.wpArrive])
    for (const e of l.exits) spots.push([`→${e.to} 출구`, e], [`→${e.to} 도착`, e.arrive])
    for (const [n, p] of spots) if (isWallAt(map, p.x, p.y)) bad(`${tag}: ${n} (${Math.round(p.x)},${Math.round(p.y)}) 가 벽 속`)
    const field = flowField(map, tileOf(map, l.spawn))
    for (const [n, p] of spots) if (field[tileOf(map, p)] < 0) bad(`${tag}: 처음 자리에서 ${n} 까지 걸어갈 수 없다`)
    for (const e of l.exits) {
      for (const f of l.exits) {
        if (Math.hypot(e.arrive.x - f.x, e.arrive.y - f.y) <= EXIT_R) bad(`${tag}: →${e.to} 로 들어와 서는 자리가 →${f.to} 출구 반경 안`)
      }
    }
  }
}

// ⑤ 막다른 곳
const dead = AREAS.filter((a) => a.links.length === 1 && a.kind !== 'boss' && !isTown(a.id))
for (const a of dead) bad(`${a.id} ${a.name}: 막다른 곳 (← ${AREAS[a.links[0]].name})`)
for (const a of AREAS) if (a.links.length > 2) bad(`${a.id} ${a.name}: 갈림길 (${a.links.map((l) => AREAS[l].name).join(' · ')})`)
console.log(`지역 ${AREAS.length}개 · 맵 ${maps}장(시드 ${SEEDS.length}개) 검사`)
console.log(`보스 방: ${AREAS.filter((a) => a.kind === 'boss').map((a) => `${a.id} ${a.name}`).join(' · ')}`)
if (problems.length === 0) console.log('문제 없음')
else {
  console.log(`문제 ${problems.length}개:`)
  for (const p of problems.slice(0, 80)) console.log('  ' + p)
}
