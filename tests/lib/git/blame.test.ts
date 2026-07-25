import { describe, expect, it } from 'vitest'
import { buildFixtureRepo } from '../../fixtures/gitFixture'
import { makeRepoContext } from '../../../src/lib/git/repo'
import { walkHistory } from '../../../src/lib/git/history'
import { blameFile, mapUnchangedToParent } from '../../../src/lib/git/blame'

describe('mapUnchangedToParent', () => {
  it('maps unchanged current lines to their parent positions', () => {
    // parent: [a, b]; current: [a, b, c] -> a,b unchanged (0->0, 1->1); c added
    const m = mapUnchangedToParent(['a', 'b'], ['a', 'b', 'c'])
    expect([...m.entries()].sort((x, y) => x[0] - y[0])).toEqual([[0, 0], [1, 1]])
  })

  it('accounts for deletions when mapping positions', () => {
    // parent: [a, b, c]; current: [a, c] -> a:0->0, c:1->2 ; b was deleted
    const m = mapUnchangedToParent(['a', 'b', 'c'], ['a', 'c'])
    expect([...m.entries()].sort((x, y) => x[0] - y[0])).toEqual([[0, 0], [1, 2]])
  })

  it('maps nothing when everything changed', () => {
    expect([...mapUnchangedToParent(['a'], ['b']).entries()]).toEqual([])
  })
})

describe('blameFile', () => {
  it('attributes each HEAD line to the commit that introduced it', async () => {
    const { fs, dir, headOid } = await buildFixtureRepo('blame-test-1', [
      {
        message: 'first',
        author: { name: 'Alice', email: 'alice@example.com' },
        files: { 'a.txt': 'one\ntwo\n' },
      },
      {
        message: 'second',
        author: { name: 'Bob', email: 'bob@example.com' },
        files: { 'a.txt': 'one\ntwo\nthree\n' },
      },
    ])

    const ctx = makeRepoContext(fs, dir)
    const commits = await walkHistory(ctx, 'main')
    const owners = await blameFile(ctx, headOid, 'a.txt')

    expect(owners).toHaveLength(3)
    expect(owners[0]).toBe(commits[1].oid) // "one" from first commit
    expect(owners[1]).toBe(commits[1].oid) // "two" from first commit
    expect(owners[2]).toBe(commits[0].oid) // "three" from second commit
  })

  it('attributes lines correctly when the file has no trailing newline', async () => {
    const { fs, dir, headOid } = await buildFixtureRepo('blame-test-3', [
      {
        message: 'first',
        author: { name: 'Alice', email: 'alice@example.com' },
        files: { 'a.txt': 'one\ntwo' },
      },
      {
        message: 'second',
        author: { name: 'Bob', email: 'bob@example.com' },
        files: { 'a.txt': 'one\ntwo\nthree' },
      },
    ])

    const ctx = makeRepoContext(fs, dir)
    const commits = await walkHistory(ctx, 'main')
    const owners = await blameFile(ctx, headOid, 'a.txt')

    expect(owners).toHaveLength(3)
    expect(owners[0]).toBe(commits[1].oid) // "one" from first commit
    expect(owners[1]).toBe(commits[1].oid) // "two" from first commit
    expect(owners[2]).toBe(commits[0].oid) // "three" from second commit
  })
})
