// 설정 칸 — **게임 안(Esc 메뉴)과 대기실에서 같은 화면**을 쓴다
// (2026-09-20 사용자: "대기실에서도 설정 화면 들어갈 수 있도록 해 줘").
// 값은 모두 브라우저에 남는다(localStorage). 게임 안에서 바꾸면 그 판에 바로 반영되고,
// 대기실에서 바꾼 것은 판에 들어갈 때 반영된다.

import { AUTOPICK_ALL, RARITY_COLORS, RARITY_NAMES } from '../core/items'
import { isTouchDevice } from '../game/touch'
import { ACTIONS, Action, RESERVED, bind, codeOf, keyLabel, label, resetKeys } from '../game/keymap'

const AUTOPICK_KEY = 'brpg.autopick'
const REAL_KEY = 'brpg.real'
const KEYS_KEY = 'brpg.keys'
const MUTE_KEY = 'brpg.muted'

const get = (k: string): string | null => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const set = (k: string, v: string): void => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* 저장 못 해도 이번 판은 반영된다 */
  }
}

/** 자동 줍기 등급 (기본은 모두) */
export function loadAutoPick(): number {
  const v = Number(get(AUTOPICK_KEY) ?? AUTOPICK_ALL)
  // 신화 등급(비트 16)이 생기기 전의 "모두"(15)는 모두로 (2026-09-19)
  if (v === 15) return AUTOPICK_ALL
  return Number.isInteger(v) && v >= 0 && v <= AUTOPICK_ALL ? v : AUTOPICK_ALL
}
export const saveAutoPick = (v: number): void => set(AUTOPICK_KEY, String(v))

/** 실사 괴물을 쓸지 — 저장한 값이 없으면 폰은 끔 · 컴퓨터는 켬 */
export function realMonstersOn(): boolean {
  const v = get(REAL_KEY)
  return v !== null ? v === '1' : !isTouchDevice()
}
export const setRealMonsters = (on: boolean): void => set(REAL_KEY, on ? '1' : '0')

/** 조작 안내 띠 */
export const keysShown = (): boolean => get(KEYS_KEY) !== '0'
export const setKeysShown = (on: boolean): void => set(KEYS_KEY, on ? '1' : '0')

/** 소리 (audio/sfx.ts 와 같은 열쇠) */
export const soundMuted = (): boolean => get(MUTE_KEY) === '1'
export const setSoundMuted = (m: boolean): void => set(MUTE_KEY, m ? '1' : '0')

export type SettingsOpts = {
  /** 조작 안내 줄을 보일까 (터치 기기는 띠가 없어 감춘다) */
  keys?: boolean
  /** 바뀐 값을 지금 판에도 알린다 (대기실에서는 없다 — 다음 판부터 반영) */
  onSound?: (muted: boolean) => void
  onReal?: (on: boolean) => void
  onKeys?: (on: boolean) => void
  onAutoPick?: (v: number) => void
}

const onoff = (name: string, on: boolean, yes = '켜기', no = '끄기') =>
  `<div class="srow"><b>${name}</b><div class="seg small" data-set="${name}">` +
  `<button type="button" data-on="1" class="${on ? 'on' : ''}">${yes}</button>` +
  `<button type="button" data-on="0" class="${on ? '' : 'on'}">${no}</button></div></div>`

/** 설정 칸 HTML. 바깥에서 `<div class="settings">…</div>` 로 감싸 준다 */
export function settingsHtml(o: SettingsOpts = {}): string {
  const ap = loadAutoPick()
  const btns = RARITY_NAMES.map(
    (n, r) =>
      `<button type="button" data-r="${r}" class="${ap & (1 << r) ? 'on' : ''}" style="--rc:${RARITY_COLORS[r]}" title="${n} 아이템을 밟으면 ${ap & (1 << r) ? '줍습니다 (누르면 끔)' : '줍지 않습니다 (누르면 켬)'}">${n}</button>`,
  ).join('')
  const state = ap === AUTOPICK_ALL ? '모두 줍기' : ap === 0 ? '꺼짐 — F 로만' : '켠 등급만'
  return (
    `<div class="settings">` +
    onoff('소리', !soundMuted()) +
    onoff('실사 괴물', realMonstersOn()) +
    `<p class="apn">실사 괴물은 처음 만날 때 모델을 받습니다. 느린 기기·데이터가 아까우면 끄세요.</p>` +
    (o.keys === false ? '' : onoff('조작 안내', keysShown(), '보기', '숨기기')) +
    `<div class="autopick"><div class="aph"><b>자동 줍기</b><span>${state}</span></div><div class="apr">${btns}</div>` +
    `<p class="apn">밟으면 내 아이템을 줍습니다. 끈 등급 · 남이 버린 아이템은 F 로 줍습니다.</p></div>` +
    `<p class="apn">치지직 방송 연동은 화면 왼쪽 위 <b>치지직</b> 단추에서 합니다.</p>` +
    (isTouchDevice() ? '' : keybindHtml()) +
    `</div>`
  )
}

