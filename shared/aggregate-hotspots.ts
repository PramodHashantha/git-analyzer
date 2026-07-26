import type { CommitStats, HotspotEntry } from './types'

export function aggregateHotspots(commitStats: CommitStats[], limit = 20): HotspotEntry[] {
  const byFile = new Map<string, { totalChurn: number; authors: Set<string> }>()

  for (const stat of commitStats) {
    for (const file of stat.files) {
      const entry = byFile.get(file.filepath) ?? { totalChurn: 0, authors: new Set<string>() }
      entry.totalChurn += file.added + file.deleted
      entry.authors.add(stat.commit.author)
      byFile.set(file.filepath, entry)
    }
  }

  return [...byFile.entries()]
    .map(([filepath, { totalChurn, authors }]) => ({
      filepath,
      totalChurn,
      authorCount: authors.size,
      score: totalChurn * authors.size,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
