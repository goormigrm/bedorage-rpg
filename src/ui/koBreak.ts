// 한국어 줄바꿈 다듬기 (2026-10-08 사용자: "한국어 줄바꿈 어색한 것 수정"). 낱말 단위 줄바꿈(word-break: keep-all)은 켜져 있었지만
// 줄이 가운뎃점 · 줄표 앞에서 끊겨 새 줄이 "· 220 피해" 처럼 기호로 시작했다 → 기호 앞 빈칸을 줄바꿈 없는 빈칸(NBSP)으로 바꿔
// 기호가 앞 낱말 끝에 붙게 한다(한글 조판에서 쉼표 · 가운뎃점은 줄 끝에 남는다). 화면에 새로 붙는 글자도 모두 — MutationObserver.

const NBSP = ' '
const RE = / ([·—])/g

function fixText(n: Text): void {
  const t = n.data
  if (t.includes(' ·') || t.includes(' —')) n.data = t.replace(RE, `${NBSP}$1`)
}

function walk(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) return fixText(root as Text)
  if (root.nodeType !== Node.ELEMENT_NODE) return
  const tag = (root as Element).tagName
  if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA') return
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = it.nextNode(); n; n = it.nextNode()) fixText(n as Text)
}

/** 한 번 켠다 (main.ts) — 지금 있는 글자와 앞으로 붙는 글자 모두 */
export function installKoBreak(): void {
  if (typeof MutationObserver === 'undefined') return
  walk(document.body)
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') fixText(m.target as Text)
      else m.addedNodes.forEach(walk)
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true })
}

/** 캔버스 줄바꿈용: 띄어 쓴 낱말들 — 가운뎃점 · 줄표는 앞 낱말에 붙인다 */
export function koWords(text: string): string[] {
  const out: string[] = []
  for (const w of text.split(' ')) {
    if ((w === '·' || w === '—') && out.length > 0) out[out.length - 1] += ` ${w}`
    else out.push(w)
  }
  return out
}
