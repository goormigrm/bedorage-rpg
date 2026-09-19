// 공지용 GIF · 사진 녹화 도우미 (개발 서버 전용 — 배포물에 들어가지 않는다). 덕의 tools/rec.js 를 RPG 에 맞춰 줄였다.
//
// 쓰는 법: 개발 서버를 `?shot=1` 로 연다(캔버스 버퍼 보존 + window.__session). 콘솔에서
//   const s = document.createElement('script'); s.src = '/bedorage-rpg/tools/rec.js'; document.head.appendChild(s)
//   __rec.start('horde', 12, 6)  → (장면 연출) → await __rec.stop()   // .frames/horde/NNN.png
//   await __rec.still('shot_horde')                                    // docs/img/shot_horde.jpg
//   python tools/gif.py horde                                          // docs/img/gif_horde.gif
//
// 브라우저 창이 가려져 있으면 requestAnimationFrame 이 멈춰 화면이 안 그려진다 → 찍을 때마다 한 프레임을 직접 그린다.
// 게임 화면의 캔버스(3D + HUD)만 합친다. docs/img · .frames 는 저장소에 올리지 않는다(.gitignore).

;(() => {
  const W = 1280, H = 720
  const off = document.createElement('canvas')
  off.width = W
  off.height = H
  let timer = null
  let frames = []
  let tag = ''

  function draw() {
    const S = window.__session
    if (S && S.frame) {
      cancelAnimationFrame(S.raf)
      S.frame(performance.now())
    }
  }
  function grab() {
    draw()
    const c = off.getContext('2d')
    c.fillStyle = '#000'
    c.fillRect(0, 0, W, H)
    const stage = document.querySelector('.game-stage')
    if (!stage) return
    const r0 = stage.getBoundingClientRect()
    for (const cv of stage.querySelectorAll('canvas')) {
      const r = cv.getBoundingClientRect()
      if (!r.width || getComputedStyle(cv).display === 'none') continue
      c.drawImage(cv, ((r.left - r0.left) / r0.width) * W, ((r.top - r0.top) / r0.height) * H, (r.width / r0.width) * W, (r.height / r0.height) * H)
    }
    frames.push(off.toDataURL('image/png'))
  }
  async function post(name, data, dir) {
    const r = await fetch('/__shot', { method: 'POST', body: JSON.stringify({ name, data, dir }) })
    return r.text()
  }
  window.__rec = {
    /** fps 로 seconds 동안 프레임을 모은다 */
    start(name, fps = 12, seconds = 6) {
      tag = name
      frames = []
      const limit = fps * seconds
      clearInterval(timer)
      timer = setInterval(() => {
        grab()
        if (frames.length >= limit) {
          clearInterval(timer)
          timer = null
        }
      }, 1000 / fps)
    },
    busy() {
      return timer !== null
    },
    count() {
      return frames.length
    },
    /** 모은 프레임을 .frames/<tag>/ 로 올린다 */
    async stop(name) {
      clearInterval(timer)
      timer = null
      if (name) tag = name
      const list = frames
      frames = []
      for (let i = 0; i < list.length; i++) await post(tag + '/' + String(i).padStart(3, '0'), list[i], 'frames')
      return list.length
    },
    /** 한 장을 docs/img/<name>.jpg 로 */
    async still(name) {
      // 합성 캔버스에서 바로 JPEG 로 (가려진 탭에서는 Image.decode 가 끝나지 않았다)
      grab()
      frames.pop()
      return post(name, off.toDataURL('image/jpeg', 0.9))
    },
  }
})()
