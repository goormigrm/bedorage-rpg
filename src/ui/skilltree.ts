// 스킬 창 (K — GUIDE 8장, D4): 캐릭터마다 10칸(액티브 다섯 · 궁극기 · 패시브 넷). 레벨마다 포인트 하나.
// 3·5랭크에서 변형 둘 중 하나를 고르고, 배운 액티브를 Q · E · 1 · 2 칸에 건다. 마을에서는 골드로 재분배.
// 상태를 직접 바꾸지 않는다 — CMD_SKILL_* 만 넣는다.

import { CMD_RESPEC, CMD_SKILL_MOD, CMD_SKILL_SLOT, CMD_SKILL_UP } from '../core/input'
import { CHAR_SKILLS, MAX_RANK, MOD_NAMES, PASSIVES, SKILLS, TREE_ACTIVE, ULT_NODE, freePoints } from '../core/skills'
import { PlayerState } from '../core/state'
import { isTown } from '../core/world'

const SLOT_LABEL = ['Q', 'E', '1', '2']

export class SkillPanel {
  readonly el: HTMLElement
  open = false
  private sig = ''

  constructor(
    parent: HTMLElement,
    private me: () => PlayerState,
    private send: (cmd: number, arg: number) => void,
    private onToggle: (open: boolean) => void,
  ) {
    this.el = document.createElement('div')
    this.el.className = 'tp wide skp'
    this.el.hidden = true
    parent.appendChild(this.el)
  }

  toggle(open = !this.open): void {
    this.open = open
    this.el.hidden = !open
    this.sig = ''
    if (open) this.render()
    this.onToggle(open)
  }

  refresh(): void {
    if (!this.open) return
    const p = this.me()
    const sig = JSON.stringify([p.build, p.level, p.gold, p.area])
    if (sig !== this.sig) this.render()
  }

  private render(): void {
    const p = this.me()
    const b = p.build
    this.sig = JSON.stringify([b, p.level, p.gold, p.area])
    const free = freePoints(p.level, b, p.spBonus)
    const plus = (n: number) => `<button class="sk-up" data-cmd="${CMD_SKILL_UP}" data-arg="${n}" ${free > 0 && b.r[n] < MAX_RANK ? '' : 'disabled'}>+</button>`
    const pips = (n: number) => `<span class="sk-r">${'◆'.repeat(b.r[n])}${'◇'.repeat(MAX_RANK - b.r[n])}</span>`
    const mods = (n: number) => {
      const out: string[] = []
      for (const [tier, need, arr] of [[0, 3, b.m3], [1, 5, b.m5]] as const) {
        if (b.r[n] < need) continue
        const cur = arr[n]
        out.push(
          `<span class="sk-m">${need}랭크: ${[0, 1]
            .map((c) => `<button data-cmd="${CMD_SKILL_MOD}" data-arg="${n * 4 + tier * 2 + c}" class="${cur === c + 1 ? 'on' : ''}" ${cur ? 'disabled' : ''}>${MOD_NAMES[tier][c]}</button>`)
            .join('')}</span>`,
        )
      }
      return out.join('')
    }
    const actives = (TREE_ACTIVE[p.char] ?? CHAR_SKILLS[p.char]).map((id, n) => {
      const def = SKILLS[id]
      const own = n < 2
      const slots = SLOT_LABEL.map((l, k) => `<button data-cmd="${CMD_SKILL_SLOT}" data-arg="${k * 16 + n}" class="${b.s[k] === n ? 'on' : ''}" ${b.r[n] > 0 ? '' : 'disabled'}>${l}</button>`).join('')
      return `<div class="sk-row"><div class="sk-h"><b>${def.name}</b>${own ? '' : '<small>배우는 스킬</small>'}${pips(n)}${plus(n)}</div>
        <div class="sk-d">${def.desc}</div><div class="sk-f"><span class="sk-slots">칸 ${slots}</span>${mods(n)}</div></div>`
    })
    const ult = SKILLS[CHAR_SKILLS[p.char][2]]
    const ultRow = `<div class="sk-row ult"><div class="sk-h"><b>${ult.name}</b><small>궁극기 · X</small>${pips(ULT_NODE)}${plus(ULT_NODE)}</div><div class="sk-d">${ult.desc}</div><div class="sk-f">${mods(ULT_NODE)}</div></div>`
    const passives = PASSIVES.map((ps, k) => `<div class="sk-row pas"><div class="sk-h"><b>${ps.name}</b>${pips(6 + k)}${plus(6 + k)}</div><div class="sk-d">${ps.desc}</div></div>`).join('')
    const respec = isTown(p.area) ? `<button class="btn" data-cmd="${CMD_RESPEC}" data-arg="0" ${p.gold >= 50 * p.level ? '' : 'disabled'}>재분배 · ${50 * p.level} 골드</button>` : '<span class="tp-note">재분배는 마을에서</span>'
    this.el.innerHTML = `<div class="tp-head"><b>스킬</b><span class="tp-gold">남은 포인트 ${free}</span><button class="inv-x" data-x>✕</button></div>
      <p class="tp-line">레벨마다 포인트 하나 · 랭크마다 위력 +15% · 재사용 -4% · 3·5랭크에서 변형 하나. 배운 스킬을 Q · E · 1 · 2 칸에 건다 (궁극기는 X).</p>
      <div class="sk-grid"><div>${actives.join('')}</div><div>${ultRow}${passives}<div class="sk-respec">${respec}</div></div></div>
      <p class="tp-hint">K · Esc 로 닫기</p>`
    this.el.querySelector<HTMLButtonElement>('[data-x]')!.onclick = () => this.toggle(false)
    this.el.querySelectorAll<HTMLButtonElement>('[data-cmd]').forEach((btn) => {
      btn.onclick = () => this.send(Number(btn.dataset.cmd), Number(btn.dataset.arg))
    })
  }
}
