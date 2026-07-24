// tests/lib/git/commit-stats.test.ts
import { describe, expect, it } from 'vitest'
import { buildFixtureRepo } from '../../fixtures/gitFixture'
import { makeRepoContext } from '../../../src/lib/git/repo'
import { walkHistory } from '../../../src/lib/git/history'
import { computeAllCommitStats } from '../../../src/lib/git/commit-stats'

describe('computeAllCommitStats', () => {
  it('reports added/deleted lines per commit, newest first', async () => {
    const { fs, dir } = await buildFixtureRepo('commit-stats-test-1', [
      {
        message: 'first',
        author: { name: 'Alice', email: 'alice@example.com' },
        files: { 'a.txt': 'one\n' },
      },
      {
        message: 'second',
        author: { name: 'Bob', email: 'bob@example.com' },
        files: { 'a.txt': 'one\ntwo\nthree\n' },
      },
    ])

    const ctx = makeRepoContext(fs, dir)
    const commits = await walkHistory(ctx, 'main')
    const stats = await computeAllCommitStats(ctx, commits)

    expect(stats).toHaveLength(2)
    expect(stats[0].commit.message).toBe('second')
    expect(stats[0].totalAdded).toBe(2)
    expect(stats[0].totalDeleted).toBe(0)
    expect(stats[1].totalAdded).toBe(1)
  })

  it('reports progress as it goes', async () => {
    const { fs, dir } = await buildFixtureRepo('commit-stats-test-2', [
      { message: 'only', author: { name: 'Alice', email: 'a@example.com' }, files: { 'a.txt': 'x\n' } },
    ])
    const ctx = makeRepoContext(fs, dir)
    const commits = await walkHistory(ctx, 'main')

    const progress: Array<{ done: number; total: number }> = []
    await computeAllCommitStats(ctx, commits, (done, total) => progress.push({ done, total }))

    expect(progress).toEqual([{ done: 1, total: 1 }])
  })
})
