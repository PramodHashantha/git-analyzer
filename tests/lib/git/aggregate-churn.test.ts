import { describe, expect, it } from 'vitest'
import type { CommitStats, CommitInfo } from '../../../src/lib/types'
import {
  aggregateAuthorTotals,
  aggregateActivityOverTime,
  aggregateCommitPatterns,
  filterNonMergeCommits,
} from '../../../src/lib/git/aggregate-churn'

function makeStat(overrides: Partial<CommitStats['commit']> & { totalAdded: number; totalDeleted: number }): CommitStats {
  return {
    commit: {
      oid: overrides.oid ?? 'oid1',
      parentOids: [],
      author: overrides.author ?? 'Alice',
      email: overrides.email ?? 'alice@example.com',
      timestamp: overrides.timestamp ?? 1700000000,
      message: overrides.message ?? 'msg',
      isMerge: overrides.isMerge ?? false,
    },
    files: [],
    totalAdded: overrides.totalAdded,
    totalDeleted: overrides.totalDeleted,
  }
}

describe('aggregateAuthorTotals', () => {
  it('sums commits/added/deleted per author, sorted by added desc', () => {
    const stats = [
      makeStat({ author: 'Alice', totalAdded: 10, totalDeleted: 2 }),
      makeStat({ author: 'Bob', totalAdded: 30, totalDeleted: 5 }),
      makeStat({ author: 'Alice', totalAdded: 5, totalDeleted: 1 }),
    ]

    const totals = aggregateAuthorTotals(stats)

    expect(totals[0]).toEqual({ author: 'Bob', commits: 1, added: 30, deleted: 5, net: 25 })
    expect(totals[1]).toEqual({ author: 'Alice', commits: 2, added: 15, deleted: 3, net: 12 })
  })
})

describe('aggregateActivityOverTime', () => {
  it('buckets commits by month per author', () => {
    const jan = Date.UTC(2024, 0, 15) / 1000
    const feb = Date.UTC(2024, 1, 10) / 1000

    const stats = [
      makeStat({ author: 'Alice', timestamp: jan, totalAdded: 5, totalDeleted: 0 }),
      makeStat({ author: 'Alice', timestamp: feb, totalAdded: 3, totalDeleted: 1 }),
    ]

    const activity = aggregateActivityOverTime(stats, 'month')

    expect(activity).toHaveLength(2)
    expect(activity[0].author).toBe('Alice')
    expect(activity[0].added).toBe(5)
    expect(activity[1].added).toBe(3)
  })
})

describe('aggregateCommitPatterns', () => {
  it('computes average lines per commit and largest commit per author', () => {
    const stats = [
      makeStat({ author: 'Alice', oid: 'a', totalAdded: 10, totalDeleted: 0 }),
      makeStat({ author: 'Alice', oid: 'b', totalAdded: 50, totalDeleted: 0 }),
    ]

    const patterns = aggregateCommitPatterns(stats)

    expect(patterns).toHaveLength(1)
    expect(patterns[0].author).toBe('Alice')
    expect(patterns[0].avgLinesPerCommit).toBe(30)
    expect(patterns[0].largestCommit).toEqual({ oid: 'b', lines: 50 })
    expect(patterns[0].dayOfWeekCounts).toHaveLength(7)
    expect(patterns[0].hourOfDayCounts).toHaveLength(24)
  })
})

function commit(oid: string, isMerge: boolean): CommitInfo {
  return { oid, parentOids: [], author: 'A', email: 'a@x.com', timestamp: 0, message: 'm', isMerge }
}

describe('filterNonMergeCommits', () => {
  it('drops merge commits and keeps the rest in order', () => {
    const commits = [commit('a', false), commit('b', true), commit('c', false)]
    expect(filterNonMergeCommits(commits).map((c) => c.oid)).toEqual(['a', 'c'])
  })

  it('returns everything when there are no merges', () => {
    const commits = [commit('a', false), commit('b', false)]
    expect(filterNonMergeCommits(commits)).toHaveLength(2)
  })
})
