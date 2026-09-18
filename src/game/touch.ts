// 모바일(터치) 조작. **가로 화면 전용** — 세로면 index.html 의 안내가 덮는다.
//
// 손가락 두 개로 스틱 두 개를 정확히 미는 것은 폰에서 무리라, 조준은 자동으로 한다(localInput 의 autoAim).
// 그래서 이 파일이 만드는 것은 **이동 방향과 버튼 상태**뿐이다.
//   왼쪽 절반: 이동 스틱 (손가락을 대는 자리에 생긴다)
//   오른쪽 절반: 누르고 있으면 사격 (큰 사격 버튼도 같은 일을 한다)
//   오른쪽 가장자리 버튼: 조준 / 구르기 / 재장전 / 교체 · 왼쪽 위: 메뉴
// 조작 영역은 화면 위 64px 을 비워 둔다(style.css 의 .tzone) — 소리·로비로 버튼 자리다.
//
// 루트는 pointer-events: none 이고 조작 요소만 auto 다. 그래야 위에 뜬 창(로비로·다시 하기)이 눌린다.

const DEAD = 0.16

/**
 * 터치 조작을 쓸 기기인가. 터치가 달린 노트북까지 잡히지 않도록 '거친 포인터'로 판단한다.
 * PC 에서 시험하려면 주소 뒤에 ?touch=1 을 붙인다.
 */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  if (location.search.includes('touch=1')) return true
  return window.matchMedia?.('(pointer: coarse)').matches ?? navigator.maxTouchPoints > 0
}

/** 손가락이 영역 밖으로 나가도 계속 따라오게. 잡을 수 없는 포인터면 조용히 넘어간다 */
function capture(el: HTMLElement, id: number): void {
  try {
    el.setPointerCapture(id)
  } catch {
    /* 이미 놓았거나 합성 이벤트 */
  }
}

interface Stick {
  id: number
  baseX: number
  baseY: number
  dx: number
  dy: number
  power: number
}

export class TouchControls {
  /** 화면 기준 이동 (-1..1) */
  move = { x: 0, y: 0 }
  ads = false
  /** 달리기 켜짐 (버튼으로 켜고 끈다). 전에는 스틱을 끝까지 밀면 무조건 달렸다 */
  sprint = false
  reload = false
  /** 눌린 순간 한 번만 소비되는 신호 */
  private dashEdge = false
  private swapEdge = false
  private menuEdge = false
  private markEdge = false
  private emoteEdge = false
  /** 사격 중인 손가락들 (영역·버튼 공용). 하나라도 있으면 발사 */
  private fire = new Set<number>()

  private root: HTMLElement
  private stickEl: HTMLElement
  private moveStick: Stick | null = null
  private detach: (() => void)[] = []

