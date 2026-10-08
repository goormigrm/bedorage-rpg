// 영상 장면 확인 (ffmpeg 없이 — HANDOVER "영상 장면 확인"): 개발 서버 페이지에서
//   const s = await import('/bedorage-rpg/tools/sheet.js')
//   await s.sheet('trailer1_hq.webm', 'tr1-sheet', [0.5, 4, 8, ...])   → .frames/shots/tr1-sheet.jpg (네 칸씩 · 칸마다 시각)
//   await s.frame('trailer1_hq.webm', 'tr1-10s', 10.6)                 → .frames/shots/tr1-10s.jpg (1280×720 한 장)
// docs/img 의 영상을 <video> 로 열어 시각마다 캔버스에 그려 /__shot 으로 보낸다.

async function open(file) {
  const v = document.createElement('video')
  v.src = `/bedorage-rpg/docs/img/${file}?${Date.now()}`
  v.muted = true
  await new Promise((r, j) => {
    v.onloadeddata = r
    v.onerror = () => j(new Error('영상을 못 열었다: ' + file))
  })
  return v
}

async function seek(v, t) {
  v.currentTime = t
  await new Promise((r) => (v.onseeked = r))
}

async function post(name, c, q = 0.85) {
  const res = await fetch('/__shot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, data: c.toDataURL('image/jpeg', q) }) })
  return res.text()
}

export async function sheet(file, name, times, cols = 4) {
  const v = await open(file)
  const w = 480
  const h = 270
  const c = document.createElement('canvas')
  c.width = cols * w
  c.height = Math.ceil(times.length / cols) * h
  const g = c.getContext('2d')
  for (let i = 0; i < times.length; i++) {
    await seek(v, times[i])
    const x = (i % cols) * w
    const y = Math.floor(i / cols) * h
    g.drawImage(v, x, y, w, h)
    g.fillStyle = '#ff0'
    g.font = '20px sans-serif'
    g.fillText(`${times[i]}s`, x + 8, y + 24)
  }
  return [v.duration, await post(name, c)]
}

export async function frame(file, name, t) {
  const v = await open(file)
  await seek(v, t)
  const c = document.createElement('canvas')
  c.width = 1280
  c.height = 720
  c.getContext('2d').drawImage(v, 0, 0, 1280, 720)
  return post(name, c, 0.9)
}
