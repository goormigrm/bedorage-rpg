// 소개 영상 (2026-09-23 사용자: "공지글에 들어갈 webm — 1분 정도 주요 장면, 자막 · 효과를 넣은 게임 소개 영상").
// 미리보기 창 크기를 **1920×1080** 으로 흉내 낸 뒤(1080 · HUD 작게로 그대로 담는다 — start 가 창 크기를 확인해 log 에 적는다)
// 개발 서버(?shot=1)의 **로비**(캐릭터 고르는 화면)에서 부른다 — 모닥불 장면을 담은 뒤 스스로 방을 만들어(봇 채우기) 판을 연다:
//   const t = await import('/bedorage-rpg/tools/trailer.js'); await t.start()   → docs/img/trailer.webm (게시판용 40 MB 안) · trailer_hq.webm (고화질) (POST /__save)
//   보스 목소리 영상: tools/bossvoice.ps1 로 대사 WAV 를 만든 뒤 t.start({ mode: 'ult' })   → boss_voice.webm · boss_voice_hq.webm (로비에서 불러도 된다)
//   t.status()  → 진행 상황
//
// **오프라인으로 그린다**: 실시간으로 녹화하면 미리보기 창이 가려져 있을 때 페이지가 1초에 한 번꼴로만 돌아 영상이
// 초당 4장으로 끊겼다. 그래서 시계(performance.now)를 가상으로 돌려 게임을 1/30초씩 직접 진행하고, 장마다
// 게임 화면(3D + HUD 캔버스)을 1920×1080 에 합쳐 제목 · 자막 · 전환(검은 화면 · 섬광) · 천천히 다가가기를 그린 뒤
// WebCodecs(VP8)로 인코딩한다. 준비하는 동안(지역 넘어가기 · 보스 세우기)은 영상에 넣지 않는다(hold).
// 소리: 그 사이 게임이 낸 소리 이벤트를 모아 두었다가 OfflineAudioContext 에서 같은 시각에 다시 울리고, 배경음
// (던전곡 → 교전 → 보스곡 → 성남 → 승리음)을 장면에 맞춰 깐 뒤 Opus 로 인코딩해 webm.js 로 묶는다.

import { muxWebM, opusHead } from './webm.js'

const W = 1920
const H = 1080
const FPS = 30
const T = 32

const S = () => window.__session
const st = () => window.__bd.state()

let out = null
let g = null
let running = false
/** 보스 목소리 영상인가 (start({ mode: 'ult' })) */
let ULT = false
let log = []
let vt = 0 // 가상 시각 (ms)
let vid = 0 // 영상에 넣은 장 수
let holding = false
/** 공지용 메인 사진: 이 장에서 자막 없이 뜬다 (docs/img/<이름>.jpg) */
let snap = null
const saves = []
const now = () => vt
const vidSec = () => vid / FPS
/** 영상의 봇 셋 (나는 철면란) */
const BOT_CHARS = ['chim', 'dangun', 'magic']
/** 거대한 보스 장면은 카메라를 뒤로 (온몸이 화면에 들어오게) */
const GIANT_ZOOM = 1.3

/** 글을 가운데에 쓴다 — 게임 이름이면 '알'만 노른자 빛으로 (2026-09-24 사용자: "캐릭터가 계란이니까 '알'을 강조해서 다른 색으로") */
function drawName(g, text, cx, cy) {
  const i = text.indexOf('알PG')
  if (i < 0) {
    g.fillText(text, cx, cy)
    return
  }
  const parts = [text.slice(0, i), '알', text.slice(i + 1)]
  const ws = parts.map((p) => g.measureText(p).width)
  let x = cx - (ws[0] + ws[1] + ws[2]) / 2
  g.save()
  g.textAlign = 'left'
  parts.forEach((p, k) => {
    if (k === 1) {
      g.save()
      const grd = g.createLinearGradient(0, cy - 70, 0, cy + 60)
      grd.addColorStop(0, '#fff6c2')
      grd.addColorStop(0.32, '#ffc61a')
      grd.addColorStop(0.66, '#ff8a00')
      grd.addColorStop(1, '#ff5400')
      g.fillStyle = grd
      g.shadowColor = 'rgba(255,100,0,0.95)'
      g.shadowBlur = 46
      g.fillText(p, x, cy)
      g.restore()
    } else g.fillText(p, x, cy)
    x += ws[k]
  })
  g.restore()
}
/** 덧그리는 것 */
const ov = { title: null, cap: null, fade: { a: 1, from: 1, to: 1, at: 0, dur: 1 }, flash: { a: 0, at: 0 }, zoom: { from: 1, to: 1, at: 0, dur: 1 }, end: null }
/** 소리 단서 (영상 초) */
let music = []
let sfxCues = []
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))

function fadeTo(to, dur) {
  ov.fade = { a: ov.fade.a, from: ov.fade.a, to, at: now(), dur }
}
function zoomTo(from, to, dur) {
  ov.zoom = { from, to, at: now(), dur }
}
function flash(a) {
  ov.flash = { a, at: now() }
}
function caption(text, sub) {
  ov.cap = { text, sub, at: now() }
}
const cue = (kind) => music.push({ t: vidSec(), kind })

// ---------- 그리기 ----------
function drawGame() {
  const cvs = [...document.querySelectorAll('.game-stage canvas')].filter((c) => c.width > 0)
  if (!cvs.length) return
  const z = ov.zoom
  const k = z.from + (z.to - z.from) * ease((now() - z.at) / z.dur)
  const cw = cvs[0].width
  const ch = cvs[0].height
  const s = Math.max(W / cw, H / ch) * k
  const dw = cw * s
  const dh = ch * s
  // 3D 는 조금 밝게 (밤 들판 · 던전이 영상으로는 너무 어두웠다) · 천천히 다가가기는 3D 만 (HUD 가 잘리지 않게)
  // 2026-09-24 사용자: "트레일러가 실제로 플레이하는 것보다 어둡다" → 1.35 → 1.6 · 가장자리 어둡게 0.55 → 0.32
  g.filter = 'brightness(1.6) contrast(1.04)'
  g.drawImage(cvs[0], (W - dw) / 2, (H - dh) / 2, dw, dh)
  g.filter = 'none'
  for (const c of cvs.slice(1)) {
    const s1 = Math.max(W / c.width, H / c.height)
    g.drawImage(c, (W - c.width * s1) / 2, (H - c.height * s1) / 2, c.width * s1, c.height * s1)
  }
}

