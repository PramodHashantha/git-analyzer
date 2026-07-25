import * as git from 'isomorphic-git'
import type { FileOwnership, AuthorOwnership } from '../types'
import type { RepoContext } from './repo'
import { computeAllOwnership } from './ownership-walk'
import type { IdentityResolver } from './identity'

export async function aggregateOwnership(
  ctx: RepoContext,
  headOid: string,
  onProgress?: (done: number, total: number) => void,
  resolver?: IdentityResolver
): Promise<{ files: FileOwnership[]; authors: AuthorOwnership[] }> {
  const ownersByFile = await computeAllOwnership(ctx, headOid, onProgress)

  const files: FileOwnership[] = []
  const authorLineTotals = new Map<string, number>()
  const authorNameCache = new Map<string, string>()
  let grandTotal = 0

  for (const filepath of [...ownersByFile.keys()].sort()) {
    const owners = ownersByFile.get(filepath)!
    const ownerLineCounts: Record<string, number> = {}

    for (const oid of owners) {
      let author = authorNameCache.get(oid)
      if (!author) {
        const { commit } = await git.readCommit({
          fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, oid, cache: ctx.cache,
        })
        const rawName = commit.author.name
        author = resolver ? resolver.resolve(rawName, commit.author.email) : rawName
        authorNameCache.set(oid, author)
      }
      ownerLineCounts[author] = (ownerLineCounts[author] ?? 0) + 1
    }

    files.push({ filepath, totalLines: owners.length, ownerLineCounts })
    for (const [author, count] of Object.entries(ownerLineCounts)) {
      authorLineTotals.set(author, (authorLineTotals.get(author) ?? 0) + count)
      grandTotal += count
    }
  }

  const authors: AuthorOwnership[] = [...authorLineTotals.entries()]
    .map(([author, linesOwned]) => ({
      author,
      linesOwned,
      percentage: grandTotal ? (linesOwned / grandTotal) * 100 : 0,
    }))
    .sort((a, b) => b.linesOwned - a.linesOwned)

  return { files, authors }
}
