import { startOfWeek, startOfMonth } from 'date-fns'
import type { AuthorTotals, ActivityBucket, CommitPatternSummary, CommitStats, CommitInfo } from './types'

/**
 * Merge commits combine branches rather than authoring code; git's own
 * `log --numstat` shows nothing for them. Exclude them from contribution
 * churn so mergers aren't credited with everyone's merged-in work.
 */
export function filterNonMergeCommits(commits: CommitInfo[]): CommitInfo[] {
  return commits.filter((c) => !c.isMerge)
}

export function aggregateAuthorTotals(commitStats: CommitStats[]): AuthorTotals[] {
  const byAuthor = new Map<string, AuthorTotals>()
  for (const stat of commitStats) {
    const author = stat.commit.author
    const existing = byAuthor.get(author) ?? { author, commits: 0, added: 0, deleted: 0, net: 0 }
    existing.commits += 1
    existing.added += stat.totalAdded
    existing.deleted += stat.totalDeleted
    existing.net = existing.added - existing.deleted
    byAuthor.set(author, existing)
  }
  return [...byAuthor.values()].sort((a, b) => b.added - a.added)
}

export type BucketGranularity = 'week' | 'month'

export function aggregateActivityOverTime(
  commitStats: CommitStats[],
  granularity: BucketGranularity
): ActivityBucket[] {
  const bucketFn = granularity === 'week' ? startOfWeek : startOfMonth
  const byKey = new Map<string, ActivityBucket>()

  for (const stat of commitStats) {
    const date = new Date(stat.commit.timestamp * 1000)
    const bucketStart = bucketFn(date).getTime()
    const author = stat.commit.author
    const key = `${bucketStart}::${author}`

    const existing = byKey.get(key) ?? { bucketStart, author, commits: 0, added: 0, deleted: 0 }
    existing.commits += 1
    existing.added += stat.totalAdded
    existing.deleted += stat.totalDeleted
    byKey.set(key, existing)
  }

  return [...byKey.values()].sort((a, b) => a.bucketStart - b.bucketStart)
}

export function aggregateCommitPatterns(commitStats: CommitStats[]): CommitPatternSummary[] {
  const byAuthor = new Map<string, CommitStats[]>()
  for (const stat of commitStats) {
    const list = byAuthor.get(stat.commit.author) ?? []
    list.push(stat)
    byAuthor.set(stat.commit.author, list)
  }

  const summaries: CommitPatternSummary[] = []
  for (const [author, stats] of byAuthor) {
    const dayOfWeekCounts = new Array(7).fill(0)
    const hourOfDayCounts = new Array(24).fill(0)
    let totalLines = 0
    let largestCommit = { oid: '', lines: -1 }

    for (const stat of stats) {
      const lines = stat.totalAdded + stat.totalDeleted
      totalLines += lines
      if (lines > largestCommit.lines) largestCommit = { oid: stat.commit.oid, lines }

      const date = new Date(stat.commit.timestamp * 1000)
      dayOfWeekCounts[date.getDay()] += 1
      hourOfDayCounts[date.getHours()] += 1
    }

    summaries.push({
      author,
      avgLinesPerCommit: stats.length ? totalLines / stats.length : 0,
      largestCommit,
      dayOfWeekCounts,
      hourOfDayCounts,
    })
  }

  return summaries
}
