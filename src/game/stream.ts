// 방송 연동 허브 (2026-09-23 — 치지직 채팅 · 후원). 페이지가 사는 동안 하나.
// 치지직 연결(net/chzzk.ts)이 여기로 채팅 · 후원을 넣고, 게임 세션이 받아 괴물 말풍선 · 후원 이벤트로 바꾼다.
// 세션이 없을 때(로비) 온 후원은 버리지 않고 들고 있다가 다음 판이 가져간다 — 돈을 낸 후원이 사라지면 안 된다.
// 설정 창의 "시험" 단추도 이 길로 가짜 채팅 · 후원을 넣는다(치지직 없이도 방송 전에 미리 볼 수 있게).

import { CHEER_EVENTS, CheerDef, DONATE_EVENTS, DON_CAP_CHOICES, DON_CAP_DEFAULT, DonateEvent } from '../core/donate'

export type StreamStatus = 'off' | 'connecting' | 'on' | 'error'

export interface StreamChat {
  nick: string
  text: string
  /** 설정 창의 채팅 시험 (말할 괴물을 더 오래 기다리고, 못 띄우면 알린다) */
  test?: boolean
}
export interface StreamDonation {
  nick: string
  amount: number
  text: string
}

export interface StreamCfg {
  /** 채팅을 괴물 말풍선으로 */
  bubbles: boolean
  /** 왼쪽 아래 후원 이벤트 표 */
  table: boolean
  /** 이벤트마다 금액(원) — DONATE_EVENTS 순서. 0 = 끔 */
  amounts: number[]
  /** 페이지를 열면 저절로 다시 연결 (한 번 연결에 성공하면 켜진다) */
  auto: boolean
  /** 응원 단계마다 금액(원) — CHEER_EVENTS 순서. 0 = 끔 (2026-09-23 사용자: "응원도 가격에 따라서 효과를 다르게") */
  cheers: number[]
  /** 같은 방해 효과가 이어 붙는 한도(초 — DON_CAP_CHOICES). 2026-09-25 방송 개선 5 */
  stackMax: number
  /** 말풍선 · 후원 글 · 닉네임에서 가릴 말 (방송인이 정한다 — game/chatfilter.ts). 2026-09-25 방송 개선 3 */
  banned: string[]
  /** 주소(링크)를 [링크] 로 */
  maskLinks: boolean
  /** 같은 사람의 같은 말 · 몰아 쓰기를 말풍선에서 거른다 (후원은 거르지 않는다 — 글만 가린다) */
  antiSpam: boolean
  /** 채팅 "!참여" 한 시청자의 이름을 정예 · 우두머리 머리 위에 (2026-09-25 방송 개선 7) */
  named: boolean
}

/**
 * 처음 가릴 말 — 방송 화면에 그대로 뜨면 곤란한 센 욕만 (방송인이 치지직 창에서 더하고 뺀다).
 * 글자 사이에 띄어쓰기 · 숫자 · 기호를 끼워도 걸린다 (chatfilter.ts)
 */
export const DEFAULT_BANNED = ['시발', '씨발', 'ㅅㅂ', 'ㅆㅂ', '병신', 'ㅄ', 'ㅂㅅ', '개새끼', '좆', '니애미', '느금마', '애미뒤진']

const CFG_KEY = 'brpg.chzzk.cfg'
/** 예전 처음 금액 (v0.44.0 — 1만 5천이 있던 것). 저장된 금액이 이것 그대로면 손대지 않은 것이라 새 처음 금액으로 바꾼다 */
const OLD_DEFAULTS = [1000, 2000, 3000, 5000, 7000, 10000, 15000, 20000, 30000, 50000]

export function defaultStreamCfg(): StreamCfg {
  return {
    bubbles: true,
    table: true,
    amounts: DONATE_EVENTS.map((e) => e.amount),
    auto: false,
    cheers: CHEER_EVENTS.map((e) => e.amount),
    stackMax: DON_CAP_DEFAULT,
    banned: [...DEFAULT_BANNED],
    maskLinks: true,
    antiSpam: true,
    named: true,
  }
}