function drawOverlay() {
  const t = now()
  const vg = g.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, W * 0.72)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(0,0,0,0.32)')
  g.fillStyle = vg
  g.fillRect(0, 0, W, H)

  if (ov.title) {
    const a = ease((t - ov.title.at) / 900) * (ov.title.out ? 1 - ease((t - ov.title.out) / 700) : 1)
    if (a > 0) {
      g.save()
      g.globalAlpha = a * 0.62
      g.fillStyle = '#050403'
      g.fillRect(0, 0, W, H)
      g.globalAlpha = a
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      const rise = (1 - ease((t - ov.title.at) / 1200)) * 30
      g.shadowColor = 'rgba(255,150,60,0.55)'
      g.shadowBlur = 40
      g.fillStyle = '#f1d58a'
      g.font = '800 150px "Nanum Myeongjo", serif'
      drawName(g, ov.title.text, W / 2, H / 2 - 40 + rise)
      g.shadowBlur = 0
      g.fillStyle = 'rgba(241,213,138,0.85)'
      g.fillRect(W / 2 - 260, H / 2 + 62 + rise, 520, 2)
      g.font = '600 42px "IBM Plex Sans KR", sans-serif'
      g.fillStyle = '#e8dcc0'
      g.fillText(ov.title.sub, W / 2, H / 2 + 118 + rise)
      g.restore()
    }
  }

  if (ov.cap) {
    const a = ease((t - ov.cap.at) / 450)
    if (a > 0) {
      g.save()
      g.globalAlpha = a
      const band = g.createLinearGradient(0, H - 300, 0, H)
      band.addColorStop(0, 'rgba(0,0,0,0)')
      band.addColorStop(0.45, 'rgba(0,0,0,0.62)')
      band.addColorStop(1, 'rgba(0,0,0,0.8)')
      g.fillStyle = band
      g.fillRect(0, H - 300, W, 300)
      const dx = (1 - a) * -60
      g.textAlign = 'left'
      g.textBaseline = 'alphabetic'
      g.fillStyle = '#c9a24a'
      g.fillRect(150 + dx, H - 190, 6, 118)
      g.shadowColor = 'rgba(0,0,0,0.9)'
      g.shadowBlur = 12
      g.fillStyle = '#f1d58a'
      g.font = '800 68px "Nanum Myeongjo", serif'
      g.fillText(ov.cap.text, 184 + dx, H - 118)
      if (ov.cap.sub) {
        g.fillStyle = '#e6e0d4'
        g.font = '500 34px "IBM Plex Sans KR", sans-serif'
        g.fillText(ov.cap.sub, 186 + dx, H - 66)
      }
      g.restore()
    }
  }

  if (ov.end) {
    const a = ease((t - ov.end.at) / 900)
    g.save()
    g.globalAlpha = a * 0.78
    g.fillStyle = '#050403'
    g.fillRect(0, 0, W, H)
    g.globalAlpha = a
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.shadowColor = 'rgba(255,150,60,0.5)'
    g.shadowBlur = 36
    g.fillStyle = '#f1d58a'
    g.font = '800 132px "Nanum Myeongjo", serif'
    drawName(g, '배도라지 알PG', W / 2, H / 2 - 110)
    g.shadowBlur = 0
    g.font = '600 40px "IBM Plex Sans KR", sans-serif'
    g.fillStyle = '#e8dcc0'
    g.fillText('설치 없이 브라우저에서 · 최대 4인 협동 · 무료', W / 2, H / 2 + 10)
    g.font = '700 46px "IBM Plex Sans KR", sans-serif'
    g.fillStyle = '#ffd86a'
    g.fillText('goormigrm.github.io/bedorage-rpg', W / 2, H / 2 + 100)
    g.font = '600 32px "IBM Plex Sans KR", sans-serif'
    g.fillStyle = '#b8a67e'
    g.fillText('오픈 베타 — 의견은 게시글 댓글로', W / 2, H / 2 + 175)
    g.restore()
  }

  // 섬광은 시간으로 옅어진다
  const fl = ov.flash.a * Math.exp(-(t - ov.flash.at) / 170)
  if (fl > 0.01) {
    g.fillStyle = `rgba(255,244,220,${fl.toFixed(3)})`
    g.fillRect(0, 0, W, H)
  }
  const f = ov.fade
  f.a = f.from + (f.to - f.from) * ease((t - f.at) / f.dur)
  if (f.a > 0.001) {
    g.fillStyle = `rgba(0,0,0,${f.a.toFixed(3)})`
    g.fillRect(0, 0, W, H)
  }
}

// ---------- 게임 조작 ----------
let M = {}
/** 영상 동안 파티는 죽지 않는다 — 괴물 공격력을 0 으로 (한 프레임에 2틱을 도는데 체력만 채우면 그 사이에 쓰러졌다) */
function god() {
  const s = st()
  for (const p of s.players) {
    p.hp = p.maxHp
    p.downed = false
    // 보스 공격은 ‰ 라 괴물 공격력 0 으로는 못 막는다 — 맞으면 갈고리에 끌려가거나 돌진에 밀려 카메라가 튄다(2026-09-24 "버벅거리는 장면").
    // 보스 공격 쿨다운을 늘 걸어 두면 예고 · 폭발은 그대로 보이고 사람만 안 맞는다 (무적은 황금 보호막이 떠서 안 쓴다)
    p.bossCd = 999
  }
  for (const m of s.monsters) m.pow = 0
}
function key(code, down) {
  window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { key: code.replace('Key', '').toLowerCase(), code, bubbles: true }))
}
function openSpot() {
  const map = window.__bd.map()
  const p = st().players[0]
  let best = null
  let bd = 1e18
  for (let ty = 6; ty < map.h - 6; ty++) {
    for (let tx = 6; tx < map.w - 6; tx++) {
      let ok = true
      for (let dy = -5; dy <= 5 && ok; dy++) for (let dx = -5; dx <= 5 && ok; dx++) if (map.tiles[(ty + dy) * map.w + tx + dx] !== 0) ok = false
      if (!ok) continue
      const x = tx * T + 16
      const y = ty * T + 16
      const d = (x - p.x) ** 2 + (y - p.y) ** 2
      if (d < bd) {
        bd = d
        best = { x, y }
      }
    }
  }
  return best
}
function spawn(kinds, n, r0 = 4, r1 = 11) {
  const s = st()
  const map = window.__bd.map()
  const p = s.players[0]
  let made = 0
  for (let i = 0; made < n && i < n * 40; i++) {
    const a = Math.random() * Math.PI * 2
    const d = (r0 + Math.random() * (r1 - r0)) * T
    const x = p.x + Math.cos(a) * d
    const y = p.y + Math.sin(a) * d
    const tx = Math.floor(x / T)
    const ty = Math.floor(y / T)
    if (tx < 1 || ty < 1 || tx >= map.w - 1 || ty >= map.h - 1 || map.tiles[ty * map.w + tx] !== 0) continue
    const m = M.dungeon.makeMonster(s, kinds[made % kinds.length], x, y, 1, 1.2, 60, 3)
    m.st = 1
    m.target = 0
    s.monsters.push(m)
    made++
  }
}
const alive = () => st().monsters.filter((m) => m.hp > 0).length
/**
 * 막 보스에게 지금 곧 이 차례(phase)의 패턴을 쓰게 한다 (영상 길이 안에 패턴 여럿을 보이려고 — 2026-09-24).
 * 패턴 차례는 monsters.ts BOSS_PLANS.order[단계] 의 번호
 */
function bossPat(kind, phase) {
  const b = st().monsters.find((m) => m.hp > 0 && m.kind === kind)
  if (!b) return
  if (b.st !== 1) {
    b.st = 1
    b.mode = 0
    b.pat = -1
  }
  b.target = 0
  b.los = 1
  b.scd = 0
  b.phase = phase
}
/**
 * 매 장: 멀어진 AI 동료를 주인공 쪽으로 조금씩 당긴다 (2026-09-24 사용자: "영상에서 철면란 소리만 크게 들린다 — 총소리도 잘 섞이게
 * 다른 캐릭터들도 배치"). 소리는 듣는 사람(주인공)에게서 멀수록 작아져, 흩어진 봇의 총소리가 묻혔다. 4.5 칸 밖이면 틱마다 2.5px
 */
function pullBots() {
  const s = st()
  const p = s.players[0]
  for (const q of s.players) {
    if (q === p || !q.alive || q.left || q.area !== p.area) continue
    const dx = p.x - q.x
    const dy = p.y - q.y
    const d = Math.hypot(dx, dy)
    const keep = (q.cameo ? 5.5 : 4.5) * T
    if (d <= keep || d > 30 * T) continue
    const k = Math.min(2.5, d - keep) / d
    const map = window.__bd.map()
    const nx = q.x + dx * k
    const ny = q.y + dy * k
    const tx = Math.floor(nx / T)
    const ty = Math.floor(ny / T)
    if (map.tiles[ty * map.w + tx] !== 0) continue
    q.x = nx
    q.y = ny
  }
}

function gatherBots() {
  const s = st()
  const p = s.players[0]
  s.players.forEach((q, i) => {
    if (i === 0) return
    q.x = p.x + Math.cos(i * 2.1) * 70
    q.y = p.y + Math.sin(i * 2.1) * 70
  })
}
function toExit() {
  const s = st()
  const l = M.world.areaLayout(s.curArea, window.__bd.map())
  const e = l.exits[0]
  s.players[0].x = e.x
  s.players[0].y = e.y
}
function dropLoot() {
  const s = st()
  const p = s.players[0]
  const rng = M.rng.makeRng(99)
  const rar = [4, 3, 3, 2, 2, 1, 3, 4, 2, 1]
  rar.forEach((r, i) => {
    const it = M.items.rollItem(rng, 900000 + i, 12, p.weapon, 'boss', 0, r)
    it.rarity = r
    const a = (i / rar.length) * Math.PI * 2
    const d = 60 + (i % 3) * 30
    s.drops.push({ id: 800000 + i, owner: 0, x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, item: it, gold: 0, pot: 0, ttl: 99999, lock: 0 })
  })
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2
    s.drops.push({ id: 800100 + i, owner: 0, x: p.x + Math.cos(a) * 120, y: p.y + Math.sin(a) * 120, item: null, gold: 40 + i * 10, pot: 0, ttl: 99999, lock: 0 })
  }
}

