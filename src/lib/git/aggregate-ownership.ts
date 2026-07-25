import * as git from 'isomorphic-git'
import type { FileOwnership, AuthorOwnership } from '../types'
import type { RepoContext } from './repo'
import type { IdentityResolver } from './identity'
import { blameFile } from './blame'
import { isBinaryBlob } from './binary'
import { mapWithConcurrency, GIT_READ_CONCURRENCY } from '../concurrency'

async function listTextFiles(ctx: RepoContext, headOid: string): Promise<string[]> {
  const files = await git.listFiles({ fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, ref: headOid })
  const textFiles: string[] = []
  await mapWithConcurrency(files, GIT_READ_CONCURRENCY, async (filepath) => {
    const { blob } = await git.readBlob({
      fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, oid: headOid, filepath, cache: ctx.cache,
    })
    if (!isBinaryBlob(blob)) textFiles.push(filepath)
  })
  return textFiles.sort()
}

export async function aggregateOwnership(
  ctx: RepoContext,
  headOid: string,
  onProgress?: (done: number, total: number) => void,
  resolver?: IdentityResolver
): Promise<{ files: FileOwnership[]; authors: AuthorOwnership[] }> {
  const filepaths = await listTextFiles(ctx, headOid)
  const authorNameCache = new Map<string, string>()

  async function ownersFor(filepath: string): Promise<Record<string, number>> {
    const owners = await blameFile(ctx, headOid, filepath)
    const counts: Record<string, number> = {}
    for (const oid of owners) {
      let author = authorNameCache.get(oid)
      if (!author) {
        const { commit } = await git.readCommit({
          fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, oid, cache: ctx.cache,
        })
        author = resolver ? resolver.resolve(commit.author.name, commit.author.email) : commit.author.name
        authorNameCache.set(oid, author)
      }
      counts[author] = (counts[author] ?? 0) + 1
    }
    return counts
  }

  const perFile = await mapWithConcurrency(filepaths, GIT_READ_CONCURRENCY, ownersFor, onProgress)

  const files: FileOwnership[] = []
  const authorLineTotals = new Map<string, number>()
  let grandTotal = 0
  for (let i = 0; i < filepaths.length; i++) {
    const ownerLineCounts = perFile[i]
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
