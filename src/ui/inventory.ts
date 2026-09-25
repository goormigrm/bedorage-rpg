// 가방 창 (I 또는 Tab): 디아블로처럼 왼쪽에 장비 다섯 칸 · 능력치, 오른쪽에 가방 30칸.
// 아이템에 마우스를 올리면 툴팁(등급 색 이름 · 옵션 · 끼고 있는 것과 비교), 왼클릭 = 끼기, 오른클릭 = 버리기(동료에게 선물).
// **상태를 직접 바꾸지 않는다** — 명령(CMD_*)만 LocalInput 에 넣고, sim 이 다음 틱에 모두의 화면에서 똑같이 처리한다(DESIGN 2장 3).
// 창이 열려 있어도 게임은 멈추지 않는다(협동). 대신 사격·스킬 입력은 막는다(클릭이 총질이 되지 않게).

import { CHARACTERS } from '../core/characters'
import { CMD_DROP, CMD_EQUIP, CMD_LOCK, CMD_SORT, CMD_UNEQUIP } from '../core/input'
import {
  AFFIXES, Item, LEGENDS, RARITY_NAMES, SETS, SLOT_COUNT, SLOT_NAMES, SLOT_WEAPON, ST_COUNT, WEAPON_IDS,
  affixText, affixValue, armorBase, computeStats, hasImplicit, itemColor, itemName, myGoldText, setCounts, weaponBaseDmg, xpNeed,
} from '../core/items'
import { PlayerState } from '../core/state'
import { WEAPONS, weaponDps } from '../core/weapons'

function esc(t: string): string {
  return t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch)
}

/** 이 캐릭터가 낄 수 있는 무기인가 (같은 계열 — SMG 캐릭터는 SMG·화염방사기) */
export function canWield(me: PlayerState, it: Item): boolean {
  return WEAPONS[WEAPON_IDS[it.wt]]?.family === WEAPONS[CHARACTERS[me.char].weapon].family
}

/** 아이템 줄 요약 (툴팁 본문) */
export function itemHtml(it: Item, me?: PlayerState): string {
  const color = itemColor(it)
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
  // 세트: 부위 셋 중 낀 것 · 2부위 · 3부위 효과 (켜진 것은 밝게)
  const sd = it.set !== undefined ? SETS[it.set] : undefined
  if (sd) {
    const have = me ? setCounts(me.equip)[it.set!] : 0
    const parts = sd.slots.map((sl) => `<span class="${me?.equip[sl]?.set === it.set ? 'on' : ''}">${SLOT_NAMES[sl]}</span>`).join(' · ')
    const bonus = (need: number, list: [number, number][]) =>
      `<div class="set-b${have >= need ? ' on' : ''}">${need}부위 — ${list.map(([k, v]) => affixText(k, v)).join(' · ')}</div>`
    lines.push(`<div class="set"><b>세트 〔${sd.name}〕 ${have} / ${sd.slots.length}</b><div class="set-p">${parts}</div>${bonus(2, sd.two)}${bonus(3, sd.three)}</div>`)
  }
  let warn = ''
  if (me && it.slot === SLOT_WEAPON && !canWield(me, it)) warn = `<div class="warn">${CHARACTERS[me.char].name} 은(는) ${kind} 을(를) 쓸 수 없습니다</div>`
  const wd = it.slot === SLOT_WEAPON ? WEAPONS[WEAPON_IDS[it.wt]] : undefined
  if (wd) lines.unshift(`<div class="base">${wd.desc} · 초당 피해 약 ${Math.round(weaponDps(wd) * 60)}</div>`)
  return `<div class="it-name" style="color:${color}">${esc(itemName(it))}</div>
    <div class="it-kind">${it.set !== undefined ? '세트' : RARITY_NAMES[it.rarity]} ${kind} · 아이템 레벨 ${it.ilvl}</div>
    ${lines.join('')}${warn}`
}

