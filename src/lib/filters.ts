import type { ActivityBucket } from './types'

export function filterByAuthors<T extends { author: string }>(
  items: T[],
  selectedAuthors: string[]
): T[] {
  if (selectedAuthors.length === 0) return items
  const set = new Set(selectedAuthors)
  return items.filter((item) => set.has(item.author))
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
