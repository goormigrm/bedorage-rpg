// 배포 전 화면 시험 (2026-10-08 퀄리티 7단계 — 품질 지키기). GitHub Actions(deploy.yml)가 빌드 뒤에 돌린다 — 실패하면 배포하지 않는다.
// 이 노트북에서는 돌리지 않는다(사용자: 노트북에서 localhost 금지 — 시험은 GitHub 서버에서).
//
//   npx vite preview --port 4173 --strictPort &   (빌드한 dist 를 띄운다)
//   node tools/uitest.mjs                          (헤드리스 크로미움 · 1366×768)
//
// 보는 것 (2026-10-08 고친 UI 결함이 되돌아오지 않게):
//  - 두 분위기(공포스러움 · 철면수심전용)로 판이 열리고, 그동안 잡히지 않은 오류가 없다
//  - 가방 칸 이름이 비지 않는다 · 가방 창이 스킬 바를 덮지 않는다
//  - 설명 풍선이 화면 안에 있고 마우스를 올린 칸을 덮지 않는다
//  - 가운데 창은 한 번에 하나 (스킬 창을 연 채 상인에게 말 걸면 상인 창만) · 창이 열려 있으면 사격이 막힌다

import { chromium } from 'playwright'

const URL = process.env.UITEST_URL ?? 'http://localhost:4173/bedorage-rpg/?shot=1'
const fails = []
const check = (cond, msg) => {
  if (!cond) fails.push(msg)
  console.log(`${cond ? '✓' : '✗'} ${msg}`)
}
// 게임 결함이 아닌 오류 (P2P · 네트워크 · 소리 자동 재생 · 헤드리스 GPU)
const IGNORE = /WebSocket|fetch|NetworkError|NotAllowedError|AbortError|ICE|RTCPeerConnection|WebGL|GPU|tracker|relay|nostr|mqtt/i

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
})

/** 판 하나를 연다 (skin = dark | bright) — 열린 page 를 돌려준다 */
async function openGame(skin) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  const errors = []
  page.on('pageerror', (e) => {
    const s = String(e?.stack ?? e)
    if (!IGNORE.test(s)) errors.push(s)
  })
  await page.goto(URL, { waitUntil: 'load' })
  await page.evaluate(() => {
    localStorage.setItem('brpg.tut', '["off"]')
    localStorage.setItem('brpg.muted', '1')
  })
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '게임 만들기'), null, { timeout: 60_000 })
  await page.evaluate(async (skin) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const btn = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t)
    btn('게임 만들기')?.click()
    await sleep(800)
    document.querySelector(`#seg-skin button[data-v="${skin}"]`)?.click()
    await sleep(300)
    btn('만들기')?.click()
    await sleep(2500)
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.includes('게임 시작'))?.click()
  }, skin)
  await page.waitForFunction(() => window.__bd?.phase?.() === 'playing', null, { timeout: 120_000 })
  await page.waitForTimeout(3000)
  await page.evaluate(() => document.querySelector('.ending .ending-go')?.click())
  await page.waitForTimeout(500)
  return { page, errors }
}

