export interface MailmapEntry {
  properName?: string
  properEmail: string
  commitName?: string
  commitEmail?: string
}

const NAME_EMAIL = /([^<>]*)<([^<>]+)>/g

/**
 * Parse a git .mailmap. Supports the four standard line forms:
 *   Proper Name <proper@email>
 *   <proper@email> <commit@email>
 *   Proper Name <proper@email> <commit@email>
 *   Proper Name <proper@email> Commit Name <commit@email>
 * Comments (`#`), blank lines, and lines without a usable <email> are skipped.
 */
export function parseMailmap(text: string): MailmapEntry[] {
  const entries: MailmapEntry[] = []

  for (const rawLine of text.split('\n')) {
    const line = rawLine.split('#')[0].trim()
    if (!line) continue

    const pairs: Array<{ name: string; email: string }> = []
    for (const match of line.matchAll(NAME_EMAIL)) {
      pairs.push({ name: match[1].trim(), email: match[2].trim() })
    }
    if (pairs.length === 0) continue

    const [proper, commit] = pairs
    const entry: MailmapEntry = { properEmail: proper.email }
    if (proper.name) entry.properName = proper.name
    if (commit) {
      entry.commitEmail = commit.email
      if (commit.name) entry.commitName = commit.name
    }
    entries.push(entry)
  }

  return entries
}
