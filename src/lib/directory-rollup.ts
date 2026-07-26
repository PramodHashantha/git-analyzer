import type { FileOwnership } from '../../shared/types'

export function rollupByDirectory(files: FileOwnership[]): FileOwnership[] {
  const byDir = new Map<string, FileOwnership>()

  for (const file of files) {
    const dir = file.filepath.includes('/') ? file.filepath.split('/')[0] : '(root)'
    const existing = byDir.get(dir) ?? { filepath: dir, totalLines: 0, ownerLineCounts: {} }
    existing.totalLines += file.totalLines
    for (const [author, count] of Object.entries(file.ownerLineCounts)) {
      existing.ownerLineCounts[author] = (existing.ownerLineCounts[author] ?? 0) + count
    }
    byDir.set(dir, existing)
  }

  return [...byDir.values()].sort((a, b) => b.totalLines - a.totalLines)
}
