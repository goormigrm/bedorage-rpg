// 마을 NPC 창 (GUIDE 9장 — 디아블로 2 의 상인·대장장이·도박꾼·보관함). NPC 곁에서 F.
// 가방 창과 같은 원칙: **상태를 직접 바꾸지 않는다** — CMD_* 만 넣고 sim 이 다음 틱에 모두의 화면에서 똑같이 처리한다.
// 창이 열려 있어도 게임은 돈다(마을이라 안전). 멀어지면 닫힌다.

import { itemIconUrl } from './itemIcons'
import { clickSuppressed, makeDraggable } from './dragItem'
import { bt, isBright } from '../game/skin'
import { npcPortrait } from './portrait'
import { ACHIEVEMENTS, achieved } from '../core/stats'
import { CMD_BAGUP, CMD_BUY, CMD_FORGE, CMD_GAMBLE, CMD_HIRE, CMD_SELL, CMD_SELL_ALL, CMD_SHOPNEW, CMD_SORT, CMD_STASHUP, CMD_STASH_PUT, CMD_STASH_TAKE, CMD_TRIAL, CMD_UPGRADE } from '../core/input'
import { CHARACTERS, PLAYABLE, ROLE_INFO } from '../core/characters'
import { mercPrice } from '../core/sim'
import {
  BAG_MAX, BAG_STEP, GAMBLE_PITY, itemColor, FORGE_MAX, FORGE_MIN, SETS, STASH_AT, STASH_MAX, STASH_STEP, bagUpPrice, forgeIlvl, forgeMaterials, forgeNeed, forgeOdds, forgePrice, goldText, isJunk, Item, LEGENDS, myGoldText, RARITY_COLORS, RARITY_NAMES, shopNewPrice, SLOT_COUNT, SLOT_NAMES, stashUpPrice, UPGRADE_MAX, affixText, affixValue, buyPrice, gamblePrice, itemName, itemValue,
  upgradeMaterials, upgradeNeed, upgradePrice,
} from '../core/items'
import { GameState, PlayerState } from '../core/state'
import { ItemTip, cellHtml, itemHtml } from './inventory'
import { WEAPONS } from '../core/weapons'
import { WEAPON_IDS, SLOT_WEAPON } from '../core/items'
import { keyLabel } from '../game/keymap'
import { ACTS, AREAS, NPC_NAMES, NpcId, QUESTS, RIFT_MAX, RIFT_TICKS, actReached, areaDef, questDiscount, riftOpen, riftScale } from '../core/world'
import { CMD_QUEST } from '../core/input'

