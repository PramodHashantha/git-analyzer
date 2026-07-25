import { describe, expect, it } from 'vitest'
import { decodeLines, linesToText } from '../../../src/lib/git/line-text'

const enc = (s: string) => new TextEncoder().encode(s)

describe('decodeLines', () => {
  it('returns [] for an empty blob', () => {
    expect(decodeLines(enc(''))).toEqual([])
  })
  it('drops the trailing empty element from a final newline', () => {
    expect(decodeLines(enc('one\ntwo\n'))).toEqual(['one', 'two'])
  })
  it('keeps all lines when there is no trailing newline', () => {
    expect(decodeLines(enc('one\ntwo'))).toEqual(['one', 'two'])
  })
})

describe('linesToText', () => {
  it('returns empty string for no lines', () => {
    expect(linesToText([])).toBe('')
  })
  it('joins with newlines and re-adds the trailing newline', () => {
    expect(linesToText(['one', 'two'])).toBe('one\ntwo\n')
  })
  it('round-trips with decodeLines for newline-terminated content', () => {
    expect(linesToText(decodeLines(enc('a\nb\n')))).toBe('a\nb\n')
  })
})
