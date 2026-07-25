import type { FileOwnership, BusFactorEntry } from './types'

export function aggregateBusFactor(
  fileOwnership: FileOwnership[],
  thresholdPercentage = 80,
  minLines = 5,
  limit = 20
): BusFactorEntry[] {
  const entries: BusFactorEntry[] = []

  for (const file of fileOwnership) {
    if (file.totalLines < minLines) continue

    let topAuthor = ''
    let topLines = -1
    for (const [author, lines] of Object.entries(file.ownerLineCounts)) {
      if (lines > topLines) {
        topAuthor = author
        topLines = lines
      }
    }

    const topAuthorPercentage = (topLines / file.totalLines) * 100
    if (topAuthorPercentage >= thresholdPercentage) {
      entries.push({ filepath: file.filepath, totalLines: file.totalLines, topAuthor, topAuthorPercentage })
    }
  }

  return entries.sort((a, b) => b.topAuthorPercentage - a.topAuthorPercentage).slice(0, limit)
}
