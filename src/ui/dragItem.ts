// 아이템 끌어다 놓기 (2026-10-08 — 보관함 개편 · 사용자: "보관함 UI 가 생각보다 별로 — 다른 게임처럼").
// 칸을 누른 채 6px 넘게 움직이면 아이템 그림이 커서를 따라오고, 놓은 곳의 [data-drop] 칸(보관함 · 가방 · 장비 · 상인)을 알린다.
// 움직이지 않고 떼면 보통 클릭 그대로. 끌다 놓은 뒤에 따라오는 클릭은 삼킨다(clickSuppressed).

export type DragFrom = 'bag' | 'stash'

export interface DragSrc {
  from: DragFrom
  index: number
  icon: string
}

let suppress = false
let hot: HTMLElement | null = null

/** 지금 막 끌어다 놓았다 — 이 클릭은 옮기기가 아니다 */
export function clickSuppressed(): boolean {
  return suppress
}

function targetAt(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null
  return el?.closest<HTMLElement>('[data-drop]') ?? null
}

function highlight(t: HTMLElement | null): void {
  if (hot === t) return
  hot?.classList.remove('drop-hot')
  hot = t
  hot?.classList.add('drop-hot')
}

/** cell 을 끌 수 있게 한다. src 가 null 이면(빈 칸) 끌지 않는다 */
export function makeDraggable(cell: HTMLElement, src: () => DragSrc | null, onDrop: (s: DragSrc, target: HTMLElement) => void): void {
  cell.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.shiftKey) return
    const s = src()
    if (!s) return
    const x0 = e.clientX
    const y0 = e.clientY
    let ghost: HTMLElement | null = null
    const move = (ev: MouseEvent) => {
      if (!ghost) {
        if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 6) return
        ghost = document.createElement('div')
        ghost.className = 'drag-ghost'
        ghost.style.backgroundImage = `url(${s.icon})`
        document.body.appendChild(ghost)
        cell.classList.add('dragging')
        document.body.classList.add('drag-item')
      }
      ghost.style.left = `${ev.clientX}px`
      ghost.style.top = `${ev.clientY}px`
      const t = targetAt(ev.clientX, ev.clientY)
      // 제자리(같은 쪽)에 놓는 것은 옮기기가 아니다
      highlight(t && t.dataset.drop !== s.from ? t : null)
    }
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move, true)
      window.removeEventListener('mouseup', up, true)
      if (!ghost) return
      ghost.remove()
      cell.classList.remove('dragging')
      document.body.classList.remove('drag-item')
      highlight(null)
      suppress = true
      setTimeout(() => (suppress = false), 0)
      const t = targetAt(ev.clientX, ev.clientY)
      if (t && t.dataset.drop !== s.from) onDrop(s, t)
    }
    window.addEventListener('mousemove', move, true)
    window.addEventListener('mouseup', up, true)
  })
}
