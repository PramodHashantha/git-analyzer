import { describe, expect, it } from 'vitest'
import { buildFixtureRepo } from '../../fixtures/gitFixture'
import { makeRepoContext } from '../../../src/lib/git/repo'
import { walkHistory } from '../../../src/lib/git/history'

describe('walkHistory', () => {
  it('returns commits newest-first with author and merge info', async () => {
    const { fs, dir } = await buildFixtureRepo('history-test-1', [
      {
        message: 'first',
        author: { name: 'Alice', email: 'alice@example.com' },
        files: { 'a.txt': 'one\n' },
        timestampSeconds: 1000,
      },
      {
        message: 'second',
        author: { name: 'Bob', email: 'bob@example.com' },
        files: { 'a.txt': 'one\ntwo\n' },
        timestampSeconds: 2000,
      },
    ])

    const ctx = makeRepoContext(fs, dir)
    const commits = await walkHistory(ctx, 'main')

    expect(commits).toHaveLength(2)
    expect(commits[0].message).toBe('second')
    expect(commits[0].author).toBe('Bob')
    expect(commits[0].isMerge).toBe(false)
    expect(commits[1].message).toBe('first')
    expect(commits[1].parentOids).toEqual([])
  })
})
