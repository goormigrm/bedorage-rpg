// 칸 넘침 · 겹침 검사 (2026-10-22 사용자: "적어도 칸을 튀어나오거나 겹쳐서 안 보이는 건 없게 해줘").
// 개발 서버(5173)를 띄운 채로:  node tools/uicheck.mjs [1920x1080 2000x957 …]   (깔린 Chrome · 소리 끔)
// 장면마다(로비 · 방 만들기 · 설정 · 마을 HUD · 가방 · NPC 창 · 스킬 · 능력치 · 퀘스트 · 메뉴 · 치지직) 화면의 HTML 글자를 모두 훑어:
//  잘림   — 글자가 제 칸보다 넓거나 높아 잘린다 (overflow hidden · 말줄임 표시는 뺀다)
//  튀어나옴 — 글자 · 단추가 테두리 · 바탕이 있는 칸 밖으로 나간다
//  화면 밖 — 화면 가장자리를 넘는다
//  가려짐 — 다른 칸이 위에 덮여 안 보인다 (창 · 대화상자가 덮는 것은 뺀다 — 일부러 위에 뜬 것)
// 캔버스에 그린 것(HUD · 이름표)은 못 본다 — 그것은 스크린샷(SHOT=1 이면 .frames/shots/ui-<크기>-<장면>.png)으로 본다.
import { chromium } from 'playwright'
import { gpuLaunch } from './gpu.mjs'
import { mkdirSync } from 'node:fs'

