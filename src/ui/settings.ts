// 설정 칸 — **게임 안(Esc 메뉴)과 대기실에서 같은 화면**을 쓴다
// (2026-09-20 사용자: "대기실에서도 설정 화면 들어갈 수 있도록 해 줘").
// 값은 모두 브라우저에 남는다(localStorage). 게임 안에서 바꾸면 그 판에 바로 반영되고,
// 대기실에서 바꾼 것은 판에 들어갈 때 반영된다.

import { AUTOPICK_ALL, AUTOPICK_DEFAULT, RARITY_COLORS, RARITY_NAMES } from '../core/items'
import { isTouchDevice } from '../game/touch'
import { ACTIONS, Action, RESERVED, bind, codeOf, keyLabel, label, resetKeys } from '../game/keymap'
import { VOL_KEYS, VOL_NAMES, VolKey, setVolume, volumes } from '../audio/volume'
import { drawAimShape } from '../render/aimShape'

/**
 * 전체 화면 (2026-10-09 사용자: "전체 화면에서 Tab 이나 Esc 를 누르면 바로 창 모드가 된다 — 설정으로만 바꾸게 하고 싶다").
 * 페이지가 연 전체 화면은 브라우저가 Esc 한 번에 풀어 버린다(보안 규칙 — 페이지가 막을 수 없다). 크롬 · 엣지는 **키보드 잠금**(Keyboard Lock)을
 * 걸면 짧은 Esc 는 게임으로 오고(메뉴 · 창 닫기), **Esc 를 길게(약 2초) 눌러야** 나간다 — 그 이상(길게 누르기까지 막기)은 브라우저가 허락하지 않는다.
 * 파이어폭스 · 사파리는 잠금이 없어 예전처럼 Esc 한 번에 풀린다. 나갈 때는 잠금도 푼다
 */
type KeyboardLock = { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void }
const kbLock = (): KeyboardLock | undefined => (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard
export async function enterFullscreen(): Promise<void> {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
    await kbLock()?.lock?.(['Escape'])
  } catch {
    /* 지원 안 하는 브라우저 · 거절 — 그냥 넘어간다 */
  }
}
export function leaveFullscreen(): void {
  kbLock()?.unlock?.()
  if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {})
}
/** 전체 화면 ↔ 창 (오른쪽 아래 단추 · Alt+Enter — 2026-10-24 사용자: "Esc 가 설정 창과 겹친다 — 오른쪽 아래 단추로 쉽게") */
export function toggleFullscreen(): void {
  if (document.fullscreenElement) leaveFullscreen()
  else void enterFullscreen()
}
// Esc 를 길게 눌러 나갔을 때도 잠금을 푼다 (창 모드에서 Esc 가 묶여 있지 않게)
if (typeof document !== 'undefined')
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) kbLock()?.unlock?.()
  })

const AUTOPICK_KEY = 'brpg.autopick'
const KEYS_KEY = 'brpg.keys'
const MUTE_KEY = 'brpg.muted'
const HUD_KEY = 'brpg.hud'
const FPSCAP_KEY = 'brpg.fpscap'
const AIM_KEY = 'brpg.aim'

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

/** 자동 줍기 등급 (처음은 희귀 이상 — AUTOPICK_DEFAULT · 고른 적이 있으면 그 값) */
export function loadAutoPick(): number {
  const v = Number(get(AUTOPICK_KEY) ?? AUTOPICK_DEFAULT)
  // 신화 등급(비트 16)이 생기기 전의 "모두"(15)는 모두로 (2026-09-19)
  if (v === 15) return AUTOPICK_ALL
  return Number.isInteger(v) && v >= 0 && v <= AUTOPICK_ALL ? v : AUTOPICK_ALL
}
export const saveAutoPick = (v: number): void => set(AUTOPICK_KEY, String(v))

