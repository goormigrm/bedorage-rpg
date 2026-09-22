import { describe, expect, it } from 'vitest'
import { CHAT_MAX, cleanChat } from '../src/ui/chat'

describe('채팅 글 다듬기', () => {
  it('줄바꿈 · 제어 문자는 공백 하나로, 앞뒤 공백은 뗀다', () => {
    expect(cleanChat('  안녕\n\n하세요\t ')).toBe('안녕 하세요')
  })
  it('글이 아니면 빈 글 (고친 클라이언트가 보낸 이상한 값)', () => {
    expect(cleanChat(42)).toBe('')
    expect(cleanChat(null)).toBe('')
    expect(cleanChat({ text: 'x' })).toBe('')
  })
  it('길이를 자른다', () => {
    expect(cleanChat('가'.repeat(500))).toHaveLength(CHAT_MAX)
  })
  it('태그는 그대로 글자로 남는다 (화면에는 textContent 로만 넣는다)', () => {
    expect(cleanChat('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>')
  })
})
