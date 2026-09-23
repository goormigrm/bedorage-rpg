// 키 재설정 (2026-09-23): e.code 로 보고 · 겹치면 서로 바꾸고 · 정해진 키(Esc · Enter · Tab · 화살표)는 못 건다.
import { beforeEach, describe, expect, it } from 'vitest'
import { _resetForTest, actionOf, bind, codeOf, isKey, keyLabel, keyOf, keysHintHtml, label, moveLabel, resetKeys, skillKeyLabel } from '../src/game/keymap'

describe('키 재설정', () => {
  beforeEach(() => _resetForTest())

  it('기본값은 예전 키와 같다 (WASD · Q · E · R · 1 · 2 · F · I …)', () => {
    expect(keyOf('up')).toBe('KeyW')
    expect(keyOf('dash')).toBe('Space')
    expect(keyOf('sprint')).toBe('Shift')
    expect(keyOf('use')).toBe('KeyF')
    expect(keyOf('bag')).toBe('KeyI')
    expect(moveLabel()).toBe('WASD')
    expect([0, 1, 2, 3, 4].map(skillKeyLabel)).toEqual(['Q', 'E', 'R', '1', '2'])
  })

  it('e.code 로 본다 — 한글 입력 상태(key 가 ㅈ · Process)여도 W 는 W 다 · 좌우 Shift 는 하나', () => {
    expect(isKey({ code: 'KeyW', key: 'ㅈ' }, 'up')).toBe(true)
    expect(isKey({ code: 'KeyW', key: 'Process' }, 'up')).toBe(true)
    expect(codeOf({ code: 'ShiftRight' })).toBe('Shift')
    expect(codeOf({ code: 'ShiftLeft' })).toBe('Shift')
    expect(isKey({ code: 'ShiftRight' }, 'sprint')).toBe(true)
  })

  it('이미 쓰는 키를 걸면 서로 바뀐다 — 한 키가 둘을 하지 않는다', () => {
    bind('skill1', 'KeyE')
    expect(keyOf('skill1')).toBe('KeyE')
    expect(keyOf('skill2')).toBe('KeyQ')
    expect(actionOf('KeyE')).toBe('skill1')
    bind('up', 'KeyZ')
    expect(keyOf('up')).toBe('KeyZ')
    expect(moveLabel()).toBe('Z · A · S · D')
    expect(keysHintHtml()).toContain('Z · A · S · D')
  })

  it('Esc · Enter · Tab · 화살표는 걸 수 없다', () => {
    for (const c of ['Escape', 'Enter', 'Tab', 'ArrowUp']) expect(bind('use', c)).toBe(false)
    expect(keyOf('use')).toBe('KeyF')
  })

  it('기본값으로 되돌리기 · 이름표', () => {
    bind('use', 'KeyG')
    expect(keyLabel('use')).toBe('G')
    resetKeys()
    expect(keyLabel('use')).toBe('F')
    expect(label('Digit1')).toBe('1')
    expect(label('Space')).toBe('Space')
    expect(label('Semicolon')).toBe(';')
  })
})
