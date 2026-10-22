// 패치 스크린샷 (2026-10-22 사용자: "트레일러 영상은 다시 안 찍어도 되고 패치 내역이 잘 보이게 스크린샷 · 기존 것과 헷갈리지 않게 별도 폴더").
// 개발 서버(npm run dev — 5173)를 띄운 채로:
//   node tools/patchshots.mjs                       → docs/img/patch-<오늘>/<장면>.png (공지 첨부용 · git 밖)
//   node tools/patchshots.mjs qa town bag           → .frames/shots/qa-<장면>.png (확인용) · 장면을 고르면 그것만
//   SHOT_DIR=patch-2026-10-22 node tools/patchshots.mjs   → 폴더 이름을 정해서
// 장면: lobby · town · bag · shop · elder · captain · field · bubbles · stream (아래 SCENES). 1920 × 1080 · 소리 끔 · 헤드리스 크로미움.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const URL = process.env.SHOT_URL ?? 'http://localhost:5173/bedorage-rpg/?shot=1'
const args = process.argv.slice(2)
const qa = args[0] === 'qa'
const pick = (qa ? args.slice(1) : args).filter(Boolean)
const day = new Date().toISOString().slice(0, 10)
const dir = qa ? '.frames/shots' : `docs/img/${process.env.SHOT_DIR ?? `patch-${day}`}`
mkdirSync(dir, { recursive: true })
const skin = process.env.SHOT_SKIN ?? 'bright'

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
page.on('pageerror', (e) => console.log('페이지 오류:', String(e).slice(0, 200)))
await page.addInitScript(() => {
  try {
    localStorage.setItem('brpg.muted', '1')
    // 영상 도구가 남긴 '작게(tiny)' HUD 가 있으면 보통으로 (사람이 보는 크기)
    if (localStorage.getItem('brpg.hud') === 'tiny') localStorage.setItem('brpg.hud', 'normal')
  } catch {
    /* 저장소 없음 */
  }
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const shot = async (name) => {
  const file = `${dir}/${qa ? 'qa-' : ''}${name}.png`
  await page.screenshot({ path: file })
  console.log('찍음', file)
}

async function openLobby() {
  await page.goto(URL)
  await page.waitForFunction(() => !!document.querySelector('#btn-host'), null, { timeout: 60000 })
  await sleep(2500)
}

/** 방을 만들어(봇 채우기 · 분위기) 판을 연다 */
async function startGame(fillBots = true) {
  await page.evaluate(async ({ skin, fillBots }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const btn = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t)
    window.__lobby?.selectChar?.('cheolmyeon')
    if (window.__lobby) window.__lobby.botChars = ['chim', 'dangun', 'magic']
    btn('게임 만들기')?.click()
    await sleep(700)
    document.querySelector(`#seg-skin button[data-v="${skin}"]`)?.click()
    await sleep(200)
    btn('만들기')?.click()
    await sleep(1600)
    const cb = document.querySelector('input[type=checkbox]')
    if (cb && cb.checked !== fillBots) cb.click()
    await sleep(900)
    btn('▶ 게임 시작')?.click()
  }, { skin, fillBots })
  await page.waitForFunction(() => window.__bd?.phase?.() === 'playing' && window.__session?.renderer?.ready, null, { timeout: 120000 })
  await sleep(4000)
  await page.evaluate(() => window.__session?.sfx?.setMuted?.(true))
}

/** NPC 곁으로 (창을 열 수 있게) */
async function nearNpc(id) {
  await page.evaluate(async (id) => {
    const w = await import('/bedorage-rpg/src/core/world.ts')
    const s = window.__bd.state()
    const n = w.townNpcs(s.curArea).find((q) => q.id === id)
    const p = s.players[0]
    p.x = n.x + 34
    p.y = n.y + 20
  }, id)
  await sleep(600)
}

const SCENES = {
  lobby: async () => {
    await openLobby()
    await shot('01_lobby')
  },
  town: async () => {
    await startGame()
    await page.mouse.move(1180, 520)
    await sleep(800)
    await shot('02_town_hud')
  },
  bag: async () => {
    await page.keyboard.press('KeyI')
    await sleep(900)
    await shot('03_bag_expand')
    await page.keyboard.press('KeyI')
  },
  shop: async () => {
    await nearNpc('merchant')
    await page.evaluate(() => window.__session.town.show('merchant'))
    await sleep(900)
    await shot('04_shop_sell')
    await page.evaluate(() => window.__session.town.show(null))
  },
  elder: async () => {
    await nearNpc('elder')
    await page.evaluate(() => window.__session.town.show('elder'))
    await sleep(900)
    await shot('05_elder_all')
    await page.evaluate(() => window.__session.town.show(null))
  },
  captain: async () => {
    // 빈 자리가 있는 방 (봇 채우기 끔) — 용병 셋
    await openLobby()
    await startGame(false)
    await nearNpc('captain')
    await page.evaluate(async () => {
      const s = window.__bd.state()
      s.players[0].gold = Math.max(s.players[0].gold, 99999)
      window.__session.town.show('captain')
    })
    await sleep(600)
    for (const name of ['매직란', '침착란', '승빠란']) {
      await page.evaluate((name) => [...document.querySelectorAll('.tp button')].find((b) => b.textContent.trim() === name)?.click(), name)
      await sleep(700)
    }
    await sleep(800)
    await shot('06_captain_mercs')
    await page.evaluate(() => window.__session.town.show(null))
  },
  field: async () => {
    // 들판으로 나가 바닥 길 안내
    await page.evaluate(async () => {
      const w = await import('/bedorage-rpg/src/core/world.ts')
      const s = window.__bd.state()
      const l = w.areaLayout(s.curArea, window.__bd.map())
      const e = l.exits.find((q) => !w.isTown(q.to)) ?? l.exits[0]
      s.players[0].x = e.x
      s.players[0].y = e.y
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', bubbles: true }))
      await new Promise((r) => setTimeout(r, 150))
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'f', code: 'KeyF', bubbles: true }))
    })
    await page.waitForFunction(() => window.__bd.state().players[0].area !== 0 && !window.__session.renderer.areaCompiling, null, { timeout: 60000 })
    await sleep(3500)
    await page.mouse.move(1300, 420)
    await sleep(600)
    await shot('07_field_nav')
  },
  bubbles: async () => {
    await page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/src/game/stream.ts'))
      const { stream } = await import(url ?? '/bedorage-rpg/src/game/stream.ts')
      for (let i = 0; i < 5; i++) stream.fakeChat(false)
    })
    await sleep(1500)
    await shot('08_chat_bubbles')
  },
  stream: async () => {
    await page.evaluate(() => document.querySelector('.czbadge, #czbadge, [data-cz]')?.click())
    await sleep(1200)
    await shot('09_stream_amounts')
  },
}

const order = pick.length ? pick : ['lobby', 'town', 'bag', 'shop', 'elder', 'field', 'bubbles', 'stream', 'captain']
// 판이 필요한 장면을 고르면 먼저 판을 연다
const needGame = new Set(['bag', 'shop', 'elder', 'field', 'bubbles', 'stream'])
let opened = false
for (const name of order) {
  if (needGame.has(name) && !opened) {
    await openLobby()
    await startGame()
    opened = true
  }
  if (name === 'town') opened = true
  if (name === 'lobby') opened = false
  console.log('장면', name)
  try {
    await SCENES[name]()
  } catch (e) {
    console.log('장면 실패', name, String(e).slice(0, 300))
  }
}
await browser.close()
