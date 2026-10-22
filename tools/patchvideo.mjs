// 패치 영상 뜨기 (2026-10-22 사용자: "오늘 업데이트 내역이 잘 보이게 동영상으로도 — 오프닝 · 엔딩 빼고 패치 내역만 · 1개 · 화질 좋게").
// 개발 서버(5173)를 띄운 채로:  node tools/patchvideo.mjs        → docs/img/<NOTES_DIR>/patchnote.webm (tools/trailer.js mode 'notes')
// 깔린 Chrome(헤드리스) · 1920×1080 · 소리 끔(게임 소리는 영상에만 — trailer.js 가 오프라인으로 그린다)
import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
page.on('pageerror', (e) => console.log('페이지 오류:', String(e).slice(0, 200)))
await page.addInitScript(() => {
  try {
    localStorage.setItem('brpg.muted', '1')
  } catch {
    /* 저장소 없음 */
  }
})
await page.goto('http://localhost:5173/bedorage-rpg/?shot=1')
await page.waitForFunction(() => !!document.querySelector('#btn-host'), null, { timeout: 60000 })
await new Promise((r) => setTimeout(r, 2500))
const t0 = Date.now()
const log = await page.evaluate(async (opts) => {
  const t = await import('/bedorage-rpg/tools/trailer.js')
  return t.start(opts)
}, { mode: 'notes', skin: process.env.SKIN ?? 'bright' })
console.log((Array.isArray(log) ? log : [log]).join('\n'))
console.log(`걸린 시간 ${Math.round((Date.now() - t0) / 1000)}초`)
await browser.close()
