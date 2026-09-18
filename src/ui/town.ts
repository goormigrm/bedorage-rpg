// 마을 NPC 창 (GUIDE 9장 — 디아블로 2 의 상인·대장장이·도박꾼·보관함). NPC 곁에서 F.
// 가방 창과 같은 원칙: **상태를 직접 바꾸지 않는다** — CMD_* 만 넣고 sim 이 다음 틱에 모두의 화면에서 똑같이 처리한다.
// 창이 열려 있어도 게임은 돈다(마을이라 안전). 멀어지면 닫힌다.

import { CMD_BUY, CMD_GAMBLE, CMD_POTUP, CMD_REROLL, CMD_SELL, CMD_STASH_PUT, CMD_STASH_TAKE } from '../core/input'
import {
  Item, LEGENDS, RARITY_COLORS, SLOT_COUNT, SLOT_NAMES, STASH_SIZE, affixText, buyPrice, gamblePrice, itemName, itemValue, potUpPrice, rerollPrice,
} from '../core/items'
import { GameState, PlayerState } from '../core/state'
import { NPC_NAMES, NpcId } from '../core/world'

function esc(t: string): string {
  return t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch)
}

/** 아이템 한 줄 (이름 · 옵션 요약) */
function row(it: Item, right: string, data: string, disabled = false): string {
  const affs = []
  for (let k = 0; k < it.aff.length; k += 2) affs.push(affixText(it.aff[k], it.aff[k + 1]))
  if (it.rarity === 3 && it.leg !== undefined && LEGENDS[it.leg]) affs.push(`✦ ${LEGENDS[it.leg].name}`)
  return `<button class="tp-row" ${data} ${disabled ? 'disabled' : ''}>
    <span class="tp-n" style="color:${RARITY_COLORS[it.rarity]}">${esc(itemName(it))}<small>${SLOT_NAMES[it.slot]} · 레벨 ${it.ilvl}</small></span>
    <span class="tp-a">${affs.map(esc).join(' · ') || '옵션 없음'}</span>
    <span class="tp-g">${right}</span></button>`
}

const LINES: Record<NpcId, string> = {
  merchant: '살 게 있으면 사고, 팔 게 있으면 팔게. 물약 주머니도 늘려 주지.',
  smith: '옵션 하나가 마음에 안 들면 가져와. 두드려서 다른 걸로 바꿔 주지 — 공짜는 아니고.',
  gambler: '안을 들여다보지 않고 사는 재미를 알아? 뭐가 나올지는 나도 몰라.',
  stash: '캐릭터끼리 나눠 쓰는 보관함이다. 넣어 둔 것은 다른 캐릭터로도 꺼낼 수 있다.',
  elder: '성당 종이 멈춘 밤부터 모든 게 틀어졌소… (촌장의 부탁은 곧 들을 수 있다)',
  captain: '칼 쓰는 녀석이 필요하면 말해. (용병 고용은 곧)',
}

export class TownPanel {
  readonly el: HTMLElement
  open: NpcId | null = null
  private tab: 'buy' | 'sell' = 'buy'
  private lastSig = ''

  constructor(
    parent: HTMLElement,
    private state: () => GameState,
    private me: () => PlayerState,
    private send: (cmd: number, arg: number) => void,
    private onToggle: (open: boolean) => void,
  ) {
    this.el = document.createElement('div')
    this.el.className = 'tp'
    this.el.hidden = true
    parent.appendChild(this.el)
  }

  show(npc: NpcId | null): void {
    this.open = npc
    this.el.hidden = !npc
    this.lastSig = ''
    if (npc) this.render()
    this.onToggle(!!npc)
  }

  /** 매 프레임: 판이 바뀌었으면(샀다·팔았다) 다시 그린다 */
  refresh(): void {
    if (!this.open) return
    const me = this.me()
    const s = this.state()
    const sig = `${this.tab}|${me.gold}|${me.bag.map((i) => i.uid + ':' + i.aff.join(',')).join(';')}|${me.stash.length}|${s.shop.length}|${me.potMax}`
    if (sig !== this.lastSig) this.render()
  }