/** 장면 넘김: 검게 닫고(0.35초) → 바꾸고 → 검은 데서 연다 (2026-09-24 사용자: "설명이 넘어갈 때 fade in/out 을 섞어서 장면 전환") */
function cut(at, fn, dur = 0.4) {
  at(0, () => fadeTo(1, dur * 900))
  at(dur, () => {
    fn()
    fadeTo(0, 520)
  })
}

/** 파티 넷을 한 지역으로 옮긴다 (보스 방 — 걸어가지 않고) */
function warpParty(area) {
  const s = st()
  for (let i = 0; i < s.players.length; i++) M.sim.warpPlayer(s, S().mapOf, i, area)
}

/**
 * 보스 결투장에 파티를 세우고 보스를 깨운다: 보스에게서 dist 떨어진 결투장 안쪽 (입구 쪽).
 * 부하 · 떼는 치운다 (보스만 보이게). **즉사기는 영상에 넣지 않는다** — 스포일러 (2026-09-24 사용자)
 */
function faceBoss(kind, dist) {
  const s = st()
  const a = window.__bd.map().arena
  const b = s.monsters.find((m) => m.kind === kind && m.hp > 0)
  if (!b || !a) return
  for (const m of s.monsters) if (m !== b) m.hp = 0
  // 카메라 쪽(화면 아래 — 남동)에 선다: 거대한 보스가 파티 뒤(화면 위)로 온몸이 보이고, 보스 몸에 파티가 가려지지 않는다 (2026-09-24 — 보스 4배)
  const p = s.players[0]
  p.x = b.x + Math.SQRT1_2 * dist
  p.y = b.y + Math.SQRT1_2 * dist
  gatherBots()
  b.st = 1
  b.target = 0
  b.los = 1
  b.scd = 40
  b.kcd = 1e9
  // 보스는 먼저 맞기 전에는 움직이지 않는다(2026-09-24) — 영상은 곧장 싸움이 되게 맞은 것으로
  b.hitTick = s.tick
}

/** 정예 무리: 금빛 이름표 · 접두 능력 (빠름 · 폭발 · 분열 · 흡혈 · 단단함) */
function elites() {
  const s = st()
  const map = window.__bd.map()
  const p = s.players[0]
  const bits = [2 | 8, 4 | 32, 16 | 2, 8 | 4]
  for (let k = 0; k < bits.length; k++) {
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2
      const d = (6 + Math.random() * 3) * T
      const x = p.x + Math.cos(a) * d
      const y = p.y + Math.sin(a) * d
      const tx = Math.floor(x / T)
      const ty = Math.floor(y / T)
      if (tx < 1 || ty < 1 || tx >= map.w - 1 || ty >= map.h - 1 || map.tiles[ty * map.w + tx] !== 0) continue
      const m = M.dungeon.makeMonster(s, [0, 2, 1, 0][k], x, y, 50 + k, 4, 60, 3)
      m.elite = 1 | bits[k]
      m.st = 1
      m.target = 0
      s.monsters.push(m)
      break
    }
  }
}

/**
 * 마지막: 크루 12명이 함께 (2026-09-24 사용자: "마지막에 멈춰 서 있는 건 의미도 재미도 없다 — 12 캐릭터 모두 등장해서 보스를 공격").
 * 판에 없는 여덟을 영상용 손님(addCameo — 정원 밖 · sim 안의 봇)으로 더하고, 군주 하나를 새로 세워 둘러싼다.
 * 군주는 "부른 보스"(sum)로 — 쓰러져도 엔딩 · 퀘스트로 치지 않는다. 쓰러지면 전리품이 쏟아진다
 */
function finale() {
  const s = st()
  const map = window.__bd.map()
  const a = map.arena
  for (const m of s.monsters) m.hp = 0
  const cx = a ? a.x : s.players[0].x
  const cy = a ? a.y : s.players[0].y
  const have = new Set(s.players.map((q) => q.char))
  for (const id of M.chars.PLAYABLE) if (!have.has(id)) M.sim.addCameo(s, id, 0, cx, cy)
  const lord = M.dungeon.makeMonster(s, 15, cx, cy, 777, 3, 60, 30)
  lord.st = 1
  lord.target = 0
  lord.los = 1
  lord.scd = 30
  lord.kcd = 1e9
  lord.sum = 99
  lord.sumBy = -1
  s.monsters.push(lord)
  // 둘레에 고르게 (결투장 안)
  const n = s.players.length
  s.players.forEach((q, i) => {
    const ang = (i / n) * Math.PI * 2 + 0.4
    const r = (4.2 + (i % 2) * 1.3) * T
    q.x = cx + Math.cos(ang) * r
    q.y = cy + Math.sin(ang) * r
    q.alive = true
    q.downed = false
    q.hp = q.maxHp
  })
}

/** 보스 즉사기를 지금 쓰게 한다 (대사 · 화면 경고 — 봇은 피한다) */
function bossUlt(kind) {
  const b = st().monsters.find((m) => m.kind === kind && m.hp > 0)
  if (!b) return
  b.kcd = 0
  b.scd = 0
  b.st = 1
  b.mode = 0
  b.pat = -1
  b.target = 0
  b.los = 1
  b.hitTick = st().tick
}

/**
 * 보스 목소리 영상 (2026-09-24 사용자: "TTS 는 트레일러에 담지 말고 별도의 동영상으로 4개의 보스에 대해서 모두"):
 * 보스 방 넷을 차례로 — 들어서서 보스를 깨우고 곧장 즉사기(대사 말풍선 · 붉은 경고 · 대사 목소리) → 파티가 피한다 → 다음 보스.
 * 목소리는 renderAudio 가 즉사기 순간(bossUlt 단서)에 WAV 로 섞는다
 */
function ultScenes() {
  const A = []
  let t = 0
  const at = (dt, fn) => {
    t += dt
    A.push({ t, fn })
  }
  const BOSSES = [
    [9, 3, '1막 도살자', '도살의 시간 — 멀리 달아나라'],
    [18, 8, '2막 거미 여왕', '죽음의 거미줄 — 여왕 곁으로'],
    [27, 12, '3막 관리인', '처형 — 등 뒤로'],
    [34, 15, '최종 보스 — 심연의 군주', '심연의 심판 — 빛나는 원 안으로'],
  ]
  at(0, () => {
    holding = true
    S().autopilot = true
    cue('boss')
  })
  BOSSES.forEach(([area, kind, name, sub], i) => {
    at(i === 0 ? 0.2 : 0, () => {
      if (i > 0) fadeTo(1, 380)
    })
    at(i === 0 ? 0 : 0.42, () => {
      holding = true
      ov.cap = null
      for (const m of st().monsters) m.hp = 0
      warpParty(area)
      window.__bd.zoom(GIANT_ZOOM)
    })
    at(1.2, () => faceBoss(kind, 190))
    at(0.35, () => {
      holding = false
      fadeTo(0, 520)
      if (i === 0) ov.title = { text: '막 보스 즉사기', sub: '보스가 대사를 외치면 — 경고를 보고 피하라', at: now() }
      caption(name, sub)
      zoomTo(1.0, 1.06, 6500)
      if (kind === 15) {
        cue('rage')
        const lord = st().monsters.find((m) => m.kind === 15 && m.hp > 0)
        if (lord) lord.hp = Math.round(lord.maxHp * 0.6)
      }
    })
    if (i === 0) A.push({ t: t + 2.2, fn: () => (ov.title.out = now()) })
    at(i === 0 ? 2.6 : 0.8, () => bossUlt(kind))
    at(4.6, () => {})
  })
  at(0.6, () => fadeTo(1, 1200))
  at(1.4, null)
  return A.sort((a, b) => a.t - b.t)
}

