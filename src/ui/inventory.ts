// 가방 창 (I 또는 Tab): 디아블로처럼 왼쪽에 장비 다섯 칸 · 능력치, 오른쪽에 가방 30칸.
// 아이템에 마우스를 올리면 툴팁(등급 색 이름 · 옵션 · 끼고 있는 것과 비교), 왼클릭 = 끼기, 오른클릭 = 버리기(동료에게 선물).
// **상태를 직접 바꾸지 않는다** — 명령(CMD_*)만 LocalInput 에 넣고, sim 이 다음 틱에 모두의 화면에서 똑같이 처리한다(DESIGN 2장 3).
// 창이 열려 있어도 게임은 멈추지 않는다(협동). 대신 사격·스킬 입력은 막는다(클릭이 총질이 되지 않게).

import { itemIconUrl } from './itemIcons'
import { clickSuppressed, makeDraggable } from './dragItem'
import { keyLabel } from '../game/keymap'
import { CHARACTERS } from '../core/characters'
import { CMD_DROP, CMD_EQUIP, CMD_LOCK, CMD_RUNE, CMD_SELL, CMD_SORT, CMD_STASH_PUT, CMD_UNEQUIP } from '../core/input'
import {
  AFFIXES, Item, LEGENDS, RARITY_NAMES, RUNES, SETS, SLOT_ARMOR, SLOT_COUNT, SLOT_HELM, SLOT_NAMES, SLOT_WEAPON, ST_COUNT, WEAPON_IDS,
  affixText, affixValue, armorBase, computeStats, hasImplicit, itemColor, itemName, myGoldText, runeStat, setCounts, socketMax, weaponBaseDmg, xpNeed,
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
  // 소켓 · 룬 (2026-10-17): 박은 룬은 이 부위에서의 능력 · 빈 소켓 · 더 뚫을 수 있으면 그것도
  if (it.so) {
    const have = it.rn?.length ?? 0
    const runes = (it.rn ?? []).map((r) => `<div class="rune" style="--ru:${RUNES[r].color}">◆ ${RUNES[r].name} — ${affixText(...runeStat(r, it.slot))}</div>`).join('')
    const empty = it.so - have
    lines.push(
      `<div class="sock"><b>소켓 ${have} / ${it.so}</b>${runes}${empty > 0 ? `<div class="rune empty">○ 빈 소켓 ${empty} — 가방 창의 룬 주머니에서 박는다</div>` : ''}</div>`,
    )
  } else if (socketMax(it) > 0) lines.push(`<div class="sock dim">소켓 없음 — 대장장이가 ${socketMax(it)}개까지 뚫는다</div>`)
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
  return `<div class="it-head r${it.rarity}" style="--rc:${color}"><i class="ic" style="background-image:url(${itemIconUrl(it)})"></i><div class="it-name" style="color:${color}">${esc(itemName(it))}</div></div>
    <div class="it-kind">${RARITY_NAMES[it.rarity]}${it.set !== undefined ? ' <b class="settag">세트</b>' : ''} ${kind} · 아이템 레벨 ${it.ilvl}</div>
    ${lines.join('')}${warn}`
}

/**
 * 가방 칸에 쓰는 짧은 이름 (위 작은 글은 부위). 무기는 무기 이름의 끝말(소총 · 바이올린 · 첼로 · 웍 — "고기 바이올린" 은 칸에서
 * "고기 …" 로 잘려 첼로와 구분이 안 됐다), 방어구 · 장신구는 바탕의 앞말(사슬 · 판금 · 구리 — 한 낱말 바탕이면 그대로).
 * 2026-10-08 사용자: "아이템 창에서 일반 아이템의 이름이 안 보인다" — 예전에는 **전체 이름의 둘째 낱말**을 썼다(v0.4.0 이름 짓기 때의 것).
 * 일반 아이템은 이름이 바탕 하나라(소총 · 투구) 둘째 낱말이 없어 빈칸이 됐고, 희귀는 바탕 대신 옵션 앞말이 나왔다.
 */