// ---------------------------------------------------------------- 공포스러움
{
  const { page, errors } = await openGame('dark')
  check(true, '공포스러움 판이 열린다')

  // 가방: 여러 종류를 채우고 연다
  await page.evaluate(() => {
    const p = window.__bd.state().players[window.__bd.me()]
    p.bag.length = 0
    let u = 90000
    for (let wt = 0; wt < 18; wt++) p.bag.push({ uid: u++, slot: 0, wt, rarity: wt % 5, ilvl: 10, aff: wt % 5 ? [0, 10] : [] })
    for (const [slot, n] of [[1, 4], [2, 3], [3, 4], [4, 4]]) for (let bt = 0; bt < n && p.bag.length < p.bagMax; bt++) p.bag.push({ uid: u++, slot, wt: 0, bt, rarity: bt % 4, ilvl: 10, aff: [5, 10] })
  })
  await page.keyboard.press('KeyI')
  await page.waitForTimeout(600)
  const bag = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.inv .cell:not(.empty)')]
    const inv = document.querySelector('.inv').getBoundingClientRect()
    return { n: cells.length, empty: cells.filter((c) => !c.querySelector('b')?.textContent?.trim()).length, bottom: inv.bottom, h: innerHeight }
  })
  check(bag.n > 0 && bag.empty === 0, `가방 칸 이름이 비지 않는다 (${bag.n}칸 중 빈 이름 ${bag.empty})`)
  check(bag.bottom <= bag.h - 140, `가방 창이 스킬 바를 덮지 않는다 (아래 끝 ${Math.round(bag.bottom)} / 화면 ${bag.h})`)

  // 설명 풍선: 맨 아래 줄 오른쪽 칸에 마우스
  const cell = page.locator('.inv .cell:not(.empty)').last()
  await cell.hover()
  await page.waitForTimeout(300)
  const tip = await page.evaluate(() => {
    // 풍선은 가방용 · 마을용 둘이다 — 지금 보이는 것
    const t = [...document.querySelectorAll('.inv-tip')].find((e) => !e.hidden)
    if (!t) return null
    const r = t.getBoundingClientRect()
    const cs = [...document.querySelectorAll('.inv .cell:not(.empty)')]
    const c = cs[cs.length - 1].getBoundingClientRect()
    const overlap = !(r.right <= c.left || r.left >= c.right || r.bottom <= c.top || r.top >= c.bottom)
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight, overlap }
  })
  check(!!tip, '아이템에 마우스를 올리면 설명 풍선이 뜬다')
  if (tip) {
    check(tip.l >= 0 && tip.t >= 0 && tip.r <= tip.w && tip.b <= tip.h, `설명 풍선이 화면 안에 있다 (${Math.round(tip.l)},${Math.round(tip.t)} ~ ${Math.round(tip.r)},${Math.round(tip.b)})`)
    check(!tip.overlap, '설명 풍선이 마우스를 올린 칸을 덮지 않는다')
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // 가운데 창은 하나: 스킬 창(K)을 연 채 상인에게 F
  await page.mouse.move(683, 300)
  await page.keyboard.press('KeyK')
  await page.waitForTimeout(400)
  await page.evaluate(() => {
    const p = window.__bd.state().players[window.__bd.me()]
    p.x = 336
    p.y = 336
  })
  await page.waitForTimeout(500)
  await page.keyboard.press('KeyF')
  await page.waitForTimeout(600)
  const wins = await page.evaluate(() => ({
    open: [...document.querySelectorAll('.tp, .wpp')].filter((e) => !e.hidden).map((e) => e.className),
    ui: window.__session.input.uiOpen,
  }))
  check(wins.open.length === 1, `가운데 창은 하나만 열린다 (${wins.open.join(' | ') || '없음'})`)
  check(wins.ui === true, '창이 열려 있으면 사격 · 스킬이 막힌다')
  await page.keyboard.press('KeyI')
  await page.keyboard.press('KeyI')
  await page.waitForTimeout(300)
  check((await page.evaluate(() => window.__session.input.uiOpen)) === true, '가방을 열고 닫아도 마을 창이 열려 있으면 사격이 막힌 채다')

  check(errors.length === 0, `잡히지 않은 오류 없음 (공포스러움)${errors.length ? '\n    ' + errors.slice(0, 3).join('\n    ') : ''}`)
  await page.close()
}

// ---------------------------------------------------------------- 철면수심전용
{
  const { page, errors } = await openGame('bright')
  const bright = await page.evaluate(() => !!document.querySelector('.skin-bright'))
  check(bright, '철면수심전용 판이 열리고 창이 캔디 나이트 색이다')
  await page.keyboard.press('KeyI')
  await page.waitForTimeout(500)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1500)
  check(errors.length === 0, `잡히지 않은 오류 없음 (철면수심전용)${errors.length ? '\n    ' + errors.slice(0, 3).join('\n    ') : ''}`)
  await page.close()
}

await browser.close()
if (fails.length) {
  console.log(`\n화면 시험 실패 ${fails.length}개 — 배포하지 않는다`)
  process.exit(1)
}
console.log('\n화면 시험 통과')
