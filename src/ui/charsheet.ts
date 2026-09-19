// 능력치 창 (C — 2026-09-19 요청 "C 키를 눌러 현재 캐릭터의 세부 능력치를 확실히 알 수 있도록, 레벨업 시 세부 능력치 포인트를 줘서
// 올릴 수 있도록, 추천하는 능력치도 같이"). 스킬 창과 같은 원칙: 상태를 직접 바꾸지 않는다 — CMD_ATTR 만 넣는다.
//   위: 능력치 넷(힘 · 민첩 · 활력 · 정신) — 쓴 점 · 지금 효과 · + 단추 · ★ 추천(캐릭터마다 둘)
//   아래: 세부 능력치 — 체력 · 무기 초당 피해 · 피해 · 연사 · 치명타 · 스킬 · 방어 · 이동 … (레벨 · 장비 · 능력치 · 패시브를 모두 더한 값)

import { ATTR_REC, CHARACTERS } from '../core/characters'
import { CMD_ATTR } from '../core/input'
import { AFFIXES, ATTR_DESC, ATTR_NAMES, ST_COUNT, ST_DMG, ST_RATE, attrFree, attrPoints, xpNeed } from '../core/items'
import { PlayerState } from '../core/state'
import { WEAPONS, weaponDps } from '../core/weapons'
import { isTown } from '../core/world'

/** 능력치 한 칸의 지금 효과 (items.ts addAttr 와 같은 수) */
function attrEffect(i: number, a: number): string {
  const f = (v: number) => (Math.round(v * 10) / 10).toString()
  if (i === 0) return `피해 +${f(a * 0.8)}%`
  if (i === 1) return `연사 +${f(a * 0.4)}% · 치명타 피해 +${f(a * 0.8)}%`
  if (i === 2) return `최대 체력 +${a * 3}`
  return `스킬 위력 +${f(a * 0.8)}% · 스킬 재사용 -${f(a * 0.2)}%`
}

export class CharSheet {
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
    this.el.className = 'tp wide csp'
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
    const sig = JSON.stringify([p.attr, p.level, p.xp, p.st, p.maxHp, p.weapon, p.area])
    if (sig !== this.sig) this.render()
  }

  private render(): void {
    const p = this.me()
    this.sig = JSON.stringify([p.attr, p.level, p.xp, p.st, p.maxHp, p.weapon, p.area])
    const c = CHARACTERS[p.char]
    const free = attrFree(p.level, p.attr)
    const rec = ATTR_REC[p.char]
    const rows = ATTR_NAMES.map((name, i) => {
      const star = rec[0] === i ? '<span class="cs-rec">★ 추천(주)</span>' : rec[1] === i ? '<span class="cs-rec sub">★ 추천(부)</span>' : ''
      return `<div class="cs-row ${rec.includes(i) ? 'rec' : ''}">
        <div class="cs-h"><b>${name}</b>${star}<span class="cs-pt">${p.attr[i]}</span>
          <button class="sk-up" data-cmd="${CMD_ATTR}" data-arg="${i}" ${free > 0 ? '' : 'disabled'}>+</button></div>
        <div class="cs-d">${ATTR_DESC[i]} · <em>지금 ${attrEffect(i, p.attr[i])}</em></div></div>`
    }).join('')
    const town = isTown(p.area)
    const acts = `<div class="cs-acts">
      <button class="btn" data-cmd="${CMD_ATTR}" data-arg="10" ${free > 0 ? '' : 'disabled'}>★ 추천대로 분배 (${free}점)</button>
      ${town ? `<button class="btn secondary" data-cmd="${CMD_ATTR}" data-arg="99" ${attrPoints(p.level) - free > 0 ? '' : 'disabled'}>되돌리기 (마을 · 무료)</button>` : '<span class="tp-note">되돌리기는 마을에서 (무료)</span>'}</div>`
    // 세부 능력치: 레벨 · 장비 · 능력치 · 스킬 트리 패시브를 모두 더한 값
    const w = WEAPONS[p.weapon]
    const dps = Math.round(weaponDps(w) * 60 * (1 + p.st[ST_DMG] / 100) * (1 + p.st[ST_RATE] / 100))
    const lines: string[] = [
      `<div class="cs-st"><span>최대 체력</span><b>${Math.round(p.maxHp)}</b></div>`,
      `<div class="cs-st"><span>무기</span><b>${w.name} · 초당 피해 약 ${dps}</b></div>`,
    ]
    for (let i = 0; i < ST_COUNT; i++) {
      const a = AFFIXES[i]
      const v = Math.round(p.st[i] * 10) / 10
      const minus = a.name.includes('감소')
      lines.push(`<div class="cs-st ${v === 0 ? 'zero' : ''}"><span>${a.name}</span><b>${v === 0 ? '—' : `${minus ? '-' : '+'}${v}${a.pct ? '%' : ''}`}</b></div>`)
    }
    const need = xpNeed(p.level)
    this.el.innerHTML = `<div class="tp-head"><b>능력치 — ${c.name}</b><span class="tp-gold">레벨 ${p.level} · 남은 포인트 ${free}</span><button class="inv-x" data-x>✕</button></div>
      <p class="tp-line">레벨마다 능력치 포인트 3점. ★ 는 ${c.name}에게 추천하는 능력치(주 6 : 부 4). 경험치 ${Math.floor(p.xp)} / ${need}</p>
      <div class="cs-grid"><div>${rows}${acts}</div><div class="cs-sts"><div class="cs-t">세부 능력치 (레벨 · 장비 · 능력치 · 패시브 합)</div>${lines.join('')}</div></div>
      <p class="tp-hint">C · Esc 로 닫기</p>`
    this.el.querySelector<HTMLButtonElement>('[data-x]')!.onclick = () => this.toggle(false)
    this.el.querySelectorAll<HTMLButtonElement>('[data-cmd]').forEach((btn) => {
      btn.onclick = () => this.send(Number(btn.dataset.cmd), Number(btn.dataset.arg))
    })
  }
}