function cellTag(it: Item): string {
  // 부위 이름 그대로 (2026-10-08 사용자: "가방에서 아이템은 그냥 무기 · 투구 · 갑옷 · 반지 · 목걸이로 — 판금 · 은 · 순례자 이렇게 표시되는 건 알맞지 않다")
  return SLOT_NAMES[it.slot] ?? ''
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
  const tag = cellTag(it)
  const so = it.so ? `<s class="so">${'●'.repeat(it.rn?.length ?? 0)}${'○'.repeat(it.so - (it.rn?.length ?? 0))}</s>` : ''
  return `<div class="cell r${it.rarity}${cant ? ' cant' : ''}${it.lk ? ' locked' : ''}${it.set !== undefined ? ' setp' : ''}" ${attr} style="--rc:${col}"><i class="ic" style="background-image:url(${itemIconUrl(it)})"></i><b>${esc(tag)}</b>${it.up ? `<u>+${it.up}</u>` : ''}${so}${it.lk ? '<i class="lk">🔒</i>' : ''}</div>`
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
    // 자리 (2026-10-08 사용자: "아이템에 마우스를 올렸을 때 설명이 가려진다"): 예전에는 늘 칸 왼쪽 250px · 칸 위에 맞춰 띄워
    // 비교 풍선(두 장)이면 둘째 장이 그 칸과 옆 칸을 덮었고, 아래쪽 칸이면 풍선이 화면 밖으로 잘렸다.
    // → 풍선 크기를 재서 **칸을 덮지 않는 쪽**(왼쪽 먼저, 모자라면 오른쪽)에 두고, 위아래 · 좌우를 화면 안으로 당긴다.
    const r = anchor.getBoundingClientRect()
    const op = this.el.offsetParent as HTMLElement | null
    const pr = op?.getBoundingClientRect() ?? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
    const scale = r.width / anchor.offsetWidth || 1
    // 실제 화면 크기로 잰다 (offsetWidth × 배율은 테두리 · 여백만큼 어긋났다 — 2026-10-08 화면 시험: 오른쪽 끝 칸을 3px 덮었다)
    const tr0 = this.el.getBoundingClientRect()
    const w = tr0.width
    const h = tr0.height
    const M = 8
    const GAP = 10
    // 보이는 칸: 게임 화면과 브라우저 창이 겹치는 곳
    const L = Math.max(0, pr.left) + M
    const T = Math.max(0, pr.top) + M
    const R = Math.min(window.innerWidth, pr.right) - M
    const B = Math.min(window.innerHeight, pr.bottom) - M
    let x = r.left - GAP - w
    if (x < L) x = r.right + GAP <= R - w ? r.right + GAP : Math.max(L, R - w)
    let y = r.top
    if (y + h > B) y = B - h
    if (y < T) y = T
    this.el.style.left = `${(x - pr.left) / scale}px`
    this.el.style.top = `${(y - pr.top) / scale}px`
    // 놓인 자리를 다시 재서 어긋난 만큼 바로잡는다 (부모의 테두리 · 여백 · 배율)
    const got = this.el.getBoundingClientRect()
    const dx = x - got.left
    const dy = y - got.top
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      this.el.style.left = `${(x - pr.left + dx) / scale}px`
      this.el.style.top = `${(y - pr.top + dy) / scale}px`
    }
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

/**
 * 가방 창의 쓰임 (2026-10-08 — 디아블로처럼 보관함 · 상인 창 옆에 같이 열린다):
 *  normal = 왼클릭 끼기 · 오른클릭 버리기 / stash = 클릭 · 오른클릭이 보관함으로 / sell = 오른클릭 팔기(전설 이상은 두 번)
 */
export type BagMode = 'normal' | 'stash' | 'sell'

export class Inventory {
  readonly el: HTMLElement
  private tip: ItemTip
  open = false
  private timer = 0
  private lastKey = ''
  private mode: BagMode = 'normal'
  /** 오른클릭 팔기를 한 번 누른 전설 이상 (두 번째에 판다) */
  private sellArm = -1
  /** 한 번 누른 룬 박기 (CMD_RUNE arg — 두 번째에 박는다 · 뺄 수 없으니까) */
  private runeArm = -1

