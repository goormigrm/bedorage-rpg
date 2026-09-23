// 텍스트 채팅 (2026-09-23 — HANDOVER "RPG 에 보통 있는데 없는 것" 1순위: 음성(B)만 있어 마이크를 못 쓰는 사람이 말할 길이 없었다).
// Enter 로 입력칸을 열고, Enter 로 보내고, Esc 로 닫는다. 방 통로(RoomLink)의 컨트롤 메시지로 문자열만 오가므로 sim · 락스텝과 무관하다.
// 대화 줄은 왼쪽에 쌓이고 몇 초 뒤 흐려진다(싸움 화면을 가리지 않게). 입력칸이 열려 있는 동안은 지난 줄이 모두 보인다.
// 대기실은 붙박이(docked): 입력칸이 늘 있고 줄이 사라지지 않는다. 대기실 대화는 게임을 시작하면 게임 안 채팅으로 이어진다.

/** 한 줄 최대 글자 수. 받는 쪽도 이만큼 자른다 (고친 클라이언트가 긴 글을 보내도 화면이 덮이지 않게) */
export const CHAT_MAX = 120
/** 보내기 간격 (도배 막기) */
const SEND_GAP_MS = 700
/** 입력칸이 닫혀 있을 때 한 줄이 보이는 시간 */
const SHOW_MS = 12000
/** 기억하는 줄 수 */
const KEEP = 40

export interface ChatLine {
  name: string
  text: string
  /** 이름 색 (나 · 동료 · 알림) */
  kind: 'me' | 'ally' | 'sys' | 'stream' | 'don'
  at: number
}

/** 받은 글을 화면에 쓸 모양으로: 줄바꿈 · 제어 문자를 공백으로, 앞뒤 공백을 떼고 길이를 자른다 */
export function cleanChat(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, CHAT_MAX)
}

export class ChatBox {
  private root: HTMLElement
  private docked: boolean
  private log: HTMLElement
  private input: HTMLInputElement
  private lines: { line: ChatLine; el: HTMLElement }[] = []
  private lastSend = 0
  private fadeTimer: number

  constructor(
    parent: HTMLElement,
    /** 보내기 (다듬은 글). false 를 돌려주면 보내지 못한 것 */
    private onSend: (text: string) => boolean,
    opts: { docked?: boolean } = {},
  ) {
    this.docked = !!opts.docked
    this.root = document.createElement('div')
    this.root.className = this.docked ? 'chat docked' : 'chat'
    const hint = this.docked ? '할 말 (Enter 보내기)' : '할 말 (Enter 보내기 · Esc 닫기)'
    this.root.innerHTML = `<div class="chat-log"></div><input class="chat-in" type="text" maxlength="${CHAT_MAX}" placeholder="${hint}" autocomplete="off" spellcheck="false"${this.docked ? '' : ' hidden'}>`
    parent.appendChild(this.root)
    this.log = this.root.querySelector('.chat-log') as HTMLElement
    this.input = this.root.querySelector('.chat-in') as HTMLInputElement
    // 입력 중인 키는 게임으로 가지 않게 여기서 멈춘다 (keydown 만 — keyup 은 흘려 보내야 누르고 있던 WASD 가 풀린다)
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      // 한글 조합 중의 Enter 는 글자를 확정할 뿐이다. 여기서 보내면 마지막 글자가 빠지거나 두 번 간다
      if (e.isComposing || e.keyCode === 229) return
      if (e.key === 'Enter') {
        e.preventDefault()
        this.submit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        this.close()
      }
    })
    // 화면을 눌러 입력칸 밖으로 나가면 닫는다 (쓰던 글은 남겨 둔다)
    this.input.addEventListener('blur', () => this.close())
    this.fadeTimer = this.docked ? 0 : window.setInterval(() => this.fade(), 500)
  }

  get open(): boolean {
    return this.docked || !this.input.hidden
  }

  show(): void {
    if (this.open) return
    this.input.hidden = false
    this.root.classList.add('open')
    this.input.focus()
    this.fade()
  }

  close(): void {
    if (this.docked || !this.open) return
    this.input.hidden = true
    this.root.classList.remove('open')
    this.input.blur()
    this.fade()
  }

  private submit(): void {
    const text = cleanChat(this.input.value)
    if (!text) {
      this.close()
      return
    }
    const now = performance.now()
    if (now - this.lastSend < SEND_GAP_MS) return
    if (!this.onSend(text)) return
    this.lastSend = now
    this.input.value = ''
    this.close()
    this.log.scrollTop = this.log.scrollHeight
  }

  /** 한 줄 더하기. 글은 textContent 로만 넣는다 (받은 글에 태그가 있어도 그대로 글자로 보인다) */
  add(name: string, text: string, kind: ChatLine['kind']): void {
    this.push({ name, text: cleanChat(text), kind, at: performance.now() })
  }

  /** 지난 줄 (대기실 → 게임으로 넘길 때) */
  history(): ChatLine[] {
    return this.lines.map((l) => l.line)
  }

  /** 넘겨받은 지난 줄을 그대로 쌓는다 (게임 안에서는 오래된 줄이라 곧바로 감춰진다) */
  load(lines: ChatLine[]): void {
    for (const l of lines) this.push({ ...l, text: cleanChat(l.text), at: performance.now() - SHOW_MS - 1 })
  }

  private push(line: ChatLine): void {
    const { name, kind } = line
    if (!line.text) return
    const el = document.createElement('div')
    el.className = `chat-line ${kind}`
    if (kind !== 'sys') {
      const b = document.createElement('b')
      b.textContent = `${name}: `
      el.appendChild(b)
    }
    el.appendChild(document.createTextNode(line.text))
    this.log.appendChild(el)
    this.lines.push({ line, el })
    while (this.lines.length > KEEP) this.lines.shift()!.el.remove()
    this.fade()
  }

  /** 닫혀 있으면 오래된 줄을 흐리게 · 감춘다. 열려 있으면 다 보인다 */
  private fade(): void {
    const now = performance.now()
    for (const { line, el } of this.lines) {
      const age = now - line.at
      const gone = !this.open && age > SHOW_MS
      el.classList.toggle('gone', gone)
      el.classList.toggle('old', !this.open && age > SHOW_MS - 2000)
    }
    this.log.scrollTop = this.log.scrollHeight
  }

  dispose(): void {
    clearInterval(this.fadeTimer)
    this.root.remove()
  }
}
