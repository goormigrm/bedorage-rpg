// 마을 NPC 창 (GUIDE 9장 — 디아블로 2 의 상인·대장장이·도박꾼·보관함). NPC 곁에서 F.
// 가방 창과 같은 원칙: **상태를 직접 바꾸지 않는다** — CMD_* 만 넣고 sim 이 다음 틱에 모두의 화면에서 똑같이 처리한다.
// 창이 열려 있어도 게임은 돈다(마을이라 안전). 멀어지면 닫힌다.

import { CMD_BAGUP, CMD_BUY, CMD_FORGE, CMD_GAMBLE, CMD_HIRE, CMD_SELL, CMD_SELL_ALL, CMD_SHOPNEW, CMD_SORT, CMD_STASHUP, CMD_STASH_PUT, CMD_STASH_TAKE, CMD_UPGRADE } from '../core/input'
import { CHARACTERS, PLAYABLE, ROLE_INFO } from '../core/characters'
import { mercPrice } from '../core/sim'
import {
  BAG_MAX, BAG_STEP, FORGE_MAX, FORGE_MIN, STASH_AT, STASH_MAX, STASH_STEP, bagUpPrice, forgeIlvl, forgeMaterials, forgeNeed, forgeOdds, forgePrice, goldText, isJunk, Item, LEGENDS, myGoldText, RARITY_COLORS, RARITY_NAMES, shopNewPrice, SLOT_COUNT, SLOT_NAMES, stashUpPrice, UPGRADE_MAX, affixText, affixValue, buyPrice, gamblePrice, itemName, itemValue,
  upgradeMaterials, upgradeNeed, upgradePrice,
} from '../core/items'
import { GameState, PlayerState } from '../core/state'
import { ItemTip, cellHtml, itemHtml } from './inventory'
import { keyLabel } from '../game/keymap'
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

/**
 * 아이템 한 줄 (이름 · 옵션 요약).
 * `short` 면 옵션을 둘까지만 적고 나머지는 "외 N" 으로 줄인다 — 보관함처럼 두 칸을 나란히 놓는 창에서
 * 설명이 길면 줄이 들쭉날쭉해져 어디까지가 가방이고 어디부터가 보관함인지 흐려진다 (2026-09-20 제보).
 */
function row(it: Item, right: string, data: string, disabled = false, short = false): string {
  const affs = []
  for (let k = 0; k < it.aff.length; k += 2) affs.push(affixText(it.aff[k], affixValue(it, k)))
  const leg = it.rarity >= 3 && it.leg !== undefined && LEGENDS[it.leg] ? `✦ ${LEGENDS[it.leg].name}` : ''
  let text: string
  if (short) {
    const head = affs.slice(0, 2).map(esc).join(' · ')
    const more = affs.length - 2
    text = [head || '옵션 없음', more > 0 ? `외 ${more}` : '', leg ? esc(leg) : ''].filter(Boolean).join(' · ')
  } else {
    if (leg) affs.push(leg)
    text = affs.map(esc).join(' · ') || '옵션 없음'
  }
  const up = it.up ? `<b class="tp-up">+${it.up}</b>` : ''
  return `<button class="tp-row${short ? ' short' : ''}" ${data} ${disabled ? 'disabled' : ''}>
    <span class="tp-n" style="color:${RARITY_COLORS[it.rarity]}">${esc(itemName(it))}${up}<small>${RARITY_NAMES[it.rarity]} ${SLOT_NAMES[it.slot]} · 레벨 ${it.ilvl}</small></span>
    <span class="tp-a">${text}</span>
    <span class="tp-g">${right}</span></button>`
}

const LINES: Record<NpcId, string> = {
  merchant: '살 게 있으면 사고, 팔 게 있으면 팔게.',
  smith: '같은 부위, 같은 등급 물건을 모아 와 — 녹여서 단단하게 해 주지. 같은 등급을 여럿 모아 오면 한 단계 위를 벼려 볼 수도 있고.',
  gambler: '안을 들여다보지 않고 사는 재미를 알아? 뭐가 나올지는 나도 몰라.',
  stash: '캐릭터끼리 나눠 쓰는 보관함이다. 넣어 둔 것은 다른 캐릭터로도 꺼낼 수 있다.',
  elder: '종이 멈춘 밤부터 모든 게 틀어졌소. 당신들도 그 밤에 떨어졌다지 — 서로 도울 일이 있겠구려.',
  captain: '혼자 가기 무서우면 말해. 쓸 만한 녀석을 붙여 주지.',
}