export function loadStreamCfg(): StreamCfg {
  const d = defaultStreamCfg()
  try {
    const v = JSON.parse(localStorage.getItem(CFG_KEY) ?? 'null') as Partial<StreamCfg> | null
    if (!v) return d
    if (Array.isArray(v.amounts) && v.amounts.length === OLD_DEFAULTS.length && v.amounts.every((a, i) => Number(a) === OLD_DEFAULTS[i])) v.amounts = d.amounts
    const amounts = DONATE_EVENTS.map((e, i) => {
      const a = Number(v.amounts?.[i])
      return Number.isFinite(a) && a >= 0 ? Math.round(a) : e.amount
    })
    const cheers = CHEER_EVENTS.map((e, i) => {
      const a = Number(v.cheers?.[i])
      return Number.isFinite(a) && a >= 0 ? Math.round(a) : e.amount
    })
    const stackMax = DON_CAP_CHOICES.includes(Number(v.stackMax)) ? Number(v.stackMax) : d.stackMax
    const banned = Array.isArray(v.banned) ? cleanBanned(v.banned) : d.banned
    return {
      bubbles: v.bubbles ?? d.bubbles,
      table: v.table ?? d.table,
      amounts,
      auto: v.auto ?? d.auto,
      cheers,
      stackMax,
      banned,
      maskLinks: v.maskLinks ?? d.maskLinks,
      antiSpam: v.antiSpam ?? d.antiSpam,
      named: v.named ?? d.named,
    }
  } catch {
    return d
  }
}

/** 가릴 말 목록 다듬기: 문자열만 · 앞뒤 공백 없이 · 같은 것 하나 · 한 말 20자 · 200개까지 */
export function cleanBanned(list: unknown[]): string[] {
  const out: string[] = []
  for (const w of list) {
    if (typeof w !== 'string') continue
    const t = w.trim().slice(0, 20)
    if (t && !out.includes(t)) out.push(t)
    if (out.length >= 200) break
  }
  return out
}

export function saveStreamCfg(c: StreamCfg): void {
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(c))
  } catch {
    /* 저장 못 해도 이번 판은 반영된다 */
  }
}

/** 이 금액이면 어떤 이벤트인가: 금액이 넘는 것 중 가장 비싼 것 (끈 것은 빼고). 없으면 undefined */
export function eventForAmount(amount: number, cfg = loadStreamCfg()): DonateEvent | undefined {
  let best: DonateEvent | undefined
  let bestAmt = -1
  DONATE_EVENTS.forEach((e, i) => {
    const a = cfg.amounts[i]
    if (a > 0 && amount >= a && a >= bestAmt) {
      best = e
      bestAmt = a
    }
  })
  return best
}

/** "!응원" 후원이면 어떤 응원인가: 금액이 넘는 단계 중 가장 비싼 것 (끈 것은 빼고). 없으면 undefined */
export function cheerForAmount(amount: number, cfg = loadStreamCfg()): CheerDef | undefined {
  let best: CheerDef | undefined
  let bestAmt = -1
  CHEER_EVENTS.forEach((e, i) => {
    const a = cfg.cheers[i]
    if (a > 0 && amount >= a && a >= bestAmt) {
      best = e
      bestAmt = a
    }
  })
  return best
}

