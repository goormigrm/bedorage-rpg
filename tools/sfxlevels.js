// 효과음 세기 재기 (2026-10-17 — 사용자: "녹음 효과음 세기 맞추기"). Claude 는 소리를 들을 수 없어 출력 크기를 잰다.
// 게임의 Sfx 를 잠깐 오프라인 소리판(OfflineAudioContext)에 물려, 녹음 소리가 나는 자리마다
//   녹음 소리로 그린 것 · 녹음을 빼고(받기 전처럼) 원래 합성 소리로 그린 것을 견준다 — 녹음 소리가 원래 맞춰 둔 크기에서 얼마나 벗어났나.
// 크기 = K 가중(귀 특성 흉내 — 높은 소리 +4dB · 아주 낮은 소리 깎기) 100ms 창의 가장 큰 평균 제곱(dB) · 봉우리(dBFS).
// 압축기 · 리미터 · 전체 음량 앞의 값이다(설정의 효과음 크기는 곱해진다 — 견주기에는 같은 배율).
// 개발 서버(?shot=1)의 판 안에서:  const m = await import('/bedorage-rpg/tools/sfxlevels.js'); console.table(await m.run())

const RATE = 48000
const SP = { gain: 1, pan: 0, far: 0 }

/** 판 밖 소리 상태 흉내 (onEvents 가 읽는 것만) — 듣는 사람 = (100, 100) · 투기장(보스 곡 · 옆 소리 계산을 건너뛴다) */
const fakeState = () => ({ phase: 'playing', mode: 'arena', phaseTimer: 0, monsters: [], players: [{ x: 100, y: 100, alive: true, hp: 100, maxHp: 100, team: 0 }] })
const ev = (e) => (sx) => sx.onEvents([{ x: 100, y: 100, ...e }], fakeState(), 0)

/** 녹음 소리가 나는 자리 (sfx.ts 에서 sample( 을 부르는 곳 전부) + 견줄 합성 소리 몇 */
export const CASES = {
  '발소리 돌': (sx) => ((sx.stepGrass = false), sx.foot(SP, true, true)),
  '발소리 풀': (sx) => ((sx.stepGrass = true), sx.foot(SP, true, true)),
  '근접 바이올린': (sx) => sx.meleeHit(SP, false, 'violin'),
  '근접 장검': (sx) => sx.meleeHit(SP, false, 'rapier'),
  '근접 후라이팬': (sx) => sx.meleeHit(SP, false, 'pan'),
  '내 명중(살 소리 겹)': (sx) => sx.hit(SP, false, true),
  '금화 1': (sx) => ((sx.lastCoin = 0), sx.coins(1)),
  '금화 3': (sx) => ((sx.lastCoin = 0), sx.coins(3)),
  '창 열기': (sx) => sx.ui(true),
  '창 닫기': (sx) => sx.ui(false),
  '단추(blip)': (sx) => sx.blip(),
  '줍기(주머니 겹)': ev({ type: 'pickup', p: 0, rarity: 0, uid: 0 }),
  '장비 끼기': ev({ type: 'equip', p: 0 }),
  '가방 가득': ev({ type: 'bagFull', p: 0 }),
  '항아리 깨기': ev({ type: 'objOpen', kind: 2 }),
  '상자 열기': ev({ type: 'objOpen', kind: 0 }),
  '떨굼': ev({ type: 'drop' }),
  '막기(쇠 겹)': ev({ type: 'block' }),
  '정예 보호막': (sx) => ((sx.lastClang = 0), ev({ type: 'mblock' })(sx)),
  '상자 부수기(나무 겹)': ev({ type: 'break', tx: 2, ty: 2 }),
  '보스 경직(종 겹)': ev({ type: 'stagger' }),
  '주머니만(줍기 겹)': (sx) => {
    const b = sx.bus(SP, 0.5)
    if (!sx.sample('pouch', b.node, b.t0, 2)) sx.tone(b.node, b.t0, 0.001, 'sine', 100, 100, 0.0001)
  },
  // ---- 견줄 것 (녹음 없음)
  '[견줌] 내 총 smg': (sx) => sx.gun('smg', SP, true),
  '[견줌] 내 총 rifle': (sx) => sx.gun('rifle', SP, true),
  '[견줌] 내 총 mg': (sx) => sx.gun('mg', SP, true),
  '[견줌] 처치 쿵': (sx) => sx.killThump(1),
}