const sizes = (process.argv.slice(2).length ? process.argv.slice(2) : ['1920x1080', '2000x957', '1366x768', '1600x900', '2560x1440', '1280x720']).map((s) => s.split('x').map(Number))
const SHOT = process.env.SHOT === '1'
if (SHOT) mkdirSync('.frames/shots', { recursive: true })
const browser = await chromium.launch(gpuLaunch())
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 페이지 안에서: 보이는 HTML 글자를 훑어 문제를 모은다 */
function audit() {
  const out = []
  const st = document.createElement('style')
  // 가려짐을 재려고 잠깐 모든 것을 맞을 수 있게 (pointer-events: none 인 띠 · 이름표도 elementsFromPoint 에 잡히게)
  st.textContent = '* { pointer-events: auto !important; }'
  document.head.appendChild(st)
  const W = innerWidth
  const H = innerHeight
  const shown = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false
    for (let q = el; q; q = q.parentElement) {
      const c = getComputedStyle(q)
      if (c.display === 'none' || Number(c.opacity) < 0.05) return false
      if (q.hidden) return false
    }
    const r = el.getBoundingClientRect()
    return r.width > 1 && r.height > 1
  }
  const own = (el) =>
    [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(' ')
      .trim()
  const label = (el) => {
    const parts = []
    for (let q = el; q && q !== document.body && parts.length < 4; q = q.parentElement) {
      const cls = typeof q.className === 'string' && q.className.trim() ? '.' + q.className.trim().split(/\s+/).slice(0, 2).join('.') : ''
      parts.unshift(q.tagName.toLowerCase() + (q.id ? '#' + q.id : '') + cls)
    }
    return parts.join(' > ')
  }
  const alpha = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/)
    if (!m) return c === 'transparent' ? 0 : 1
    const v = m[1].split(/[ ,/]+/).filter(Boolean)
    return v.length > 3 ? Number(v[3]) : 1
  }
  const boxy = (el) => {
    const cs = getComputedStyle(el)
    const bw = ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs[`border${s}Width`]) > 0 && alpha(cs[`border${s}Color`]) > 0.1)
    // 글자에 입힌 그라데이션(background-clip: text)은 칸이 아니다
    const textClip = /text/.test(cs.backgroundClip || cs.webkitBackgroundClip || '')
    return bw || alpha(cs.backgroundColor) > 0.15 || (cs.backgroundImage !== 'none' && !textClip)
  }
  /** 글자(제 글자 마디)가 실제로 차지하는 자리 — 칸 크기가 아니라 글자로 잰다 (단추의 반짝임 같은 장식은 안 센다) */
  const textRect = (el) => {
    let r = null
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue
      const rg = document.createRange()
      rg.selectNodeContents(n)
      for (const q of rg.getClientRects()) {
        if (q.width < 1) continue
        r = r ? { left: Math.min(r.left, q.left), top: Math.min(r.top, q.top), right: Math.max(r.right, q.right), bottom: Math.max(r.bottom, q.bottom) } : { left: q.left, top: q.top, right: q.right, bottom: q.bottom }
      }
    }
    return r && { ...r, width: r.right - r.left, height: r.bottom - r.top }
  }
  const visual = (el) => {
    if (el.tagName === 'CANVAS') return false
    if (['IMG', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return true
    return boxy(el) || own(el).length > 0
  }
  // 일부러 모두 위에 뜨는 것 (대화상자 · 메뉴 · 설명 풍선 — 덮어도 문제가 아니다)
  const MODAL = '.dlg, .ending, .overlay, .menu, .czpanel-wrap, .joining, .game-load, .inv-tip, .tip, .drag-ghost, .settings'
  // 창 — HUD 위에는 떠도 되지만 **창끼리 겹치면 안 된다** (2026-10-22 사용자: "아이템 창과 능력치 창을 같이 열면 겹친다")
  const WIN = '.tp, .inv, .wpp'
  const texts = [...document.querySelectorAll('body *')].filter((el) => {
    if (el.closest('svg') || el.tagName === 'CANVAS' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return false
    const t = own(el)
    return (t.length > 0 || ['BUTTON', 'INPUT'].includes(el.tagName)) && shown(el)
  })
  for (const el of texts) {
    const er = el.getBoundingClientRect()
    const tr = textRect(el)
    const r = tr ?? er
    const cs = getComputedStyle(el)
    const t = (own(el) || el.value || el.placeholder || '').slice(0, 24)
    const add = (kind, extra = '') => out.push({ kind, at: label(el), text: t, extra })
    // 잘림: 글자가 제 칸(overflow hidden)을 넘는다 — 말줄임(…)은 일부러
    if (tr && cs.textOverflow !== 'ellipsis') {
      const o = Math.max(er.left - tr.left, tr.right - er.right, er.top - tr.top, tr.bottom - er.bottom)
      const hid = /hidden|clip/.test(cs.overflowX) || /hidden|clip/.test(cs.overflowY)
      if (hid && o > 2) add('잘림', `${Math.round(o)}px`)
    }
    // 화면 밖 (굴리는 칸 안에 있으면 굴리면 보인다 — 뺀다)
    let scroller = null
    for (let q = el.parentElement; q && q !== document.body; q = q.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(q).overflowY) || /auto|scroll/.test(getComputedStyle(q).overflowX)) {
        scroller = q
        break
      }
    }
    if (!scroller && (r.right > W + 1 || r.bottom > H + 1 || r.left < -1 || r.top < -1)) add('화면 밖', `${Math.round(r.left)},${Math.round(r.top)} ~ ${Math.round(r.right)},${Math.round(r.bottom)} / ${W}×${H}`)
    // 튀어나옴: 가장 가까운 테두리 · 바탕 칸
    let box = null
    for (let q = el.parentElement; q && q !== document.body; q = q.parentElement) {
      const qr = q.getBoundingClientRect()
      if (qr.width >= W - 2 && qr.height >= H - 2) break // 화면 전체 바탕(로비 · 게임 화면)은 칸이 아니다
      if (boxy(q)) {
        box = q
        break
      }
    }
    if (box && !/auto|scroll/.test(getComputedStyle(box).overflowY)) {
      const b = box.getBoundingClientRect()
      const o = Math.max(b.left - r.left, r.right - b.right, b.top - r.top, r.bottom - b.bottom)
      if (o > 2) add('튀어나옴', `${Math.round(o)}px 밖 — 칸 ${label(box)}`)
    }
    // 가려짐: 글자 가운데 · 네 귀퉁이 안쪽을 찍어 가장 위의 보이는 것을 본다
    const pts = [
      [(r.left + r.right) / 2, (r.top + r.bottom) / 2],
      [r.left + 4, r.top + r.height / 2],
      [r.right - 4, r.top + r.height / 2],
    ]
    let hidden = 0
    let by = null
    for (const [x, y] of pts) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue
      const stack = document.elementsFromPoint(x, y)
      const top = stack.find((h) => h === el || el.contains(h) || h.contains(el) || visual(h))
      if (!top || top === el || el.contains(top) || top.contains(el)) continue
      // 대화상자 · 메뉴가 덮은 것 — 일부러
      if (top.closest(MODAL) && top.closest(MODAL) !== el.closest(MODAL)) continue
      // 창이 HUD 를 덮은 것 — 괜찮다 (창끼리는 센다)
      if (top.closest(WIN) && !el.closest(WIN)) continue
      hidden++
      by = top
    }
    if (hidden >= 2) add('가려짐', `덮은 것 ${label(by)} "${(own(by) || '').slice(0, 16)}"`)
  }
  st.remove()
  // 같은 것끼리 묶는다
  const seen = new Map()
  for (const o of out) {
    const k = o.kind + o.at
    if (!seen.has(k)) seen.set(k, { ...o, n: 1 })
    else seen.get(k).n++
  }
  return [...seen.values()]
}