/** 표에 보일 응원 줄: 켠 단계를 금액 순으로 */
export function cheerRows(cfg = loadStreamCfg()): { e: CheerDef; amount: number }[] {
  return CHEER_EVENTS.map((e, i) => ({ e, amount: cfg.cheers[i] }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => a.amount - b.amount)
}

/** 표에 보일 줄: 켠 이벤트를 금액 순으로 */
export function eventRows(cfg = loadStreamCfg()): { e: DonateEvent; amount: number }[] {
  return DONATE_EVENTS.map((e, i) => ({ e, amount: cfg.amounts[i] }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => a.amount - b.amount)
}

export const won = (n: number): string => `${n.toLocaleString('ko-KR')}원`

/** 채팅 "!참여" — 시청자 이름 괴물 추첨 후보가 된다 (말풍선으로는 띄우지 않는다) */
export const JOIN_RE = /^!\s*(참여|참가|join)$/i

/**
 * 시청자 이름 괴물 추첨 (2026-09-26 사용자: "참여는 무료인데 100명이 참여하면 선착순이야 추첨이야?" → 추첨으로).
 * 후보 = 최근 JOIN_TTL 안에 "!참여" 한 사람 모두(한 사람 한 번 — 다시 쓰면 시간만 새로). 이름 붙일 때마다 **무작위로 한 명**.
 * 최근 WIN_COOL 안에 당첨된 사람은 다른 후보가 있으면 뒤로 미룬다(한 사람만 거듭 뽑히지 않게). 뽑힌 사람은 후보에서 빠진다
 */
export const JOIN_TTL = 15 * 60_000
export const JOIN_MAX = 500
export const WIN_COOL = 10 * 60_000

export interface Joiner {
  nick: string
  at: number
}

/** 후보에 넣는다 (이미 있으면 시간만 새로 · 넘치면 가장 오래된 사람부터 뺀다) */
export function addJoiner(pool: Joiner[], nick: string, now: number): void {
  const had = pool.find((j) => j.nick === nick)
  if (had) {
    had.at = now
    return
  }
  pool.push({ nick, at: now })
  if (pool.length > JOIN_MAX) {
    let old = 0
    for (let i = 1; i < pool.length; i++) if (pool[i].at < pool[old].at) old = i
    pool.splice(old, 1)
  }
}

/** 한 명을 뽑아 후보에서 뺀다 (없으면 undefined). 오래된 후보 · 오래된 당첨 기록은 여기서 치운다 */
export function drawJoiner(pool: Joiner[], winners: Map<string, number>, now: number, rand: () => number = Math.random): string | undefined {
  for (let i = pool.length - 1; i >= 0; i--) if (now - pool[i].at >= JOIN_TTL) pool.splice(i, 1)
  for (const [nick, t] of winners) if (now - t >= WIN_COOL) winners.delete(nick)
  if (pool.length === 0) return undefined
  const fresh = pool.filter((j) => !winners.has(j.nick))
  const from = fresh.length > 0 ? fresh : pool
  const pick = from[Math.min(from.length - 1, Math.floor(rand() * from.length))]
  pool.splice(pool.indexOf(pick), 1)
  winners.set(pick.nick, now)
  return pick.nick
}

type Fn<T> = (v: T) => void

class StreamHub {
  status: StreamStatus = 'off'
  detail = ''
  /** 시험 단추를 눌렀나 (그러면 치지직이 없어도 표를 보여 준다) */
  tried = false
  // 받은 채팅 · 후원의 **개수 · 합계 · 목록은 모으지 않는다** (2026-09-23 사용자: "후원 합계는 수입의 전체 수준을 알 수 있으니
  // 절대 표시되지 않게 — 받은 채팅 · 후원 숫자 · 합계 내역은 나타내지 않도록"). 모으지 않으면 어디에도 샐 수 없다.
  private actFns = new Set<() => void>()
  private statusFns = new Set<Fn<StreamStatus>>()
  private chatFns = new Set<Fn<StreamChat>>()
  private donFns = new Set<Fn<StreamDonation>>()
  /** 받을 세션이 없을 때 온 후원 (다음 판이 가져간다) */
  private held: StreamDonation[] = []

  /** 표 · 말풍선을 쓸 때인가 (연결됐거나 시험 중) */
  get live(): boolean {
    return this.status === 'on' || this.status === 'connecting' || this.tried
  }

  setStatus(s: StreamStatus, detail = ''): void {
    this.status = s
    this.detail = detail
    for (const f of [...this.statusFns]) f(s)
  }

  onStatus(f: Fn<StreamStatus>): () => void {
    this.statusFns.add(f)
    return () => this.statusFns.delete(f)
  }

  /** 채팅 · 후원이 올 때마다 (상태 단추의 불이 한 번 깜빡인다 — 숫자는 없다) */
  onActivity(f: () => void): () => void {
    this.actFns.add(f)
    return () => this.actFns.delete(f)
  }

  private note(): void {
    for (const f of [...this.actFns]) f()
  }

  /** 세션이 채팅 · 후원을 받는다. 들고 있던 후원도 이때 넘긴다. 돌려주는 함수로 그만 받는다 */
  listen(chat: Fn<StreamChat>, don: Fn<StreamDonation>): () => void {
    this.chatFns.add(chat)
    this.donFns.add(don)
    const held = this.held.splice(0)
    for (const d of held) don(d)
    return () => {
      this.chatFns.delete(chat)
      this.donFns.delete(don)
    }
  }

  /** 게임(세션)이 받고 있나 — 치지직 창의 시험 단추가 "게임 안에서 보입니다" 를 알릴 때 */
  get inGame(): boolean {
    return this.chatFns.size > 0
  }

  /**
   * 게임(세션)이 넣는다: 지금 말풍선을 띄울 수 없는 까닭 (마을 · 말풍선 끔 · 화면에 괴물 없음). 띄울 수 있으면 null.
   * 채팅 시험 단추가 누르자마자 알린다 (2026-09-24 사용자: "채팅 시험이 동작하지 않아" — 괴물이 없는 곳에서 누르면
   * 8초 기다렸다 조용히 버려서, 아무 일도 안 일어난 것처럼 보였다)
   */
  sayBlock: (() => string | null) | null = null

  chat(c: StreamChat): void {
    this.note()
    for (const f of [...this.chatFns]) f(c)
  }

  donation(d: StreamDonation): void {
    this.note()
    if (this.donFns.size === 0) {
      this.held.push(d)
      if (this.held.length > 30) this.held.shift()
      return
    }
    for (const f of [...this.donFns]) f(d)
  }

  // ---- 시험 (설정 창) ----
  private samples = ['ㅋㅋㅋㅋㅋ', '뒤에 뒤에!!', '철면님 그거 아니에요', '보스 언제 나옴?', '와 방금 컨트롤 미쳤다', '살려주세요ㅠㅠ', '가즈아아아', '이거 무슨 게임이에요?', '방금 그거 맞음?', '후원 한 번 가겠습니다']
  private nicks = ['배도라지팬', '침착한시청자', '고기바이올린', '철면수심짱', '지나가던계란', '구울사냥꾼']

  /** test = 설정 창의 채팅 시험 (소개 영상은 false — "채팅 시험" 안내가 화면에 뜨지 않게) */
  fakeChat(test = true): void {
    this.tried = true
    const r = (a: string[]) => a[Math.floor(Math.random() * a.length)]
    this.chat({ nick: r(this.nicks), text: r(this.samples), test })
  }

  /** 참여 시험: 가짜 시청자가 "!참여" (이름이 겹치지 않게 번호를 붙인다) */
  fakeJoin(): void {
    this.tried = true
    const r = (a: string[]) => a[Math.floor(Math.random() * a.length)]
    this.chat({ nick: `${r(this.nicks)}${Math.floor(Math.random() * 90) + 10}`, text: '!참여', test: true })
  }

  /** 응원 시험: 그 단계 금액 + "!응원" */
  fakeCheer(amount: number): void {
    this.tried = true
    const r = (a: string[]) => a[Math.floor(Math.random() * a.length)]
    this.donation({ nick: r(this.nicks), amount, text: '힘내세요 !응원' })
  }

  fakeDonation(amount: number): void {
    this.tried = true
    const r = (a: string[]) => a[Math.floor(Math.random() * a.length)]
    this.donation({ nick: r(this.nicks), amount, text: '시험 후원입니다!' })
  }
}

export const stream = new StreamHub()