// ---------- 장면 (게임 시각 초 — 준비 중(hold)에는 게임은 흐르고 영상은 멈춘다) ----------
function scenes() {
  const A = []
  let t = 0
  const at = (dt, fn) => {
    t += dt
    A.push({ t, fn })
  }
  const every = (from, to, step, fn) => {
    for (let x = from; x < to; x += step) A.push({ t: x, fn })
  }
  // 마을 (고르는 화면 다음 — 짧게)
  at(0, () => {
    fadeTo(0, 700)
    caption('마을에서 떠나는 이어진 세계', '촌장 퀘스트 · 상인 · 대장장이 · 도박꾼 · 보관함 · 용병')
    zoomTo(1.06, 1.0, 4000)
    key('KeyD', true)
  })
  at(1.6, () => {
    key('KeyD', false)
    key('KeyW', true)
    snap = 'shot_town'
  })
  at(1.6, () => {
    key('KeyW', false)
    fadeTo(1, 350)
  })
  // 들판으로 (준비하는 동안 영상 멈춤)
  at(0.4, () => {
    holding = true
    ov.cap = null
    toExit()
    key('KeyF', true)
  })
  at(0.15, () => key('KeyF', false))
  at(1.0, () => {
    if (st().curArea === 0) {
      toExit()
      key('KeyF', true)
    }
  })
  at(0.15, () => key('KeyF', false))
  at(1.0, () => {
    S().autopilot = true
    const spot = openSpot()
    if (spot) {
      st().players[0].x = spot.x
      st().players[0].y = spot.y
    }
    gatherBots()
    // 초반 설명은 화려하게 (2026-09-24 사용자: "몬스터를 더 왕창 · AI 들을 주변에 배치") — 떼 60
    spawn([0, 0, 1, 2], 60, 4, 12)
  })
  // 괴물 떼
  at(1.2, () => {
    holding = false
    cue('hot')
    fadeTo(0, 450)
    zoomTo(1.0, 1.08, 10000)
    caption('몰려드는 실사 괴물 떼', '막마다 다른 괴물 16종 — 잠든 무리는 총소리에 깬다')
  })
  const horde = t
  every(horde + 1.0, horde + 10, 1.0, () => alive() < 55 && spawn([0, 1, 0, 2], 22, 6, 12))
  A.push({ t: horde + 4.2, fn: () => (snap = 'shot_fight') })
  // 스킬
  at(9.6, () => {})
  cut(at, () => {
    gatherBots()
    caption('캐릭터마다 스킬 둘 · 궁극기', '탱커 · 딜러 · 힐러 — 스킬을 쓰면 이름을 외치고, 초록 말풍선은 "이쪽으로 모여"')
    spawn([0, 1, 2], 30, 5, 11)
  })
  const skills = t
  every(skills + 0.6, skills + 8, 1.0, () => alive() < 50 && spawn([0, 1, 2], 20, 6, 11))
  // 정예
  at(8.2, () => {})
  cut(at, () => {
    gatherBots()
    caption('정예 · 접두 능력', '금빛 이름표 — 빠름 · 단단함 · 폭발 · 분열 · 흡혈')
    elites()
    spawn([0, 0, 2], 24, 6, 11)
  })
  at(6.5, () => {})
  // 치지직 — 채팅 말풍선 · !응원(아군 괴물) · 후원 이벤트(좀비 떼 · 정예 무리)
  cut(at, () => {
    gatherBots()
    caption('치지직 방송 연동', '시청자 채팅은 괴물 머리 위 말풍선으로')
    for (let i = 0; i < 4; i++) M.stream.fakeChat(false)
    spawn([0, 1, 2], 30, 6, 11)
  })
  every(t + 0.3, t + 16, 0.4, () => M.stream.fakeChat(false))
  every(t + 1, t + 16, 1.2, () => alive() < 40 && spawn([0, 1, 2], 14, 6, 11))
  at(3.2, () => {
    caption('후원 글에 !응원 입력', '괴롭히는 대신 돕는다 — 아군 괴물 · 회복 구슬 · 공격 강화')
    M.stream.fakeCheer(10000)
  })
  at(5.5, () => {
    caption('후원 금액마다 이벤트', '좀비 떼 · 암흑 · 정예 무리 · 중간보스 · 막 보스 — 보낸 사람 이름표')
    M.stream.fakeDonation(1000)
  })
  at(1.6, () => M.stream.fakeDonation(5000))
  at(4.6, () => {})
  // ---- 막 보스 넷 — 저마다의 보스 방으로 (패턴 몇 개만 — 즉사기는 스포일러라 넣지 않는다)
  const boss = (area, kind, dist, capText, capSub, pats, stay, extra) => {
    at(0, () => fadeTo(1, 380))
    at(0.42, () => {
      holding = true
      ov.cap = null
      for (const m of st().monsters) m.hp = 0
      warpParty(area)
      window.__bd.zoom(GIANT_ZOOM)
    })
    at(1.2, () => faceBoss(kind, dist))
    at(0.35, () => {
      holding = false
      fadeTo(0, 520)
      caption(capText, capSub)
      // 보스가 나오면 대사 한마디 (즉사기는 쓰지 않는다 — 목소리만)
      sfxCues.push({ t: vidSec() + 0.45, line: kind })
      zoomTo(1.0, 1.05, stay * 1000)
      if (extra) extra()
    })
    for (const [dt, ph] of pats) A.push({ t: t + dt, fn: () => bossPat(kind, ph) })
    at(stay, () => {})
  }
  at(0, () => cue('boss'))
  boss(9, 3, 180, '막 보스 넷 — 저마다의 보스 방', '1막 도살자 — 돌진 · 회전 베기 · 갈고리', [[0.3, 1], [2.1, 2], [4.0, 0]], 5.4)
  boss(18, 8, 190, '2막 거미 여왕', '거미줄 부채 · 도약 · 새끼 부르기 · 독 안개', [[0.3, 0], [1.9, 1], [3.6, 3]], 5.4)
  boss(27, 12, 190, '3막 관리인', '충격파 십자 · 내려찍기 · 방패병', [[0.3, 2], [2.3, 1]], 4.6)
  boss(34, 15, 210, '최종 보스 — 심연의 군주', '체력이 줄면 분노 — 광선 · 지옥불 · 그림자', [[0.3, 4], [2.4, 3]], 4.8, () => {
    cue('rage')
    const lord = st().monsters.find((m) => m.kind === 15 && m.hp > 0)
    if (lord) lord.hp = Math.round(lord.maxHp * 0.6)
  })
  A.push({ t: t - 2.0, fn: () => (snap = 'shot_boss') })
  // ---- 마지막: 크루 12명이 함께 군주를 — 쓰러지면 전리품이 쏟아진다
  cut(at, () => {
    finale()
    window.__bd.zoom(1.4)
    caption('배도라지 크루 12명', '탱커 · 딜러 · 힐러 — 혼자부터 최대 4명, 빈 자리는 봇')
  })
  const fin = t
  A.push({ t: fin + 0.8, fn: () => bossPat(15, 4) })
  A.push({ t: fin + 3.2, fn: () => bossPat(15, 3) })
  A.push({ t: fin + 5.4, fn: () => bossPat(15, 0) })
  // 7.5초에 쓰러지게 (12명의 화력은 봇마다 달라 체력으로 맞추지 않는다 — 조금 남겨 두면 다음 한 대에 쓰러진다)
  A.push({
    t: fin + 7.5,
    fn: () => {
      const lord = st().monsters.find((m) => m.kind === 15 && m.hp > 0)
      if (lord) lord.hp = Math.min(lord.hp, 40)
    },
  })
  // 쓰러지면 떨어지는 것은 판의 확률대로(대개 마법) — 영상에는 등급마다 하나씩 더 보인다(마법 · 희귀 · 전설 · 신화 기둥)
  A.push({ t: fin + 7.9, fn: () => dropLoot() })
  at(8.3, () => {
    cue('win')
    caption('나만의 전리품', '마법 · 희귀 · 전설 · 신화 — 강화 · 벼리기 · 보관함 · 사람마다 따로')
  })
  // 끝 카드는 싸움 위에 (멈춰 선 화면이 아니라)
  at(4.2, () => {
    ov.cap = null
    ov.end = { at: now() }
    spawn([0, 1, 2], 24, 5, 10)
  })
  at(5.4, () => fadeTo(1, 1400))
  at(1.6, null)
  return A.sort((a, b) => a.t - b.t)
}

