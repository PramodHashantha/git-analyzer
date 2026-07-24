import type { ActivityBucket, CommitStats } from './types'

export function filterByAuthors<T extends { author: string }>(
  items: T[],
  selectedAuthors: string[]
): T[] {
  if (selectedAuthors.length === 0) return items
  const set = new Set(selectedAuthors)
  return items.filter((item) => set.has(item.author))
}

export function filterCommitStatsByAuthors(
  commitStats: CommitStats[],
  selectedAuthors: string[]
): CommitStats[] {
  if (selectedAuthors.length === 0) return commitStats
  const set = new Set(selectedAuthors)
  return commitStats.filter((stat) => set.has(stat.commit.author))
}

export interface DateRange {
  start: number | null
  end: number | null
}

export function filterActivityByDateRange(
  activity: ActivityBucket[],
  range: DateRange
): ActivityBucket[] {
  return activity.filter((bucket) => {
    if (range.start !== null && bucket.bucketStart < range.start) return false
    if (range.end !== null && bucket.bucketStart > range.end) return false
    return true
  })
}

export function filterCommitStatsByDateRange(
  commitStats: CommitStats[],
  range: DateRange
): CommitStats[] {
  return commitStats.filter((stat) => {
    const ms = stat.commit.timestamp * 1000
    if (range.start !== null && ms < range.start) return false
    if (range.end !== null && ms > range.end) return false
    return true
  })
}
