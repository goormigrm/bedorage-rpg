// 패치 영상 뜨기 (2026-10-22 사용자: "오늘 업데이트 내역이 잘 보이게 동영상으로도 — 오프닝 · 엔딩 빼고 패치 내역만 · 1개 · 화질 좋게").
// 개발 서버(5173)를 띄운 채로:  node tools/patchvideo.mjs        → docs/img/<NOTES_DIR>/patchnote.webm (tools/trailer.js mode 'notes')
//   SKIN=dark → patchnote_dark.webm · MODE=trailer PART=1|2 DIR=release-<날짜> → 소개 영상(patch<편>_<분위기>.webm)을 그 폴더에
//   MODE=trailer PART=3 DIR=release-<날짜> [SKIN=dark] → 한 편 소개 intro_<분위기>.webm (파일당 20 MB 안 — 새로 올리는 사이트)
//   MODE=patch24 → 10월 23일 이후 패치 플레이 영상 docs/img/patch-2026-10-24/patch_1024_play(_hq).webm (☀ · 720 은 20 MB 안)
//   짧게 확인: MAXSEC=12(영상 12초에서 멈춤) · OUTDIR=patch-0000-1(docs/img 아래 다른 폴더 — 이름은 patch- · release- + 숫자만) ·
//   DIAG=3(녹화 없이 3초 동안 장마다 판 틱 · 위치 · 카메라를 적는다) · WHY=1(장을 담다 / 빼는 까닭) · NOSAVE=1
// 깔린 Chrome(헤드리스) · 1920×1080 · 소리 끔(게임 소리는 영상에만 — trailer.js 가 오프라인으로 그린다)
import { chromium } from 'playwright'
import { gpuLaunch } from './gpu.mjs'

const browser = await chromium.launch(gpuLaunch('--autoplay-policy=no-user-gesture-required'))
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
}, { mode: process.env.MODE === 'trailer' ? undefined : process.env.MODE === 'patch24' ? 'patch24' : 'notes', part: Number(process.env.PART ?? 1), dir: process.env.DIR, skin: process.env.SKIN ?? 'bright', why: !!process.env.WHY, noSave: !!process.env.NOSAVE, maxSec: Number(process.env.MAXSEC ?? 0), outDir: process.env.OUTDIR, diag: process.env.DIAG ? { sec: Number(process.env.DIAG), every: 1 } : undefined })
console.log((Array.isArray(log) ? log : [log]).map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n'))
console.log(`걸린 시간 ${Math.round((Date.now() - t0) / 1000)}초`)
await browser.close()