// ---------- 소리 (오프라인) ----------
function liteState(s) {
  return {
    phase: s.phase,
    phaseTimer: s.phaseTimer,
    mode: s.mode,
    players: s.players.map((p) => ({ x: p.x, y: p.y, alive: p.alive, weapon: p.weapon, char: p.char })),
    // x · y — 곁의 괴물 옆 소리(sfx ambientVoice)가 가까운 괴물을 고른다
    monsters: s.monsters.map((m) => ({ hp: m.hp, st: m.st, kind: m.kind, maxHp: m.maxHp, x: m.x, y: m.y })),
  }
}

async function renderAudio(durSec) {
  const live = S().sfx
  const rate = 48000
  const off = new OfflineAudioContext(2, Math.ceil(rate * durSec), rate)
  let fakeT = 0
  const proxy = new Proxy(off, {
    get(tg, k) {
      if (k === 'currentTime') return fakeT
      if (k === 'state') return 'running'
      const v = Reflect.get(tg, k)
      return typeof v === 'function' ? v.bind(tg) : v
    },
  })
  const master = off.createGain()
  master.gain.value = 0.8
  const comp = off.createDynamicsCompressor()
  comp.threshold.value = -14
  comp.knee.value = 18
  comp.ratio.value = 6
  comp.attack.value = 0.003
  comp.release.value = 0.16
  master.connect(comp)
  comp.connect(off.destination)
  const bgm = off.createGain()
  // 배경음 (2026-09-24 사용자: "효과음만 있으니 허전하다 — 어둡고 무서운 배경음"): 효과음 1,500여 개 사이에서 들리게 0.2 → 0.5 (약 +8dB)
  bgm.gain.value = 0.5
  bgm.connect(master)
  const noise = off.createBuffer(1, rate, rate)
  const d = noise.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  const sx = Object.assign(Object.create(Object.getPrototypeOf(live)), live)
  Object.assign(sx, { ctx: proxy, master, bgmGain: bgm, noise, mutedFlag: false, busRef: new WeakMap(), live: 0, tokens: 36, tokenAt: 0, bgmTimer: 0, bgmOn: false, bgmNextBeat: 0.15, bgmBeatIndex: 0, boss: 0, intensity: 0, lineBufs: new Map(), lineLoading: new Set(), verbIr: null, loadLine: () => {} })
  // 되풀이 제한의 시각(last… · kindVoice · nextIdle)을 비운다 — 살아 있는 게임에서 복사한 **실제 시각**(수십만 ms)이 그대로면
  // 가상 시각(0 부터)과 비교해 늘 "방금 냈다"가 되어 괴물 소리 · 맞는 소리 · 폭발 … 이 영상 내내 하나도 나지 않았다 (2026-09-24 사용자:
  // "trailer_hq 에서는 왜 몬스터 잡는데 몬스터 소리가 안 들려?")
  for (const k of Object.keys(sx)) if (/^last[A-Z]/.test(k) && k !== 'lastCountdownSec' && typeof sx[k] === 'number') sx[k] = -1e9
  sx.kindVoice = new Map()
  sx.nextIdle = 0
  sx.dropped = 0
  // 동시에 울리는 소리 수(live): 오프라인에서는 끝났다는 알림(onended)이 렌더링 때에야 와서 **줄지 않고 쌓이기만** 했다 —
  // 56 을 넘은 뒤로는 남(봇 · 괴물)의 소리가 모두 빠졌다. 소리마다 가상 시각으로 끝(0.45초 뒤)을 적어 두고 단서마다 센다
  const ends = []
  const fin0 = sx.finish
  sx.finish = function (src, chain, bus, counted) {
    fin0.call(this, src, chain, bus, false)
    if (counted) {
      ends.push(fakeT + 0.45)
      this.live = ends.length
    }
  }
  // 계측: 괴물 소리가 실제로 몇 번 났나
  let voiced = 0
  let asked = 0
  const voice0 = sx.voice
  sx.voice = function (...a) {
    asked++
    const lv = this.lastVoice
    const lb = this.lastBossRoar
    voice0.apply(this, a)
    if (this.lastVoice !== lv || this.lastBossRoar !== lb) voiced++
  }

  // 배경음: 단서 사이마다 이어서 깐다
  const segs = music.map((m, i) => ({ ...m, to: music[i + 1]?.t ?? durSec }))
  for (const s of segs) {
    if (s.kind === 'win') {
      fakeT = s.t
      sx.bossWin()
    }
    sx.boss = s.kind === 'boss' ? 1 : s.kind === 'rage' ? 2 : 0
    sx.intensity = s.kind === 'hot' || s.kind === 'boss' || s.kind === 'rage' ? 1 : s.kind === 'win' ? 0.4 : 0
    fakeT = Math.max(0, s.to - 0.4)
    if (sx.boss) sx.scheduleBoss(proxy)
    else sx.scheduleDark(proxy)
  }
  // 효과음: 모은 이벤트를 그 시각에 (소리 되풀이 제한도 가상 시각으로)
  // 배경음 음표는 구간 끝 시각으로 미리 깔려 끝 목록의 차례를 흐트러뜨렸다(앞이 늦은 시각이라 하나도 안 빠져 live 가 수백) — 비우고 센다
  ends.length = 0
  sx.live = 0
  const pn = performance.now
  for (const c of sfxCues) {
    fakeT = c.t
    performance.now = () => c.t * 1000
    while (ends.length && ends[0] <= c.t) ends.shift()
    sx.live = ends.length
    try {
      if (c.donate !== undefined) sx.donate(c.donate)
      else if (c.line === undefined) sx.onEvents(c.ev, c.st, c.lp)
    } catch (e) {
      log.push('소리 ' + e)
    }
  }
  performance.now = pn
  const monEv = sfxCues.reduce((n, c) => n + (c.ev ?? []).filter((e) => e.type === 'mdeath' || e.type === 'wake' || e.type === 'windup').length, 0)
  log.push(`괴물 소리 ${voiced}번 / 부름 ${asked} (괴물 깸 · 공격 · 쓰러짐 단서 ${monEv}) · 빠진 소리 ${sx.dropped ?? 0}`)
  // 보스 대사 — 게임과 **같은 가공**(sfx.bossLine — 음 내리기 · 겹치기 · 메아리 · 긴 잔향)으로.
  // 보스 목소리 영상은 즉사기 순간에, 소개 영상은 보스가 나올 때(2026-09-24 사용자: "즉사기는 쓰지 않지만 보스 나왔을 때 각 보스의
  // 대사 일부분이 들리도록" — lineCue). 소리 파일은 게임이 싣는 것(public/voice — tools/bossvoice.ps1)
  {
    let n = 0
    for (const k of [3, 8, 12, 15]) {
      try {
        const res = await fetch(`/bedorage-rpg/voice/boss_${k}.wav?${Date.now()}`)
        if (res.ok) sx.lineBufs.set(k, await off.decodeAudioData(await res.arrayBuffer()))
      } catch (e) {
        log.push(`목소리 ${k} ` + e)
      }
    }
    for (const c of sfxCues) {
      if (c.line !== undefined) {
        fakeT = c.t
        if (sx.bossLine(c.line)) n++
      }
      for (const e of ULT ? c.ev ?? [] : []) {
        if (e.type !== 'bossUlt') continue
        fakeT = c.t + 0.1
        if (sx.bossLine(e.kind)) n++
      }
    }
    log.push(`보스 목소리 ${n}번 (소리 파일 ${sx.lineBufs.size}개)`)
  }
  // 끝에서 옅어진다
  master.gain.setValueAtTime(0.8, Math.max(0, durSec - 1.8))
  master.gain.linearRampToValueAtTime(0, durSec)
  return off.startRendering()
}

