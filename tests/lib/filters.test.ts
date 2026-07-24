// tests/lib/filters.test.ts
import { describe, expect, it } from 'vitest'
import { filterByAuthors, filterActivityByDateRange } from '../../src/lib/filters'
import type { ActivityBucket } from '../../src/lib/types'

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
