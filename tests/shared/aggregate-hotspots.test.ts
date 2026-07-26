import { describe, expect, it } from 'vitest'
import { aggregateHotspots } from '../../shared/aggregate-hotspots'
import type { CommitStats } from '../../shared/types'

function stat(
  author: string,
  oid: string,
  files: { filepath: string; added: number; deleted: number }[]
): CommitStats {
  return {
    commit: { oid, parentOids: [], author, email: `${author}@example.com`, timestamp: 0, message: 'x', isMerge: false },
    files,
    totalAdded: files.reduce((s, f) => s + f.added, 0),
    totalDeleted: files.reduce((s, f) => s + f.deleted, 0),
  }
}

describe('aggregateHotspots', () => {
  it('scores files by total churn times distinct author count', () => {
    const commitStats: CommitStats[] = [
      stat('Alice', 'c1', [{ filepath: 'a.txt', added: 10, deleted: 0 }]),
      stat('Bob', 'c2', [{ filepath: 'a.txt', added: 5, deleted: 5 }]),
      stat('Alice', 'c3', [{ filepath: 'b.txt', added: 100, deleted: 0 }]),
    ]

    const hotspots = aggregateHotspots(commitStats)

    const a = hotspots.find((h) => h.filepath === 'a.txt')!
    expect(a.totalChurn).toBe(20)
    expect(a.authorCount).toBe(2)
    expect(a.score).toBe(40)

    const b = hotspots.find((h) => h.filepath === 'b.txt')!
    expect(b.totalChurn).toBe(100)
    expect(b.authorCount).toBe(1)
    expect(b.score).toBe(100)

    // b.txt has the higher score (100 vs 40) despite fewer distinct authors.
    expect(hotspots[0].filepath).toBe('b.txt')
  })

  it('caps results to the given limit, defaulting to 20', () => {
    const commitStats: CommitStats[] = Array.from({ length: 30 }, (_, i) =>
      stat('Alice', `c${i}`, [{ filepath: `file${i}.txt`, added: i + 1, deleted: 0 }])
    )
    expect(aggregateHotspots(commitStats, 5)).toHaveLength(5)
    expect(aggregateHotspots(commitStats)).toHaveLength(20)
  })
})