/** 한 자리를 오프라인으로 그린다 (samples = false 면 받기 전처럼 합성으로) */
async function render(sx, fn, samples) {
  const off = new OfflineAudioContext(1, Math.round(RATE * 1.8), RATE)
  const proxy = new Proxy(off, {
    get(t, k) {
      if (k === 'currentTime') return 0.02
      if (k === 'state') return 'running'
      const v = Reflect.get(t, k)
      return typeof v === 'function' ? v.bind(t) : v
    },
  })
  // K 가중: 1.68 kHz 위 +4dB · 38Hz 아래 깎기 (ITU-R BS.1770 의 두 단 흉내)
  const master = off.createGain()
  const hs = off.createBiquadFilter()
  hs.type = 'highshelf'
  hs.frequency.value = 1681
  hs.gain.value = 4
  const hp = off.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 38
  hp.Q.value = 0.5
  master.connect(hs)
  hs.connect(hp)
  hp.connect(off.destination)
  const keep = { ctx: sx.ctx, master: sx.master, samples: sx.samples, muted: sx.mutedFlag, lite: sx.lite, live: sx.live, stepGrass: sx.stepGrass }
  sx.ctx = proxy
  sx.master = master
  sx.mutedFlag = false
  sx.lite = false
  sx.live = 0
  // 남의 소리 초당 한도(토큰)를 채운다 — 연달아 그리면 바닥나 소리가 빠졌다
  sx.tokens = 99
  sx.tokenAt = 0
  if (!samples) sx.samples = new Map()
  // 무작위 높이 · 변형을 고르게 (여러 번 그려 평균 — 변형마다 크기가 다르다)
  try {
    fn(sx)
  } finally {
    sx.ctx = keep.ctx
    sx.master = keep.master
    sx.samples = keep.samples
    sx.mutedFlag = keep.muted
    sx.lite = keep.lite
    sx.live = keep.live
    sx.stepGrass = keep.stepGrass
  }
  const d = (await off.startRendering()).getChannelData(0)
  let peak = 0
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]))
  const W = Math.round(RATE * 0.1)
  let sum = 0
  let best = 0
  for (let i = 0; i < d.length; i++) {
    sum += d[i] * d[i]
    if (i >= W) sum -= d[i - W] * d[i - W]
    best = Math.max(best, sum / W)
  }
  return { loud: best > 0 ? 10 * Math.log10(best) : -120, peak: peak > 0 ? 20 * Math.log10(peak) : -120 }
}

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length

/** 모든 자리를 잰다 — 자리마다 n 번 그려 평균 (녹음 변형 · 무작위 높이) */
export async function run(n = 6, names = Object.keys(CASES)) {
  const sx = window.__session?.sfx
  if (!sx || !sx.samples || sx.samples.size === 0) throw new Error('판 안에서 · 녹음 소리를 받은 뒤에 (sx.samples)')
  const rows = []
  for (const name of names) {
    const fn = CASES[name]
    const withS = []
    const synth = []
    for (let i = 0; i < n; i++) {
      withS.push(await render(sx, fn, true))
      synth.push(await render(sx, fn, false))
    }
    const ls = avg(withS.map((r) => r.loud))
    const ly = avg(synth.map((r) => r.loud))
    rows.push({ 자리: name, '녹음 크기 dB': +ls.toFixed(1), '합성 크기 dB': +ly.toFixed(1), '차이': +(ls - ly).toFixed(1), '녹음 봉우리': +avg(withS.map((r) => r.peak)).toFixed(1) })
  }
  return rows
}

/** 녹음 묶음 파일 자체의 크기 (변형끼리 고른지 — 파일 번호 차례) — 같은 K 가중 · 100ms */
export async function files() {
  const sx = window.__session?.sfx
  const out = []
  for (const [g, n] of Object.entries(sx.constructor.SAMPLE_GROUPS)) {
    const ls = []
    const list = []
    for (let i = 0; i < n; i++) {
      const a = await (await fetch(`/bedorage-rpg/sfx/${g}_${i}.ogg`)).arrayBuffer()
      list.push(await sx.ctx.decodeAudioData(a))
    }
    for (const b of list) {
      const off = new OfflineAudioContext(1, b.length + 1, b.sampleRate)
      const src = off.createBufferSource()
      src.buffer = b
      const hs = off.createBiquadFilter()
      hs.type = 'highshelf'
      hs.frequency.value = 1681
      hs.gain.value = 4
      src.connect(hs)
      hs.connect(off.destination)
      src.start()
      const d = (await off.startRendering()).getChannelData(0)
      const W = Math.round(b.sampleRate * 0.1)
      let sum = 0
      let best = 0
      for (let i = 0; i < d.length; i++) {
        sum += d[i] * d[i]
        if (i >= W) sum -= d[i - W] * d[i - W]
        best = Math.max(best, sum / W)
      }
      ls.push(+(10 * Math.log10(best)).toFixed(1))
    }
    out.push({ 묶음: g, 변형: ls.length, '크기 dB': ls.join(' · '), '길이 s': +(list[0].duration).toFixed(2) })
  }
  return out
}
