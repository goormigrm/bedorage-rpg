// 가방 창 (I 또는 Tab): 디아블로처럼 왼쪽에 장비 다섯 칸 · 능력치, 오른쪽에 가방 30칸.
// 아이템에 마우스를 올리면 툴팁(등급 색 이름 · 옵션 · 끼고 있는 것과 비교), 왼클릭 = 끼기, 오른클릭 = 버리기(동료에게 선물).
// **상태를 직접 바꾸지 않는다** — 명령(CMD_*)만 LocalInput 에 넣고, sim 이 다음 틱에 모두의 화면에서 똑같이 처리한다(DESIGN 2장 3).
// 창이 열려 있어도 게임은 멈추지 않는다(협동). 대신 사격·스킬 입력은 막는다(클릭이 총질이 되지 않게).

import { CHARACTERS } from '../core/characters'
import { CMD_DROP, CMD_EQUIP, CMD_UNEQUIP } from '../core/input'
import {
  AFFIXES, BAG_SIZE, Item, LEGENDS, RARITY_COLORS, RARITY_NAMES, SLOT_COUNT, SLOT_NAMES, SLOT_WEAPON, ST_COUNT, WEAPON_IDS,
  affixText, affixValue, armorBase, computeStats, hasImplicit, itemName, weaponBaseDmg, xpNeed,
} from '../core/items'
import { PlayerState } from '../core/state'
import { WEAPONS, weaponDps } from '../core/weapons'

function esc(t: string): string {
  return t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch)
}

/** 이 캐릭터가 낄 수 있는 무기인가 (같은 계열 — 권총 캐릭터는 권총·리볼버) */
function canWield(me: PlayerState, it: Item): boolean {
  return WEAPONS[WEAPON_IDS[it.wt]]?.family === WEAPONS[CHARACTERS[me.char].weapon].family
}

/** 아이템 줄 요약 (툴팁 본문) */
export function itemHtml(it: Item, me?: PlayerState): string {
  const color = RARITY_COLORS[it.rarity]
  const kind = it.slot === SLOT_WEAPON ? WEAPONS[WEAPON_IDS[it.wt]]?.name ?? '무기' : SLOT_NAMES[it.slot]
  const lines: string[] = []
  const base = weaponBaseDmg(it)
  if (base) lines.push(`<div class="base">피해 +${base}%</div>`)
  const arm = armorBase(it)
  if (arm) lines.push(`<div class="base">받는 피해 -${arm}%</div>`)
  // 바탕 종류의 기본 옵션은 ◇ 로 (그 종류면 늘 붙는다) · 강화는 옵션에 이미 곱해져 있다
  for (let k = 0; k < it.aff.length; k += 2) lines.push(`<div class="aff">${k === 0 && hasImplicit(it) ? '◇ 기본 ' : '◆ '}${affixText(it.aff[k], affixValue(it, k))}</div>`)
  if (it.up) lines.push(`<div class="base">강화 +${it.up} — 옵션 · 기본 +${it.up * 10}%</div>`)
  if (it.rarity >= 3 && it.leg !== undefined && LEGENDS[it.leg]) lines.push(`<div class="leg">✦ ${LEGENDS[it.leg].name} — ${LEGENDS[it.leg].desc}</div>`)
  let warn = ''
  if (me && it.slot === SLOT_WEAPON && !canWield(me, it)) warn = `<div class="warn">${CHARACTERS[me.char].name} 은(는) ${kind} 을(를) 쓸 수 없습니다</div>`
  const wd = it.slot === SLOT_WEAPON ? WEAPONS[WEAPON_IDS[it.wt]] : undefined
  if (wd) lines.unshift(`<div class="base">${wd.desc} · 초당 피해 약 ${Math.round(weaponDps(wd) * 60)}</div>`)
  return `<div class="it-name" style="color:${color}">${esc(itemName(it))}</div>
    <div class="it-kind">${RARITY_NAMES[it.rarity]} ${kind} · 아이템 레벨 ${it.ilvl}</div>
    ${lines.join('')}${warn}`
}

/** 이 아이템을 끼면 능력치가 어떻게 바뀌나 (비교 줄) */
function compareHtml(it: Item, me: PlayerState): string {
  if (it.slot === SLOT_WEAPON && !canWield(me, it)) return ''
  const equip = [...me.equip]
  equip[it.slot] = it
  const after = computeStats(me.level, equip)
  const out: string[] = []
  for (let i = 0; i < ST_COUNT; i++) {
    const d = Math.round((after[i] - me.st[i]) * 10) / 10
    if (d === 0) continue
    const a = AFFIXES[i]
    out.push(`<div class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${a.name} ${d > 0 ? '+' : ''}${d}${a.pct ? '%' : ''}</div>`)
  }
  return out.length ? `<div class="cmp"><div class="cmp-t">끼면</div>${out.join('')}</div>` : ''
}

export class Inventory {
  readonly el: HTMLElement
  private tip: HTMLElement
  open = false
  private timer = 0
  private lastKey = ''