  constructor(host: HTMLElement) {
    const el = document.createElement('div')
    el.className = 'touch-ui'
    el.innerHTML = `
      <div class="tzone move"></div>
      <div class="tzone fire"><span>누르고 있으면 사격</span></div>
      <div class="tstick" hidden><i></i></div>
      <div class="tbtns">
        <button class="tbtn" data-a="reload">재장전</button>
        <button class="tbtn" data-a="swap">교체</button>
        <button class="tbtn" data-a="ads">조준</button>
        <button class="tbtn" data-a="dash">구르기</button>
        <button class="tbtn" data-a="sprint">달리기</button>
        <button class="tbtn mark" data-a="mark" hidden>신호</button>
        <button class="tbtn emote" data-a="emote">ㅋㅋ</button>
        <button class="tbtn big" data-a="fire">사격</button>
      </div>
      <button class="tbtn menu" data-a="menu">≡</button>`
    host.appendChild(el)
    this.root = el
    this.stickEl = el.querySelector('.tstick') as HTMLElement

    const knob = this.stickEl.querySelector('i') as HTMLElement
    const R = 54
    const place = (x: number, y: number) => {
      this.stickEl.hidden = false
      this.stickEl.style.left = `${x}px`
      this.stickEl.style.top = `${y}px`
      knob.style.transform = 'translate(-50%, -50%)'
    }
    const drag = (s: Stick, x: number, y: number) => {
      let dx = x - s.baseX
      let dy = y - s.baseY
      const d = Math.hypot(dx, dy)
      const p = Math.min(1, d / R)
      if (d > 0) {
        dx /= d
        dy /= d
      }
      s.dx = dx
      s.dy = dy
      s.power = p
      knob.style.transform = `translate(calc(-50% + ${dx * p * R}px), calc(-50% + ${dy * p * R}px))`
      this.move = p < DEAD ? { x: 0, y: 0 } : { x: dx * p, y: dy * p }
    }

    // ---- 이동 영역 ----
    const moveZone = el.querySelector('.tzone.move') as HTMLElement
    const moveDown = (e: PointerEvent) => {
      if (this.moveStick) return
      e.preventDefault()
      this.moveStick = { id: e.pointerId, baseX: e.clientX, baseY: e.clientY, dx: 0, dy: 0, power: 0 }
      place(e.clientX, e.clientY)
      capture(moveZone, e.pointerId)
    }
    const moveMove = (e: PointerEvent) => {
      if (this.moveStick?.id === e.pointerId) drag(this.moveStick, e.clientX, e.clientY)
    }
    const moveUp = (e: PointerEvent) => {
      if (this.moveStick?.id !== e.pointerId) return
      this.moveStick = null
      this.move = { x: 0, y: 0 }
      this.stickEl.hidden = true
    }
    this.on(moveZone, 'pointerdown', moveDown)
    this.on(moveZone, 'pointermove', moveMove)
    this.on(moveZone, 'pointerup', moveUp)
    this.on(moveZone, 'pointercancel', moveUp)

    // ---- 사격 영역 ----
    const fireZone = el.querySelector('.tzone.fire') as HTMLElement
    const fireDown = (e: PointerEvent) => {
      e.preventDefault()
      this.fire.add(e.pointerId)
      fireZone.classList.add('on')
      capture(fireZone, e.pointerId)
    }
    const fireUp = (e: PointerEvent) => {
      this.fire.delete(e.pointerId)
      if (this.fire.size === 0) fireZone.classList.remove('on')
    }
    this.on(fireZone, 'pointerdown', fireDown)
    this.on(fireZone, 'pointerup', fireUp)
    this.on(fireZone, 'pointercancel', fireUp)

    // ---- 버튼: 조준은 토글, 사격·재장전은 누르는 동안, 나머지는 한 번 ----
    for (const btn of Array.from(el.querySelectorAll<HTMLButtonElement>('.tbtn'))) {
      const act = btn.dataset.a
      const press = (e: PointerEvent) => {
        e.preventDefault()
        e.stopPropagation()
        capture(btn, e.pointerId)
        if (act === 'ads') {
          this.ads = !this.ads
          btn.classList.toggle('on', this.ads)
        } else if (act === 'sprint') {
          this.sprint = !this.sprint
          btn.classList.toggle('on', this.sprint)
        } else if (act === 'reload') {
          this.reload = true
          btn.classList.add('on')
        } else if (act === 'fire') {
          this.fire.add(e.pointerId)
          btn.classList.add('on')
        } else if (act === 'dash') this.dashEdge = true
        else if (act === 'swap') this.swapEdge = true
        else if (act === 'menu') this.menuEdge = true
        else if (act === 'mark') this.markEdge = true
        else if (act === 'emote') this.emoteEdge = true
      }
      const release = (e: PointerEvent) => {
        if (act === 'reload') {
          this.reload = false
          btn.classList.remove('on')
        } else if (act === 'fire') {
          this.fire.delete(e.pointerId)
          btn.classList.remove('on')
        }
      }
      this.on(btn, 'pointerdown', press)
      this.on(btn, 'pointerup', release)
      this.on(btn, 'pointercancel', release)
    }
  }

  private on<K extends keyof HTMLElementEventMap>(
    el: HTMLElement,
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
  ): void {
    el.addEventListener(type, fn as EventListener)
    this.detach.push(() => el.removeEventListener(type, fn as EventListener))
  }

  /** 사격 중인가 */
  get firing(): boolean {
    return this.fire.size > 0
  }

  takeDash(): boolean {
    const v = this.dashEdge
    this.dashEdge = false
    return v
  }

  takeSwap(): boolean {
    const v = this.swapEdge
    this.swapEdge = false
    return v
  }

  takeMenu(): boolean {
    const v = this.menuEdge
    this.menuEdge = false
    return v
  }

  /** 팀 신호 버튼을 눌렀는가 (한 번만) */
  takeMark(): boolean {
    const v = this.markEdge
    this.markEdge = false
    return v
  }

  /** 감정 표현 버튼(ㅋㅋ)을 눌렀는가 (한 번만) */
  takeEmote(): boolean {
    const v = this.emoteEdge
    this.emoteEdge = false
    return v
  }

  /** 팀전에서만 신호 버튼을 보여 준다 */
  setMarkVisible(v: boolean): void {
    const b = this.root.querySelector('[data-a="mark"]') as HTMLElement | null
    if (b) b.hidden = !v
  }

  /** 창(메뉴·결과·캐릭터 선택)이 떠 있는 동안은 조작을 치운다 — 창 버튼이 눌려야 하므로 */
  setVisible(v: boolean): void {
    this.root.hidden = !v
    if (!v) {
      this.move = { x: 0, y: 0 }
      this.moveStick = null
      this.stickEl.hidden = true
      this.fire.clear()
      this.reload = false
    }
  }

  dispose(): void {
    for (const off of this.detach) off()
    this.detach = []
    this.root.remove()
  }
}

/** 전체화면 + 가로 고정 시도. 사용자 제스처 안에서 불러야 한다 */
export async function enterLandscape(): Promise<void> {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
  } catch {
    /* 지원 안 하는 브라우저는 그냥 넘어간다 */
  }
  try {
    const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
    await so?.lock?.('landscape')
  } catch {
    /* iOS 등 잠금 미지원 — 세로면 안내 화면이 뜬다 */
  }
}

