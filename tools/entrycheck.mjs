// 첫 진입 시각표 (2026-10-23 사용자: "첫 진입 끊김으로 몬스터에게 맞아 죽을 뻔 — 덮개가 있는 동안은 이동이 안 되게").
// 개발 서버 5173:  node tools/entrycheck.mjs [bright|dark] [지역 번호 — 기본 1]
// 방을 만들고 마을에서 2.5초 만에 그 지역으로 옮긴 뒤(D 를 누른 채) 15초 동안 프레임마다: 간격 · 덮개(C 컴파일 · H 준비) · 내 체력 · 무적 ·
// 곁의 깬 괴물 · 셰이더 수 · 빛 수. 덮개가 걷힌 뒤 새로 만든 셰이더는 이미 있던 가장 비슷한 것과 열쇠(cacheKey) 차이로 적는다
// (#34 · #36 = 점광원 수 · #2 · #4 = 색공간 · #45 · #47 = 톤 매핑). 0 이어야 할 것: 덮개 동안 움직인 거리 · 덮개 안에서 맞음 · 걷힐 때 곁의 깬 괴물
import { chromium } from 'playwright'

const skin = process.argv[2] === 'dark' ? 'dark' : 'bright'
const AREA = Number(process.argv[3] ?? 1)
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
page.on('pageerror', (e) => console.log('페이지 오류:', String(e).slice(0, 200)))
await page.addInitScript(() => {
  localStorage.setItem('brpg.muted', '1')
  localStorage.setItem('brpg.gfx', 'high')
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await page.goto('http://localhost:5173/bedorage-rpg/?shot=1')
await page.waitForFunction(() => !!document.querySelector('#btn-host'), null, { timeout: 60000 })
await sleep(2000)
await page.evaluate(async (skin) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const btn = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t)
  window.__lobby?.selectChar?.('cheolmyeon')
  btn('게임 만들기')?.click()
  await sleep(700)
  document.querySelector(`#seg-skin button[data-v="${skin}"]`)?.click()
  await sleep(200)
  btn('만들기')?.click()
  await sleep(1600)
  const cb = document.querySelector('input[type=checkbox]')
  if (cb && !cb.checked) cb.click()
  await sleep(900)
  btn('▶ 게임 시작')?.click()
}, skin)
await page.waitForFunction(() => window.__bd?.phase?.() === 'playing' && window.__session?.renderer?.ready, null, { timeout: 120000 })
// 방을 만들고 곧장 나가는 사람처럼: 마을에서 오래 기다리지 않는다 (사용자 상황)
await sleep(2500)
await page.keyboard.down('KeyD')
const out = await page.evaluate(async (AREA) => {
  document.querySelector('.ending.intro .ending-go')?.click()
  const S = window.__session
  const R = S.renderer
  const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/src/core/sim.ts'))
  const sim = await import(url)
  const st = window.__bd.state()
  const me = st.players[0]
  const rows = []
  let last = performance.now()
  let t0 = 0
  let hp0 = me.hp
  let np = R.gl.info.programs.length
  const newProgs = []
  let hits = 0
  let hitsCovered = 0
  await new Promise((res) => {
    const step = (t) => {
      const iv = t - last
      last = t
      if (t0 === 0) {
        t0 = t
        for (let i = 0; i < st.players.length; i++) sim.warpPlayer(st, S.mapOf, i, AREA)
      }
      const p = window.__bd.state().players[0]
      const covered = R.areaCompiling || R.areaHold
      const pr = R.gl.info.programs
      if (pr.length > np && t - t0 > 4000) {
        const olds = pr.slice(0, np).map((q) => q.cacheKey.split(','))
        const diffs = pr.slice(np).map((q) => {
          const k = q.cacheKey.split(',')
          let best = null
          let bd = 1e9
          for (const o of olds) {
            if (o.length !== k.length || o[0] !== k[0]) continue
            let d = 0
            for (let i = 0; i < k.length; i++) if (o[i] !== k[i]) d++
            if (d < bd) {
              bd = d
              best = o
            }
          }
          if (!best) return `새 종류(${k[0].slice(0, 40)} · 칸 ${k.length})`
          // 빛 수가 같은 기존 것(덮개 동안 데운 것)과의 차이
          let b2 = null
          let d2 = 1e9
          for (const o of olds) {
            if (o.length !== k.length || o[0] !== k[0] || o[34] !== k[34] || o[36] !== k[36]) continue
            let d = 0
            for (let i = 0; i < k.length; i++) if (o[i] !== k[i]) d++
            if (d < d2) {
              d2 = d
              b2 = o
            }
          }
          const same = []
          if (b2) for (let i = 0; i < k.length; i++) if (b2[i] !== k[i]) same.push(`#${i}:${b2[i].slice(0, 14)}→${k[i].slice(0, 14)}`)
          const idx = []
          for (let i = 0; i < k.length; i++) if (best[i] !== k[i]) idx.push(`#${i}:${best[i].slice(0, 12)}→${k[i].slice(0, 12)}`)
          return `${k[0].slice(0, 24)} ${idx.join(' ')}${b2 ? ` [같은 빛 수 기존과: ${same.join(' ')}]` : ' [같은 빛 수 기존 없음]'}`
        })
        newProgs.push(`${Math.round(t - t0)}ms ` + diffs.join(' | '))
      }
      np = pr.length
      if (p.hp < hp0) {
        hits++
        if (covered) hitsCovered++
      }
      hp0 = p.hp
      rows.push({ x: Math.round(p.x), y: Math.round(p.y), t: Math.round(t - t0), iv: Math.round(iv), cov: covered ? (R.areaCompiling ? 'C' : 'H') : '-', hp: Math.round(p.hp), max: p.maxHp, inv: p.invuln, near: window.__bd.view().monsters.filter((m) => m.hp > 0 && m.st !== 0 && Math.hypot(m.x - p.x, m.y - p.y) < 6 * 32).length, cv: `프로그램 ${R.gl.info.programs.length} · 빛 ${(() => { let n = 0; R.scene.traverse((o) => { if (o.isLight && o.visible && !o.isAmbientLight && !o.isHemisphereLight) n++ }); return n })()} · 텍스처 ${R.gl.info.memory.textures}` })
      if (t - t0 < 15000) requestAnimationFrame(step)
      else res()
    }
    requestAnimationFrame(step)
  })
  return { rows, hits, hitsCovered, newProgs, tick: window.__bd.state().tick }
}, AREA)
await page.keyboard.up('KeyD')
const lift = out.rows.find((r, i) => i > 0 && r.cov === '-' && out.rows[i - 1].cov !== '-')
const protEnd = out.rows.find((r, i) => i > 0 && r.inv === 0 && out.rows[i - 1].inv > 0)
console.log(`분위기 ${skin} · 지역 ${AREA} · 덮개 걷힘 ${lift?.t ?? '?'}ms · 보호 끝 ${protEnd?.t ?? '?'}ms · 맞은 프레임 ${out.hits} (덮개 안 ${out.hitsCovered})`)
for (const r of out.rows) if (r.iv > 50 || r === lift || r === protEnd) console.log(`  ${String(r.t).padStart(5)}ms 간격 ${String(r.iv).padStart(4)} 덮개 ${r.cov} 체력 ${r.hp}/${r.max} 무적 ${r.inv} 곁의 깬 괴물 ${r.near} | ${r.cv}`)
const firstHit = out.rows.find((r, i) => i > 0 && r.hp < out.rows[i - 1].hp)
if (firstHit) console.log(`  처음 맞음 ${firstHit.t}ms 덮개 ${firstHit.cov}`)
const cov = out.rows.filter((r) => r.cov !== '-' && r.t > 300)
const moved = cov.length ? Math.hypot(cov[cov.length - 1].x - cov[0].x, cov[cov.length - 1].y - cov[0].y) : -1
const after = out.rows.filter((r) => r.cov === '-' && r.t > (lift?.t ?? 0))
const movedAfter = after.length > 30 ? Math.hypot(after[30].x - after[0].x, after[30].y - after[0].y) : -1
console.log(`  D 를 누른 채 — 덮개 동안 움직인 거리 ${Math.round(moved)}px · 걷힌 뒤 0.5초 동안 ${Math.round(movedAfter)}px`)
for (const l of out.newProgs) console.log('  새 셰이더', l.slice(0, 600))
const minHp = Math.min(...out.rows.map((r) => r.hp))
console.log(`  가장 낮은 체력 ${minHp}`)
await browser.close()
