// 밝은 분위기 맵 사진첩 (2026-10-17 — 사용자: "철면수심전용 버전에서만 그래픽 작업으로 더 낫게 · 맵이나 구조물의 퀄리티를 높이고 싶어").
// 그래픽을 고치기 전 · 뒤를 같은 자리에서 견주려고, 맵마다 대표 지역으로 파티를 옮겨 3D 화면만 찍는다(HUD 없이).
// 개발 서버(?shot=1)의 로비(캐릭터 고르는 화면)에서:
//   const g = await import('/bedorage-rpg/tools/gallery.js'); await g.start()   → ☀ 철면수심전용 판을 연다 (봇 셋 · 소리 끔)
//   await g.shoot('before')                                                    → .frames/shots/before-<지역>.jpg (맵마다 하나)
//   await g.shoot('after', [1, 11])                                             → 고른 지역만
// 사진은 git 밖(.frames). 판을 연 뒤 코드를 고치면 vite 가 페이지를 새로 고친다 → start() 부터 다시.

const S = () => window.__session
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 맵마다 한 지역 (같은 맵을 쓰는 지역은 하나만): 대기실 넷 · 들판 · 굴 · 실내 · 보스 방 */
export const AREAS = [0, 1, 2, 6, 8, 9, 10, 11, 12, 14, 18, 19, 20, 21, 22, 25, 27, 28, 29, 30, 32, 33, 34, 35]

/** 개발 서버는 고친 파일을 ?t= 꼬리표가 붙은 주소로 준다 — 게임이 쓰는 그 사본을 불러야 판에 닿는다 (trailer.js 와 같다) */
async function sameModule(path) {
  const url = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes(path)).sort((a, b) => b.length - a.length)[0]
  return import(url ?? '/bedorage-rpg' + path)
}

export async function start() {
  // 시험 중에는 소리를 끈다 (HANDOVER 주의)
  localStorage.setItem('brpg.muted', '1')
  const btn = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t)
  window.__lobby?.selectChar?.('cheolmyeon')
  btn('게임 만들기')?.click()
  await sleep(700)
  document.querySelector('#seg-skin button[data-v="bright"]')?.click()
  await sleep(200)
  btn('만들기')?.click()
  await sleep(1600)
  const cb = document.querySelector('input[type=checkbox]')
  if (cb && !cb.checked) cb.click()
  await sleep(900)
  btn('▶ 게임 시작')?.click()
  for (let k = 0; k < 160 && !(S() && window.__bd?.phase?.() === 'playing'); k++) await sleep(250)
  S()?.sfx?.setMuted?.(true)
  await sleep(4500)
  return window.__bd?.phase?.() ?? '판 없음'
}

/** 파티를 옮기고 세계가 서면 3D 화면 한 장 (1280 폭 jpg) */
export async function shoot(prefix, areas = AREAS, wait = 2600) {
  const sim = await sameModule('/src/core/sim.ts')
  const out = []
  for (const area of areas) {
    const s = window.__bd.state()
    for (let i = 0; i < s.players.length; i++) sim.warpPlayer(s, S().mapOf, i, area)
    await sleep(wait)
    // 그린 직후 같은 틱에 읽는다 (preserveDrawingBuffer 없이)
    S().frame(performance.now())
    const src = S().renderer.gl.domElement
    const c = document.createElement('canvas')
    c.width = 1280
    c.height = Math.round((1280 * src.height) / src.width)
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height)
    const res = await fetch('/__shot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `${prefix}-${area}`, data: c.toDataURL('image/jpeg', 0.85) }) })
    out.push(await res.text())
  }
  return out
}
