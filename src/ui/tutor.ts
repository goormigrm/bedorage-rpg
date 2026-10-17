// 처음 10분 안내 (2026-10-08 퀄리티 6단계 — 사용자: "퀄리티를 올릴 수 있는 것들 … 단계별로 모두"):
// 처음 하는 사람에게 조작을 **하나씩** — 스킬 바 위 말풍선 하나, 해 보면 다음으로 넘어간다.
// 이동 → (마을) 안내원 · 촌장에게 말 걸기 → (들판) 쏘기 → 스킬 → 구르기 → 줍기 → 가방 → 타운 포털.
// 바꾼 키를 그대로 보인다(keyLabel). 끝낸 단계는 이 브라우저에 기억한다 — 이미 여러 판 한 사람(brpg.games 6 이상)은 처음부터 건너뛴다.
// 그림 · 글만 — 판(sim)과 무관.

import { keyLabel, skillKeyLabel } from '../game/keymap'
import { isTown } from '../core/world'
import { NPC_NAMES } from '../core/world'
import type { GameState } from '../core/state'

const KEY = 'brpg.tut'
type Step = 'move' | 'talk' | 'shoot' | 'skill' | 'dash' | 'loot' | 'bag' | 'portal'
const ORDER: Step[] = ['move', 'talk', 'shoot', 'skill', 'dash', 'loot', 'bag', 'portal']

export interface TutorView {
  state: GameState
  me: number
  /** 지금 보는 지역의 괴물 (살아 있는 것) 중 나와 가까운 수 */
  nearMonsters: number
  /** 내 것으로 떨어진 아이템이 곁에 있나 */
  nearLoot: boolean
  bagOpen: boolean
  firing: boolean
}

export class Tutor {
  private el: HTMLElement
  private done: Set<Step>
  private off = false
  private shown: Step | null = null
  private startX = NaN
  private startY = NaN
  private fireT = 0
  private bag0 = -1

  constructor(parent: HTMLElement) {
    let saved: string[] = []
    let games = 0
    try {
      saved = JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]
      games = Number(localStorage.getItem('brpg.games') ?? '0')
    } catch {
      /* 저장소를 못 쓰면 처음부터 */
    }
    this.done = new Set(saved.filter((s): s is Step => (ORDER as string[]).includes(s)))
    // 이미 여러 판 해 본 사람(이 기능 전부터)은 건너뛴다
    if (saved.length === 0 && games > 6) this.off = true
    if (saved.includes('off')) this.off = true
    this.el = document.createElement('div')
    this.el.className = 'tutor'
    this.el.hidden = true
    parent.appendChild(this.el)
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify([...this.done, ...(this.off ? ['off'] : [])]))
    } catch {
      /* 무시 */
    }
  }

  private finish(s: Step): void {
    if (this.done.has(s)) return
    this.done.add(s)
    this.save()
    // 끝낸 말풍선은 잠깐 초록으로 반짝이고 사라진다
    if (this.shown === s) {
      this.el.classList.add('ok')
      window.setTimeout(() => {
        this.el.classList.remove('ok')
        if (this.shown === s) this.hide()
      }, 650)
    }
  }

  private hide(): void {
    this.shown = null
    this.el.hidden = true
  }

  private show(s: Step, html: string): void {
    if (this.shown === s) return
    this.shown = s
    this.el.innerHTML = `<span class="tutor-t">${html}</span><button class="tutor-x" title="안내 끄기">안내 끄기</button>`
    this.el.hidden = false
    this.el.querySelector<HTMLButtonElement>('.tutor-x')!.onclick = (e) => {
      e.stopPropagation()
      this.off = true
      this.save()
      this.hide()
    }
  }

  /** 1초에 몇 번 (session) */
  update(v: TutorView, dt: number): void {
    if (this.off) return
    const p = v.state.players[v.me]
    if (!p || !p.alive || v.state.mode !== 'dungeon') {
      this.hide()
      return
    }
    const town = isTown(p.area)
    const k = (id: Parameters<typeof keyLabel>[0]) => `<b class="kc">${keyLabel(id)}</b>`
    // ---- 끝났나 살피기 (보이든 안 보이든)
    if (Number.isNaN(this.startX)) {
      this.startX = p.x
      this.startY = p.y
    }
    if (Math.hypot(p.x - this.startX, p.y - this.startY) > 90) this.finish('move')
    if ((p.quests ?? []).some((q) => q > 0) || !town) this.finish('talk')
    if (v.firing && !town) this.fireT += dt
    if (this.fireT > 1.2 || p.kills >= 3) this.finish('shoot')
    if ((p.cd[0] ?? 0) > 0 || (p.cd[1] ?? 0) > 0) this.finish('skill')
    if (p.dashTimer > 0) this.finish('dash')
    if (this.bag0 < 0) this.bag0 = p.bag.length
    if (p.bag.length > this.bag0) this.finish('loot')
    if (v.bagOpen) this.finish('bag')
    if (p.portalCast > 0) this.finish('portal')
    // ---- 지금 보일 것 (차례대로, 그 자리에서 할 수 있는 첫 단계)
    const next = ORDER.find((s) => {
      if (this.done.has(s)) return false
      if (s === 'move') return true
      if (s === 'talk') return town
      if (s === 'shoot') return !town && v.nearMonsters > 0
      if (s === 'skill') return !town && v.nearMonsters > 0 && this.done.has('shoot')
      if (s === 'dash') return !town && v.nearMonsters > 0 && this.done.has('skill')
      if (s === 'loot') return v.nearLoot
      if (s === 'bag') return p.bag.length > 0 && this.done.has('loot')
      if (s === 'portal') return !town && p.level >= 3
      return false
    })
    if (!next) {
      this.hide()
      return
    }
    const elder = NPC_NAMES.elder
    const html: Record<Step, string> = {
      move: `${k('up')}${k('left')}${k('down')}${k('right')} 로 움직인다 · ${k('sprint')} 달리기`,
      talk: `느낌표(!)가 뜬 <b>${elder}</b> 곁에서 ${k('use')} — 할 일을 알려 준다 · 출구로 나가면 들판`,
      shoot: `마우스로 조준 · <b class="kc">왼쪽 버튼</b>을 꾹 — 쏘기 (재장전 없음) · 금색 조준선 = 약점`,
      skill: `${`<b class="kc">${skillKeyLabel(0)}</b><b class="kc">${skillKeyLabel(1)}</b>`} 스킬 · <b class="kc">${skillKeyLabel(2)}</b> 궁극기 — 집중(오른쪽 파란 구슬)을 쓴다`,
      dash: `${k('dash')} 구르기 — 구르는 동안 맞지 않는다 (두 번까지 모아 둔다)`,
      loot: `떨어진 것 곁에서 ${k('use')} — 줍기 · 빛기둥이 높을수록 좋은 것`,
      bag: `${k('bag')} 가방 — 왼클릭 끼기 · 마우스를 올리면 지금 것과 견준다`,
      portal: `${k('portal')} 타운 포털 — 마을에 갔다가 그 자리로 돌아온다 (팔기 · 고치기)`,
    }
    this.show(next, html[next])
  }

  dispose(): void {
    this.el.remove()
  }
}
