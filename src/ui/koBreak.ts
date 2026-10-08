// 한국어 줄바꿈 다듬기 (2026-10-08 사용자: "줄바꿈할 공간이 충분히 있는데 문장 중간에서 끊어서 줄바꿈하는 경우 — 칸이 충분하면
// 문장 자체를 줄바꿈하도록"). 두 가지:
//  ① 문장 단위: 두 문장 이상인 글은 문장마다 줄바꿈 없는 덩어리(.ks — inline-block)로 감싼다 → 한 문장이 지금 줄에 다 안 들어가면
//     문장째 다음 줄로 넘어간다(그 줄 너비보다 긴 문장만 안에서 낱말 단위로 접힌다). 짧은 문장 둘은 한 줄에 그대로 붙는다.
//  ② 가운뎃점 · 줄표가 줄 머리에 오지 않게: 기호 앞 빈칸을 줄바꿈 없는 빈칸(NBSP)으로 — 기호가 앞 낱말 끝에 붙는다.
// 화면에 새로 붙는 글자도 모두 — MutationObserver. 캔버스 HUD 의 줄바꿈은 koLines 가 같은 규칙으로 한다.

const NBSP = ' '
const RE = / ([·—])/g
/** 문장 끝: 마침표 · 물음표 · 느낌표 뒤 빈칸 (1.5배 · v0.8 처럼 빈칸이 없으면 나누지 않는다) */
const SENT = /(?<=[.!?])\s+(?=\S)/

function fixText(n: Text): void {
  const t = n.data
  if (t.includes(' ·') || t.includes(' —')) n.data = t.replace(RE, `${NBSP}$1`)
  splitSentences(n)
}

/** 두 문장 이상이면 문장마다 .ks 덩어리로 (단추 · 칸 · 한 줄짜리 · 플렉스 · 그리드 안은 그대로) */
function splitSentences(n: Text): void {
  const parent = n.parentElement
  if (!parent || parent.classList.contains('ks')) return
  const parts = n.data.split(SENT)
  if (parts.length < 2) return
  if (parent.closest('button, input, textarea, select, .cell, .kh, [data-nosplit]')) return
  const cs = getComputedStyle(parent)
  if (cs.display.includes('flex') || cs.display.includes('grid') || cs.whiteSpace.startsWith('nowrap') || cs.whiteSpace === 'pre') return
  const frag = document.createDocumentFragment()
  parts.forEach((s, i) => {
    const span = document.createElement('span')
    span.className = 'ks'
    span.textContent = s
    frag.appendChild(span)
    if (i < parts.length - 1) frag.appendChild(document.createTextNode(' '))
  })
  parent.replaceChild(frag, n)
}

function walk(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) return fixText(root as Text)
  if (root.nodeType !== Node.ELEMENT_NODE) return
  const tag = (root as Element).tagName
  if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA') return
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const list: Text[] = []
  for (let n = it.nextNode(); n; n = it.nextNode()) list.push(n as Text)
  // 걸으며 바꾸면 길이 어긋난다 — 모은 뒤에
  for (const n of list) fixText(n)
}

/** 한 번 켠다 (main.ts) — 지금 있는 글자와 앞으로 붙는 글자 모두 */
export function installKoBreak(): void {
  if (typeof MutationObserver === 'undefined') return
  walk(document.body)
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') {
        if (m.target.isConnected) fixText(m.target as Text)
      } else m.addedNodes.forEach((a) => a.isConnected && walk(a))
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

/**
 * 캔버스 줄바꿈 (문장 단위 먼저): 문장이 지금 줄에 다 들어가면 붙이고, 아니면 문장째 새 줄 — 한 줄보다 긴 문장만 낱말 단위로 접는다.
 * fits(줄) = 그 글이 한 줄 너비에 들어가나
 */
export function koLines(text: string, fits: (s: string) => boolean): string[] {
  const out: string[] = []
  let cur = ''
  for (const sent of text.split(SENT)) {
    const tryJoin = cur ? `${cur} ${sent}` : sent
    if (fits(tryJoin)) {
      cur = tryJoin
      continue
    }
    if (cur) out.push(cur)
    cur = ''
    if (fits(sent)) {
      cur = sent
      continue
    }
    // 한 줄보다 긴 문장: 낱말 단위로
    for (const w of koWords(sent)) {
      const next = cur ? `${cur} ${w}` : w
      if (fits(next) || !cur) cur = next
      else {
        out.push(cur)
        cur = w
      }
    }
  }
  if (cur) out.push(cur)
  return out
}
