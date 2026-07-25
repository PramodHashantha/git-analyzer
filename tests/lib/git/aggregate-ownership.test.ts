import { describe, expect, it } from 'vitest'
import { buildFixtureRepo } from '../../fixtures/gitFixture'
import { makeRepoContext } from '../../../src/lib/git/repo'
import { aggregateOwnership } from '../../../src/lib/git/aggregate-ownership'

describe('aggregateOwnership', () => {
  it('rolls up per-file ownership into per-author totals and percentages', async () => {
    const { fs, dir, headOid } = await buildFixtureRepo('aggregate-ownership-test-1', [
      {
        message: 'first',
        author: { name: 'Alice', email: 'alice@example.com' },
        files: { 'a.txt': 'one\ntwo\n', 'b.txt': 'x\n' },
      },
      {
        message: 'second',
        author: { name: 'Bob', email: 'bob@example.com' },
        files: { 'a.txt': 'one\ntwo\nthree\n' },
      },
    ])

    const ctx = makeRepoContext(fs, dir)
    const { files, authors } = await aggregateOwnership(ctx, headOid)

    const aTxt = files.find((f) => f.filepath === 'a.txt')
    expect(aTxt?.totalLines).toBe(3)
    expect(aTxt?.ownerLineCounts).toEqual({ Alice: 2, Bob: 1 })

    const bTxt = files.find((f) => f.filepath === 'b.txt')
    expect(bTxt?.ownerLineCounts).toEqual({ Alice: 1 })

    const alice = authors.find((a) => a.author === 'Alice')
    const bob = authors.find((a) => a.author === 'Bob')
    expect(alice?.linesOwned).toBe(3)
    expect(bob?.linesOwned).toBe(1)
    expect(alice?.percentage).toBeCloseTo(75)
    expect(bob?.percentage).toBeCloseTo(25)
  })

  it('reports progress across commits', async () => {
    const { fs, dir, headOid } = await buildFixtureRepo('aggregate-ownership-progress', [
      { message: 'c1', author: { name: 'Alice', email: 'alice@example.com' }, files: { 'a.txt': 'x\n' } },
      { message: 'c2', author: { name: 'Alice', email: 'alice@example.com' }, files: { 'b.txt': 'y\n' } },
    ])
    const ctx = makeRepoContext(fs, dir)

    const progress: Array<{ done: number; total: number }> = []
    await aggregateOwnership(ctx, headOid, (done, total) => progress.push({ done, total }))

    expect(progress).toEqual([
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ])
  })
})
