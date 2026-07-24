import { describe, expect, it } from 'vitest'
import { buildFixtureRepo } from '../../fixtures/gitFixture'
import { makeRepoContext } from '../../../src/lib/git/repo'
import { walkHistory } from '../../../src/lib/git/history'
import { blameFile, computeFileOwnership } from '../../../src/lib/git/blame'

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

  it('resolves owner oids to author names and counts lines', async () => {
    const { fs, dir, headOid } = await buildFixtureRepo('blame-test-2', [
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
    const counts = await computeFileOwnership(ctx, headOid, 'a.txt', new Map())

    expect(counts).toEqual({ Alice: 2, Bob: 1 })
  })
})
