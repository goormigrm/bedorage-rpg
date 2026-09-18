// 웨이포인트 창 (디아블로 2): 웨이포인트 곁에서 F. 막마다 열린 곳이 나열되고, 누르면 그곳으로 건너간다.
// 가방 창과 같은 원칙 — **상태를 직접 바꾸지 않는다**. CMD_WAYPOINT 만 LocalInput 에 넣고 sim 이 다음 틱에 옮긴다.

import { CMD_WAYPOINT } from '../core/input'
import { ACTS, AREAS, WAYPOINTS, wpBit } from '../core/world'
import { PlayerState } from '../core/state'

export class WaypointPanel {
  readonly el: HTMLElement
  open = false

  constructor(
    parent: HTMLElement,
    private me: () => PlayerState,
    private send: (cmd: number, arg: number) => void,
    private onToggle: (open: boolean) => void,
    /** 난이도의 지역 레벨 더하기 (악몽 +10 · 지옥 +20) */
    private levelAdd: () => number = () => 0,
  ) {
    this.el = document.createElement('div')
    this.el.className = 'wpp'
    this.el.hidden = true
    parent.appendChild(this.el)
  }

  toggle(open = !this.open): void {
    this.open = open
    this.el.hidden = !open
    if (open) this.render()
    this.onToggle(open)
  }

  private render(): void {
    const me = this.me()
    const acts = ACTS.map((act, ai) => {
      const rows = WAYPOINTS.filter((id) => AREAS[id].act === ai)
        .map((id) => {
          const known = (me.wps & wpBit(id)) !== 0
          const here = me.area === id
          const a = AREAS[id]
          return `<button data-a="${id}" class="${here ? 'here' : ''}" ${known && !here ? '' : 'disabled'}>
            <span>${known ? a.name : '— 아직 찾지 못함 —'}</span>${known && a.level ? `<small>지역 레벨 ${a.level + this.levelAdd()}</small>` : here ? '<small>지금 여기</small>' : ''}</button>`
        })
        .join('')
      return `<div class="wpp-act"><div class="wpp-actn">${ai + 1}막 · ${act.name}</div>${rows}</div>`
    }).join('')
    this.el.innerHTML = `<div class="wpp-head"><b>웨이포인트</b><button class="inv-x" data-x>✕</button></div>
      <p class="wpp-hint">밟아서 연 웨이포인트로 곧장 건너갑니다 · F / Esc 로 닫기</p>${acts}`
    this.el.querySelector<HTMLButtonElement>('[data-x]')!.onclick = () => this.toggle(false)
    this.el.querySelectorAll<HTMLButtonElement>('button[data-a]').forEach((b) => {
      b.onclick = () => {
        this.send(CMD_WAYPOINT, Number(b.dataset.a))
        this.toggle(false)
      }
    })
  }
}
