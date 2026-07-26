import { describe, expect, it } from 'vitest'
import { rollupByDirectory } from '../../src/lib/directory-rollup'
import type { FileOwnership } from '../../shared/types'

describe('rollupByDirectory', () => {
  it('groups files by their top-level directory and sums line ownership', () => {
    const files: FileOwnership[] = [
      { filepath: 'src/a.ts', totalLines: 10, ownerLineCounts: { Alice: 10 } },
      { filepath: 'src/b.ts', totalLines: 5, ownerLineCounts: { Bob: 5 } },
      { filepath: 'readme.txt', totalLines: 2, ownerLineCounts: { Alice: 2 } },
    ]

    const rollup = rollupByDirectory(files)

    const src = rollup.find((r) => r.filepath === 'src')
    expect(src?.totalLines).toBe(15)
    expect(src?.ownerLineCounts).toEqual({ Alice: 10, Bob: 5 })

    const root = rollup.find((r) => r.filepath === '(root)')
    expect(root?.totalLines).toBe(2)
  })
})