async function newGame(page) {
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const btn = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t)
    window.__lobby?.selectChar?.('cheolmyeon')
    btn('게임 만들기')?.click()
    await sleep(600)
    document.querySelector('#seg-skin button[data-v="bright"]')?.click()
    btn('만들기')?.click()
    await sleep(1500)
    const cb = document.querySelector('input[type=checkbox]')
    if (cb && !cb.checked) cb.click()
    await sleep(800)
    btn('▶ 게임 시작')?.click()
  })
  await page.waitForFunction(() => window.__bd?.phase?.() === 'playing' && window.__session?.renderer?.ready, null, { timeout: 120000 })
  await sleep(2500)
  await page.evaluate(async () => {
    window.__session?.sfx?.setMuted?.(true)
    document.querySelector('.ending.intro .ending-go')?.click()
    // 가방 열두 칸 (글이 긴 아이템 이름까지 보이게)
    const same = async (path) => {
      const url = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes(path)).sort((a, b) => b.length - a.length)[0]
      return import(url ?? '/bedorage-rpg' + path)
    }
    const items = await same('/src/core/items.ts')
    const rngM = await same('/src/core/rng.ts')
    const p = window.__bd.state().players[0]
    p.gold = 123456
    p.level = 30
    const rng = rngM.makeRng(7)
    for (let i = 0; i < 18; i++) {
      const it = items.rollItem(rng, 910000 + i, 30, p.weapon, 'boss', 0, [4, 3, 3, 2, 1, 0][i % 6])
      it.rarity = [4, 3, 3, 2, 1, 0][i % 6]
      p.bag.push(it)
    }
  })
  await sleep(800)
}

const npcScene = (id) => async (page) => {
  await page.evaluate(async (id) => {
    const same = async (path) => {
      const url = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes(path)).sort((a, b) => b.length - a.length)[0]
      return import(url ?? '/bedorage-rpg' + path)
    }
    const w = await same('/src/core/world.ts')
    const s = window.__bd.state()
    const n = w.townNpcs(s.curArea).find((q) => q.id === id)
    if (!n) return
    s.players[0].x = n.x + 34
    s.players[0].y = n.y + 20
    await new Promise((r) => setTimeout(r, 400))
    window.__session.town.show(id)
  }, id)
  await sleep(900)
}
// 창 닫기: Esc 는 아무것도 없으면 메뉴를 연다 — 쓰지 않고 닫기 단추 · 같은 키로
let undo = null
const closeAll = async (page) => {
  if (undo) await undo(page)
  undo = null
  await page.evaluate(() => {
    window.__session?.town?.show?.(null)
    for (const el of document.querySelectorAll('.inv:not([hidden]) .inv-x, .tp:not([hidden]) .inv-x')) el.click()
  })
  await sleep(300)
}
const key = (code) => async (page) => {
  await page.keyboard.press(code)
  await sleep(700)
  undo = async (p) => {
    await p.keyboard.press(code)
    await sleep(300)
  }
}