// 2026-10-24 사용자: "실사 괴물 · 보스 목소리는 끌 일 없으니까 빼고 · 화면 흔들림도 빼고 · 화질도 무조건 자동 · 색약 모드도 빼고" → 설정 창에서 뺐다.
// 예전에 저장한 값(brpg.real · bossvoice · shake · gfx · colorblind)은 더 읽지 않는다 — 꺼 둔 채로 남지 않게

/** 실사 괴물 — 컴퓨터는 늘 켬 · 폰은 끔(받는 데이터 · 느린 기기) */
export const realMonstersOn = (): boolean => !isTouchDevice()

/** 화면 흔들림 세기 — 늘 끔(2026-10-08 사용자: 멀미 · 기본값 끔). 후원 "화면 흔들림" 이벤트는 따로 그대로다 */
export const shakeScale = (): number => 0
/**
 * 조준선(에임) 모양 · 크기 (2026-10-08 사용자: "설정에 에임 모양 및 크기 설정을 추가해줘"). 금색(약점 위) · 히트마커는 모양과 상관없이 그대로.
 * 모두 어두운 테두리를 둘러 ☀ 밝은 바닥에서도 보인다
 */
export type AimShape = 'cross' | 'crossring' | 'ring' | 'dot'
export const AIM_SHAPES: { id: AimShape; name: string }[] = [
  { id: 'cross', name: '십자' },
  { id: 'crossring', name: '십자 + 원' },
  { id: 'ring', name: '원' },
  { id: 'dot', name: '점' },
]
export const AIM_SIZES: { k: number; name: string }[] = [
  { k: 0.75, name: '작게' },
  { k: 1, name: '보통' },
  { k: 1.4, name: '크게' },
  { k: 1.8, name: '아주 크게' },
]
let aim: { shape: AimShape; size: number } = (() => {
  try {
    const v = JSON.parse(get(AIM_KEY) ?? '{}') as { shape?: string; size?: number }
    const shape = AIM_SHAPES.some((a) => a.id === v.shape) ? (v.shape as AimShape) : 'cross'
    // 처음 값은 크게 (2026-10-22 사용자: "기본 에임 크기도 크게") — 고른 적이 있으면 그 값
    const size = AIM_SIZES.some((a) => a.k === v.size) ? (v.size as number) : 1.4
    return { shape, size }
  } catch {
    return { shape: 'cross' as AimShape, size: 1.4 }
  }
})()
export const aimStyle = (): { shape: AimShape; size: number } => aim
export function setAimStyle(v: { shape?: AimShape; size?: number }): void {
  aim = { shape: v.shape ?? aim.shape, size: v.size ?? aim.size }
  set(AIM_KEY, JSON.stringify(aim))
}

/** 괴물 위 피해 숫자 — 늘 보인다 (2026-10-24 사용자: "피해 숫자는 보기로 — 메뉴에서 빼") */
export const dmgNumbersOn = (): boolean => true
/**
 * 프레임 제한: 고주사율 모니터에서도 1초에 약 60번만 그린다 (기본 켬 — game/ticker.ts shouldDraw).
 * 2026-10-24 "모니터에 맞춤"으로 굳혔다가 2026-10-25 사용자: "60 으로 고정하는 이유가 있다면 기본값을 60 으로 하고 설정에 추가" —
 * 판은 1초 60번 움직여 더 그려도 같은 장면이고, 같은 PC 에서 방송 프로그램(인코딩)이 쓸 CPU · GPU 를 남긴다. 방송 화면의 프레임은 방송 프로그램이 정한다
 */
let fpsCap = get(FPSCAP_KEY) !== '0'
export const fpsCapOn = (): boolean => fpsCap
export const setFpsCap = (on: boolean): void => {
  fpsCap = on
  set(FPSCAP_KEY, on ? '1' : '0')
}

/** 조작 안내 띠 */
export const keysShown = (): boolean => get(KEYS_KEY) !== '0'
export const setKeysShown = (on: boolean): void => set(KEYS_KEY, on ? '1' : '0')

