// tests/lib/filters.test.ts
import { describe, expect, it } from 'vitest'
import {
  filterByAuthors,
  filterActivityByDateRange,
  filterCommitStatsByDateRange,
  filterCommitStatsByAuthors,
} from '../../src/lib/filters'
import type { ActivityBucket, CommitStats } from '../../src/lib/types'

describe('filterByAuthors', () => {
  it('returns everything when no authors are selected', () => {
    const items = [{ author: 'Alice' }, { author: 'Bob' }]
    expect(filterByAuthors(items, [])).toEqual(items)
  })

  it('keeps only the selected authors', () => {
    const items = [{ author: 'Alice' }, { author: 'Bob' }]
    expect(filterByAuthors(items, ['Bob'])).toEqual([{ author: 'Bob' }])
  })
})

describe('filterActivityByDateRange', () => {
  const activity: ActivityBucket[] = [
    { bucketStart: 1000, author: 'Alice', commits: 1, added: 1, deleted: 0 },
    { bucketStart: 2000, author: 'Alice', commits: 1, added: 1, deleted: 0 },
    { bucketStart: 3000, author: 'Alice', commits: 1, added: 1, deleted: 0 },
  ]

  it('returns everything when the range is unbounded', () => {
    expect(filterActivityByDateRange(activity, { start: null, end: null })).toHaveLength(3)
  })

  it('excludes buckets outside the given range', () => {
    const result = filterActivityByDateRange(activity, { start: 1500, end: 2500 })
    expect(result).toEqual([activity[1]])
  })
})

describe('filterCommitStatsByDateRange', () => {
  function makeStat(timestamp: number): CommitStats {
    return {
      commit: {
        oid: `oid-${timestamp}`,
        parentOids: [],
        author: 'Alice',
        email: 'alice@example.com',
        timestamp,
        message: 'msg',
        isMerge: false,
      },
      files: [],
      totalAdded: 1,
      totalDeleted: 0,
    }
  }

  const commitStats: CommitStats[] = [makeStat(1), makeStat(2), makeStat(3)]

  it('returns everything when the range is unbounded', () => {
    expect(filterCommitStatsByDateRange(commitStats, { start: null, end: null })).toEqual(
      commitStats
    )
  })

  it('excludes commits outside the given range', () => {
    const result = filterCommitStatsByDateRange(commitStats, { start: 1500, end: 2500 })
    expect(result).toEqual([commitStats[1]])
  })
})

describe('filterCommitStatsByAuthors', () => {
  function makeStat(author: string): CommitStats {
    return {
      commit: {
        oid: `oid-${author}`,
        parentOids: [],
        author,
        email: `${author}@example.com`,
        timestamp: 1,
        message: 'msg',
        isMerge: false,
      },
      files: [],
      totalAdded: 1,
      totalDeleted: 0,
    }
  }

  const commitStats: CommitStats[] = [makeStat('Alice'), makeStat('Bob')]

  it('returns everything when no authors are selected', () => {
    expect(filterCommitStatsByAuthors(commitStats, [])).toEqual(commitStats)
  })

  it('keeps only commits from the selected authors', () => {
    const result = filterCommitStatsByAuthors(commitStats, ['Bob'])
    expect(result).toEqual([commitStats[1]])
  })
})
