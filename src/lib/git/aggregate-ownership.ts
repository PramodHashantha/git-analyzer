import * as git from 'isomorphic-git'
import type { FileOwnership, AuthorOwnership } from '../types'
import type { RepoContext } from './repo'
import { computeFileOwnership } from './blame'
import { mapWithConcurrency, GIT_READ_CONCURRENCY } from '../concurrency'

async function listFilesAtCommit(ctx: RepoContext, oid: string): Promise<string[]> {
  const files: string[] = []
  await git.walk({
    fs: ctx.fs,
    dir: ctx.dir,
    gitdir: ctx.gitdir,
    cache: ctx.cache,
    trees: [git.TREE({ ref: oid })],
    map: async (filepath, [entry]) => {
      if (filepath === '.' || !entry) return
      // Only walk plain blobs — trees recurse naturally, and mode-160000
      // submodule entries (type 'commit') must be skipped here too, since
      // blaming a submodule path would call readBlob on a commit object.
      if ((await entry.type()) !== 'blob') return
      files.push(filepath)
      return filepath
    },
  })
  return files.sort()
}

export async function aggregateOwnership(
  ctx: RepoContext,
  headOid: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ files: FileOwnership[]; authors: AuthorOwnership[] }> {
  const filepaths = await listFilesAtCommit(ctx, headOid)
  const authorNameCache = new Map<string, string>()

  // Blame each file concurrently (each blame is an independent history walk).
  // Results come back in filepath order, so the aggregation below stays
  // deterministic regardless of which files finish first.
  const perFileOwnerCounts = await mapWithConcurrency(
    filepaths,
    GIT_READ_CONCURRENCY,
    (filepath) => computeFileOwnership(ctx, headOid, filepath, authorNameCache),
    onProgress
  )

  const files: FileOwnership[] = []
  const authorLineTotals = new Map<string, number>()
  let grandTotal = 0

  for (let i = 0; i < filepaths.length; i++) {
    const ownerLineCounts = perFileOwnerCounts[i]
    const totalLines = Object.values(ownerLineCounts).reduce((a, b) => a + b, 0)

    files.push({ filepath: filepaths[i], totalLines, ownerLineCounts })
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
