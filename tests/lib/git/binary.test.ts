import { describe, expect, it } from 'vitest'
import { isBinaryBlob } from '../../../src/lib/git/binary'

const enc = (s: string) => new TextEncoder().encode(s)

describe('isBinaryBlob', () => {
  it('treats a blob containing a NUL byte as binary', () => {
    expect(isBinaryBlob(new Uint8Array([104, 105, 0, 106]))).toBe(true)
  })
  it('treats plain text as not binary', () => {
    expect(isBinaryBlob(enc('hello\nworld\n'))).toBe(false)
  })
  it('treats an empty blob as not binary', () => {
    expect(isBinaryBlob(new Uint8Array([]))).toBe(false)
  })
})
