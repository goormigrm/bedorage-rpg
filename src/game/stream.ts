// 방송 연동 허브 (2026-09-23 — 치지직 채팅 · 후원). 페이지가 사는 동안 하나.
// 치지직 연결(net/chzzk.ts)이 여기로 채팅 · 후원을 넣고, 게임 세션이 받아 괴물 말풍선 · 후원 이벤트로 바꾼다.
// 세션이 없을 때(로비) 온 후원은 버리지 않고 들고 있다가 다음 판이 가져간다 — 돈을 낸 후원이 사라지면 안 된다.
// 설정 창의 "시험" 단추도 이 길로 가짜 채팅 · 후원을 넣는다(치지직 없이도 방송 전에 미리 볼 수 있게).

import { CHEER_EVENTS, CheerDef, DONATE_EVENTS, DonateEvent } from '../core/donate'

export type StreamStatus = 'off' | 'connecting' | 'on' | 'error'

export interface StreamChat {
  nick: string
  text: string
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
}

const CFG_KEY = 'brpg.chzzk.cfg'
/** 예전 처음 금액 (v0.44.0 — 1만 5천이 있던 것). 저장된 금액이 이것 그대로면 손대지 않은 것이라 새 처음 금액으로 바꾼다 */
const OLD_DEFAULTS = [1000, 2000, 3000, 5000, 7000, 10000, 15000, 20000, 30000, 50000]

function defaults(): StreamCfg {
  return { bubbles: true, table: true, amounts: DONATE_EVENTS.map((e) => e.amount), auto: false, cheers: CHEER_EVENTS.map((e) => e.amount) }
}

export function loadStreamCfg(): StreamCfg {
  const d = defaults()
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
    return { bubbles: v.bubbles ?? d.bubbles, table: v.table ?? d.table, amounts, auto: v.auto ?? d.auto, cheers }
  } catch {
    return d
  }
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
  private nicks = ['배도라지팬', '침착한시청자', '고기바이올린', '철면수심짱', '지나가던오리', '구울사냥꾼']

  fakeChat(): void {
    this.tried = true
    const r = (a: string[]) => a[Math.floor(Math.random() * a.length)]
    this.chat({ nick: r(this.nicks), text: r(this.samples) })
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
