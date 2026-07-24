import * as git from 'isomorphic-git'
import type { FileOwnership, AuthorOwnership } from '../types'
import type { RepoContext } from './repo'
import { computeFileOwnership } from './blame'

async function listFilesAtCommit(ctx: RepoContext, oid: string): Promise<string[]> {
  const files: string[] = []
  await git.walk({
    fs: ctx.fs,
    dir: ctx.dir,
    gitdir: ctx.gitdir,
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
  const files: FileOwnership[] = []
  const authorLineTotals = new Map<string, number>()
  const authorNameCache = new Map<string, string>()
  let grandTotal = 0

  for (let i = 0; i < filepaths.length; i++) {
    const filepath = filepaths[i]
    const ownerLineCounts = await computeFileOwnership(ctx, headOid, filepath, authorNameCache)
    const totalLines = Object.values(ownerLineCounts).reduce((a, b) => a + b, 0)

    files.push({ filepath, totalLines, ownerLineCounts })
    for (const [author, count] of Object.entries(ownerLineCounts)) {
      authorLineTotals.set(author, (authorLineTotals.get(author) ?? 0) + count)
      grandTotal += count
    }
    onProgress?.(i + 1, filepaths.length)
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