/**
 * 가방 칸 하나. **보관함 창도 같은 것을 쓴다** — 보관함을 가방처럼 칸으로 본다(2026-09-25 요청).
 * `attr` 은 누를 때 알아볼 표(data-bag="3" 같은 것), `me` 를 주면 못 끼는 무기를 흐리게 한다.
 */
export function cellHtml(it: Item | undefined, attr: string, me?: PlayerState): string {
  if (!it) return `<div class="cell empty" ${attr}></div>`
  const col = itemColor(it)
  const cant = !!me && it.slot === SLOT_WEAPON && !canWield(me, it)
  // 잠근 것은 자물쇠 — 팔기 · 버리기 · 재료 · 한꺼번에 보관에서 빠진다
  const tag = it.set !== undefined ? SETS[it.set]?.tag ?? '' : itemName(it).split(' ')[1] ?? ''
  return `<div class="cell${cant ? ' cant' : ''}${it.lk ? ' locked' : ''}${it.set !== undefined ? ' setp' : ''}" ${attr} style="--rc:${col}"><small>${SLOT_NAMES[it.slot]}</small><b>${esc(tag)}</b>${it.up ? `<u>+${it.up}</u>` : ''}${it.lk ? '<i class="lk">🔒</i>' : ''}</div>`
}

/** 아이템 설명 풍선. 가방 창과 보관함 창이 **같은 것**을 쓴다 (2026-09-25) */
export class ItemTip {
  readonly el: HTMLElement
  constructor(parent: HTMLElement) {
    this.el = document.createElement('div')
    this.el.className = 'inv-tip'
    this.el.hidden = true
    parent.appendChild(this.el)
  }

  /** anchor 왼쪽에 띄운다. compare 면 끼고 있는 것과 견준다 */
  show(anchor: HTMLElement, it: Item | undefined, me: PlayerState, compare: boolean): void {
    if (!it) return
    const eq = me.equip[it.slot]
    this.el.innerHTML = `<div class="tip-main" style="--rc:${itemColor(it)}">${itemHtml(it, me)}${compare ? compareHtml(it, me) : ''}</div>
      ${compare && eq && eq !== it ? `<div class="tip-eq"><div class="tip-t">끼고 있는 것</div>${itemHtml(eq)}</div>` : ''}`
    this.el.hidden = false
    const r = anchor.getBoundingClientRect()
    const pr = (this.el.offsetParent as HTMLElement | null)?.getBoundingClientRect() ?? { left: 0, top: 0 }
    const scale = r.width / anchor.offsetWidth || 1
    this.el.style.left = `${(r.left - pr.left) / scale - 250}px`
    this.el.style.top = `${(r.top - pr.top) / scale}px`
  }

  hide(): void {
    this.el.hidden = true
  }

  dispose(): void {
    this.el.remove()
  }
}

