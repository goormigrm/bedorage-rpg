// 방송 화면에 뜨는 시청자 글 거르기 (2026-09-25 사용자 고른 방송 개선 3 — "금칙어 · 링크 가리기").
// 괴물 말풍선(채팅) · 후원 글 · 닉네임에 쓴다. 가릴 말은 방송인이 치지직 창에서 정한다(game/stream.ts StreamCfg.banned).
// - 가릴 말: 글자 사이에 띄어쓰기 · 숫자 · 기호를 끼워도 걸린다("시 1 발") → ○ 로
// - 주소(링크): http · www · 흔한 끝(.com · .kr · .gg …) → [링크]
// - 도배: 같은 사람이 같은 말을 30초 안에 또 · 10초에 넷 넘게 → 말풍선에서 뺀다 (후원은 빼지 않는다 — 글만 가린다)
// - 같은 글자를 길게(ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ) → 여덟 자까지

/** 가릴 말 글자 사이에 끼워도 걸리는 것 */
const GAP = "[\\s\\d._\\-~!@#$%^&*+=|/\\\\'\"`,:;?<>()\\[\\]{}·ㆍ]*"

const reCache = new Map<string, RegExp>()

function wordRe(w: string): RegExp | null {
  const chars = [...w.replace(/\s+/g, '')]
  if (chars.length === 0) return null
  const key = chars.join('')
  let re = reCache.get(key)
  if (!re) {
    re = new RegExp(chars.map((ch) => ch.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')).join(GAP), 'giu')
    reCache.set(key, re)
    if (reCache.size > 400) reCache.delete(reCache.keys().next().value as string)
  }
  return re
}

/** 주소: http(s):// · www. 로 시작 · 또는 흔한 끝(.com …)으로 끝나는 이름 */
const LINK_RE =
  /(?:https?:\/\/|www\.)\S+|[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|kr|co|io|me|gg|tv|xyz|ly|link|site|app|shop|info|to|be|cc|live|club|online|top|kro|pw)(?![a-z0-9])(?:\/\S*)?/giu

export interface FilterCfg {
  banned: string[]
  maskLinks: boolean
}

/** 가릴 말은 ○ 로, 주소는 [링크] 로 */
export function maskText(text: string, cfg: FilterCfg): string {
  let out = text
  if (cfg.maskLinks) out = out.replace(LINK_RE, '[링크]')
  // 긴 말부터 (짧은 말이 긴 말의 일부를 먼저 가려 긴 말이 안 걸리는 일이 없게)
  const words = [...cfg.banned].sort((a, b) => b.length - a.length)
  for (const w of words) {
    const re = wordRe(w)
    if (!re) continue
    re.lastIndex = 0
    const n = [...w.replace(/\s+/g, '')].length
    out = out.replace(re, '○'.repeat(Math.max(2, Math.min(4, n))))
  }
  return out
}

/** 같은 글자가 여덟 번 넘게 이어지면 여덟 번까지 (ㅋㅋㅋ… · !!!!…) */
export function squeezeRepeats(text: string): string {
  return text.replace(/(.)\1{8,}/gsu, (_m, ch: string) => ch.repeat(8))
}

/** 같은 말인지 볼 때: 띄어쓰기 · 대소문자 · 길게 늘인 것을 없앤다 */
function norm(text: string): string {
  return squeezeRepeats(text.toLowerCase().replace(/\s+/g, '')).replace(/(.)\1+/gsu, '$1')
}

/** 도배 거르기: 같은 사람의 같은 말(30초 안) · 몰아 쓰기(10초에 넷 넘게) */
export class SpamGuard {
  static readonly SAME_MS = 30_000
  static readonly BURST_MS = 10_000
  static readonly BURST_MAX = 4
  private seen = new Map<string, { texts: Map<string, number>; times: number[] }>()
  private sweepAt = 0

  /** 말풍선으로 띄워도 되나 (되면 기록한다) */
  allow(nick: string, text: string, now: number): boolean {
    if (now >= this.sweepAt) this.sweep(now)
    let r = this.seen.get(nick)
    if (!r) {
      r = { texts: new Map(), times: [] }
      this.seen.set(nick, r)
    }
    r.times = r.times.filter((t) => now - t < SpamGuard.BURST_MS)
    const key = norm(text)
    const last = r.texts.get(key)
    if (last !== undefined && now - last < SpamGuard.SAME_MS) return false
    if (r.times.length >= SpamGuard.BURST_MAX) return false
    r.times.push(now)
    r.texts.set(key, now)
    return true
  }

  private sweep(now: number): void {
    this.sweepAt = now + 30_000
    for (const [nick, r] of this.seen) {
      for (const [k, t] of r.texts) if (now - t >= SpamGuard.SAME_MS) r.texts.delete(k)
      if (r.texts.size === 0 && r.times.every((t) => now - t >= SpamGuard.BURST_MS)) this.seen.delete(nick)
    }
  }
}
