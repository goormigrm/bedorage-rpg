// 4분할 장면 녹화 (2026-10-26 사용자: "4분할 영상으로 각자 다른 플레이어가 같은 전투 상황에서 각기 다른 모드로 전투 중인 장면").
// 분위기는 페이지 전체 설정이라 한 화면에 ☀ · 🌙 를 같이 그릴 수 없다 → **실제 멀티 판**을 브라우저 넷(따로 저장소)으로 열고
// 각자 ☀ 쿼터뷰 · ☀ 3인칭 · 🌙 쿼터뷰 · 🌙 3인칭으로 같은 싸움을 하는 화면을 동시에 찍는다(CDP 화면 전송 — 진짜 시간).
// 패치 영상(tools/trailer.js TPPV)이 이 사진들을 2×2 로 붙여 한 장면으로 넣는다. 소리는 방장 화면의 판 이벤트를 같이 적어 둔다.
//   개발 서버(5173)를 띄운 채로: node tools/splitcap.mjs   → .frames/split/q0 ~ q3/*.jpg · .frames/split/meta.json
import { chromium } from 'playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { gpuLaunch } from './gpu.mjs'

const URL = process.env.SPLIT_URL ?? 'http://localhost:5173/bedorage-rpg/?shot=1'
const OUT = '.frames/split'
const SEC = Number(process.env.SPLIT_SEC ?? 14)
const LEVEL = Number(process.env.SPLIT_LV ?? 6)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a)

/** 네 자리: 이름 · 캐릭터 · 분위기 · 시점 (화면 칸 순서 — 왼쪽 위부터) */
const SEATS = [
  { name: '침착이', char: 'chim', skin: 'bright', view: 'quarter' },
  { name: '기열이', char: 'giyeol', skin: 'bright', view: 'fps' },
  { name: '주펄이', char: 'jupeol', skin: 'dark', view: 'quarter' },
  { name: '단군이', char: 'dangun', skin: 'dark', view: 'fps' },
]