/** 이 아이템을 끼면 능력치가 어떻게 바뀌나 (비교 줄) */
function compareHtml(it: Item, me: PlayerState): string {
  if (it.slot === SLOT_WEAPON && !canWield(me, it)) return ''
  const equip = [...me.equip]
  equip[it.slot] = it
  const after = computeStats(me.level, equip, me.attr)
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
  private tip: ItemTip
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
    parent.appendChild(this.el)
    this.tip = new ItemTip(parent)
    this.el.addEventListener('contextmenu', (e) => e.preventDefault())
    // 창 안의 클릭이 게임(사격)으로 새지 않게
    for (const ev of ['mousedown', 'mouseup', 'click']) this.el.addEventListener(ev, (e) => e.stopPropagation())
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open
    this.el.hidden = !this.open
    this.tip.hide()
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
    const key = JSON.stringify([me.level, me.xp, me.gold, me.bagMax, me.equip.map((e) => e?.uid ?? 0), me.bag.map((b) => `${b.uid}${b.lk ? 'L' : ''}${b.up ?? 0}`)])
    if (key === this.lastKey) return
    this.lastKey = key
    const c = CHARACTERS[me.char]
    const need = xpNeed(me.level)
    const slot = (i: number) => {
      const it = me.equip[i]
      const col = it ? itemColor(it) : 'rgba(201,162,74,0.3)'
      return `<div class="eq" data-eq="${i}" style="--rc:${col}"><small>${SLOT_NAMES[i]}</small>${it ? `<b style="color:${col}">${esc(itemName(it))}</b>` : '<i>비어 있음</i>'}</div>`
    }
    const stats = [0, 1, 2, 3, 4, 5, 6, 7, 9].map((i) => {
      const v = Math.round(me.st[i] * 10) / 10
      return `<div><span>${AFFIXES[i].name}</span><b>${v > 0 ? (i === 6 || i === 9 ? '-' : '+') : ''}${v}${AFFIXES[i].pct ? '%' : ''}</b></div>`
    })
    const cells: string[] = []
    for (let i = 0; i < me.bagMax; i++) cells.push(cellHtml(me.bag[i], `data-bag="${i}"`, me))
    this.el.innerHTML = `
      <div class="inv-head"><b>${c.name}</b><span>레벨 ${me.level}</span><span class="gold">${myGoldText(me.gold)}</span><button class="inv-x" title="닫기 (I · Tab · Esc)">✕</button></div>
      <div class="inv-xp"><i style="width:${Math.min(100, (me.xp / need) * 100).toFixed(1)}%"></i><span>${me.xp} / ${need}</span></div>
      <div class="inv-body">
        <div class="inv-left">
          <div class="eqs">${Array.from({ length: SLOT_COUNT }, (_, i) => slot(i)).join('')}</div>
          <div class="inv-stats">${stats.join('')}</div>
        </div>
        <div class="inv-right">
          <div class="bag-h">가방 ${me.bag.length} / ${me.bagMax}
            <button class="bag-sort" data-sort title="등급이 높은 것부터 줄 세운다">정렬</button>
            <small>왼클릭 끼기 · 오른클릭 버리기 · <b>Shift+클릭 잠금</b>(팔기 · 재료에서 빠짐)</small></div>
          <div class="bag">${cells.join('')}</div>
        </div>
      </div>`
    ;(this.el.querySelector('.inv-x') as HTMLButtonElement).onclick = () => this.toggle(false)
    const sortBtn = this.el.querySelector('[data-sort]') as HTMLButtonElement | null
    if (sortBtn)
      sortBtn.onclick = () => {
        this.send(CMD_SORT, 0)
        this.lastKey = ''
      }
    this.el.querySelectorAll<HTMLElement>('[data-bag]').forEach((cell) => {
      const i = Number(cell.dataset.bag)
      cell.onclick = (e) => {
        if (!me.bag[i]) return
        // Shift+클릭 = 잠금 토글 (실수로 팔거나 버리지 않게 — "전부 팔기" 의 짝)
        this.send((e as MouseEvent).shiftKey ? CMD_LOCK : CMD_EQUIP, i)
        this.lastKey = ''
        this.tip.hide()
      }
      cell.oncontextmenu = (e) => {
        e.preventDefault()
        if (!me.bag[i]?.lk) this.send(CMD_DROP, i)
        this.tip.hide()
      }
      cell.onmouseenter = () => this.tip.show(cell, me.bag[i], me, true)
      cell.onmouseleave = () => this.tip.hide()
    })
    this.el.querySelectorAll<HTMLElement>('[data-eq]').forEach((cell) => {
      const i = Number(cell.dataset.eq)
      cell.onclick = () => {
        if (me.equip[i]) this.send(CMD_UNEQUIP, i)
        this.tip.hide()
      }
      cell.onmouseenter = () => this.tip.show(cell, me.equip[i] ?? undefined, me, false)
      cell.onmouseleave = () => this.tip.hide()
    })
  }

  dispose(): void {
    clearInterval(this.timer)
    this.el.remove()
    this.tip.dispose()
  }
}