/**
 * HUD 크기 (2026-09-23 사용자: "HUD 를 전체적으로 작게"). 논리 1px 을 화면 몇 px 로 보일지의 목표 — hud.ts setViewSize.
 * 전에는 논리 높이 720 고정이라 1080p 창에서 약 1.3 배 · 1440p 에서 1.8 배로 커 보였다. 보통 = 1 배.
 */
// 2026-10-22 보통을 1.3 배로 올렸다가 같은 날 사용자: "기본 해상도 자체를 줄인 느낌이라 플레이 화면을 너무 가려 — GUI 크기 자체는 원래대로" → 예전 값.
// 글씨는 작은 글씨 하한(12px) · 짧은 글로 알아보기 쉽게 하고, 더 크게는 '크게'에서
export const HUD_SIZES = [
  { id: 'small', name: '작게', k: 0.85 },
  { id: 'normal', name: '보통', k: 1 },
  { id: 'large', name: '크게', k: 1.2 },
] as const
export function hudSize(): (typeof HUD_SIZES)[number]['id'] {
  const v = get(HUD_KEY)
  return HUD_SIZES.some((h) => h.id === v) ? (v as (typeof HUD_SIZES)[number]['id']) : 'normal'
}
/** 소개 영상은 더 작게 (2026-10-08 사용자: "영상은 HUD 자체도 작게" — tools/trailer.js 가 'tiny' 를 넣는다 · 설정 창에는 없다) */
export const hudScale = (): number => (get(HUD_KEY) === 'tiny' ? 0.7 : (HUD_SIZES.find((h) => h.id === hudSize())?.k ?? 1))
export const setHudSize = (id: string): void => {
  set(HUD_KEY, id)
  applyUiZoom()
}
/** 창(HTML — 로비 · 가방 · 상점 · 설정 …) 배율: 작게 · 보통은 원래 크기(1) · 크게만 1.15 (1080p 아래 창은 화면을 덮지 않게 1) */
export function uiZoom(winH: number): number {
  return hudSize() === 'large' && winH >= 1000 ? 1.15 : 1
}
/** CSS 변수 --uiz 를 맞춘다 (style.css 의 zoom). 폰은 따로 짠 화면이라 1 */
export function applyUiZoom(): void {
  const touch = window.matchMedia?.('(pointer: coarse)').matches || location.search.includes('touch=1')
  document.documentElement.style.setProperty('--uiz', touch ? '1' : uiZoom(window.innerHeight).toFixed(3))
}

/**
 * 화질 (2026-09-23 최적화 — "서버 없는 게임이니 4명이 해도 렉이 없게"). 락스텝이라 한 사람이 느리면 모두가 기다린다.
 * 늘 자동(2026-10-24 사용자: "화질도 무조건 자동으로"): 프레임이 느리면 3D 해상도를 한 단계씩 낮추고(가장 낮으면 그림자도 끈다), 넉넉해지면 다시 올린다 (session.autoQuality).
 * 계측 도구(tools/perf.mjs · entrycheck.mjs)만 주소에 gfx=high 를 붙여 높게 고정한다
 */
export type GfxMode = 'auto' | 'high' | 'low'
export const gfxMode = (): GfxMode => (typeof location !== 'undefined' && location.search.includes('gfx=high') ? 'high' : 'auto')

/** 소리 (audio/sfx.ts 와 같은 열쇠) */
export const soundMuted = (): boolean => get(MUTE_KEY) === '1'
export const setSoundMuted = (m: boolean): void => set(MUTE_KEY, m ? '1' : '0')