// 사람마다 따로 브라우저(프로세스) — 한 브라우저에 넷이면 GPU · 화면 전송이 한 줄로 서서 초당 7 ~ 10장이었다 · 뒤에 있는 창도 늦추지 않게
const FLAGS = ['--enable-gpu-rasterization', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows']
const browsers = []
const people = []
try {
  for (const s of SEATS) {
    const browser = await chromium.launch(gpuLaunch(...FLAGS))
    browsers.push(browser)
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => log(s.name, '페이지 오류', String(e).slice(0, 200)))
    await page.addInitScript(({ s }) => {
      localStorage.setItem('brpg.muted', '1')
      localStorage.setItem('bd.nick', s.name)
      localStorage.setItem('brpg.skin', s.skin)
      localStorage.setItem('brpg.view', s.view)
      localStorage.setItem('brpg.hud', 'normal')
      // 처음 하는 사람용 안내(구르기 · 조준 …)를 끈다 — 네 칸 아래 가운데에 같은 글이 떠 있었다
      localStorage.setItem('brpg.tut', JSON.stringify(['off']))
    }, { s })
    await page.goto(URL)
    await page.waitForFunction(() => !!document.querySelector('#btn-host'), null, { timeout: 90000 })
    // 세이브: 그 레벨 봇 한 벌 · 1막 마을에서 시작 → 운동장(지역 1 — ☀ 3인칭이 가장 트였다. 2막 숲 · 늪은 큰 나무 · 버섯이 카메라를 덮었다)
    await page.evaluate(async ({ char, level }) => {
      const base = location.origin + '/bedorage-rpg/src/'
      const bs = await import(base + 'core/botsheet.ts')
      const world = await import(base + 'core/world.ts')
      const quests = world.QUESTS.map(() => 0)
      const sh = bs.botSheet(char, level, level, 7, quests, world.questPoints(quests))
      sh.quests = quests
      sh.wps = world.wpBit(0)
      localStorage.setItem('brpg.save.slot', '1')
      localStorage.setItem('brpg.save.v1', JSON.stringify({ v: 1, chars: { [char]: sh }, updated: Date.now() }))
    }, { char: s.char, level: LEVEL })
    await page.reload()
    await page.waitForFunction(() => !!document.querySelector('#btn-host') && !!window.__lobby, null, { timeout: 90000 })
    await page.evaluate((c) => window.__lobby.selectChar(c), s.char)
    people.push({ ...s, page })
  }
  log('넷 준비')
  const [A, ...guests] = people
  const click = (p, text) => p.page.evaluate((t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t && !b.disabled)?.click(), text)
  await click(A, '게임 만들기')
  await sleep(600)
  await click(A, '만들기')
  await sleep(1500)
  for (const g of guests) {
    for (let k = 0; k < 30; k++) {
      const ok = await g.page.evaluate((n) => {
        const row = [...document.querySelectorAll('#rooms .room')].find((r) => r.innerText.includes(n))
        const b = row?.querySelector('button[data-code]')
        if (b && !b.disabled) b.click()
        return !!b && !b.disabled
      }, A.name)
      if (ok) break
      await g.page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '새로고침')?.click())
      await sleep(1500)
    }
    for (let k = 0; k < 20 && !(await A.page.evaluate((n) => document.querySelector('#status')?.innerText.includes(n), g.name)); k++) await sleep(800)
    await click(g, '준비')
    await sleep(600)
  }
  await sleep(1500)
  await click(A, '▶ 게임 시작')
  for (let k = 0; k < 90; k++) {
    await sleep(1000)
    const ticks = await Promise.all(people.map((p) => p.page.evaluate(() => window.__session?.state?.tick ?? 0)))
    if (ticks.every((t) => t > 120)) break
  }
  log('판 시작')
  for (const p of people) await p.page.evaluate(() => document.querySelector('.ending.intro .ending-go')?.click())
  // 방의 분위기는 방장 것(☀) — 🌙 자리는 G 로 바꾼다 (게임의 모드 스위치와 같은 길)
  for (const p of people) {
    const bright = await p.page.evaluate(() => !!document.querySelector('.skin-bright'))
    if (bright !== (p.skin === 'bright')) await p.page.evaluate(() => window.__session.switchSkin())
  }
  await sleep(6000)
  // 방장이 마을 문으로 첫 들판에 → 모두 같이 (방장이 이끈다)
  const gate = await A.page.evaluate(async () => {
    const world = await import(location.origin + '/bedorage-rpg/src/core/world.ts')
    const S = window.__session
    const me = S.state.players[0]
    const e = world.areaLayout(me.area, S.mapOf(me.area)).exits.find((q) => q.to === 1) ?? world.areaLayout(me.area, S.mapOf(me.area)).exits[0]
    return { x: e.x, y: e.y }
  })
  await A.page.evaluate(async ({ x, y }) => {
    const S = window.__session
    const inp = S.input
    const s0 = inp.sample.bind(inp)
    let done = false
    inp.sample = (...a) => {
      const b = s0(...a)
      const me = S.state.players[0]
      const d = Math.hypot(x - me.x, y - me.y)
      if (d < 28) {
        done = true
        return { ...b, mx: 0, my: 0, buttons: (b.buttons ?? 0) | (1 << 6) }
      }
      return { ...b, mx: Math.round(((x - me.x) / d) * 100), my: Math.round(((y - me.y) / d) * 100) }
    }
    const end = performance.now() + 25000
    while (!done && performance.now() < end) await new Promise((r) => setTimeout(r, 50))
    await new Promise((r) => setTimeout(r, 300))
    inp.sample = s0
  }, gate)
  await sleep(5000)
  const areas = await Promise.all(people.map((p) => p.page.evaluate(() => window.__session.state.players.map((q) => q.area).join(','))))
  log('들판', areas.join(' | '))

  // ---- 싸우기: 모두 같은 규칙 — 가장 가까운 괴물(11칸)을 쏘고 · 스킬을 가끔 · 방장은 괴물이 없으면 앞으로(다음 출구 3칸 앞까지) · 나머지는 방장 곁에
  for (const [i, p] of people.entries()) {
    await p.page.evaluate(async ({ i, lead }) => {
      const S = window.__session
      const inp = S.input
      const R = () => S.renderer
      const I = await import(location.origin + '/bedorage-rpg/src/core/input.ts')
      const world = await import(location.origin + '/bedorage-rpg/src/core/world.ts')
      const T = 32
      const s0 = inp.sample.bind(inp)
      const me0 = S.state.players[S.cfg.localPlayer]
      const l = world.areaLayout(me0.area, S.mapOf(me0.area))
      const goal = l.exits.find((e) => e.to !== world.ACTS[0].town) ?? l.exits[0]
      let k = 0
      inp.sample = (...a) => {
        const base = s0(...a)
        k++
        const s = S.state
        const me = s.players[S.cfg.localPlayer]
        let best = null
        let bd = 11 * T
        for (const m of s.monsters) {
          if (m.hp <= 0) continue
          const d = Math.hypot(m.x - me.x, m.y - me.y)
          if (d < bd) {
            bd = d
            best = m
          }
        }
        // 걷기
        let tx = me.x
        let ty = me.y
        if (lead) {
          if (!best || bd > 6 * T) {
            const dx = goal.x - me.x
            const dy = goal.y - me.y
            const d = Math.hypot(dx, dy)
            if (d > 4 * T) {
              tx = me.x + (dx / d) * 40
              ty = me.y + (dy / d) * 40
            }
          }
        } else {
          const L = s.players[0]
          const ang = (i * Math.PI * 2) / 3 + 0.6
          tx = L.x + Math.cos(ang) * 2.2 * T
          ty = L.y + Math.sin(ang) * 2.2 * T
        }
        const dx = tx - me.x
        const dy = ty - me.y
        const dd = Math.hypot(dx, dy)
        const out = { ...base, mx: dd > 14 ? Math.round((dx / dd) * 100) : 0, my: dd > 14 ? Math.round((dy / dd) * 100) : 0 }
        // 겨누기 · 쏘기
        if (best) {
          const ang = Math.atan2(best.y - me.y, best.x - me.x)
          if (inp.fps) {
            // 3인칭: 시선을 괴물 쪽으로 부드럽게 (조준은 화면 가운데 — 게임이 정한다)
            const diff = Math.atan2(Math.sin(ang - inp.yaw), Math.cos(ang - inp.yaw))
            inp.yaw += Math.max(-0.06, Math.min(0.06, diff * 0.25))
            inp.pitch = -0.12
          } else {
            out.aim = Math.round((ang / (Math.PI * 2)) * 1024) & 1023
            out.aimDist = Math.min(255, Math.round(bd / 4))
            const sc = R().worldToScreen(best.x / T, 0.8, best.y / T)
            inp.mouse.x += (sc.x - inp.mouse.x) * 0.35
            inp.mouse.y += (sc.y - inp.mouse.y) * 0.35
          }
          out.buttons = (out.buttons ?? 0) | I.BTN_FIRE
          // 스킬: 사람마다 엇갈려 1.6초마다 하나 (세 틱 누른다)
          const ph = (k + i * 23) % 96
          if (ph < 3) out.buttons |= I.SKILL_BTNS[(Math.floor((k + i * 23) / 96) + i) % 4 === 2 ? 0 : (Math.floor((k + i * 23) / 96) + i) % 5]
        }
        return out
      }
    }, { i, lead: i === 0 })
  }
  log('싸움 시작')
  // 방장 화면의 판 이벤트 (소리) — 진짜 시각(초)과 함께
  await A.page.evaluate(() => {
    window.__splitEv = []
    const S = window.__session
    const lite = (s) => ({
      phase: s.phase,
      phaseTimer: s.phaseTimer,
      mode: s.mode,
      players: s.players.map((p) => ({ x: p.x, y: p.y, alive: p.alive, weapon: p.weapon, char: p.char, fx: [...p.fx] })),
      monsters: s.monsters.map((m) => ({ hp: m.hp, st: m.st, kind: m.kind, maxHp: m.maxHp, x: m.x, y: m.y })),
    })
    const on0 = S.sfx.onEvents.bind(S.sfx)
    S.sfx.onEvents = (ev, s, lp) => {
      if (ev.length) window.__splitEv.push({ t: Date.now() / 1000, ev: structuredClone(ev), st: lite(s), lp })
      return on0(ev, s, lp)
    }
  })
  // ---- 찍기: 넷 동시에 (CDP 화면 전송)
  rmSync(OUT, { recursive: true, force: true })
  const frames = SEATS.map(() => [])
  const cdps = []
  for (const [i, p] of people.entries()) {
    mkdirSync(`${OUT}/q${i}`, { recursive: true })
    const cdp = await p.page.context().newCDPSession(p.page)
    cdp.on('Page.screencastFrame', async (f) => {
      const n = frames[i].length
      writeFileSync(`${OUT}/q${i}/${String(n).padStart(5, '0')}.jpg`, Buffer.from(f.data, 'base64'))
      frames[i].push({ n, t: f.metadata.timestamp })
      try {
        await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId })
      } catch {
        /* 닫는 중 */
      }
    })
    cdps.push(cdp)
  }
  const start = Date.now() / 1000
  await Promise.all(cdps.map((c) => c.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 960, maxHeight: 540, everyNthFrame: 1 })))
  await sleep(SEC * 1000)
  await Promise.all(cdps.map((c) => c.send('Page.stopScreencast').catch(() => {})))
  const end = Date.now() / 1000
  const ev = (await A.page.evaluate(() => window.__splitEv)).filter((e) => e.t >= start && e.t <= end)
  const hashes = await Promise.all(people.map((p) => p.page.evaluate(() => ({ h: window.__bd.hashes(), r: window.__bd.resyncs() }))))
  const ticks = Object.keys(hashes[0].h).filter((t) => hashes.every((x) => t in x.h))
  const bad = ticks.filter((t) => hashes.some((x) => x.h[t] !== hashes[0].h[t])).length
  writeFileSync(`${OUT}/meta.json`, JSON.stringify({ start, end, seats: SEATS, frames, ev }))
  log(`찍음 ${SEC}초 · 장 수 ${frames.map((f) => f.length).join(' · ')} (초당 ${frames.map((f) => (f.length / SEC).toFixed(0)).join(' · ')}) · 소리 단서 ${ev.length} · 동기화 같은 틱 ${ticks.length} 다름 ${bad} · 리싱크 ${hashes.map((x) => x.r).join('/')}`)
} catch (e) {
  log('실패', String(e).slice(0, 500))
} finally {
  for (const b of browsers) await b.close()
}
