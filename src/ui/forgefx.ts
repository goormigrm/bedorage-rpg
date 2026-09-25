// 벼리기 결과 연출 (2026-09-20 사용자: "벼리기 할 때 가운데에 성공 실패 이펙트 같은 것도 추가해 줘,
// 그리고 뭐가 나왔는지도 확실하게 보이게 해 줘").
//
// **DOM 으로 띄운다** — 대장장이 창(.tp) 위에 보여야 하기 때문이다. HUD 캔버스는 창 아래에 깔려 가려진다.
// 성공하면 등급 색 고리 둘이 퍼지고 불티가 튄다. 실패하면 흐린 고리 하나만 가라앉는다.

import { Item, RARITY_NAMES, SLOT_NAMES, SLOT_WEAPON, WEAPON_IDS, itemColor, itemName } from '../core/items'
import { WEAPONS } from '../core/weapons'

function esc(t: string): string {
  return t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch)
}

export function showForgeFx(parent: HTMLElement, it: Item, up: boolean): void {
  parent.querySelector('.forge-fx')?.remove()
  const el = document.createElement('div')
  el.className = `forge-fx ${up ? 'win' : 'lose'}`
  el.style.setProperty('--rc', itemColor(it))
  const kind = it.slot === SLOT_WEAPON ? WEAPONS[WEAPON_IDS[it.wt]]?.name ?? '무기' : SLOT_NAMES[it.slot]
  // 불티: 열두 방향
  const sparks = up
    ? Array.from({ length: 12 }, (_, i) => `<i class="ffx-s" style="--a:${(i / 12) * 360}deg;animation-delay:${(i % 4) * 0.04}s"></i>`).join('')
    : ''
  el.innerHTML = `<div class="ffx-box">
    <div class="ffx-ring"></div>${up ? '<div class="ffx-ring d2"></div>' : ''}
    ${sparks}
    <div class="ffx-t">
      <b>${up ? `${RARITY_NAMES[it.rarity]}!` : '등급 그대로'}</b>
      <span>${esc(itemName(it))}</span>
      <small>${RARITY_NAMES[it.rarity]} ${kind} · 아이템 레벨 ${it.ilvl}</small>
    </div>
  </div>`
  parent.appendChild(el)
  setTimeout(() => el.remove(), 3000)
}
