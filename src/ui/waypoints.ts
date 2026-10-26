// 웨이포인트 창 (디아블로 2): 웨이포인트 곁에서 F. 막마다 열린 곳이 나열되고, 누르면 그곳으로 건너간다.
// 가방 창과 같은 원칙 — **상태를 직접 바꾸지 않는다**. CMD_WAYPOINT 만 LocalInput 에 넣고 sim 이 다음 틱에 옮긴다.

import { keyLabel } from '../game/keymap'
import { CMD_WAYPOINT, WP_TO_LEADER } from '../core/input'
import { ACTS, AREAS, WAYPOINTS, actLocked, areaDef, isTown, wpBit } from '../core/world'
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
    /** 나를 이끄는 방장 (파티원일 때만) — 사냥터는 방장 곁으로만 · 마을은 따로 (2026-10-26 "방장이 이끈다") */
    private leader: () => { area: number; name: string; alive: boolean } | null = () => null,
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
    const ld = this.leader()
    const acts = ACTS.map((act, ai) => {
      // 깬 막은 보이지 않는다 — 돌아가지 않는다 (2026-10-22)
      if (actLocked(me.quests, ai)) return ''
      // 길에서 뺀 지역(retired)의 웨이포인트는 비트 자리만 남았다 — 창에 보이지 않는다
      const rows = WAYPOINTS.filter((id) => AREAS[id].act === ai && !AREAS[id].retired)
        .map((id) => {
          const known = (me.wps & wpBit(id)) !== 0
          const here = me.area === id
          const a = AREAS[id]
          // 파티원은 사냥터로 혼자 가지 않는다 — 마을 · 방장이 있는 곳만
          const led = !!ld && !isTown(id) && id !== ld.area
          return `<button data-a="${id}" class="${here ? 'here' : ''}" ${known && !here && !led ? '' : 'disabled'}>
            <span>${known ? a.name : '— 아직 찾지 못함 —'}</span>${here ? '<small>지금 여기</small>' : known && led ? '<small>방장이 이끕니다</small>' : known && a.level ? `<small>지역 레벨 ${a.level + this.levelAdd()}</small>` : ''}</button>`
        })
        .join('')
      return `<div class="wpp-act"><div class="wpp-actn">${ai + 1}막 · ${act.name}</div>${rows}</div>`
    }).join('')
    const lead = ld
      ? `<button class="wpp-lead" data-lead ${ld.alive ? '' : 'disabled'}><span>👑 방장 곁으로</span><small>${ld.name.replace(/[&<>"]/g, '')} · ${ld.alive ? areaDef(ld.area).name : '쓰러져 있음'}</small></button>`
      : ''
    this.el.innerHTML = `<div class="wpp-head"><b>웨이포인트</b><button class="inv-x" data-x>✕</button></div>
      <p class="wpp-hint">가 본 지역으로 곧장 · ${keyLabel('use')} / Esc 로 닫기</p>${lead}${acts}`
    this.el.querySelector<HTMLButtonElement>('[data-x]')!.onclick = () => this.toggle(false)
    const lb = this.el.querySelector<HTMLButtonElement>('[data-lead]')
    if (lb)
      lb.onclick = () => {
        this.send(CMD_WAYPOINT, WP_TO_LEADER)
        this.toggle(false)
      }
    this.el.querySelectorAll<HTMLButtonElement>('button[data-a]').forEach((b) => {
      b.onclick = () => {
        this.send(CMD_WAYPOINT, Number(b.dataset.a))
        this.toggle(false)
      }
    })
  }
}
