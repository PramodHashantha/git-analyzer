import { describe, expect, it, vi, afterEach } from 'vitest'
import { isFileSystemAccessSupported } from '../../src/lib/browser-support'

describe('isFileSystemAccessSupported', () => {
  afterEach(() => {
    // @ts-expect-error test cleanup
    delete window.showDirectoryPicker
  })

  it('returns false when showDirectoryPicker is absent', () => {
    expect(isFileSystemAccessSupported()).toBe(false)
  })

  it('returns true when showDirectoryPicker is present', () => {
    // @ts-expect-error test stub
    window.showDirectoryPicker = vi.fn()
    expect(isFileSystemAccessSupported()).toBe(true)
  })
})