  private render(): void {
    const npc = this.open
    if (!npc) return
    const me = this.me()
    const s = this.state()
    this.lastSig = `${this.tab}|${me.gold}|${me.bag.map((i) => i.uid + ':' + i.aff.join(',')).join(';')}|${me.stash.length}|${s.shop.length}|${me.potMax}`
    let body = ''
    if (npc === 'merchant') {
      const tabs = `<div class="tp-tabs"><button data-tab="buy" class="${this.tab === 'buy' ? 'on' : ''}">사기</button><button data-tab="sell" class="${this.tab === 'sell' ? 'on' : ''}">팔기</button></div>`
      const list =
        this.tab === 'buy'
          ? s.shop.map((it, i) => row(it, `${buyPrice(it)} 골드`, `data-cmd="${CMD_BUY}" data-arg="${i}"`, me.gold < buyPrice(it))).join('') || '<p class="tp-empty">다 팔렸다. 다음 게임에 새로 들어온다.</p>'
          : me.bag.map((it, i) => row(it, `+${itemValue(it)} 골드`, `data-cmd="${CMD_SELL}" data-arg="${i}"`)).join('') || '<p class="tp-empty">가방이 비었다.</p>'
      const pot = me.potMax >= 8 ? '<p class="tp-note">물약 주머니가 가장 크다 (8칸).</p>' : `<button class="btn tp-pot" data-cmd="${CMD_POTUP}" data-arg="0" ${me.gold < potUpPrice(me.potMax) ? 'disabled' : ''}>물약 주머니 늘리기 ${me.potMax} → ${me.potMax + 1}칸 · ${potUpPrice(me.potMax)} 골드</button>`
      body = tabs + `<div class="tp-list">${list}</div>` + pot
    } else if (npc === 'smith') {
      body = `<p class="tp-note">누르면 옵션 하나가 같은 칸의 다른 옵션으로 바뀐다 (무엇이 될지는 모른다).</p><div class="tp-list">${
        me.bag.map((it, i) => row(it, `${rerollPrice(it)} 골드`, `data-cmd="${CMD_REROLL}" data-arg="${i}"`, it.aff.length === 0 || me.gold < rerollPrice(it))).join('') || '<p class="tp-empty">가방이 비었다. 장비를 벗어 가방에 넣어 오라.</p>'
      }</div>`
    } else if (npc === 'gambler') {
      const price = gamblePrice(me.level)
      body = `<p class="tp-note">칸을 고르면 그 칸의 아이템 하나 (레벨 ${me.level + 2} · 등급은 운) — ${price} 골드.</p><div class="tp-slots">${Array.from({ length: SLOT_COUNT }, (_, k) => `<button class="btn" data-cmd="${CMD_GAMBLE}" data-arg="${k}" ${me.gold < price ? 'disabled' : ''}>${SLOT_NAMES[k]}</button>`).join('')}</div>`
    } else if (npc === 'stash') {
      body = `<div class="tp-cols"><div><div class="tp-h">가방 (${me.bag.length}) — 누르면 넣기</div><div class="tp-list">${me.bag.map((it, i) => row(it, '→', `data-cmd="${CMD_STASH_PUT}" data-arg="${i}"`, me.stash.length >= STASH_SIZE)).join('') || '<p class="tp-empty">비었다</p>'}</div></div>
        <div><div class="tp-h">보관함 (${me.stash.length}/${STASH_SIZE}) — 누르면 꺼내기</div><div class="tp-list">${me.stash.map((it, i) => row(it, '←', `data-cmd="${CMD_STASH_TAKE}" data-arg="${i}"`)).join('') || '<p class="tp-empty">비었다</p>'}</div></div></div>`
    } else {
      body = ''
    }
    this.el.innerHTML = `<div class="tp-head"><b>${NPC_NAMES[npc]}</b><span class="tp-gold">${me.gold} 골드</span><button class="inv-x" data-x>✕</button></div>
      <p class="tp-line">"${LINES[npc]}"</p>${body}<p class="tp-hint">F · Esc 로 닫기</p>`
    this.el.classList.toggle('wide', npc === 'stash')
    this.el.querySelector<HTMLButtonElement>('[data-x]')!.onclick = () => this.show(null)
    this.el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => {
      b.onclick = () => {
        this.tab = b.dataset.tab === 'sell' ? 'sell' : 'buy'
        this.render()
      }
    })
    this.el.querySelectorAll<HTMLButtonElement>('[data-cmd]').forEach((b) => {
      b.onclick = () => this.send(Number(b.dataset.cmd), Number(b.dataset.arg))
    })
  }
}
