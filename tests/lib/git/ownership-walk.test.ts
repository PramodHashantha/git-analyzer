import { describe, expect, it } from 'vitest'
import { applyChangeToOwners, computeAllOwnership } from '../../../src/lib/git/ownership-walk'
import { linesToText } from '../../../src/lib/git/line-text'
import { buildFixtureRepo } from '../../fixtures/gitFixture'
import { makeRepoContext } from '../../../src/lib/git/repo'
import { walkHistory } from '../../../src/lib/git/history'

const owners = (before: string[], beforeOwners: string[], after: string[], oid: string) =>
  applyChangeToOwners(beforeOwners, linesToText(before), linesToText(after), oid)

describe('applyChangeToOwners', () => {
  it('attributes appended lines to the new commit, keeping context owners', () => {
    expect(owners(['one', 'two'], ['c1', 'c1'], ['one', 'two', 'three'], 'c2')).toEqual([
      'c1', 'c1', 'c2',
    ])
  })

  it('keeps surviving owners when a line is deleted', () => {
    expect(owners(['a', 'b', 'c'], ['c1', 'c1', 'c1'], ['a', 'c'], 'c2')).toEqual(['c1', 'c1'])
  })

  it('attributes only the changed line on an in-place edit', () => {
    expect(owners(['a', 'b', 'c'], ['c1', 'c1', 'c1'], ['a', 'B', 'c'], 'c2')).toEqual([
      'c1', 'c2', 'c1',
    ])
  })

  it('attributes a full replacement to the new commit', () => {
    expect(owners(['x'], ['c1'], ['y'], 'c2')).toEqual(['c2'])
  })

  it('returns [] when the file becomes empty', () => {
    expect(owners(['a'], ['c1'], [], 'c2')).toEqual([])
  })

  it('attributes every line to the commit when adding to an empty file', () => {
    expect(owners([], [], ['a', 'b'], 'c2')).toEqual(['c2', 'c2'])
  })
})

describe('computeAllOwnership', () => {
  it('maps each HEAD line to the commit that introduced it', async () => {
    const { fs, dir, headOid } = await buildFixtureRepo('own-walk-1', [
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
    const commits = await walkHistory(ctx, 'main') // [second, first]

    const owners = await computeAllOwnership(ctx, headOid)

    expect(owners.get('a.txt')).toEqual([commits[1].oid, commits[1].oid, commits[0].oid])
    expect(owners.get('b.txt')).toEqual([commits[1].oid])
  })

  it('reports progress once per commit', async () => {
    const { fs, dir, headOid } = await buildFixtureRepo('own-walk-2', [
      { message: 'c1', author: { name: 'A', email: 'a@x.com' }, files: { 'a.txt': 'x\n' } },
      { message: 'c2', author: { name: 'A', email: 'a@x.com' }, files: { 'a.txt': 'x\ny\n' } },
    ])
    const ctx = makeRepoContext(fs, dir)

    const progress: Array<{ done: number; total: number }> = []
    await computeAllOwnership(ctx, headOid, (done, total) => progress.push({ done, total }))

    expect(progress).toEqual([
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ])
  })
})