  constructor(
    parent: HTMLElement,
    private me: () => PlayerState,
    private send: (cmd: number, arg: number) => void,
    private onToggle: (open: boolean) => void,
  ) {
    this.el = document.createElement('div')
    this.el.className = 'inv'
    this.el.hidden = true
    this.tip = document.createElement('div')
    this.tip.className = 'inv-tip'
    this.tip.hidden = true
    parent.appendChild(this.el)
    parent.appendChild(this.tip)
    this.el.addEventListener('contextmenu', (e) => e.preventDefault())
    // 창 안의 클릭이 게임(사격)으로 새지 않게
    for (const ev of ['mousedown', 'mouseup', 'click']) this.el.addEventListener(ev, (e) => e.stopPropagation())
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open
    this.el.hidden = !this.open
    this.tip.hidden = true
    this.lastKey = ''
    clearInterval(this.timer)
    if (this.open) {
      this.render()
      // 판이 도는 중이라 줍거나 레벨이 오르면 바뀐다 — 가볍게 자주 다시 그린다 (바뀐 게 없으면 건너뛴다)
      this.timer = window.setInterval(() => this.render(), 200)
    }
    this.onToggle(this.open)
  }

  private render(): void {
    const me = this.me()
    const key = JSON.stringify([me.level, me.xp, me.gold, me.equip.map((e) => e?.uid ?? 0), me.bag.map((b) => b.uid)])
    if (key === this.lastKey) return
    this.lastKey = key
    const c = CHARACTERS[me.char]
    const need = xpNeed(me.level)
    const slot = (i: number) => {
      const it = me.equip[i]
      const col = it ? RARITY_COLORS[it.rarity] : 'rgba(201,162,74,0.3)'
      return `<div class="eq" data-eq="${i}" style="--rc:${col}"><small>${SLOT_NAMES[i]}</small>${it ? `<b style="color:${col}">${esc(itemName(it))}</b>` : '<i>비어 있음</i>'}</div>`
    }
    const stats = [0, 1, 2, 3, 4, 5, 6, 7, 9].map((i) => {
      const v = Math.round(me.st[i] * 10) / 10
      return `<div><span>${AFFIXES[i].name}</span><b>${v > 0 ? (i === 6 || i === 9 ? '-' : '+') : ''}${v}${AFFIXES[i].pct ? '%' : ''}</b></div>`
    })
    const cells: string[] = []
    for (let i = 0; i < BAG_SIZE; i++) {
      const it = me.bag[i]
      if (!it) {
        cells.push('<div class="cell empty"></div>')
        continue
      }
      const col = RARITY_COLORS[it.rarity]
      const cant = it.slot === SLOT_WEAPON && !canWield(me, it)
      cells.push(`<div class="cell${cant ? ' cant' : ''}" data-bag="${i}" style="--rc:${col}"><small>${SLOT_NAMES[it.slot]}</small><b>${esc(itemName(it).split(' ')[1] ?? '')}</b></div>`)
    }
    this.el.innerHTML = `
      <div class="inv-head"><b>${c.name}</b><span>레벨 ${me.level}</span><span class="gold">◈ ${me.gold}</span><button class="inv-x" title="닫기 (I · Tab · Esc)">✕</button></div>
      <div class="inv-xp"><i style="width:${Math.min(100, (me.xp / need) * 100).toFixed(1)}%"></i><span>${me.xp} / ${need}</span></div>
      <div class="inv-body">
        <div class="inv-left">
          <div class="eqs">${Array.from({ length: SLOT_COUNT }, (_, i) => slot(i)).join('')}</div>
          <div class="inv-stats">${stats.join('')}</div>
        </div>
        <div class="inv-right">
          <div class="bag-h">가방 ${me.bag.length} / ${BAG_SIZE} <small>왼클릭 끼기 · 오른클릭 버리기(동료에게 선물)</small></div>
          <div class="bag">${cells.join('')}</div>
        </div>
      </div>`
    ;(this.el.querySelector('.inv-x') as HTMLButtonElement).onclick = () => this.toggle(false)
    this.el.querySelectorAll<HTMLElement>('[data-bag]').forEach((cell) => {
      const i = Number(cell.dataset.bag)
      cell.onclick = () => {
        this.send(CMD_EQUIP, i)
        this.tip.hidden = true
      }
      cell.oncontextmenu = (e) => {
        e.preventDefault()
        this.send(CMD_DROP, i)
        this.tip.hidden = true
      }
      cell.onmouseenter = () => this.showTip(cell, me.bag[i], true)
      cell.onmouseleave = () => (this.tip.hidden = true)
    })
    this.el.querySelectorAll<HTMLElement>('[data-eq]').forEach((cell) => {
      const i = Number(cell.dataset.eq)
      cell.onclick = () => {
        if (me.equip[i]) this.send(CMD_UNEQUIP, i)
        this.tip.hidden = true
      }
      cell.onmouseenter = () => {
        const it = me.equip[i]
        if (it) this.showTip(cell, it, false)
      }
      cell.onmouseleave = () => (this.tip.hidden = true)
    })
  }

  private showTip(anchor: HTMLElement, it: Item | undefined, compare: boolean): void {
    if (!it) return
    const me = this.me()
    const eq = me.equip[it.slot]
    this.tip.innerHTML = `<div class="tip-main" style="--rc:${RARITY_COLORS[it.rarity]}">${itemHtml(it, me)}${compare ? compareHtml(it, me) : ''}</div>
      ${compare && eq ? `<div class="tip-eq"><div class="tip-t">끼고 있는 것</div>${itemHtml(eq)}</div>` : ''}`
    this.tip.hidden = false
    const r = anchor.getBoundingClientRect()
    const pr = (this.tip.offsetParent as HTMLElement | null)?.getBoundingClientRect() ?? { left: 0, top: 0 }
    const scale = r.width / anchor.offsetWidth || 1
    this.tip.style.left = `${(r.left - pr.left) / scale - 250}px`
    this.tip.style.top = `${(r.top - pr.top) / scale}px`
  }

  dispose(): void {
    clearInterval(this.timer)
    this.el.remove()
    this.tip.remove()
  }
}