/**
 * 키 설정 (2026-09-23 — "RPG 에 보통 있는데 없는 것" 의 키 재설정). 접었다 펴는 칸 — 펴면 21 줄이라 Esc 메뉴가 길어진다.
 * 단추를 누르고 새 키를 누르면 바뀐다. 이미 다른 행동에 걸린 키면 **서로 바뀐다**.
 */
let kbOpen = false
let listening: Action | null = null
let kbNote = ''
function keybindHtml(): string {
  if (!kbOpen) return `<div class="keybind"><button type="button" class="kb-toggle">키 설정 ▸</button></div>`
  let groups = ''
  let last = ''
  for (const a of ACTIONS) {
    if (a.group !== last) {
      groups += `<div class="kb-g">${a.group}</div>`
      last = a.group
    }
    const wait = listening === a.id
    groups += `<div class="kb-row${wait ? ' wait' : ''}"><span>${a.label}</span><button type="button" data-kb="${a.id}" class="${keyLabel(a.id) !== label(a.def) ? 'changed' : ''}">${wait ? '키를 누르세요…' : keyLabel(a.id)}</button></div>`
  }
  return `<div class="keybind open">
    <div class="aph"><button type="button" class="kb-toggle">키 설정 ▾</button><button type="button" class="kb-reset">기본값으로</button></div>
    <div class="kb-grid">${groups}</div>
    <p class="apn">${kbNote || '단추를 누르고 바꿀 키를 누르세요. 이미 쓰는 키면 서로 바뀝니다 · Esc 는 취소 · 화살표는 늘 이동 · 마우스(사격 · 정조준)는 그대로.'}</p>
  </div>`
}

/** 새 키를 기다린다: 창에서 가장 먼저(capture) 잡아 게임 · 메뉴로 흘려보내지 않는다 */
let capture: ((e: KeyboardEvent) => void) | null = null
function listen(a: Action | null, redraw: () => void): void {
  listening = a
  if (capture) window.removeEventListener('keydown', capture, true)
  capture = null
  if (!a) return
  capture = (e: KeyboardEvent) => {
    e.preventDefault()
    e.stopImmediatePropagation()
    if (e.key === 'Escape') {
      kbNote = ''
      listen(null, redraw)
      redraw()
      return
    }
    const code = codeOf(e)
    if (RESERVED.has(code)) {
      kbNote = `${label(code)} 는 정해진 뜻이 있어 걸 수 없습니다 — 다른 키를 누르세요.`
      redraw()
      return
    }
    bind(a, code)
    kbNote = `${ACTIONS.find((x) => x.id === a)?.label} → ${label(code)}`
    listen(null, redraw)
    redraw()
  }
  window.addEventListener('keydown', capture, true)
}

/** 설정 칸의 단추를 잇는다. 값이 바뀌면 칸을 다시 그리고 다시 잇는다 */
export function bindSettings(box: HTMLElement, o: SettingsOpts = {}): void {
  const redraw = () => {
    box.innerHTML = settingsHtml(o)
    bindSettings(box, o)
  }
  box.querySelectorAll<HTMLButtonElement>('.srow .seg button').forEach((b) => {
    b.onclick = () => {
      const on = b.dataset.on === '1'
      const name = (b.parentElement as HTMLElement).dataset.set
      if (name === '소리') {
        setSoundMuted(!on)
        o.onSound?.(!on)
      } else if (name === '실사 괴물') {
        setRealMonsters(on)
        o.onReal?.(on)
      } else {
        setKeysShown(on)
        o.onKeys?.(on)
      }
      redraw()
    }
  })
  // 키 설정
  box.querySelectorAll<HTMLButtonElement>('.kb-toggle').forEach((b) => {
    b.onclick = () => {
      kbOpen = !kbOpen
      listen(null, redraw)
      kbNote = ''
      redraw()
    }
  })
  const reset = box.querySelector<HTMLButtonElement>('.kb-reset')
  if (reset)
    reset.onclick = () => {
      resetKeys()
      listen(null, redraw)
      kbNote = '모두 기본값으로 되돌렸습니다.'
      redraw()
    }
  box.querySelectorAll<HTMLButtonElement>('[data-kb]').forEach((b) => {
    b.onclick = () => {
      const a = b.dataset.kb as Action
      kbNote = ''
      listen(listening === a ? null : a, redraw)
      redraw()
    }
  })
  box.querySelectorAll<HTMLButtonElement>('.autopick button[data-r]').forEach((b) => {
    b.onclick = () => {
      const v = loadAutoPick() ^ (1 << Number(b.dataset.r))
      saveAutoPick(v)
      o.onAutoPick?.(v)
      redraw()
    }
  })
}

