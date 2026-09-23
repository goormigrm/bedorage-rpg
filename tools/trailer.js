// 소개 영상 (2026-09-23 사용자: "공지글에 들어갈 webm — 1분 정도 주요 장면, 자막 · 효과를 넣은 게임 소개 영상").
// 개발 서버에서 방을 만들고(봇 채우기 켬) 판을 시작해 마을에 선 뒤:
//   const t = await import('/bedorage-rpg/tools/trailer.js'); await t.start()   → docs/img/trailer.webm (POST /__save)
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
let log = []
let vt = 0 // 가상 시각 (ms)
let vid = 0 // 영상에 넣은 장 수
let holding = false
/** 공지용 메인 사진: 이 장에서 자막 없이 뜬다 (docs/img/<이름>.jpg) */
let snap = null
const saves = []
const now = () => vt
const vidSec = () => vid / FPS
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
  g.filter = 'brightness(1.35) contrast(1.06)'
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
  vg.addColorStop(1, 'rgba(0,0,0,0.55)')
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
      g.fillText(ov.title.text, W / 2, H / 2 - 40 + rise)
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
    g.fillText('배도라지RPG', W / 2, H / 2 - 110)
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
  // 제목 (마을 위 — 걷는다)
  at(0, () => {
    cue('calm')
    zoomTo(1.12, 1.0, 6000)
    fadeTo(0, 1200)
    ov.title = { text: '배도라지RPG', sub: '종소리에 끌려 떨어진 오리들의 쿼터뷰 슈팅 RPG', at: now() }
    key('KeyD', true)
  })
  at(2.3, () => {
    key('KeyD', false)
    key('KeyS', true)
  })
  at(1.5, () => {
    key('KeyS', false)
    ov.title.out = now()
  })
  // 마을
  at(0.4, () => {
    caption('마을에서 시작하는 이어진 세계', '촌장의 퀘스트 · 상인 · 대장장이 벼리기 · 보관함 — 성문을 나서면 들판')
    zoomTo(1.0, 1.06, 5000)
    key('KeyA', true)
  })
  at(2.0, () => {
    key('KeyA', false)
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
    spawn([0, 0, 1, 2], 36, 5, 12)
  })
  // 괴물 떼
  at(1.2, () => {
    holding = false
    cue('hot')
    fadeTo(0, 450)
    zoomTo(1.0, 1.08, 11000)
    caption('몰려드는 실사 괴물 떼', '구울 · 해골 궁수 · 부푼 시체 … 막마다 다른 괴물과 정예 · 우두머리')
  })
  const horde = t
  every(horde + 1.4, horde + 11, 1.4, () => alive() < 26 && spawn([0, 1, 0, 2], 14, 7, 12))
  A.push({ t: horde + 4.2, fn: () => (snap = 'shot_fight') })
  at(11, () => {
    caption('캐릭터마다 스킬 · 궁극기', '배도라지 크루 12명 — 탱커 · 딜러 · 힐러, 최대 4명이 함께')
    flash(0.35)
  })
  const skills = t
  every(skills + 1.2, skills + 8, 1.2, () => alive() < 22 && spawn([0, 1, 2], 14, 6, 11))
  // 치지직 — 채팅 말풍선 · 응원 후원 · 후원으로 막 보스 (시청자 투표는 2026-09-23 뺐다)
  at(8, () => {
    caption('치지직 방송 연동', '채팅은 괴물 말풍선으로 · 후원은 게임 속 이벤트로 · "!응원" 후원은 우리 편을 돕는다')
    for (let i = 0; i < 4; i++) M.stream.fakeChat()
  })
  every(t + 0.3, t + 6.5, 0.35, () => M.stream.fakeChat())
  // 1만 원 !응원 = 함성 (쓰러진 동료 일으키기 · 모두 회복 · 공격 속도)
  at(1.6, () => M.stream.fakeCheer(10000))
  // 5만 원 = 막 보스 (1막 들판이라 도살자)
  at(3.2, () => M.stream.fakeDonation(50000))
  every(t + 0.6, t + 4, 0.9, () => M.stream.fakeChat())
  at(1.8, () => cue('boss'))
  // 막 보스 — 정해진 패턴 (2026-09-23 보스 패턴: 예고 범위가 차오르면 터진다 · 최대 체력 % 피해)
  at(1.0, () => {
    caption('막 보스는 정해진 패턴으로', '빨간 예고 범위를 피하라 — 보스 공격은 최대 체력의 %, 탱커도 똑같이 아프다')
    zoomTo(1.0, 1.06, 6500)
    // 후원으로 불린 도살자는 화면 밖에 나타날 수 있다 — 카메라 앞(4~6칸)에 다시 세운다
    for (const m of st().monsters) if (m.kind === 3) m.hp = 0
    spawn([3], 1, 4, 6)
    bossPat(3, 1) // 회전 베기
  })
  at(1.7, () => bossPat(3, 0)) // 돌진
  at(2.0, () => bossPat(3, 2)) // 갈고리
  at(2.2, () => {
    holding = true
    for (const m of st().monsters) m.hp = 0
    spawn([15], 1, 4, 5)
    spawn([14, 14], 2, 6, 9)
    // 체력 60% — 첫 틱에 분노(그림자 · 지옥불이 차례에 들어온다)
    const lord = st().monsters.find((m) => m.kind === 15 && m.hp > 0)
    if (lord) lord.hp = Math.round(lord.maxHp * 0.6)
  })
  at(1.2, () => {
    holding = false
    cue('rage')
    flash(0.9)
    caption('최종 보스 — 심연의 군주', '심연 광선 · 지옥불 · 불비 — 체력이 줄면 분노해 패턴이 늘어난다')
    zoomTo(1.0, 1.1, 6000)
    bossPat(15, 4) // 심연 광선
  })
  at(1.8, () => bossPat(15, 3)) // 지옥불 (가까이 → 곧 멀리)
  A.push({ t: t + 0.9, fn: () => (snap = 'shot_boss') })
  at(2.1, () => bossPat(15, 1)) // 불비
  // 전리품
  at(2.0, () => {
    holding = true
    for (const m of st().monsters) m.hp = 0
    dropLoot()
  })
  at(0.5, () => {
    holding = false
    cue('win')
    flash(0.6)
    caption('나만의 전리품', '마법 · 희귀 · 전설 · 신화 — 강화하고, 모아서 벼리고, 창고에 쌓는다')
    zoomTo(1.05, 1.12, 8000)
  })
  // 끝
  at(7.5, () => {
    ov.cap = null
    spawn([0, 1], 10, 7, 11)
    ov.end = { at: now() }
  })
  at(6.2, () => fadeTo(1, 1400))
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
    monsters: s.monsters.map((m) => ({ hp: m.hp, st: m.st, kind: m.kind, maxHp: m.maxHp })),
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
  bgm.gain.value = 0.2
  bgm.connect(master)
  const noise = off.createBuffer(1, rate, rate)
  const d = noise.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  const sx = Object.assign(Object.create(Object.getPrototypeOf(live)), live)
  Object.assign(sx, { ctx: proxy, master, bgmGain: bgm, noise, mutedFlag: false, busRef: new WeakMap(), live: 0, tokens: 36, tokenAt: 0, bgmTimer: 0, bgmOn: false, bgmNextBeat: 0.15, bgmBeatIndex: 0, boss: 0, intensity: 0 })

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
  const pn = performance.now
  for (const c of sfxCues) {
    fakeT = c.t
    performance.now = () => c.t * 1000
    try {
      if (c.donate !== undefined) sx.donate(c.donate)
      else sx.onEvents(c.ev, c.st, c.lp)
    } catch (e) {
      log.push('소리 ' + e)
    }
  }
  performance.now = pn
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
    stream: (await import(performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes('/src/game/stream.ts')).sort((a, b) => b.length - a.length)[0] ?? '/bedorage-rpg/src/game/stream.ts')).stream,
  }
  out = document.createElement('canvas')
  out.width = W
  out.height = H
  g = out.getContext('2d')
  await document.fonts?.ready
  const chunks = []
  const ve = new VideoEncoder({
    output: (c) => {
      const b = new Uint8Array(c.byteLength)
      c.copyTo(b)
      chunks.push({ data: b, ts: c.timestamp, key: c.type === 'key' })
    },
    error: (e) => log.push('영상 인코더 ' + e),
  })
  ve.configure({ codec: 'vp8', width: W, height: H, bitrate: 14_000_000, framerate: FPS })

  // 가상 시계 — 게임 · 렌더러 · HUD 가 모두 이 시각을 본다
  const sess = S()
  const realNow = performance.now.bind(performance)
  vt = realNow()
  const t0 = vt
  performance.now = () => vt
  sess.ticker.stop()
  sess.lastTick = vt
  sess.last = vt
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
  const acts = scenes()
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
  const file = muxWebM({ width: W, height: H, video: chunks, audio: au.chunks, opusHead: au.head, durationMs: dur * 1000 })
  const res = await fetch('/__save?name=trailer&ext=webm', { method: 'POST', body: file })
  log.push('저장 ' + (await res.text()))
  log.push('사진 ' + (await Promise.all(saves)).join(' · '))
  running = false
  return log
}

export const status = () => ({ running, vid, sec: +vidSec().toFixed(1), log })