/** 퀘스트 목록 (촌장 창 — 버튼 있음 · 퀘스트 기록 — 버튼 없음) */
export function questList(q: number[], buttons: boolean): string {
  return QUESTS.map((d, i) => {
    const st = q[i] ?? 0
    if (st < 0) return ''
    const tag = ['아직 모름', '진행 중', bt('이룸 — 촌장에게 보고'), '끝'][st]
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
    const me = this.me()
    const q = me.quests
    const sig = q.join('') + JSON.stringify(me.stats) + me.level
    if (sig === this.sig) return
    this.sig = sig
    // 연 막까지, 막마다 묶어서 (뒤 막이 위)
    const reach = actReached(q)
    let body = ''
    for (let act = reach; act >= 0; act--) body += `<p class="tp-line">${act + 1}막 · ${ACTS[act].name}</p>` + questList(q.map((v, i) => (QUESTS[i]?.act === act ? v : -1)), false)
    this.el.innerHTML = `<div class="tp-head"><b>퀘스트 · 기록</b><button class="inv-x" data-x>✕</button></div>${body}${recordHtml(me)}<p class="tp-hint">${bt('퀘스트는 마을의 촌장 카인이')} 맡긴다 · ${keyLabel('quest')} · Esc 로 닫기</p>`
    this.el.querySelector<HTMLButtonElement>('[data-x]')!.onclick = () => this.toggle(false)
  }
}

/** 기록 · 업적 (2026-09-25 사용자 고른 개선 9) — 퀘스트 기록(J) 아래 */
function recordHtml(me: PlayerState): string {
  const s = me.stats
  const n = (v: number) => v.toLocaleString('ko-KR')
  const line = `<p class="rec-line">괴물 <b>${n(s.kills)}</b> · 정예 <b>${n(s.elites)}</b> · ${bt('보물 고블린')} <b>${n(s.goblins)}</b> · 전설 <b>${n(s.legends)}</b> · 신화 <b>${n(s.mythics)}</b> · 주운 골드 <b>${goldText(s.gold)}</b> · 죽음 <b>${n(s.deaths)}</b></p>`
  const done = ACHIEVEMENTS.filter((a) => achieved(a, s, me.level)).length
  const rows = ACHIEVEMENTS.map((a) => {
    const [cur, goal] = a.goal(s, me.level)
    const ok = cur >= goal
    const pct = Math.min(100, Math.round((cur / goal) * 100))
    return `<div class="ach${ok ? ' ok' : ''}"><b>${ok ? '★' : '☆'} ${a.name}</b><span>${a.desc}</span>${
      ok || goal <= 1 ? '' : `<i style="--p:${pct}%"></i><small>${n(Math.min(cur, goal))} / ${n(goal)}</small>`
    }</div>`
  }).join('')
  return `<p class="tp-line">기록 · 업적 ${done} / ${ACHIEVEMENTS.length}</p>${line}<div class="ach-grid">${rows}</div>`
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
    <span class="tp-n" style="color:${itemColor(it)}"><i class="ic" style="background-image:url(${itemIconUrl(it)})"></i>${esc(itemName(it))}${up}<small>${it.set !== undefined ? '세트' : RARITY_NAMES[it.rarity]} ${SLOT_NAMES[it.slot]} · 레벨 ${it.ilvl}</small></span>
    <span class="tp-a">${text}</span>
    <span class="tp-g">${right}</span></button>`
}

/** 보관함 한 쪽(탭)의 칸 수 — 10 × 6, 굴리지 않고 한눈에 (디아블로 4 의 탭처럼) */
const STASH_TAB = 60

/** 찾기에 쓰는 아이템 글: 이름 · 등급 · 부위 · 무기 종류 · 옵션 · 전설 · 세트 */
function searchText(it: Item): string {
  const parts = [itemName(it), RARITY_NAMES[it.rarity], SLOT_NAMES[it.slot]]
  if (it.slot === SLOT_WEAPON) parts.push(WEAPONS[WEAPON_IDS[it.wt]]?.name ?? '')
  for (let k = 0; k < it.aff.length; k += 2) parts.push(affixText(it.aff[k], affixValue(it, k)))
  if (it.leg !== undefined && LEGENDS[it.leg]) parts.push(LEGENDS[it.leg].name, LEGENDS[it.leg].desc)
  if (it.set !== undefined && SETS[it.set]) parts.push('세트', SETS[it.set].name)
  if (it.up) parts.push(`+${it.up}`)
  return parts.join(' ').toLowerCase()
}

/** 찾는 말(띄어 쓴 낱말 모두)이 들어 있나 */
function matches(it: Item, q: string): boolean {
  const t = searchText(it)
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => t.includes(w))
}

const LINES: Record<NpcId, string> = {
  merchant: '살 게 있으면 사고, 팔 게 있으면 팔게.',
  smith: '같은 부위, 같은 등급 물건을 모아 와 — 녹여서 단단하게 해 주지. 같은 등급을 여럿 모아 오면 한 단계 위를 벼려 볼 수도 있고.',
  gambler: '안을 들여다보지 않고 사는 재미를 알아? 뭐가 나올지는 나도 몰라.',
  stash: '캐릭터끼리 나눠 쓰는 보관함이다. 넣어 둔 것은 다른 캐릭터로도 꺼낼 수 있다.',
  elder: '종이 멈춘 밤부터 모든 게 틀어졌소. 당신들도 그 밤에 떨어졌다지 — 서로 도울 일이 있겠구려.',
  captain: '혼자 가기 무서우면 말해. 쓸 만한 녀석을 붙여 주지.',
  trial: '문 너머는 매번 다르다. 버티는 만큼 깊이 내려간다.',
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
  /** 보관함 탭 (닫았다 열어도 보던 탭 — 라스트 에포크에서 사람들이 바라던 것) · 찾는 말 */
  private stashTab = 0
  private query = ''
  /** 시련의 문에서 고른 단계 (0 = 아직 — 열 수 있는 가장 높은 단계로) */
  private riftStage = 0
  /** 대사 상자 (U6): 한 글자씩 — 누구의 말을 몇 글자까지 보였나 · 타이머 */
  private talkFor: NpcId | null = null
  private talkN = 0
  private talkTimer = 0
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
    // 창을 굴리면 칸이 움직인다 — 풍선이 옛 자리에 남지 않게 (2026-10-08 자잘한 편의)
    // 스크롤은 거품이 일지 않는다 — 안쪽 칸(.st-grid)을 굴려도 잡히게 capture 로
    this.el.addEventListener('scroll', () => this.tip.hide(), { passive: true, capture: true })
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
    // 대사는 창을 새로 열 때만 한 글자씩 (같은 창을 다시 그릴 때는 이어서)
    if (npc !== this.talkFor) {
      clearInterval(this.talkTimer)
      this.talkFor = npc
      this.talkN = 0
      if (npc) this.talkTimer = window.setInterval(() => this.typeOn(), 24)
    }
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
    return `${this.tab}|${this.smithTab}|${this.forgeRarity}|${this.sellArmed}|${this.stashTab}|${this.query}|${me.quests.join('')}|${me.gold}|${me.bagMax}|${me.stashMax}|${items(me.bag)}|${me.equip
      .map((i) => (i ? i.uid + ':' + (i.up ?? 0) : '-'))
      .join(';')}|${items(me.stash)}|${s.shop.map((i) => i.uid).join(';')}|${this.lastGamble?.items.map((i) => i.uid).join(';') ?? ''}|${this.riftStage}|${me.riftBest}|${
      s.rift ? `${s.rift.area}:${s.rift.boss}:${Math.floor((s.rift.kills / Math.max(1, s.rift.need)) * 20)}:${s.players.some((q) => !q.left && q.area === s.rift!.area)}` : ''
    }`
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
              return row(it, `${price} 골드`, `data-cmd="${CMD_BUY}" data-arg="${i}"`, me.gold < price || me.bag.length >= me.bagMax)
            }).join('') || '<p class="tp-empty">다 팔렸다. 다음 게임에 새로 들어온다.</p>'
          : me.bag.map((it, i) => row(it, it.lk ? '🔒 잠금' : `+${itemValue(it)} 골드`, it.lk ? '' : `data-cmd="${CMD_SELL}" data-arg="${i}"`, !!it.lk)).join('') || '<p class="tp-empty">가방이 비었다.</p>'
      // 가방이 가득 차면 살 수 없다(sim 이 조용히 거른다) — 까닭을 적는다 (2026-10-08)
      const fullNote = this.tab === 'buy' && me.bag.length >= me.bagMax ? '<p class="tp-note warn">가방이 가득 찼다 — 팔거나 보관하면 살 수 있다</p>' : ''
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
          <p class="tp-hint">잠근 것 ${locked}개는 팔지 않습니다 — 가방(${keyLabel('bag')}) 에서 <b>Shift+클릭</b>으로 잠급니다.</p>
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
      body = tabs + shopSvc + bulk + fullNote + `<div class="tp-list">${list}</div>`
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
          ? `<div class="forge-out ${lf.up ? 'win' : 'lose'}" style="--rc:${itemColor(lf.it)}">
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
        card = `<div class="forge-out ${best.rarity >= 3 ? 'win' : ''}" style="--rc:${itemColor(best)}">
          <div class="fo-h"><b>${g.items.length}번 뽑았다</b><span>${goldText(g.gold)} · 가방에 들어갔다</span></div>
          <div class="gb-out">${g.items.map((it, i) => cellHtml(it, `data-gb="${i}"`, me)).join('')}</div>
          <p class="gb-tally">${tally}</p>
          <div class="gb-best"><div class="tip-t">가장 좋은 것</div>${itemHtml(best, me)}</div>
        </div>`
      }
      body =
        card +
        `<p class="tp-note">칸을 고르면 그 칸의 아이템 (레벨 ${me.level + 2} · 등급은 운) — 한 번 <b>${goldText(price)}</b> · 10연 <b>${goldText(price * 10)}</b>.</p>
        <p class="tp-note gb-pity">전설 천장 <b>${me.gpity} / ${GAMBLE_PITY}</b> — ${me.gpity >= GAMBLE_PITY ? '<b style="color:#ff9a3a">다음 한 번은 전설 이상</b>' : `전설 없이 ${GAMBLE_PITY - me.gpity}번 더 뽑으면 그다음은 전설 이상`}</p>
        <div class="gb-grid">${Array.from({ length: SLOT_COUNT }, (_, k) => `<div class="gb-slot"><b>${SLOT_NAMES[k]}</b>
            <button class="btn secondary" data-cmd="${CMD_GAMBLE}" data-arg="${k}" ${canOne ? '' : 'disabled'}>한 번</button>
            <button class="btn" data-cmd="${CMD_GAMBLE}" data-arg="${k + 16}" ${canOne ? '' : 'disabled'}>10연</button></div>`).join('')}</div>
        <p class="tp-hint2">가방 빈 칸 <b class="${room > 0 ? '' : 'bad'}">${room}</b> · 돈이나 자리가 모자라면 되는 데까지만 뽑는다.</p>`
    } else if (npc === 'stash') {
      // 2026-10-08 개편 (사용자: "보관함 UI 가 생각보다 별로 — 다른 게임처럼"): 디아블로 4 · D2R · 라스트 에포크처럼
      //  · 가방(장비 포함)이 **오른쪽에 같이 열리고**(세션 dockBag) 이 창은 왼쪽 — 두 창 사이를 클릭 · 오른클릭 · 끌어다 놓기로 옮긴다
      //  · 60칸(10 × 6) 탭으로 나눠 굴리지 않고 한눈에 · 탭마다 찬 개수 · 보던 탭 기억
      //  · 찾기: 맞지 않는 칸은 흐리게(라스트 에포크) · 탭마다 맞는 개수
      const full = me.stash.length >= me.stashMax
      const bagFull = me.bag.length >= me.bagMax
      const canPut = !full && me.bag.some((it) => !it.lk)
      const up = stashUpPrice(me.stashMax)
      const tabs = Math.max(1, Math.ceil(me.stashMax / STASH_TAB))
      if (this.stashTab >= tabs) this.stashTab = tabs - 1
      const q = this.query.trim()
      const tabBtn = (k: number) => {
        const lo = k * STASH_TAB
        const cap = Math.min(STASH_TAB, me.stashMax - lo)
        const items = me.stash.slice(lo, lo + cap)
        const hit = q ? items.filter((it) => matches(it, q)).length : 0
        return `<button data-sttab="${k}" class="${k === this.stashTab ? 'on' : ''}${items.length >= cap ? ' full' : ''}">${k + 1}<small>${items.length}/${cap}</small>${hit ? `<i>${hit}</i>` : ''}</button>`
      }
      const lo = this.stashTab * STASH_TAB
      const cap = Math.min(STASH_TAB, me.stashMax - lo)
      const cells = Array.from({ length: cap }, (_, k) => {
        const i = lo + k
        const it = me.stash[i]
        const c = cellHtml(it, `data-take="${i}"`, me)
        return it && q && !matches(it, q) ? c.replace('class="cell ', 'class="cell dim ') : c
      }).join('')
      const total = q ? me.stash.filter((it) => matches(it, q)).length : 0
      body = `<div class="st-top">
          <div class="st-tabs">${Array.from({ length: tabs }, (_, k) => tabBtn(k)).join('')}${
            me.stashMax >= STASH_MAX
              ? ''
              : `<button class="st-up" data-cmd="${CMD_STASHUP}" data-arg="0" ${me.gold >= up ? '' : 'disabled'} title="보관함 ${STASH_STEP}칸 늘리기 — 모든 캐릭터가 함께 쓴다">+${STASH_STEP}칸<small>${goldText(up)}</small></button>`
          }</div>
          <span class="st-count${full ? ' bad' : ''}">${me.stash.length} / ${me.stashMax}</span>
        </div>
        <div class="st-find"><input class="st-q" type="text" placeholder="찾기 — 이름 · 등급 · 부위 · 옵션 (예: 전설 반지 · 치명)" value="${esc(this.query)}" autocomplete="off" spellcheck="false">${
          q ? `<span class="st-hits">${total}개</span><button class="st-clear" data-qclear title="지우기">✕</button>` : ''
        }</div>
        <div class="bag st-grid" data-drop="stash">${cells}</div>
        <div class="st-foot">
          <button class="btn secondary" data-cmd="${CMD_SORT}" data-arg="1" title="등급이 높은 것부터 줄 세운다">정렬</button>
          <button class="btn" data-cmd="${CMD_STASH_PUT}" data-arg="200" ${canPut ? '' : 'disabled'} title="잠근 것(🔒)은 빠진다">가방 전부 넣기</button>
          <button class="btn secondary" data-cmd="${CMD_STASH_TAKE}" data-arg="200" ${me.stash.length > 0 && !bagFull ? '' : 'disabled'}>전부 꺼내기</button>
        </div>
        <p class="tp-hint2">클릭 · 오른클릭으로 가방 ↔ 보관함 · 끌어다 놓기 · 마우스를 올리면 설명 · 모든 캐릭터가 함께 쓴다${full ? ' · <b class="bad">가득 찼다</b>' : ''}</p>`
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
    } else if (npc === 'trial') {
      body = this.trialBody(me, s)
    } else {
      body = ''
    }
    this.paint(npc, me, body)
  }

  /**
   * 시련의 문 (2026-10-08 퀄리티 2차 7단계 D3): 단계를 골라 열고 들어간다 · 열린 시련에 들어간다.
   * 규칙 · 단계마다 오르는 값을 한눈에 — 단계를 바꾸면 아래 숫자가 바로 바뀐다
   */
  private trialBody(me: PlayerState, s: GameState): string {
    const sec = Math.round(RIFT_TICKS / 60 / 60)
    const rules = `<ul class="tr-rules"><li>괴물을 잡아 <b>진행 막대</b>를 채우면 <b>${bt('시련의 수호자')}</b>가 나온다</li><li><b>${sec}분 안에</b> 수호자를 잡으면 다음 단계가 열린다</li><li>마을로는 수호자 자리에 열리는 문 · 타운 포털로</li></ul>`
    if (!riftOpen(me, s.tier)) return `${rules}<p class="tp-note warn">보통 난이도에서 <b>${bt('심연의 군주')}</b>를 쓰러뜨리면 열린다.</p>`
    const r = s.rift
    const inside = !!r && s.players.some((q) => !q.left && q.area === r.area)
    const top = Math.min(RIFT_MAX, me.riftBest + 1)
    if (this.riftStage < 1 || this.riftStage > top) this.riftStage = top
    const st = this.riftStage
    const sc = riftScale(st)
    const x = (v: number) => `×${(Math.round(v * 10) / 10).toFixed(1)}`
    let open = ''
    if (r && r.boss < 2) {
      const k = Math.min(100, Math.round((r.kills / Math.max(1, r.need)) * 100))
      open = `<div class="tr-open"><b>${r.stage}단계</b> ${bt('시련이')} 열려 있다 — 진행 ${r.boss > 0 ? '수호자' : `${k}%`}<button class="btn" data-cmd="${CMD_TRIAL}" data-arg="0">들어가기</button></div>`
    }
    const pick = `<div class="tr-pick">
        <button class="btn secondary" data-rstage="${st - 1}" ${st > 1 ? '' : 'disabled'}>−</button>
        <span class="tr-stage"><b>${st}</b>단계</span>
        <button class="btn secondary" data-rstage="${st + 1}" ${st < top ? '' : 'disabled'}>+</button>
        <span class="tr-best">끝낸 가장 높은 단계 ${me.riftBest || '없음'}</span>
      </div>
      <div class="tr-scale">
        <span>괴물 체력 <b>${x(sc.hp)}</b></span><span>괴물 힘 <b>${x(sc.pow)}</b></span>
        <span>경험치 <b>${x(sc.xp)}</b></span><span>골드 <b>${x(sc.gold)}</b></span><span>좋은 등급 <b>+${Math.round(sc.loot * 100)}%</b></span>
      </div>
      <button class="btn tr-go" data-cmd="${CMD_TRIAL}" data-arg="${st}" ${inside ? 'disabled' : ''}>${st}단계 열고 들어가기</button>
      ${inside ? `<p class="tp-note">${bt('지금 시련 안에 사람이 있다 — 끝나고 나오면 새로 열 수 있다')}</p>` : r && r.boss < 2 ? `<p class="tp-note">${bt('새로 열면 지금 열린 시련은 닫힌다')}</p>` : ''}`
    return `${rules}${open}${pick}`
  }

  /** 대사 한 글자 더 (다 보이면 멈춘다) */
  private typeOn(): void {
    const npc = this.talkFor
    if (!npc) return clearInterval(this.talkTimer)
    const line = bt(LINES[npc])
    this.talkN = Math.min(line.length, this.talkN + 1)
    const el = this.el.querySelector<HTMLElement>('.tp-said')
    if (el) el.textContent = line.slice(0, this.talkN)
    if (this.talkN >= line.length) clearInterval(this.talkTimer)
  }

  /**
   * 대사 상자 (2026-10-08 퀄리티 2차 7단계 U6 — 전에는 따옴표 한 줄): 왼쪽에 둥근 초상(portrait.ts) · 이름 · 한 글자씩 나오는 대사.
   * 누르면 다 보인다
   */
  private talkHtml(npc: NpcId): string {
    const line = bt(LINES[npc])
    return `<div class="tp-talk" data-talk><img class="tp-face" src="${npcPortrait(npc, isBright())}" alt=""><div class="tp-say"><b>${NPC_NAMES[npc]}</b><span class="tp-said">${line.slice(0, this.talkN)}</span></div></div>`
  }

  /** 창을 그리고 단추를 잇는다 (모든 NPC 공용) */
  private paint(npc: NpcId, me: PlayerState, body: string): void {
    // 다시 그려도 굴리던 자리 그대로 (2026-10-08 — 보관함에서 하나 옮길 때마다 칸 목록이 맨 위로 튀었다)
    const tops = [...this.el.querySelectorAll<HTMLElement>('.st-grid')].map((g) => g.scrollTop)
    // 찾기 칸에 쓰는 중이면 다시 그려도 초점 · 커서를 지킨다
    const qEl = this.el.querySelector<HTMLInputElement>('.st-q')
    const typing = !!qEl && document.activeElement === qEl
    const caret = typing ? [qEl!.selectionStart ?? 0, qEl!.selectionEnd ?? 0] : null
    this.el.innerHTML = `<div class="tp-head"><b>${NPC_NAMES[npc]}</b><span class="tp-gold">${myGoldText(me.gold)}</span><button class="inv-x" data-x>✕</button></div>
      ${npc === 'stash' ? '' : this.talkHtml(npc)}${body}<p class="tp-hint">${keyLabel('use')} · Esc 로 닫기</p>`
    this.el.classList.toggle('wide', npc === 'gambler')
    this.el.classList.toggle('stashp', npc === 'stash')
    // 보관함 · 상인은 가방 창이 오른쪽에 같이 열린다 — 이 창은 왼쪽에 붙는다 (디아블로)
    this.el.classList.toggle('docked', npc === 'stash' || npc === 'merchant')
    // 가방에서 끌어다 이 창에 놓으면: 보관함은 보관 · 상인은 팔기
    if (npc === 'stash') this.el.dataset.drop = 'stash'
    else if (npc === 'merchant') this.el.dataset.drop = 'sell'
    else delete this.el.dataset.drop
    const q2 = this.el.querySelector<HTMLInputElement>('.st-q')
    if (q2) {
      // 쓰는 키는 게임으로 가지 않게 (keydown 만 — keyup 은 흘려 보내야 누르고 있던 WASD 가 풀린다). Esc 는 찾기 칸에서 나온다
      q2.addEventListener('keydown', (e) => {
        e.stopPropagation()
        if (e.key === 'Escape') q2.blur()
      })
      q2.addEventListener('input', () => {
        this.query = q2.value
        this.render()
      })
      if (typing) {
        q2.focus()
        if (caret) q2.setSelectionRange(caret[0], caret[1])
      }
    }
    const qc = this.el.querySelector<HTMLButtonElement>('[data-qclear]')
    if (qc)
      qc.onclick = () => {
        this.query = ''
        this.render()
      }
    this.el.querySelectorAll<HTMLButtonElement>('[data-sttab]').forEach((b) => {
      b.onclick = () => {
        this.stashTab = Number(b.dataset.sttab)
        this.tip.hide()
        this.render()
      }
    })
    // 대장장이 강화 목록은 이름 · 옵션 · 값 세 칸이라 조금 넓어야 옵션이 두 줄로 접히지 않는다 (2026-09-20)
    this.el.classList.toggle('smith', npc === 'smith')
    this.el.querySelector<HTMLButtonElement>('[data-x]')!.onclick = () => this.show(null)
    const talk = this.el.querySelector<HTMLElement>('[data-talk]')
    if (talk)
      talk.onclick = () => {
        this.talkN = 1e4
        this.typeOn()
      }
    this.el.querySelectorAll<HTMLElement>('.st-grid').forEach((g, k) => (g.scrollTop = tops[k] ?? 0))
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
    this.el.querySelectorAll<HTMLButtonElement>('[data-rstage]').forEach((b) => {
      b.onclick = () => {
        this.riftStage = Number(b.dataset.rstage)
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
        if (cmd >= 0) {
          cell.onclick = () => {
            if (!get() || clickSuppressed()) return
            this.tip.hide()
            this.send(cmd, i)
          }
          // 오른클릭도 옮기기 (디아블로 · 라스트 에포크의 빠른 옮기기)
          cell.oncontextmenu = (e) => {
            e.preventDefault()
            if (!get()) return
            this.tip.hide()
            this.send(cmd, i)
          }
        }
        cell.onmouseenter = () => this.tip.show(cell, get(), me, true)
        cell.onmouseleave = () => this.tip.hide()
        // 보관함 칸은 끌어서 가방(오른쪽 가방 창)에 놓으면 꺼낸다
        if (cmd === CMD_STASH_TAKE)
          makeDraggable(cell, () => (get() ? { from: 'stash', index: i, icon: itemIconUrl(get()!) } : null), (s, t) => {
            this.tip.hide()
            if (t.dataset.drop === 'bag' || t.dataset.drop === 'eq') this.send(CMD_STASH_TAKE, s.index)
          })
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
