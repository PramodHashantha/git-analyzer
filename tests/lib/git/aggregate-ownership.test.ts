import { describe, expect, it } from 'vitest'
import { buildFixtureRepo } from '../../fixtures/gitFixture'
import { makeRepoContext } from '../../../src/lib/git/repo'
import { walkHistory } from '../../../src/lib/git/history'
import { aggregateOwnership } from '../../../src/lib/git/aggregate-ownership'
import { buildIdentityResolver } from '../../../src/lib/git/identity'

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

  it('reports progress once per text file (not per commit)', async () => {
    // One commit, two files: per-file progress is [1/2, 2/2]; a per-commit
    // scheme would report [1/1], so this fixture discriminates the two.
    const { fs, dir, headOid } = await buildFixtureRepo('aggregate-ownership-progress', [
      {
        message: 'c1',
        author: { name: 'Alice', email: 'alice@example.com' },
        files: { 'a.txt': 'x\n', 'b.txt': 'y\n' },
      },
    ])
    const ctx = makeRepoContext(fs, dir)

    const progress: Array<{ done: number; total: number }> = []
    await aggregateOwnership(ctx, headOid, (done, total) => progress.push({ done, total }))

    expect(progress).toEqual([
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ])
  })

  it('excludes binary files from ownership', async () => {
    // A NUL byte (built at runtime to keep this source file pure ASCII) marks
    // image.bin as binary, so it must be excluded from ownership.
    const binaryContent = 'PNG' + String.fromCharCode(0) + 'data'
    const { fs, dir, headOid } = await buildFixtureRepo('aggregate-ownership-binary', [
      {
        message: 'text + binary',
        author: { name: 'Alice', email: 'alice@example.com' },
        files: { 'code.txt': 'a\nb\n', 'image.bin': binaryContent },
      },
    ])
    const ctx = makeRepoContext(fs, dir)
    const { files } = await aggregateOwnership(ctx, headOid)

    expect(files.some((f) => f.filepath === 'code.txt')).toBe(true)
    expect(files.some((f) => f.filepath === 'image.bin')).toBe(false)
  })

  it('applies an identity resolver to owner author names', async () => {
    const { fs, dir, headOid } = await buildFixtureRepo('aggregate-ownership-identity', [
      {
        message: 'first',
        author: { name: 'Alice', email: 'shared@x.com' },
        files: { 'a.txt': 'one\n' },
      },
      {
        message: 'second',
        author: { name: 'Alice Alt', email: 'shared@x.com' },
        files: { 'a.txt': 'one\ntwo\n' },
      },
    ])
    const ctx = makeRepoContext(fs, dir)
    const commits = await walkHistory(ctx, 'main')
    const resolver = buildIdentityResolver([], commits)

    const { authors } = await aggregateOwnership(ctx, headOid, undefined, resolver)

    // Both commits share an email, so ownership collapses to one author.
    expect(authors).toHaveLength(1)
    expect(authors[0].linesOwned).toBe(2)
  })
})