export type SettingsOpts = {
  /** 조작 안내 줄을 보일까 (터치 기기는 띠가 없어 감춘다) */
  keys?: boolean
  /** 바뀐 값을 지금 판에도 알린다 (대기실에서는 없다 — 다음 판부터 반영) */
  onSound?: (muted: boolean) => void
  /** HUD 크기가 바뀌었다 (게임 안이면 화면 크기를 다시 맞춘다) */
  onHud?: () => void
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
  const state = ap === AUTOPICK_ALL ? '모두 줍기' : ap === 0 ? `꺼짐 — ${keyLabel('use')} 로만` : '켠 등급만'
  // 키 설정을 펴면 게임 안(Esc 메뉴)에서는 오른쪽 칸으로 편다 — 아래로 늘어나 화면을 넘던 것(2026-09-23 사용자) 고침
  const kb = !isTouchDevice()
  // 2026-10-24 사용자: "설정 메뉴가 쓸데없이 길다 — 1920 에서 한 화면에" → 자동 줍기를 맨 위로 · 소리는 전체 크기만 · 설명 줄은 짧게 · 전체 화면은 게임 화면 오른쪽 아래 단추로
  return (
    `<div class="settings${kb && kbOpen ? ' kbwide' : ''}"><div class="sg-main">` +
    `<div class="autopick"><div class="aph"><b>자동 줍기</b><span>${state}</span></div><div class="apr">${btns}</div>` +
    `<p class="apn">밟으면 내 아이템을 줍습니다. 끈 등급 · 남이 버린 아이템은 ${keyLabel('use')} 로 줍습니다.</p></div>` +
    onoff('소리', !soundMuted()) +
    volRowsHtml() +
    (o.keys === false ? '' : onoff('조작 안내', keysShown(), '보기', '숨기기')) +
    (isTouchDevice() ? '' : hudRowHtml()) +
    (isTouchDevice() ? '' : aimRowsHtml()) +
    onoff('프레임 제한', fpsCapOn(), '60fps', '모니터에 맞춤') +
    `<p class="apn">판은 1초에 60번 움직입니다 — 더 그리면 CPU 만 더 씁니다(방송할 때 60 권장).</p>` +
    `<p class="apn">치지직 방송 연동은 화면 왼쪽 위 <b>치지직</b> 단추에서 합니다.</p>` +
    `</div>` +
    (kb ? keybindHtml() : '') +
    `</div>`
  )
}

/** 소리 크기 밀대 — 전체 하나만 (2026-10-24 사용자: "소리 크기는 전체 크기 조절만 남겨" — 배경음 · 효과음 · 괴물 · 보스 목소리 밀대는 뺐다) */
function volRowsHtml(): string {
  const v = volumes()
  return (
    `<div class="vols">` +
    VOL_KEYS.filter((k) => k === 'all').map((k) => {
      const pct = Math.round(v[k] * 100)
      return `<label class="vrow"><span>${VOL_NAMES[k]}</span><input type="range" min="0" max="100" step="5" value="${pct}" data-vol="${k}"><em>${pct}%</em></label>`
    }).join('') +
    `</div>`
  )
}

/** 에임 모양 · 크기 — 단추마다 실제 조준선 그림 (2026-10-24 사용자: "실제 모양이 어떤 건지 그림으로") · 크기 단추는 고른 모양을 그 크기로 */
function aimRowsHtml(): string {
  const icon = (shape: AimShape, k: number) => `<canvas class="aimico" width="56" height="56" data-shape="${shape}" data-k="${k}"></canvas>`
  const shapes = AIM_SHAPES.map((a) => `<button type="button" data-aimshape="${a.id}" class="${a.id === aim.shape ? 'on' : ''}" title="${a.name}">${icon(a.id, 1)}</button>`).join('')
  const sizes = AIM_SIZES.map((a) => `<button type="button" data-aimsize="${a.k}" class="${a.k === aim.size ? 'on' : ''}" title="${a.name}">${icon(aim.shape, a.k)}</button>`).join('')
  return `<div class="srow aimrow"><b>에임 모양</b><div class="seg small hudseg">${shapes}</div></div><div class="srow aimrow"><b>에임 크기</b><div class="seg small hudseg">${sizes}</div></div>`
}

function hudRowHtml(): string {
  const cur = hudSize()
  const btns = HUD_SIZES.map((h) => `<button type="button" data-hud="${h.id}" class="${h.id === cur ? 'on' : ''}">${h.name}</button>`).join('')
  return `<div class="srow"><b>글자 크기</b><div class="seg small hudseg">${btns}</div></div>`
}

