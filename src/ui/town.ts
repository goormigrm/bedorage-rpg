// 마을 NPC 창 (GUIDE 9장 — 디아블로 2 의 상인·대장장이·도박꾼·보관함). NPC 곁에서 F.
// 가방 창과 같은 원칙: **상태를 직접 바꾸지 않는다** — CMD_* 만 넣고 sim 이 다음 틱에 모두의 화면에서 똑같이 처리한다.
// 창이 열려 있어도 게임은 돈다(마을이라 안전). 멀어지면 닫힌다.

import { CMD_BUY, CMD_GAMBLE, CMD_HIRE, CMD_SELL, CMD_STASH_PUT, CMD_STASH_TAKE, CMD_UPGRADE } from '../core/input'
import { CHARACTERS, PLAYABLE } from '../core/characters'
import { mercPrice } from '../core/sim'
import {
  Item, LEGENDS, RARITY_COLORS, RARITY_NAMES, SLOT_COUNT, SLOT_NAMES, STASH_SIZE, UPGRADE_MAX, affixText, affixValue, buyPrice, gamblePrice, itemName, itemValue,
  upgradeMaterials, upgradeNeed, upgradePrice,
} from '../core/items'
import { GameState, PlayerState } from '../core/state'
import { ACTS, AREAS, NPC_NAMES, NpcId, QUESTS, actReached, areaDef, questDiscount } from '../core/world'
import { CMD_QUEST } from '../core/input'

/** 퀘스트 목록 (촌장 창 — 버튼 있음 · 퀘스트 기록 — 버튼 없음) */
export function questList(q: number[], buttons: boolean): string {
  return QUESTS.map((d, i) => {
    const st = q[i] ?? 0
    if (st < 0) return ''
    const tag = ['아직 모름', '진행 중', '이룸 — 촌장에게 보고', '끝'][st]
    const btn = !buttons ? '' : st === 0 ? `<button class="btn" data-cmd="${CMD_QUEST}" data-arg="${i}">맡는다</button>` : st === 2 ? `<button class="btn tp-claim" data-cmd="${CMD_QUEST}" data-arg="${i}">보상 받기 — ${d.reward}</button>` : ''
    const say = st === 3 ? d.thanks : d.ask
    return `<div class="q-row q${st}"><div class="q-h"><b>${d.name}</b><span>${tag}</span></div>
      ${st === 0 && !buttons ? '' : `<p class="q-say">"${say}"</p>`}
      ${st < 3 ? `<p class="q-task">◆ ${d.task} · 보상: ${d.reward}</p>` : ''}${btn}</div>`
  }).join('')
}

/** 퀘스트 기록 (J) */
export class QuestLog {
  readonly el: HTMLElement
  open = false
  private sig = ''
  constructor(parent: HTMLElement, private me: () => PlayerState, private onToggle: (open: boolean) => void) {
    this.el = document.createElement('div')
    this.el.className = 'tp'
    this.el.hidden = true
    parent.appendChild(this.el)
  }
  toggle(open = !this.open): void {
    this.open = open
    this.el.hidden = !open
    this.sig = ''
    this.refresh()
    this.onToggle(open)
  }
  refresh(): void {
    if (!this.open) return
    const q = this.me().quests
    if (q.join('') === this.sig) return
    this.sig = q.join('')
    // 연 막까지, 막마다 묶어서 (뒤 막이 위)
    const reach = actReached(q)
    let body = ''
    for (let act = reach; act >= 0; act--) body += `<p class="tp-line">${act + 1}막 · ${ACTS[act].name}</p>` + questList(q.map((v, i) => (QUESTS[i]?.act === act ? v : -1)), false)
    this.el.innerHTML = `<div class="tp-head"><b>퀘스트</b><button class="inv-x" data-x>✕</button></div>${body}<p class="tp-hint">퀘스트는 마을의 촌장 카인이 맡긴다 · J · Esc 로 닫기</p>`
    this.el.querySelector<HTMLButtonElement>('[data-x]')!.onclick = () => this.toggle(false)
  }
}

function esc(t: string): string {
  return t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch)
}