async function encodeAudio(buf) {
  const chunks = []
  let head = null
  const ae = new AudioEncoder({
    output: (c, meta) => {
      const b = new Uint8Array(c.byteLength)
      c.copyTo(b)
      chunks.push({ data: b, ts: c.timestamp })
      if (!head && meta?.decoderConfig?.description) head = new Uint8Array(meta.decoderConfig.description)
    },
    error: (e) => log.push('소리 인코더 ' + e),
  })
  ae.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 })
  const L = buf.getChannelData(0)
  const R = buf.getChannelData(1)
  for (let o = 0; o < L.length; o += 48000) {
    const n = Math.min(48000, L.length - o)
    const data = new Float32Array(n * 2)
    data.set(L.subarray(o, o + n), 0)
    data.set(R.subarray(o, o + n), n)
    ae.encode(new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((o / 48000) * 1e6), data }))
  }
  await ae.flush()
  ae.close()
  const ok = head && head.length >= 19 && new TextDecoder().decode(head.subarray(0, 8)) === 'OpusHead'
  return { chunks, head: ok ? head : opusHead() }
}

// ---------- 녹화 ----------
/** 진단: 영상 없이 첫 sec 초를 돌며 장면별 상태를 모은다 (까만 장면 찾기) */
let diag = null
// ---------- 여는 장면: 캐릭터 고르는 화면 (2026-09-24 사용자: "처음에 마을에서 시작하지 말고, 12 캐릭터 고르는 화면부터") ----------
/**
 * 로비의 모닥불 장면(3D — 발판 위의 12명)을 화면 가득 담아, 한 사람씩 불 앞으로 나오게 하며 이름 · 역할 · 무기를 자막으로.
 * 마지막은 철면란(주인공). 영상에 담은 뒤 방을 만들어(봇 채우기) 판을 연다 — 그동안은 영상에 넣지 않는다.
 * 돌려주는 값: 담았나 (로비가 아니면 false — 이미 판 안에서 부르면 예전처럼 마을부터)
 */
async function lobbyPhase(ve) {
  const L = window.__lobby
  const bf = L?.bonfire
  const cv = document.querySelector('#bonfire')
  if (!bf || !cv) return false
  M.chars = await sameModule('/src/core/characters.ts')
  M.weapons = await sameModule('/src/core/weapons.ts')
  const { CHARACTERS, PLAYABLE, ROLE_INFO } = M.chars
  const { WEAPONS } = M.weapons
  // 무대를 화면 가득 (오른쪽 패널 · 아래 카드 자리를 비우지 않는다 — 영상에는 캔버스만 담는다)
  // 발판 무대는 위쪽 3/4 에 — 불 앞으로 걸어 나온 사람(카메라 쪽)이 아래에서 잘리지 않게
  bf.frame = () => ({ x0: cv.clientWidth * 0.03, x1: cv.clientWidth * 0.97, y0: cv.clientHeight * 0.01, y1: cv.clientHeight * 0.8 })
  bf.renderer.setPixelRatio(1)
  bf.resize()
  const realNow = performance.now.bind(performance)
  vt = realNow()
  performance.now = () => vt
  bf.last = vt
  Object.assign(ov, { title: null, cap: null, end: null, fade: { a: 1, from: 1, to: 1, at: vt, dur: 1 }, flash: { a: 0, at: 0 }, zoom: { from: 1, to: 1, at: vt, dur: 1 } })
  // 넷만 눌러 본다 (2026-09-24 사용자: "12개를 모두 클릭할 필요는 없다 — 침착란 · 단군란 · 매직란 · 철면란만")
  const order = ['chim', 'dangun', 'magic', 'cheolmyeon'].filter((id) => PLAYABLE.includes(id))
  bf.select(null)
  const A = []
  const at = (t, fn) => A.push({ t, fn })
  at(0, () => {
    cue('calm')
    fadeTo(0, 1200)
    zoomTo(1.1, 1.0, 5000)
    ov.title = { text: '배도라지 알PG', sub: '계란이 된 배도라지 크루의 쿼터뷰 슈팅 RPG', at: now() }
  })
  at(3.3, () => (ov.title.out = now()))
  at(4.0, () => caption('배도라지 크루 12명', '탱커 3 · 딜러 6 · 힐러 3 — 누구로 떠날까'))
  // 한 사람 1.4초 — 0.72초로는 불 앞에 다 나오기 전에 다음 사람으로 넘어갔다
  const STEP = 1.4
  order.forEach((id, i) => {
    at(5.2 + i * STEP, () => {
      const c = CHARACTERS[id]
      bf.select(id)
      caption(c.name, `${ROLE_INFO[c.role].name} · ${WEAPONS[c.weapon].name}`)
    })
  })
  const end = 5.2 + order.length * STEP + 0.9
  at(end - 0.6, () => fadeTo(1, 500))
  const t0 = vt
  let ai = 0
  for (let i = 0; i < FPS * 30; i++) {
    vt += 1000 / FPS
    const sec = (vt - t0) / 1000
    while (ai < A.length && A[ai].t <= sec) A[ai++].fn()
    if (sec > end) break
    bf.loop()
    cancelAnimationFrame(bf.raf)
    g.fillStyle = '#000'
    g.fillRect(0, 0, W, H)
    const z = ov.zoom
    const k = z.from + (z.to - z.from) * ease((now() - z.at) / z.dur)
    const s = Math.max(W / cv.width, H / cv.height) * k
    g.filter = 'brightness(1.3)'
    g.drawImage(cv, (W - cv.width * s) / 2, (H - cv.height * s) / 2, cv.width * s, cv.height * s)
    g.filter = 'none'
    drawOverlay()
    const vf = new VideoFrame(out, { timestamp: Math.round((vid * 1e6) / FPS), duration: Math.round(1e6 / FPS) })
    ve.encode(vf, { keyFrame: vid % (FPS * 2) === 0 })
    vf.close()
    vid++
    if (ve.encodeQueueSize > 8) await ve.flush()
  }
  performance.now = realNow
  ov.cap = null
  ov.title = null
  log.push(`로비 ${vidSec().toFixed(1)}초 (캔버스 ${cv.width}×${cv.height})`)
  return true
}

/** 로비에서 방을 만들고(봇 채우기) 판을 연다 — 진짜 시간으로 기다린다 (영상에는 넣지 않는다) */
async function startGameFromLobby() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const btn = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t)
  window.__lobby?.selectChar?.('cheolmyeon')
  // 파티: 나 철면란(탱커) · 딜러 침착란 · 단군란 · 힐러 매직란 (2026-09-24 사용자)
  if (window.__lobby) window.__lobby.botChars = BOT_CHARS
  btn('게임 만들기')?.click()
  await sleep(700)
  btn('만들기')?.click()
  await sleep(1600)
  const cb = document.querySelector('input[type=checkbox]')
  if (cb && !cb.checked) cb.click()
  await sleep(900)
  btn('▶ 게임 시작')?.click()
  for (let k = 0; k < 160 && !(window.__session && window.__bd?.phase?.() === 'playing'); k++) await sleep(250)
  // 마을 준비 (셰이더 · 바닥 · 모델)
  await sleep(4500)
  log.push('판 ' + (window.__bd?.phase?.() ?? '없음'))
}

/** 개발 서버는 고친 파일을 ?t= 꼬리표가 붙은 주소로 준다 — 게임이 쓰는 그 사본을 불러야 판에 닿는다 */
async function sameModule(path) {
  const url = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes(path)).sort((a, b) => b.length - a.length)[0]
  return import(url ?? '/bedorage-rpg' + path)
}

