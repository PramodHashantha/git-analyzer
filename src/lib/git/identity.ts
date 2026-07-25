import type { CommitInfo } from '../types'
import type { RepoContext } from './repo'

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

export interface IdentityResolver {
  resolve(name: string, email: string): string
}

export function buildIdentityResolver(
  entries: MailmapEntry[],
  commits: CommitInfo[]
): IdentityResolver {
  const lower = (s: string) => s.toLowerCase()

  // Map a commit (name, email) to its canonical email (lowercased). A mailmap
  // entry with a commitEmail remaps to properEmail; name+email entries are more
  // specific and win over email-only ones. Entries without a commitEmail (form
  // "Proper Name <email>") don't remap the email, they only name it (below).
  function canonEmail(name: string, email: string): string {
    const el = lower(email)
    let emailOnly: string | undefined
    for (const e of entries) {
      if (!e.commitEmail) continue
      if (lower(e.commitEmail) !== el) continue
      if (e.commitName !== undefined) {
        if (e.commitName === name) return lower(e.properEmail) // most specific
      } else if (emailOnly === undefined) {
        emailOnly = lower(e.properEmail)
      }
    }
    return emailOnly ?? el
  }

  // A mailmap-declared proper name for a canonical email, if any.
  function mailmapName(canonicalEmail: string): string | undefined {
    for (const e of entries) {
      if (e.properName && lower(e.properEmail) === canonicalEmail) return e.properName
    }
    return undefined
  }

  // Most frequent raw name per canonical email across the corpus (ties broken
  // lexicographically for determinism).
  const nameCounts = new Map<string, Map<string, number>>()
  for (const commit of commits) {
    if (!commit.email) continue
    const ce = canonEmail(commit.author, commit.email)
    const counts = nameCounts.get(ce) ?? new Map<string, number>()
    counts.set(commit.author, (counts.get(commit.author) ?? 0) + 1)
    nameCounts.set(ce, counts)
  }

  const displayName = new Map<string, string>()
  for (const [ce, counts] of nameCounts) {
    const declared = mailmapName(ce)
    if (declared) {
      displayName.set(ce, declared)
      continue
    }
    let best = ''
    let bestCount = -1
    for (const [name, count] of counts) {
      if (count > bestCount || (count === bestCount && name < best)) {
        best = name
        bestCount = count
      }
    }
    displayName.set(ce, best)
  }

  return {
    resolve(name: string, email: string): string {
      if (!email) return name
      const ce = canonEmail(name, email)
      return displayName.get(ce) ?? mailmapName(ce) ?? name
    },
  }
}

/** Read and parse the repo-root .mailmap, or [] if none exists. */
export async function readMailmap(ctx: RepoContext): Promise<MailmapEntry[]> {
  try {
    const text = (await ctx.fs.promises.readFile(`${ctx.dir === '/' ? '' : ctx.dir}/.mailmap`, {
      encoding: 'utf8',
    })) as string
    return parseMailmap(text)
  } catch {
    return []
  }
}
