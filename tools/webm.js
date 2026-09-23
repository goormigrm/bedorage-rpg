// 아주 작은 WebM 묶개 (2026-09-23 — 소개 영상). WebCodecs 로 인코딩한 VP8 영상 조각 · Opus 소리 조각을 한 파일로.
// 외부 라이브러리 없이: EBML 머리 · Segment(SeekHead · Info · Tracks · Cluster… · Cues). 크기는 모두 8바이트 vint 로 적는다(규격 안).
// muxWebM({ width, height, video: [{data, ts(µs), key}], audio: [{data, ts(µs)}], opusHead?, durationMs }) → Uint8Array

const enc = new TextEncoder()

function idBytes(id) {
  const out = []
  let v = id
  while (v > 0) {
    out.unshift(v & 0xff)
    v = Math.floor(v / 256)
  }
  return out
}
function size8(n) {
  const b = new Uint8Array(8)
  b[0] = 0x01
  let v = n
  for (let i = 7; i >= 1; i--) {
    b[i] = v & 0xff
    v = Math.floor(v / 256)
  }
  return b
}
function concat(parts) {
  let len = 0
  for (const p of parts) len += p.length
  const out = new Uint8Array(len)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
function el(id, payload) {
  const body = payload instanceof Uint8Array ? payload : concat(payload)
  return concat([new Uint8Array(idBytes(id)), size8(body.length), body])
}
function uint(id, v, bytes = 0) {
  const b = []
  let x = v
  do {
    b.unshift(x & 0xff)
    x = Math.floor(x / 256)
  } while (x > 0)
  while (b.length < bytes) b.unshift(0)
  return el(id, new Uint8Array(b))
}
function float(id, v) {
  const b = new Uint8Array(8)
  new DataView(b.buffer).setFloat64(0, v)
  return el(id, b)
}
const str = (id, s) => el(id, enc.encode(s))
const bin = (id, b) => el(id, b)

function simpleBlock(track, rel, key, data) {
  const h = new Uint8Array(4)
  h[0] = 0x80 | track
  new DataView(h.buffer).setInt16(1, rel)
  h[3] = key ? 0x80 : 0
  return el(0xa3, concat([h, data]))
}

export function opusHead(channels = 2, preSkip = 312, rate = 48000) {
  const b = new Uint8Array(19)
  b.set(enc.encode('OpusHead'), 0)
  const v = new DataView(b.buffer)
  b[8] = 1
  b[9] = channels
  v.setUint16(10, preSkip, true)
  v.setUint32(12, rate, true)
  v.setInt16(16, 0, true)
  b[18] = 0
  return b
}

export function muxWebM({ width, height, video, audio = [], opusHead: head, channels = 2, rate = 48000, durationMs }) {
  const ebml = el(0x1a45dfa3, [
    uint(0x4286, 1), uint(0x42f7, 1), uint(0x42f2, 4), uint(0x42f3, 8), str(0x4282, 'webm'), uint(0x4287, 2), uint(0x4285, 2),
  ])
  const info = el(0x1549a966, [uint(0x2ad7b1, 1000000), float(0x4489, durationMs), str(0x4d80, 'bedorage-rpg tools/webm.js'), str(0x5741, 'bedorage-rpg trailer')])
  const vTrack = el(0xae, [
    uint(0xd7, 1), uint(0x73c5, 1), uint(0x83, 1), uint(0x9c, 0), str(0x86, 'V_VP8'),
    el(0xe0, [uint(0xb0, width), uint(0xba, height)]),
  ])
  const tracks = [vTrack]
  if (audio.length) {
    const h = head ?? opusHead(channels, 312, rate)
    const preSkip = new DataView(h.buffer, h.byteOffset).getUint16(10, true)
    tracks.push(
      el(0xae, [
        uint(0xd7, 2), uint(0x73c5, 2), uint(0x83, 2), uint(0x9c, 0), str(0x86, 'A_OPUS'), bin(0x63a2, h),
        uint(0x56aa, Math.round((preSkip / rate) * 1e9)), uint(0x56bb, 80000000),
        el(0xe1, [float(0xb5, rate), uint(0x9f, channels)]),
      ]),
    )
  }
  const tracksEl = el(0x1654ae6b, tracks)

  // 클러스터: 영상 열쇠 장면마다 새로. 그 사이의 소리 조각을 시간 순으로 끼운다
  const blocks = [
    ...video.map((c) => ({ t: c.ts / 1000, track: 1, key: c.key, data: c.data })),
    ...audio.map((c) => ({ t: c.ts / 1000, track: 2, key: true, data: c.data })),
  ].sort((a, b) => a.t - b.t || a.track - b.track)
  const clusters = []
  let cur = null
  for (const b of blocks) {
    const tms = Math.round(b.t)
    if (!cur || (b.track === 1 && b.key) || tms - cur.t > 30000) {
      cur = { t: tms, parts: [], key: b.track === 1 && b.key }
      clusters.push(cur)
    }
    cur.parts.push(simpleBlock(b.track, tms - cur.t, b.key, b.data))
  }
  const clusterEls = clusters.map((c) => el(0x1f43b675, [uint(0xe7, c.t), ...c.parts]))

  // 자리 계산: SeekHead(고정 크기) · Info · Tracks · Cluster… · Cues
  const seekEntry = (id, pos) => el(0x4dbb, [bin(0x53ab, new Uint8Array(idBytes(id))), uint(0x53ac, pos, 8)])
  const seekLen = el(0x114d9b74, [seekEntry(0x1549a966, 0), seekEntry(0x1654ae6b, 0), seekEntry(0x1c53bb6b, 0)]).length
  const infoPos = seekLen
  const tracksPos = infoPos + info.length
  let pos = tracksPos + tracksEl.length
  const cuePoints = []
  clusterEls.forEach((c, i) => {
    if (clusters[i].key) cuePoints.push(el(0xbb, [uint(0xb3, clusters[i].t), el(0xb7, [uint(0xf7, 1), uint(0xf1, pos, 8)])]))
    pos += c.length
  })
  const cuesPos = pos
  const cues = el(0x1c53bb6b, cuePoints)
  const seekHead = el(0x114d9b74, [seekEntry(0x1549a966, infoPos), seekEntry(0x1654ae6b, tracksPos), seekEntry(0x1c53bb6b, cuesPos)])
  const segment = el(0x18538067, [seekHead, info, tracksEl, ...clusterEls, cues])
  return concat([ebml, segment])
}