/** 아이템 한 줄 (이름 · 옵션 요약) */
function row(it: Item, right: string, data: string, disabled = false): string {
  const affs = []
  for (let k = 0; k < it.aff.length; k += 2) affs.push(affixText(it.aff[k], affixValue(it, k)))
  if (it.rarity >= 3 && it.leg !== undefined && LEGENDS[it.leg]) affs.push(`✦ ${LEGENDS[it.leg].name}`)
  return `<button class="tp-row" ${data} ${disabled ? 'disabled' : ''}>
    <span class="tp-n" style="color:${RARITY_COLORS[it.rarity]}">${esc(itemName(it))}<small>${RARITY_NAMES[it.rarity]} ${SLOT_NAMES[it.slot]} · 레벨 ${it.ilvl}</small></span>
    <span class="tp-a">${affs.map(esc).join(' · ') || '옵션 없음'}</span>
    <span class="tp-g">${right}</span></button>`
}

const LINES: Record<NpcId, string> = {
  merchant: '살 게 있으면 사고, 팔 게 있으면 팔게.',
  smith: '같은 부위, 같은 등급 물건을 모아 와. 녹여서 네 장비를 한 단계 단단하게 만들어 주지.',
  gambler: '안을 들여다보지 않고 사는 재미를 알아? 뭐가 나올지는 나도 몰라.',
  stash: '캐릭터끼리 나눠 쓰는 보관함이다. 넣어 둔 것은 다른 캐릭터로도 꺼낼 수 있다.',
  elder: '성당 종이 멈춘 밤부터 모든 게 틀어졌소. 부탁할 것이 있소…',
  captain: '혼자 가기 무서우면 말해. 쓸 만한 녀석을 붙여 주지.',
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
    const sig = `${this.tab}|${me.quests.join('')}|${me.gold}|${me.bag.map((i) => i.uid + ':' + (i.up ?? 0)).join(';')}|${me.equip.map((i) => (i ? i.uid + ':' + (i.up ?? 0) : '-')).join(';')}|${me.stash.length}|${s.shop.length}`
    if (sig !== this.lastSig) this.render()
  }

  private render(): void {
    const npc = this.open
    if (!npc) return
    const me = this.me()
    const s = this.state()
    this.lastSig = `${this.tab}|${me.quests.join('')}|${me.gold}|${me.bag.map((i) => i.uid + ':' + (i.up ?? 0)).join(';')}|${me.equip.map((i) => (i ? i.uid + ':' + (i.up ?? 0) : '-')).join(';')}|${me.stash.length}|${s.shop.length}`
    let body = ''
    if (npc === 'merchant') {
      const tabs = `<div class="tp-tabs"><button data-tab="buy" class="${this.tab === 'buy' ? 'on' : ''}">사기</button><button data-tab="sell" class="${this.tab === 'sell' ? 'on' : ''}">팔기</button></div>`
      const list =
        this.tab === 'buy'
          ? s.shop.map((it, i) => {
              const price = Math.round(buyPrice(it) * questDiscount(me.quests))
              return row(it, `${price} 골드`, `data-cmd="${CMD_BUY}" data-arg="${i}"`, me.gold < price)
            }).join('') || '<p class="tp-empty">다 팔렸다. 다음 게임에 새로 들어온다.</p>'
          : me.bag.map((it, i) => row(it, `+${itemValue(it)} 골드`, `data-cmd="${CMD_SELL}" data-arg="${i}"`)).join('') || '<p class="tp-empty">가방이 비었다.</p>'
      // 물약 주머니는 없앴다 (회복은 체력 구슬 하나로 — 2026-09-19)
      const pot = ''
      body = tabs + `<div class="tp-list">${list}</div>` + pot
    } else if (npc === 'smith') {
      // 강화 (2026-09-19 — 옵션 다시 굴리기를 없앴다): 낀 장비 · 가방. 같은 부위 · 같은 등급 (단계 + 1)개를 녹인다
      const cand: { it: Item; arg: number; where: string }[] = []
      me.equip.forEach((it, k) => it && cand.push({ it, arg: 100 + k, where: '낀 것' }))
      me.bag.forEach((it, i) => cand.push({ it, arg: i, where: '가방' }))
      const list = cand
        .map(({ it, arg, where }) => {
          const lv = it.up ?? 0
          if (lv >= UPGRADE_MAX) return row(it, `${where} · +${lv} 최대`, '', true)
          const need = upgradeNeed(it)
          const have = upgradeMaterials(me.bag, it).length
          const g = upgradePrice(it)
          return row(it, `${where} · +${lv} → +${lv + 1}<br>재료 ${Math.min(have, need)}/${need} · ${g} 골드`, `data-cmd="${CMD_UPGRADE}" data-arg="${arg}"`, have < need || me.gold < g)
        })
        .join('')
      body = `<p class="tp-note">같은 부위 · 같은 등급의 아이템을 <b>(지금 단계 + 1)개</b> 녹여 한 단계 올린다 — 단계마다 옵션 · 기본 피해/방어 +10%, 최대 +5. 재료는 가방에서 값싼 것부터 쓴다.</p><div class="tp-list">${
        list || '<p class="tp-empty">강화할 장비가 없다.</p>'
      }</div>`
    } else if (npc === 'gambler') {
      const price = gamblePrice(me.level)
      body = `<p class="tp-note">칸을 고르면 그 칸의 아이템 하나 (레벨 ${me.level + 2} · 등급은 운) — ${price} 골드.</p><div class="tp-slots">${Array.from({ length: SLOT_COUNT }, (_, k) => `<button class="btn" data-cmd="${CMD_GAMBLE}" data-arg="${k}" ${me.gold < price ? 'disabled' : ''}>${SLOT_NAMES[k]}</button>`).join('')}</div>`
    } else if (npc === 'stash') {
      body = `<div class="tp-cols"><div><div class="tp-h">가방 (${me.bag.length}) — 누르면 넣기</div><div class="tp-list">${me.bag.map((it, i) => row(it, '→', `data-cmd="${CMD_STASH_PUT}" data-arg="${i}"`, me.stash.length >= STASH_SIZE)).join('') || '<p class="tp-empty">비었다</p>'}</div></div>
        <div><div class="tp-h">보관함 (${me.stash.length}/${STASH_SIZE}) — 누르면 꺼내기</div><div class="tp-list">${me.stash.map((it, i) => row(it, '←', `data-cmd="${CMD_STASH_TAKE}" data-arg="${i}"`)).join('') || '<p class="tp-empty">비었다</p>'}</div></div></div>`
    } else if (npc === 'elder') {
      const reach = actReached(me.quests)
      const here = areaDef(me.area).act
      const travel = ACTS.map((a, i) => (i <= reach && i !== here ? `<button class="btn" data-cmd="${CMD_QUEST}" data-arg="${100 + i}">${i + 1}막 ${a.name}으로 — ${AREAS[a.town].name}</button>` : '')).join('')
      body = questList(me.quests.map((v, i) => (QUESTS[i]?.act === here ? v : -1)), true) + (travel ? `<div class="tp-slots">${travel}</div>` : '')
    } else if (npc === 'captain') {
      const mine = s.players.find((q) => q.merc === me.id && !q.left)
      const price = mercPrice(me.level)
      const free = s.players.some((q) => q.vacant && q.left)
      body = mine
        ? `<p class="tp-note">지금 <b>${CHARACTERS[mine.char].name}</b>(레벨 ${mine.level})이 따라다닌다. 쓰러지면 마을에서 다시 일어나 곁으로 온다.</p><button class="btn" data-cmd="${CMD_HIRE}" data-arg="255">내보내기</button>`
        : !free
          ? '<p class="tp-empty">게임 자리가 다 찼다 — 용병을 앉힐 자리가 없다 (최대 4명).</p>'
          : `<p class="tp-note">빈 자리에 용병 하나 (내 레벨 · 나를 따라다닌다) — ${price} 골드.</p><div class="tp-slots">${PLAYABLE.filter((id) => id !== me.char)
              .map((id) => `<button class="btn" data-cmd="${CMD_HIRE}" data-arg="${PLAYABLE.indexOf(id)}" ${me.gold < price ? 'disabled' : ''}>${CHARACTERS[id].name}</button>`)
              .join('')}</div>`
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