const SCENES = [
  ['로비', async () => {}],
  ['방 만들기', async (page) => {
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '게임 만들기')?.click())
    await sleep(700)
  }],
  ['설정(로비)', async (page) => {
    await page.keyboard.press('Escape')
    await sleep(300)
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('설정'))?.click())
    await sleep(700)
  }],
  ['@게임', null],
  ['마을 HUD', async () => {}],
  ['가방', key('KeyI')],
  ['상점', npcScene('merchant')],
  ['대장장이', npcScene('smith')],
  ['도박꾼', npcScene('gambler')],
  ['보관함', npcScene('stash')],
  ['촌장', npcScene('elder')],
  ['용병 대장', npcScene('captain')],
  ['시련의 문', npcScene('trial')],
  ['스킬 창', key('KeyK')],
  ['능력치', key('KeyC')],
  ['퀘스트', key('KeyJ')],
  ['메뉴', key('Escape')],
  ['가방 + 능력치', async (page) => {
    await page.keyboard.press('KeyI')
    await sleep(400)
    await page.keyboard.press('KeyC')
    await sleep(700)
    undo = async (p) => {
      await p.keyboard.press('KeyC')
      await p.keyboard.press('KeyI')
      await sleep(300)
    }
  }],
  ['가방 + 스킬', async (page) => {
    await page.keyboard.press('KeyI')
    await sleep(400)
    await page.keyboard.press('KeyK')
    await sleep(700)
    undo = async (p) => {
      await p.keyboard.press('KeyK')
      await p.keyboard.press('KeyI')
      await sleep(300)
    }
  }],
  ['치지직', async (page) => {
    await page.evaluate(() => document.querySelector('.czbadge, #czbadge, [data-cz], .cz-badge')?.click())
    await sleep(900)
    undo = async (p) => {
      await p.evaluate(() => document.querySelector('.czpanel-wrap .x, .czpanel .x, .czpanel [data-x], .czpanel-wrap [aria-label="닫기"]')?.click())
      await p.keyboard.press('Escape')
      await sleep(300)
    }
  }],
]

let total = 0
for (const [w, h] of sizes) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.log('  페이지 오류:', String(e).slice(0, 160)))
  await page.addInitScript(() => {
    try {
      localStorage.setItem('brpg.muted', '1')
      localStorage.setItem('brpg.hud', 'normal')
    } catch {
      /* 저장소 없음 */
    }
  })
  await page.goto('http://localhost:5173/bedorage-rpg/?shot=1')
  await page.waitForFunction(() => !!document.querySelector('#btn-host'), null, { timeout: 60000 })
  await sleep(2000)
  console.log(`\n■ ${w}×${h}`)
  // 자기 시험: 일부러 넘치는 칸 · 잘리는 칸 · 가려지는 글자를 넣고 잡히는지 본다 (도구가 '0건'만 내는 것이 아닌지)
  if (w === sizes[0][0] && h === sizes[0][1]) {
    const found = await page.evaluate((src) => {
      const box = document.createElement('div')
      box.innerHTML = `<div style="position:fixed;left:40px;top:300px;width:120px;height:30px;border:2px solid red;background:#000;z-index:999"><span style="white-space:nowrap">아주아주아주아주 긴 글자가 칸 밖으로</span></div>
        <div style="position:fixed;left:40px;top:360px;width:80px;height:24px;overflow:hidden;white-space:nowrap;background:#000;z-index:999">잘리는 긴 글자 잘리는 긴 글자</div>
        <div style="position:fixed;left:40px;top:420px;z-index:998;color:#fff">가려지는 글자입니다</div><div style="position:fixed;left:30px;top:410px;width:220px;height:40px;background:#123;z-index:999"></div>`
      document.body.appendChild(box)
      const r = eval(`(${src})`)()
      box.remove()
      return r.map((o) => o.kind)
    }, audit.toString())
    const ok = ['튀어나옴', '잘림', '가려짐'].every((k) => found.includes(k))
    console.log(`  자기 시험: ${ok ? '통과' : '실패 — ' + found.join(' · ')}`)
    if (!ok) process.exitCode = 2
  }
  for (const [name, run] of SCENES) {
    if (name === '@게임') {
      await page.keyboard.press('Escape').catch(() => {})
      await page.evaluate(() => document.querySelectorAll('.dlg .x, .dlg [data-close]').forEach((b) => b.click()))
      await page.goto('http://localhost:5173/bedorage-rpg/?shot=1')
      await page.waitForFunction(() => !!document.querySelector('#btn-host'), null, { timeout: 60000 })
      await sleep(1500)
      await newGame(page)
      continue
    }
    try {
      await run(page)
      const list = await page.evaluate(audit)
      if (SHOT) await page.screenshot({ path: `.frames/shots/ui-${w}x${h}-${name}.png` })
      total += list.length
      console.log(`  ${name}: ${list.length ? `${list.length}건` : '문제 없음'}`)
      for (const o of list) console.log(`    [${o.kind}] ${o.text ? `"${o.text}" ` : ''}${o.at}${o.n > 1 ? ` ×${o.n}` : ''} — ${o.extra}`)
    } catch (e) {
      console.log(`  ${name}: 장면 실패 ${String(e).slice(0, 160)}`)
    }
    if (!['로비', '방 만들기'].includes(name)) await closeAll(page)
  }
  await page.close()
}
console.log(`\n모두 ${total}건`)
await browser.close()
process.exit(total ? 1 : 0)