export async function start(opts = {}) {
  if (running) return 'already'
  running = true
  log = []
  music = []
  sfxCues = []
  vid = 0
  holding = false
  snap = null
  saves.length = 0
  M = {
    dungeon: await import('/bedorage-rpg/src/core/dungeon.ts'),
    world: await import('/bedorage-rpg/src/core/world.ts'),
    items: await import('/bedorage-rpg/src/core/items.ts'),
    rng: await import('/bedorage-rpg/src/core/rng.ts'),
    // 개발 서버는 고친 파일을 ?t= 꼬리표가 붙은 주소로 준다 — 게임이 쓰는 그 사본을 불러야 시험 후원이 판에 닿는다
    stream: (await sameModule('/src/game/stream.ts')).stream,
    // 보스 방으로 옮기기(warpPlayer)는 게임이 쓰는 sim 사본이어야 한다 (모듈 안 상태 — 묶인 지역 · 소환 대기열)
    sim: await sameModule('/src/core/sim.ts'),
    chars: await sameModule('/src/core/characters.ts'),
  }
  out = document.createElement('canvas')
  out.width = W
  out.height = H
  g = out.getContext('2d')
  await document.fonts?.ready
  // 영상은 **두 벌**을 한 번에 뜬다 (2026-09-24 사용자: "화질 괜찮은 버전도 만들고, 낮춘 버전으로 해서 2개를 항상"):
  //  trailer.webm    — 게시판용(파일당 40 MB): 720 후보 셋 중 **38 MB 안에서 가장 큰 것**.
  //                    VP8 은 비트레이트를 지키지 못한다 — 2초마다 키 프레임(1080 한 장 수백 KB)과 파티클 많은 화면이 바닥을 올려
  //                    1.9 · 2.4 Mbps 가 1분 37초에 44.5 · 45.9 MB 였다 → 키 프레임 8초마다 · 720 후보를 더해 뜬 뒤에 크기로 고른다
  //  trailer_hq.webm — 고화질: 1080 · 가변 16 Mbps · 키 2초 (크기는 상관없다)
  // 같은 장을 인코더 넷에 넣는다 — 게임을 한 번만 돌린다. 소리는 한 번 만들어 모두에 붙인다
  const LOW_MAX = 38_000_000
  // 영상 종류: 소개 영상(trailer) · 보스 목소리(boss_voice — 즉사기 넷 + 대사 목소리, TTS 는 소개 영상에 넣지 않는다)
  ULT = opts.mode === 'ult'
  const BASE = ULT ? 'boss_voice' : 'trailer'
  const encs = [
    // 2026-09-24 계측(1분 37초): 1080 2.2 Mbps → 42.5 MB(넘침) · 720 2.2 → 28.6 · 720 1.5 → 22.9 — 1080 은 게시판에 못 맞춘다 → 720 셋
    { name: BASE, w: 1280, h: 720, bitrate: opts.bitrate ?? 3_000_000, mode: 'constant', low: true, key: FPS * 8, chunks: [] },
    { name: BASE, w: 1280, h: 720, bitrate: 2_200_000, mode: 'constant', low: true, key: FPS * 8, chunks: [] },
    { name: BASE, w: 1280, h: 720, bitrate: 1_500_000, mode: 'constant', low: true, key: FPS * 8, chunks: [] },
    { name: BASE + '_hq', w: W, h: H, bitrate: opts.hqBitrate ?? 16_000_000, mode: 'variable', low: false, key: FPS * 2, chunks: [] },
  ]
  // 720 후보에 넣을 작은 장
  const small = document.createElement('canvas')
  small.width = 1280
  small.height = 720
  const sg = small.getContext('2d')
  for (const e of encs) {
    e.enc = new VideoEncoder({
      output: (c) => {
        const b = new Uint8Array(c.byteLength)
        c.copyTo(b)
        e.chunks.push({ data: b, ts: c.timestamp, key: c.type === 'key' })
      },
      error: (err) => log.push(`영상 인코더(${e.name}) ` + err),
    })
    e.enc.configure({ codec: 'vp8', width: e.w, height: e.h, bitrate: e.bitrate, bitrateMode: e.mode, framerate: FPS })
    e.n = 0
  }
  // 인코더 하나처럼 쓴다 (로비 장면 · 게임 장면이 같은 것을 부른다). 키 프레임은 인코더마다 제 간격으로
  const ve = {
    encode: (vf) => {
      let sf = null
      for (const e of encs) {
        const keyFrame = e.n++ % e.key === 0
        if (e.w === W) {
          e.enc.encode(vf, { keyFrame })
          continue
        }
        if (!sf) {
          sg.drawImage(out, 0, 0, small.width, small.height)
          sf = new VideoFrame(small, { timestamp: vf.timestamp, duration: vf.duration })
        }
        e.enc.encode(sf, { keyFrame })
      }
      sf?.close()
    },
    flush: () => Promise.all(encs.map((e) => e.enc.flush())),
    get encodeQueueSize() {
      return Math.max(...encs.map((e) => e.enc.encodeQueueSize))
    },
    close: () => {
      for (const e of encs) e.enc.close()
    },
  }
  const chunks = encs[0].chunks

  // 여는 장면: 캐릭터 고르는 화면 — 로비에서 부르면 모닥불 장면을 담고 방을 만들어 판을 연다
  Object.defineProperty(window, 'devicePixelRatio', { get: () => 1, configurable: true })
  localStorage.setItem('brpg.hud', 'small')
  if (!S()) {
    if (ULT) await startGameFromLobby()
    else if (await lobbyPhase(ve)) await startGameFromLobby()
  }
  if (!S()) {
    log.push('판이 없다 — 로비나 판 안에서 부를 것')
    running = false
    return log
  }
  const sess = S()
  // 1080 게임 화면 · HUD 작게 (2026-09-24 사용자: "소개 영상에서 HUD 크기를 작게, 1080 해상도로 된 게임 화면을 캡쳐") —
  // 전에는 미리보기 창 크기(1280 안팎)로 그린 화면을 1920×1080 으로 늘려 HUD 가 크고 3D 가 흐릿했다.
  // 창(미리보기의 크기 흉내)을 1920×1080 으로 두고 · 화면 배율 1 · HUD '작게'(논리 2258×1270 을 0.85 배로 보임) · 화질 높게
  // → 3D · HUD 캔버스가 1920×1080 그대로 = 늘리지 않고 담는다
  if (innerWidth !== W || innerHeight !== H) log.push(`⚠ 창 ${innerWidth}×${innerHeight} — ${W}×${H} 여야 1080 으로 뜬다 (미리보기 창 크기를 맞출 것)`)
  sess.applyGfx('high')
  sess.fit()
  const glc0 = [...document.querySelectorAll('.game-stage canvas')].filter((c) => c.width > 0)
  log.push('캔버스 ' + glc0.map((c) => `${c.width}×${c.height}`).join(' · '))
  // 영상에 나오는 괴물의 실사 모델을 먼저 받아 굽는다 — 녹화 도중 처음 나오면 도형 모습에서 실사로 한순간 바뀌어 튀어 보였다
  // 들판 떼 · 막 보스 넷과 그 부하(새끼 거미 · 방패병 · 그림자) · 포격 악마
  const kinds = [0, 1, 2, 3, 6, 8, 9, 12, 13, 14, 15]
  sess.renderer.monsterView.prefetch(kinds)
  for (let k = 0; k < 120; k++) {
    const r = window.__bd.models()
    if (kinds.every((x) => r.ready.includes(x) || r.failed.includes(x))) break
    await new Promise((res) => setTimeout(res, 250))
  }
  log.push('모델 ' + JSON.stringify(window.__bd.models().ready))
  // 가상 시계 — 게임 · 렌더러 · HUD 가 모두 이 시각을 본다
  const realNow = performance.now.bind(performance)
  vt = realNow()
  const t0 = vt
  performance.now = () => vt
  sess.ticker.stop()
  sess.lastTick = vt
  sess.last = vt
  // 자동 줍기를 끈다 — 가방이 찬 캐릭터로 뜨면 "가방이 가득 찼습니다" 가 영상 내내 떴다 · 전리품 기둥도 바닥에 남는다
  for (const q of st().players) q.autoPick = 0
  // 영상용: 카메라를 가깝게 (캐릭터가 크게 보이게)
  sess.renderer.setDebugZoom(0.74)
  // 소리는 모아 두었다가 따로 그린다 (라이브 소리는 내지 않는다)
  const sfx = sess.sfx
  sfx.onEvents = (ev, s, lp) => {
    if (!holding && ev.length) sfxCues.push({ t: vidSec(), ev: structuredClone(ev), st: liteState(s), lp })
  }
  sfx.donate = (big) => {
    if (!holding) sfxCues.push({ t: vidSec(), donate: big })
  }
  sfx.updateSteps = () => {}
  Object.assign(ov, { title: null, cap: null, end: null, fade: { a: 1, from: 1, to: 1, at: vt, dur: 1 }, flash: { a: 0, at: 0 }, zoom: { from: 1, to: 1, at: vt, dur: 1 } })

  diag = []
  const acts = ULT ? ultScenes() : scenes()
  let ai = 0
  // WebGL 컨텍스트를 잃으면(가려진 창 · GPU 메모리) 그동안은 게임도 녹화도 멈추고 되살아나길 기다린다 — 안 그러면 까만 장면이 들어간다
  const glc = [...document.querySelectorAll('.game-stage canvas')].filter((c) => c.width > 0)[0]
  let lost = false
  let settle = 0
  const onLost = (e) => {
    e.preventDefault()
    lost = true
    log.push(`WebGL 잃음 (영상 ${vidSec().toFixed(1)}초)`)
  }
  const onBack = () => {
    lost = false
    settle = FPS
    log.push(`WebGL 되살아남 (영상 ${vidSec().toFixed(1)}초)`)
  }
  glc?.addEventListener('webglcontextlost', onLost)
  glc?.addEventListener('webglcontextrestored', onBack)
  try {
    for (let i = 0; i < FPS * 120; i++) {
      if (lost) {
        await ve.flush()
        await new Promise((r) => setTimeout(r, 250))
        i--
        continue
      }
      vt += 1000 / FPS
      const gsec = (vt - t0) / 1000
      let stop = false
      while (ai < acts.length && acts[ai].t <= gsec) {
        const a = acts[ai++]
        if (!a.fn) stop = true
        else a.fn()
      }
      if (stop) break
      god()
      if (!holding) pullBots()
      sess.tick()
      god()
      // 영상에서는 화면 흔들림 · 당김을 끈다 (2026-09-23 사용자: "치지직 장면의 화면 흔들림 — 너무 정신없다")
      sess.renderer.shake = 0
      sess.renderer.punch = 0
      sess.renderer.kick = 0
      sess.frame(vt)
      if (opts.diag && i % 10 === 0) {
        const me = st().players[0]
        const R = sess.renderer
        let pl = 0
        R.scene.traverseVisible((o) => {
          if (o.isPointLight && !o.userData.pad) pl++
        })
        const c = [...document.querySelectorAll('.game-stage canvas')].filter((x) => x.width > 0)
        const b = (cv) => {
          g.clearRect(0, 0, 64, 36)
          g.drawImage(cv, 0, 0, 64, 36)
          const d = g.getImageData(0, 0, 64, 36).data
          let sum = 0
          for (let k = 0; k < d.length; k += 4) sum += d[k] + d[k + 1] + d[k + 2]
          return Math.round((sum / (d.length / 4) / 3) * 10) / 10
        }
        diag.push({ t: +((vt - t0) / 1000).toFixed(1), area: st().curArea, alive: me.alive, x: Math.round(me.x), y: Math.round(me.y), cam: R.camera.position.toArray().map((v) => +v.toFixed(1)), pl, gl: b(c[0]), hud: b(c[1]), progs: R.gl.info.programs.length, calls: R.gl.info.render.calls, mapOpen: R.mapOpen, lost: R.gl.getContext().isContextLost() })
        if (opts.diag.shots?.includes(i)) {
          const sc = document.createElement('canvas')
          sc.width = 960
          sc.height = 540
          const sg = sc.getContext('2d')
          for (const x of c) sg.drawImage(x, 0, 0, 960, 540)
          await fetch('/__shot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'diag-' + i, data: sc.toDataURL('image/jpeg', 0.8) }) })
        }
      }
      if (opts.diag && (vt - t0) / 1000 > opts.diag.sec) break
      cancelAnimationFrame(sess.raf)
      clearTimeout(sess.raf)
      if (settle > 0) settle--
      if (!holding && settle === 0 && !opts.diag) {
        g.fillStyle = '#000'
        g.fillRect(0, 0, W, H)
        drawGame()
        if (snap) {
          const name = snap
          snap = null
          saves.push(fetch('/__shot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, dir: 'img', data: out.toDataURL('image/jpeg', 0.92) }) }).then((r) => r.text()))
        }
        drawOverlay()
        const vf = new VideoFrame(out, { timestamp: Math.round((vid * 1e6) / FPS), duration: Math.round(1e6 / FPS) })
        ve.encode(vf, { keyFrame: vid % (FPS * 2) === 0 })
        vf.close()
        vid++
      }
      // 인코더가 따라오게 가끔 기다린다 (창이 가려져 있으면 한 번에 1초쯤 걸린다)
      if (ve.encodeQueueSize > 8) await ve.flush()
    }
    await ve.flush()
    log.push(`영상 ${vid}장 (${vidSec().toFixed(1)}초) · 조각 ${chunks.length}`)
  } finally {
    glc?.removeEventListener('webglcontextlost', onLost)
    glc?.removeEventListener('webglcontextrestored', onBack)
    performance.now = realNow
    delete sfx.onEvents
    delete sfx.donate
    delete sfx.updateSteps
    sess.lastTick = realNow()
    sess.last = realNow()
    sess.renderer.setDebugZoom(1)
    sess.ticker.start()
  }
  ve.close()
  if (opts.diag) {
    running = false
    return diag
  }
  const dur = vidSec()
  const abuf = await renderAudio(dur)
  log.push(`소리 ${abuf.duration.toFixed(1)}초 · 효과음 단서 ${sfxCues.length}`)
  const au = await encodeAudio(abuf)
  const mux = (e) => muxWebM({ width: e.w, height: e.h, video: e.chunks, audio: au.chunks, opusHead: au.head, durationMs: dur * 1000 })
  // 게시판용: 38 MB 안에서 가장 큰 것 — 같은 크기대면 1080 을 먼저 (모두 넘으면 가장 작은 것)
  const lows = encs.filter((e) => e.low).map((e) => { const file = mux(e); return { e, file, size: file.byteLength ?? file.size } })
  const fit = lows.filter((x) => x.size <= LOW_MAX).sort((a, b) => b.size - a.size)[0] ?? lows.sort((a, b) => a.size - b.size)[0]
  log.push('게시판용 후보 ' + lows.map((x) => `${x.e.h}p ${(x.e.bitrate / 1e6).toFixed(1)} Mbps → ${(x.size / 1e6).toFixed(1)} MB`).join(' · '))
  for (const { e, file } of [fit, ...encs.filter((e) => !e.low).map((e) => ({ e, file: mux(e) }))]) {
    const res = await fetch(`/__save?name=${e.name}&ext=webm`, { method: 'POST', body: file })
    log.push(`저장 ${await res.text()} (${e.h}p ${(e.bitrate / 1e6).toFixed(1)} Mbps ${e.mode === 'constant' ? '고정' : '가변'})`)
  }
  log.push('사진 ' + (await Promise.all(saves)).join(' · '))
  running = false
  return log
}

export const status = () => ({ running, vid, sec: +vidSec().toFixed(1), log })

/** 확인용: 방금 뜬 영상의 소리 단서로 소리만 다시 그려 괴물 소리 계측을 본다 (영상은 다시 뜨지 않는다) */
export async function audioCheck() {
  const n0 = log.length
  const dur = sfxCues.length ? sfxCues[sfxCues.length - 1].t + 2 : 5
  const buf = await renderAudio(dur)
  return { dur: +buf.duration.toFixed(1), log: log.slice(n0), cues: sfxCues.length }
}

/** 배경음만 그려 초마다 크기(RMS · 최고)를 잰다 — 소리를 내지 않고 섞음 비율을 맞출 때 (2026-09-24) */
export async function musicTest(plan = [[0, 'calm'], [18, 'hot'], [30, 'boss'], [40, 'rage']], sec = 48) {
  music = plan.map(([t, kind]) => ({ t, kind }))
  sfxCues = []
  const buf = await renderAudio(sec)
  const L = buf.getChannelData(0)
  const out = []
  for (let s0 = 0; s0 < sec; s0 += 2) {
    let sum = 0
    let pk = 0
    const a = Math.floor(s0 * buf.sampleRate)
    const b = Math.min(L.length, Math.floor((s0 + 2) * buf.sampleRate))
    for (let i = a; i < b; i++) {
      sum += L[i] * L[i]
      pk = Math.max(pk, Math.abs(L[i]))
    }
    out.push([s0, +(20 * Math.log10(Math.sqrt(sum / (b - a)) + 1e-9)).toFixed(1), +(20 * Math.log10(pk + 1e-9)).toFixed(1)])
  }
  return out
}