/**
 * 키 설정 (2026-09-23 — "RPG 에 보통 있는데 없는 것" 의 키 재설정). 접었다 펴는 칸 — 펴면 21 줄이라 Esc 메뉴가 길어진다.
 * 단추를 누르고 새 키를 누르면 바뀐다. 이미 다른 행동에 걸린 키면 **서로 바뀐다**.
 */
// 처음부터 펴 둔다 (2026-10-24 사용자: "키 설정은 기본값이 열림으로")
let kbOpen = true
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
function listen(a: Action | null, redraw: () => void, box?: HTMLElement): void {
  listening = a
  if (capture) window.removeEventListener('keydown', capture, true)
  capture = null
  if (!a) return
  capture = (e: KeyboardEvent) => {
    // 설정 칸이 닫혔다(메뉴 "계속" · 대화창 닫기): 기다리기를 그만두고 키는 그대로 흘려보낸다
    // (2026-10-08 — 키 단추를 누른 채 메뉴를 닫으면 다음 키(W · 채팅 글자)가 몰래 그 동작에 묶였다)
    if (box && (!box.isConnected || box.getClientRects().length === 0)) {
      listen(null, redraw)
      return
    }
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
    // 키 목록은 칸 안에서 굴러간다 — 다시 그려도 보던 자리 그대로 (2026-10-08 — 아래 줄을 누르면 맨 위로 튀었다)
    const top = box.querySelector('.kb-grid')?.scrollTop ?? 0
    box.innerHTML = settingsHtml(o)
    const g = box.querySelector('.kb-grid')
    if (g) g.scrollTop = top
    bindSettings(box, o)
  }
  box.querySelectorAll<HTMLButtonElement>('.srow .seg[data-set] button').forEach((b) => {
    b.onclick = () => {
      const on = b.dataset.on === '1'
      const name = (b.parentElement as HTMLElement).dataset.set
      if (name === '소리') {
        setSoundMuted(!on)
        o.onSound?.(!on)
      } else if (name === '프레임 제한') {
        setFpsCap(on)
      } else {
        setKeysShown(on)
        o.onKeys?.(on)
      }
      redraw()
    }
  })
  // 소리 크기: 끄는 동안에도 곧장 들리게 input 마다 반영 (칸을 다시 그리면 밀대를 놓친다 — 글자만 바꾼다)
  box.querySelectorAll<HTMLInputElement>('input[data-vol]').forEach((inp) => {
    inp.oninput = () => {
      const pct = Number(inp.value)
      setVolume(inp.dataset.vol as VolKey, pct / 100)
      const em = inp.parentElement?.querySelector('em')
      if (em) em.textContent = `${pct}%`
    }
  })
  box.querySelectorAll<HTMLButtonElement>('[data-aimshape]').forEach((b) => {
    b.onclick = () => {
      setAimStyle({ shape: b.dataset.aimshape as AimShape })
      redraw()
    }
  })
  box.querySelectorAll<HTMLButtonElement>('[data-aimsize]').forEach((b) => {
    b.onclick = () => {
      setAimStyle({ size: Number(b.dataset.aimsize) })
      redraw()
    }
  })
  // 조준선 그림: 크기 배율 k 를 그대로 (HUD 와 같은 함수 — render/aimShape.ts)
  box.querySelectorAll<HTMLCanvasElement>('canvas.aimico').forEach((c) => {
    const g = c.getContext('2d')
    if (!g) return
    const k = Number(c.dataset.k)
    drawAimShape(g, c.width / 2, c.height / 2, c.dataset.shape as AimShape, k, 12 * k * 0.8, false)
  })
  box.querySelectorAll<HTMLButtonElement>('[data-hud]').forEach((b) => {
    b.onclick = () => {
      setHudSize(b.dataset.hud as string)
      o.onHud?.()
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
      listen(listening === a ? null : a, redraw, box)
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