  /**
   * 룬 주머니 (소켓 · 룬 — 2026-10-17): 가진 룬마다 개수와, 빈 소켓이 있는 낀 장비(무기 · 투구 · 갑옷)마다 "박기" 단추.
   * 같은 룬도 무기와 방어구에서 능력이 다르다(단추에 마우스를 올리면 보인다)
   */
  private runesHtml(me: PlayerState): string {
    const have = RUNES.map((d, r) => ({ d, r, n: me.runes?.[r] ?? 0 })).filter((x) => x.n > 0)
    const open = [SLOT_WEAPON, SLOT_HELM, SLOT_ARMOR].filter((k) => {
      const it = me.equip[k]
      return !!it && (it.rn?.length ?? 0) < (it.so ?? 0)
    })
    const total = have.reduce((a, x) => a + x.n, 0)
    const rows = have
      .map(({ d, r, n }) => {
        const tip = `무기 ${affixText(...runeStat(r, SLOT_WEAPON))} · 투구 · 갑옷 ${affixText(...runeStat(r, SLOT_ARMOR))}`
        const btns = open
          .map((k) => `<button type="button" data-rune="${k * 8 + r}" class="${this.runeArm === k * 8 + r ? 'arm' : ''}" title="${SLOT_NAMES[k]}에 박기 — ${affixText(...runeStat(r, k))}">${SLOT_NAMES[k]}</button>`)
          .join('')
        return `<div class="rune-row" style="--ru:${d.color}"><span title="${tip}"><i>◆</i>${d.name} ×${n}</span>${btns}</div>`
      })
      .join('')
    const hint = total === 0 ? '괴물이 떨어뜨린다 — 정예 · 우두머리 · 막 보스가 더 자주' : open.length === 0 ? '빈 소켓이 없다 — 대장장이가 뚫는다' : '박을 장비를 누른다 (뺄 수 없다)'
    return `<div class="inv-runes"><div class="ir-h"><b>룬 주머니 ${total}</b><small>${hint}</small></div>${rows}</div>`
  }

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
    this.el.addEventListener('scroll', () => this.tip.hide(), { passive: true, capture: true })
    this.el.addEventListener('contextmenu', (e) => e.preventDefault())
    // 창 안의 클릭이 게임(사격)으로 새지 않게
    for (const ev of ['mousedown', 'mouseup', 'click']) this.el.addEventListener(ev, (e) => e.stopPropagation())
  }

  /** 보관함 · 상인 창이 열리고 닫힐 때 세션이 바꾼다 */
  setMode(m: BagMode): void {
    if (m === this.mode) return
    this.mode = m
    this.sellArm = -1
    this.el.classList.toggle('docked', m !== 'normal')
    this.lastKey = ''
    if (this.open) this.render()
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

  /** 잠깐 보이는 알림 줄 (가방 창 위 — 2.5초) */
  private note = ''
  private noteTimer = 0
  private flash(msg: string): void {
    this.note = msg
    clearTimeout(this.noteTimer)
    this.noteTimer = window.setTimeout(() => {
      this.note = ''
      if (this.open) this.render()
    }, 2500)
    this.render()
  }

  private render(): void {
    const me = this.me()
    const key = JSON.stringify([this.mode, me.level, me.xp, me.gold, me.bagMax, me.attr, me.st.map((v) => Math.round(v * 10)), me.equip.map((e) => `${e?.uid ?? 0}:${e?.so ?? 0}:${e?.rn?.length ?? 0}`), me.bag.map((b) => `${b.uid}${b.lk ? 'L' : ''}${b.up ?? 0}`), me.runes, this.runeArm, this.note])
    if (key === this.lastKey) return
    this.lastKey = key
    const c = CHARACTERS[me.char]
    const need = xpNeed(me.level)
    const slot = (i: number) => {
      const it = me.equip[i]
      const col = it ? itemColor(it) : 'rgba(201,162,74,0.3)'
      return `<div class="eq${it ? ` r${it.rarity}` : ''}" data-eq="${i}" data-drop="eq" style="--rc:${col}">${it ? `<i class="ic" style="background-image:url(${itemIconUrl(it)})"></i>` : ''}<small>${SLOT_NAMES[i]}</small>${it ? `<b style="color:${col}">${esc(itemName(it))}</b>` : '<i>비어 있음</i>'}</div>`
    }
    const stats = [0, 1, 2, 3, 4, 5, 6, 7, 9].map((i) => {
      const v = Math.round(me.st[i] * 10) / 10
      return `<div><span>${AFFIXES[i].name}</span><b>${v > 0 ? (i === 6 || i === 9 ? '-' : '+') : ''}${v}${AFFIXES[i].pct ? '%' : ''}</b></div>`
    })
    const cells: string[] = []
    for (let i = 0; i < me.bagMax; i++) cells.push(cellHtml(me.bag[i], `data-bag="${i}"`, me))
    this.el.innerHTML = `
      <div class="inv-head"><b>${c.name}</b><span>레벨 ${me.level}</span><span class="gold">${myGoldText(me.gold)}</span><button class="inv-x" title="닫기 (${keyLabel('bag')} · Tab · Esc)">✕</button></div>
      <div class="inv-xp"><i style="width:${Math.min(100, (me.xp / need) * 100).toFixed(1)}%"></i><span>${me.xp} / ${need}</span></div>
      <div class="inv-body">
        <div class="inv-left">
          <div class="eqs">${Array.from({ length: SLOT_COUNT }, (_, i) => slot(i)).join('')}</div>
          <div class="inv-stats">${stats.join('')}</div>
          ${this.runesHtml(me)}
        </div>
        <div class="inv-right">
          <div class="bag-h">가방 ${me.bag.length} / ${me.bagMax}
            <button class="bag-sort" data-sort title="등급이 높은 것부터 줄 세운다">정렬</button>
            <small>${
               this.mode === 'stash'
                 ? '<b>클릭 · 오른클릭 → 보관함</b> · 끌어서 장비 칸에 끼기 · <b>Shift+클릭 잠금</b>'
                 : this.mode === 'sell'
                   ? '<b>오른클릭 팔기</b>(전설 이상은 두 번) · 왼클릭 끼기 · <b>Shift+클릭 잠금</b>'
                   : '왼클릭 끼기 · 오른클릭 버리기 · 끌어서 장비 칸 · <b>Shift+클릭 잠금</b>(팔기 · 재료에서 빠짐)'
             }</small></div>
          ${this.note ? `<p class="inv-note">${esc(this.note)}</p>` : ''}
          <div class="bag" data-drop="bag">${cells.join('')}</div>
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
        if (!me.bag[i] || clickSuppressed()) return
        // Shift+클릭 = 잠금 토글 (실수로 팔거나 버리지 않게 — "전부 팔기" 의 짝). 보관함이 열려 있으면 클릭은 보관함으로
        this.send((e as MouseEvent).shiftKey ? CMD_LOCK : this.mode === 'stash' ? CMD_STASH_PUT : CMD_EQUIP, i)
        this.lastKey = ''
        this.tip.hide()
      }
      cell.oncontextmenu = (e) => {
        e.preventDefault()
        this.tip.hide()
        const it = me.bag[i]
        if (!it) return
        // 보관함 곁: 보관함으로 · 상인 곁: 팔기 · 그 밖: 버리기 (보관함 · 상인 곁에서는 버리지 않는다)
        if (this.mode === 'stash') return this.send(CMD_STASH_PUT, i)
        if (this.mode === 'sell') {
          if (it.lk) return this.flash('잠근 것은 팔 수 없다 — Shift+클릭으로 풀기')
          if (it.rarity >= 3 && this.sellArm !== it.uid) {
            this.sellArm = it.uid
            return this.flash(`한 번 더 오른클릭하면 팝니다 — ${itemName(it)}`)
          }
          this.sellArm = -1
          return this.send(CMD_SELL, i)
        }
        if (!it.lk) this.send(CMD_DROP, i)
      }
      // 끌어다 놓기: 보관함 칸 → 보관 · 장비 칸 → 끼기 · 상인 창 → 팔기
      makeDraggable(cell, () => (me.bag[i] ? { from: 'bag', index: i, icon: itemIconUrl(me.bag[i]) } : null), (s, t) => {
        this.tip.hide()
        const d = t.dataset.drop
        if (d === 'stash') this.send(CMD_STASH_PUT, s.index)
        else if (d === 'eq') this.send(CMD_EQUIP, s.index)
        else if (d === 'sell') {
          const it = me.bag[s.index]
          if (it?.lk) this.flash('잠근 것은 팔 수 없다 — Shift+클릭으로 풀기')
          else this.send(CMD_SELL, s.index)
        }
        this.lastKey = ''
      })
      cell.onmouseenter = () => this.tip.show(cell, me.bag[i], me, true)
      cell.onmouseleave = () => this.tip.hide()
    })
    this.el.querySelectorAll<HTMLButtonElement>('[data-rune]').forEach((b) => {
      b.onclick = () => {
        const arg = Number(b.dataset.rune)
        // 박은 룬은 뺄 수 없다 — 한 번 더 눌러야 박는다
        if (this.runeArm !== arg) {
          this.runeArm = arg
          this.flash(`한 번 더 누르면 박는다 — ${RUNES[arg & 7].name} → ${SLOT_NAMES[arg >> 3]} (뺄 수 없다)`)
          this.lastKey = ''
          return
        }
        this.runeArm = -1
        this.send(CMD_RUNE, arg)
        this.lastKey = ''
      }
    })
    this.el.querySelectorAll<HTMLElement>('[data-eq]').forEach((cell) => {
      const i = Number(cell.dataset.eq)
      cell.onclick = () => {
        // 가방이 가득 차면 벗을 수 없다(sim 이 조용히 거른다) — 까닭을 잠깐 보인다 (2026-10-08)
        if (me.equip[i] && me.bag.length >= me.bagMax) this.flash('가방이 가득 찼다 — 벗으려면 빈 칸이 필요하다')
        else if (me.equip[i]) this.send(CMD_UNEQUIP, i)
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