export class TownPanel {
  readonly el: HTMLElement
  open: NpcId | null = null
  private tab: 'buy' | 'sell' = 'buy'
  /** 대장장이 탭 (강화 · 전설 벼리기) */
  private smithTab: 'up' | 'forge' = 'up'
  /** "전부 팔기" 를 한 번 눌렀다 (한 번 더 눌러야 실제로 판다 — 실수 방지) */
  private sellArmed = false
  /** 벼리기에서 고른 재료 등급 (1 마법 · 2 희귀 · 3 전설) */
  private forgeRarity = 2
  /** 마지막 벼리기 결과 (창 위에 카드로 — 2026-09-20 "뭐가 나왔는지 확실하게") */
  private lastForge: { it: Item; up: boolean } | null = null
  /** 마지막 도박 결과 (2026-09-25 "뽑았을 때 어떤 아이템을 뽑았는지 알려 줘") */
  private lastGamble: { items: Item[]; gold: number } | null = null
  private lastSig = ''
  /** 아이템 설명 풍선 — 보관함 · 도박 결과의 칸에 마우스를 올리면 (가방 창과 같은 것) */
  private tip: ItemTip

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
    this.tip = new ItemTip(parent)
  }

  /** 세션이 벼리기 결과를 알려 준다 (sim 이벤트) */
  forgeResult(it: Item, up: boolean): void {
    this.lastForge = { it, up }
    this.lastSig = ''
    if (this.open === 'smith') this.render()
  }

  /** 세션이 도박 결과를 알려 준다 (sim 이벤트 — 뽑은 것 전부) */
  gambleResult(items: Item[], gold: number): void {
    this.lastGamble = { items, gold }
    this.lastSig = ''
    if (this.open === 'gambler') this.render()
  }

  show(npc: NpcId | null): void {
    this.sellArmed = false
    this.lastForge = null
    this.lastGamble = null
    this.tip.hide()
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
    const sig = this.sigOf(me, s)
    if (sig !== this.lastSig) this.render()
  }

  /**
   * 창을 다시 그릴지 가르는 값. **보관함도 순서까지 본다** — 개수만 보던 때는 보관함을 정렬해도(개수 그대로)
   * 창이 다시 그려지지 않아 정렬이 안 되는 것처럼 보였다(2026-09-23 사용자). 그리는 쪽과 보는 쪽이 같은 값을 쓴다.
   */
  private sigOf(me: PlayerState, s: GameState): string {
    const items = (l: Item[]) => l.map((i) => i.uid + ':' + (i.up ?? 0) + (i.lk ? 'L' : '')).join(';')
    return `${this.tab}|${this.smithTab}|${this.forgeRarity}|${this.sellArmed}|${me.quests.join('')}|${me.gold}|${me.bagMax}|${me.stashMax}|${items(me.bag)}|${me.equip
      .map((i) => (i ? i.uid + ':' + (i.up ?? 0) : '-'))
      .join(';')}|${items(me.stash)}|${s.shop.map((i) => i.uid).join(';')}|${this.lastGamble?.items.map((i) => i.uid).join(';') ?? ''}`
  }

  private render(): void {
    const npc = this.open
    if (!npc) return
    const me = this.me()
    const s = this.state()
    this.lastSig = this.sigOf(me, s)
    let body = ''
    if (npc === 'merchant') {
      const tabs = `<div class="tp-tabs"><button data-tab="buy" class="${this.tab === 'buy' ? 'on' : ''}">사기</button><button data-tab="sell" class="${this.tab === 'sell' ? 'on' : ''}">팔기</button></div>`
      const list =
        this.tab === 'buy'
          ? s.shop.map((it, i) => {
              const price = Math.round(buyPrice(it) * questDiscount(me.quests))
              return row(it, `${price} 골드`, `data-cmd="${CMD_BUY}" data-arg="${i}"`, me.gold < price)
            }).join('') || '<p class="tp-empty">다 팔렸다. 다음 게임에 새로 들어온다.</p>'
          : me.bag.map((it, i) => row(it, it.lk ? '🔒 잠금' : `+${itemValue(it)} 골드`, it.lk ? '' : `data-cmd="${CMD_SELL}" data-arg="${i}"`, !!it.lk)).join('') || '<p class="tp-empty">가방이 비었다.</p>'
      // 한꺼번에 팔기 (2026-09-20 요청). 잠근 것은 빠진다 — 가방 창에서 Shift+클릭으로 잠근다
      let bulk = ''
      if (this.tab === 'sell') {
        const junk = me.bag.filter((it) => !it.lk && isJunk(it))
        const all = me.bag.filter((it) => !it.lk)
        const sum = (a: Item[]) => a.reduce((g, it) => g + itemValue(it), 0)
        const locked = me.bag.length - all.length
        bulk = `<div class="sell-all">
          <button class="btn secondary" data-cmd="${CMD_SELL_ALL}" data-arg="0" ${junk.length ? '' : 'disabled'}>잡템 팔기 — ${junk.length}개 · ${sum(junk)} 골드<small>일반 · 마법</small></button>
          <button class="btn ${this.sellArmed ? 'danger' : 'secondary'}" data-sellall ${all.length ? '' : 'disabled'}>${
            this.sellArmed ? `정말 전부? — ${all.length}개 · ${sum(all)} 골드` : `전부 팔기 — ${all.length}개 · ${sum(all)} 골드`
          }<small>${this.sellArmed ? '한 번 더 누르면 팝니다' : '낀 것은 빼고'}</small></button>
          <p class="tp-hint">잠근 것 ${locked}개는 팔지 않습니다 — 가방(I) 에서 <b>Shift+클릭</b>으로 잠급니다.</p>
        </div>`
      }
      // 돈 쓸 곳 (2026-09-25 요청): 가방 칸 늘리기 · 진열 새로 받기. 사는 탭에만 둔다
      let shopSvc = ''
      if (this.tab === 'buy') {
        const bu = bagUpPrice(me.bagMax)
        const nw = shopNewPrice(me.level)
        const bagBtn =
          me.bagMax >= BAG_MAX
            ? `<button class="btn secondary" disabled>가방을 끝까지 늘렸다<small>${BAG_MAX}칸</small></button>`
            : `<button class="btn" data-cmd="${CMD_BAGUP}" data-arg="0" ${me.gold >= bu ? '' : 'disabled'}>가방 ${BAG_STEP}칸 늘리기 — ${goldText(bu)}<small>${me.bagMax} → ${
                me.bagMax + BAG_STEP
              }칸 · 이 캐릭터만</small></button>`
        shopSvc = `<div class="tp-svc">${bagBtn}
          <button class="btn secondary" data-cmd="${CMD_SHOPNEW}" data-arg="0" ${me.gold >= nw ? '' : 'disabled'}>진열 새로 받기 — ${goldText(nw)}<small>열 가지를 새로 깐다 · 파티 모두에게</small></button></div>`
      }
      // 한꺼번에 팔기는 **목록 위**에 — 아래 두면 물건이 많을 때 스크롤해야 보인다
      body = tabs + shopSvc + bulk + `<div class="tp-list">${list}</div>`
    } else if (npc === 'smith') {
      // 대장장이는 둘을 한다: **강화**(같은 부위·등급을 녹여 단계 올리기)와 **벼리기**(같은 등급 여럿 → 윗 등급을 노린다)
      const tabs = `<div class="tp-tabs"><button data-stab="up" class="${this.smithTab === 'up' ? 'on' : ''}">강화</button><button data-stab="forge" class="${this.smithTab === 'forge' ? 'on' : ''}">벼리기</button></div>`
      if (this.smithTab === 'forge') {
        // 재료 등급을 고르면 그 **윗 등급**을 노린다 (2026-09-20 요청). 재료는 가방 + 보관함
        const rar = this.forgeRarity
        const need = forgeNeed(rar)
        const mats = forgeMaterials(me.bag, me.stash, rar)
        const have = mats.length
        const use = mats.slice(0, need)
        const ilvl = forgeIlvl(me.bag, me.stash, use)
        const price = forgePrice(ilvl, rar)
        const ok = have >= need && me.gold >= price && me.bag.length < me.bagMax
        const fromStash = use.filter((k) => k >= STASH_AT).length
        const tier = (r: number) =>
          `<button data-frar="${r}" class="${r === rar ? 'on' : ''}" style="--rc:${RARITY_COLORS[r]}">${RARITY_NAMES[r]} ${forgeNeed(r)}개<small>→ ${RARITY_NAMES[r + 1]} ${Math.round(forgeOdds(r) * 100)}%</small></button>`
        const lf = this.lastForge
        const card = lf
          ? `<div class="forge-out ${lf.up ? 'win' : 'lose'}" style="--rc:${RARITY_COLORS[lf.it.rarity]}">
              <div class="fo-h"><b>${lf.up ? '한 단계 올랐다' : '등급 그대로'}</b><span>방금 벼린 것 — 가방에 들어갔다</span></div>
              ${itemHtml(lf.it)}
            </div>`
          : ''
        body =
          tabs +
          card +
          `<p class="tp-note">같은 등급 여럿을 녹여 <b>한 단계 위</b>를 노린다. 실패해도 <b>같은 등급</b> 하나는 나온다.
            재료는 가방과 <b>보관함</b>에서 <b>싼 것부터</b> 쓴다(잠근 것은 빼고).</p>
          <div class="seg forge-tier">${[FORGE_MIN, 2, FORGE_MAX].map(tier).join('')}</div>
          <div class="forge-st"><span>${RARITY_NAMES[rar]} 재료 <b class="${have >= need ? 'ok' : 'bad'}">${Math.min(have, need)}/${need}</b>${
            use.length > 0 ? ` <small>(가방 ${use.length - fromStash} · 보관함 ${fromStash})</small>` : ''
          }</span>
            <span>아이템 레벨 <b>${have >= need ? ilvl : '—'}</b> <small>(재료 평균 + 1)</small></span>
            <span>값 <b class="${me.gold >= price ? 'ok' : 'bad'}">${have >= need ? price : '—'} 골드</b></span></div>
          <div class="tp-slots">${Array.from({ length: SLOT_COUNT }, (_, k) => `<button class="btn" data-cmd="${CMD_FORGE}" data-arg="${rar * 16 + k}" ${ok ? '' : 'disabled'}>${SLOT_NAMES[k]}</button>`).join('')}</div>
          ${
            have < need
              ? `<p class="tp-empty">${RARITY_NAMES[rar]} 아이템을 더 모아 오라 — 가방과 보관함을 함께 센다.</p>`
              : me.bag.length >= me.bagMax
                ? '<p class="tp-empty">가방이 가득 찼다.</p>'
                : ''
          }`
        return this.paint(npc, me, body)
      }
      // 강화 (2026-09-19 — 옵션 다시 굴리기를 없앴다): 낀 장비 · 가방. 같은 부위 · 같은 등급 (단계 + 1)개를 녹인다
      const cand: { it: Item; arg: number; where: string }[] = []
      me.equip.forEach((it, k) => it && cand.push({ it, arg: 100 + k, where: '낀 것' }))
      me.bag.forEach((it, i) => cand.push({ it, arg: i, where: '가방' }))
      const list = cand
        .map(({ it, arg, where }) => {
          const lv = it.up ?? 0
          if (lv >= UPGRADE_MAX) return row(it, `${where} · +${lv} 최대`, '', true)
          const need = upgradeNeed(it)
          const have = upgradeMaterials(me.bag, me.stash, it).length
          const g = upgradePrice(it)
          return row(it, `${where} · +${lv} → +${lv + 1}<br>재료 ${Math.min(have, need)}/${need} · ${g} 골드`, `data-cmd="${CMD_UPGRADE}" data-arg="${arg}"`, have < need || me.gold < g)
        })
        .join('')
      body = tabs + `<p class="tp-note">같은 부위 · 같은 등급의 아이템을 <b>(지금 단계 + 1)개</b> 녹여 한 단계 올린다 — 단계마다 옵션 · 기본 피해/방어 +10%, 최대 +5. 재료는 <b>가방과 보관함</b>에서 값싼 것부터 쓴다(잠근 것은 빼고).</p><div class="tp-list">${
        list || '<p class="tp-empty">강화할 장비가 없다.</p>'
      }</div>`
    } else if (npc === 'gambler') {
      // 2026-09-25 요청: **10연 뽑기** 와 **뭐가 나왔는지** 카드로
      const price = gamblePrice(me.level)
      const room = me.bagMax - me.bag.length
      const canOne = me.gold >= price && room >= 1
      const g = this.lastGamble
      let card = ''
      if (g && g.items.length > 0) {
        const best = g.items.reduce((a, b) => (b.rarity > a.rarity ? b : a))
        const counts = [0, 0, 0, 0, 0]
        for (const it of g.items) counts[it.rarity]++
        const tally = counts.map((n, r) => (n > 0 ? `<span style="color:${RARITY_COLORS[r]}">${RARITY_NAMES[r]} ${n}</span>` : '')).filter(Boolean).join(' · ')
        card = `<div class="forge-out ${best.rarity >= 3 ? 'win' : ''}" style="--rc:${RARITY_COLORS[best.rarity]}">
          <div class="fo-h"><b>${g.items.length}번 뽑았다</b><span>${goldText(g.gold)} · 가방에 들어갔다</span></div>
          <div class="gb-out">${g.items.map((it, i) => cellHtml(it, `data-gb="${i}"`, me)).join('')}</div>
          <p class="gb-tally">${tally}</p>
          <div class="gb-best"><div class="tip-t">가장 좋은 것</div>${itemHtml(best, me)}</div>
        </div>`
      }
      body =
        card +
        `<p class="tp-note">칸을 고르면 그 칸의 아이템 (레벨 ${me.level + 2} · 등급은 운) — 한 번 <b>${goldText(price)}</b> · 10연 <b>${goldText(price * 10)}</b>.</p>
        <div class="gb-grid">${Array.from({ length: SLOT_COUNT }, (_, k) => `<div class="gb-slot"><b>${SLOT_NAMES[k]}</b>
            <button class="btn secondary" data-cmd="${CMD_GAMBLE}" data-arg="${k}" ${canOne ? '' : 'disabled'}>한 번</button>
            <button class="btn" data-cmd="${CMD_GAMBLE}" data-arg="${k + 16}" ${canOne ? '' : 'disabled'}>10연</button></div>`).join('')}</div>
        <p class="tp-hint2">가방 빈 칸 <b class="${room > 0 ? '' : 'bad'}">${room}</b> · 돈이나 자리가 모자라면 되는 데까지만 뽑는다.</p>`
    } else if (npc === 'stash') {
      // 2026-09-25 요청: 보관함도 **가방처럼 칸으로** 보고, 한꺼번에 넣고, 골드로 늘린다
      const full = me.stash.length >= me.stashMax
      const bagFull = me.bag.length >= me.bagMax
      const canPut = !full && me.bag.some((it) => !it.lk)
      const up = stashUpPrice(me.stashMax)
      const grid = (n: number, get: (i: number) => Item | undefined, attr: string) =>
        `<div class="bag st-grid">${Array.from({ length: n }, (_, i) => cellHtml(get(i), `${attr}="${i}"`, me)).join('')}</div>`
      body = `<div class="tp-cols">
        <div class="tp-col"><div class="tp-h">가방 <span class="${bagFull ? 'bad' : ''}">${me.bag.length}/${me.bagMax}</span></div>
          <div class="tp-btns"><button class="btn secondary" data-cmd="${CMD_SORT}" data-arg="0">정렬</button>
            <button class="btn" data-cmd="${CMD_STASH_PUT}" data-arg="200" ${canPut ? '' : 'disabled'}>전부 보관 →</button></div>
          ${grid(me.bagMax, (i) => me.bag[i], 'data-put')}</div>
        <div class="tp-col"><div class="tp-h">보관함 <span class="${full ? 'bad' : ''}">${me.stash.length}/${me.stashMax}</span></div>
          <div class="tp-btns"><button class="btn secondary" data-cmd="${CMD_SORT}" data-arg="1">정렬</button>
            <button class="btn" data-cmd="${CMD_STASH_TAKE}" data-arg="200" ${me.stash.length > 0 && !bagFull ? '' : 'disabled'}>← 전부 꺼내기</button></div>
          ${grid(me.stashMax, (i) => me.stash[i], 'data-take')}</div></div>
        <p class="tp-hint2">칸을 누르면 옮긴다 · 마우스를 올리면 설명 · 잠근 것(🔒)은 <b>전부 보관</b>에서 빠진다.</p>
        <div class="tp-svc">${
          me.stashMax >= STASH_MAX
            ? `<button class="btn secondary" disabled>보관함을 끝까지 늘렸다<small>${STASH_MAX}칸</small></button>`
            : `<button class="btn" data-cmd="${CMD_STASHUP}" data-arg="0" ${me.gold >= up ? '' : 'disabled'}>보관함 ${STASH_STEP}칸 늘리기 — ${goldText(up)}<small>${me.stashMax} → ${
                me.stashMax + STASH_STEP
              }칸 · 모든 캐릭터가 함께 쓴다</small></button>`
        }</div>
        ${full ? '<p class="tp-note">보관함이 가득 찼다 — 꺼내거나 팔거나, 칸을 늘려야 넣을 수 있다.</p>' : ''}`
    } else if (npc === 'elder') {
      const reach = actReached(me.quests)
      const here = areaDef(me.area).act
      const travel = ACTS.map((a, i) => (i <= reach && i !== here ? `<button class="btn" data-cmd="${CMD_QUEST}" data-arg="${100 + i}">${i + 1}막 ${a.name}으로 — ${AREAS[a.town].name}</button>` : '')).join('')
      // 이 막의 퀘스트가 먼저, 그 아래 **다른 막**의 맡을 · 진행 중 · 보고할 일 (끝낸 것은 뺀다) — 어느 야영지 촌장이든 받는다 (2026-09-25)
      const other = questList(
        me.quests.map((v, i) => {
          const a = QUESTS[i]?.act
          return a !== undefined && a !== here && a <= reach && v !== 3 ? v : -1
        }),
        true,
      )
      body =
        questList(me.quests.map((v, i) => (QUESTS[i]?.act === here ? v : -1)), true) +
        (other ? `<div class="tp-sub">다른 막의 일 — 여기서도 맡고 보고할 수 있다</div>${other}` : '') +
        (travel ? `<div class="tp-slots">${travel}</div>` : '')
    } else if (npc === 'captain') {
      const mine = s.players.find((q) => q.merc === me.id && !q.left)
      const price = mercPrice(me.level)
      const free = s.players.some((q) => q.vacant && q.left)
      body = mine
        ? `<p class="tp-note">지금 <b>${CHARACTERS[mine.char].name}</b>(레벨 ${mine.level})이 따라다닌다. 쓰러지면 마을에서 다시 일어나 곁으로 온다.</p><button class="btn" data-cmd="${CMD_HIRE}" data-arg="255">내보내기</button>`
        : !free
          ? '<p class="tp-empty">게임 자리가 다 찼다 — 용병을 앉힐 자리가 없다 (최대 4명).</p>'
          : `<p class="tp-note">빈 자리에 용병 하나 (내 레벨 · 나를 따라다닌다) — ${price} 골드. 내게 모자란 역할을 붙이면 좋다.</p>${(['tank', 'heal', 'dps'] as const)
              .map((r) => {
                // 역할별로 묶는다 (2026-09-19 탱 · 딜 · 힐)
                const ids = PLAYABLE.filter((id) => id !== me.char && CHARACTERS[id].role === r)
                const info = ROLE_INFO[r]
                return `<div class="tp-role"><span class="role-chip" style="--rc:${info.color}" title="${info.desc}">${info.name}</span>${ids
                  .map((id) => `<button class="btn" data-cmd="${CMD_HIRE}" data-arg="${PLAYABLE.indexOf(id)}" ${me.gold < price ? 'disabled' : ''}>${CHARACTERS[id].name}</button>`)
                  .join('')}</div>`
              })
              .join('')}`
    } else {
      body = ''
    }
    this.paint(npc, me, body)
  }

  /** 창을 그리고 단추를 잇는다 (모든 NPC 공용) */
  private paint(npc: NpcId, me: PlayerState, body: string): void {
    this.el.innerHTML = `<div class="tp-head"><b>${NPC_NAMES[npc]}</b><span class="tp-gold">${myGoldText(me.gold)}</span><button class="inv-x" data-x>✕</button></div>
      <p class="tp-line">"${LINES[npc]}"</p>${body}<p class="tp-hint">${keyLabel('use')} · Esc 로 닫기</p>`
    this.el.classList.toggle('wide', npc === 'stash' || npc === 'gambler')
    this.el.classList.toggle('stashp', npc === 'stash')
    // 대장장이 강화 목록은 이름 · 옵션 · 값 세 칸이라 조금 넓어야 옵션이 두 줄로 접히지 않는다 (2026-09-20)
    this.el.classList.toggle('smith', npc === 'smith')
    this.el.querySelector<HTMLButtonElement>('[data-x]')!.onclick = () => this.show(null)
    this.wireCells(me)
    this.el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => {
      b.onclick = () => {
        this.sellArmed = false
        this.tab = b.dataset.tab === 'sell' ? 'sell' : 'buy'
        this.render()
      }
    })
    this.el.querySelectorAll<HTMLButtonElement>('[data-frar]').forEach((b) => {
      b.onclick = () => {
        this.forgeRarity = Number(b.dataset.frar)
        this.render()
      }
    })
    this.el.querySelectorAll<HTMLButtonElement>('[data-stab]').forEach((b) => {
      b.onclick = () => {
        this.smithTab = b.dataset.stab === 'forge' ? 'forge' : 'up'
        this.render()
      }
    })
    const sa = this.el.querySelector('[data-sellall]') as HTMLButtonElement | null
    if (sa)
      sa.onclick = () => {
        // 두 번 눌러야 판다 — 한 판 모은 것을 한 번에 날리지 않게
        if (!this.sellArmed) {
          this.sellArmed = true
          this.render()
          return
        }
        this.sellArmed = false
        this.send(CMD_SELL_ALL, 1)
      }
    this.el.querySelectorAll<HTMLButtonElement>('[data-cmd]').forEach((b) => {
      b.onclick = () => {
        this.sellArmed = false
        this.send(Number(b.dataset.cmd), Number(b.dataset.arg))
      }
    })
  }

  /** 보관함 · 도박 결과의 칸: 누르면 옮기고, 올리면 설명 풍선 (가방 창과 같은 손맛) */
  private wireCells(me: PlayerState): void {
    const wire = (sel: string, list: () => Item[], cmd: number) => {
      this.el.querySelectorAll<HTMLElement>(sel).forEach((cell) => {
        const i = Number(cell.dataset.put ?? cell.dataset.take ?? cell.dataset.gb)
        const get = () => list()[i]
        if (cmd >= 0)
          cell.onclick = () => {
            if (!get()) return
            this.tip.hide()
            this.send(cmd, i)
          }
        cell.onmouseenter = () => this.tip.show(cell, get(), me, true)
        cell.onmouseleave = () => this.tip.hide()
      })
    }
    wire('[data-put]', () => this.me().bag, CMD_STASH_PUT)
    wire('[data-take]', () => this.me().stash, CMD_STASH_TAKE)
    wire('[data-gb]', () => this.lastGamble?.items ?? [], -1)
  }

  dispose(): void {
    this.tip.dispose()
  }
}
