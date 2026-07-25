import * as git from 'isomorphic-git'
import type { CommitInfo, CommitStats, FileLineStats } from '../types'
import type { RepoContext } from './repo'
import { listChangedFiles, countLineChanges } from './line-diff'
import { mapWithConcurrency, GIT_READ_CONCURRENCY } from '../concurrency'
import { isBinaryBlob } from './binary'

const decoder = new TextDecoder('utf-8', { fatal: false })

async function readBlob(ctx: RepoContext, oid: string): Promise<Uint8Array> {
  const { blob } = await git.readBlob({ fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, oid, cache: ctx.cache })
  return blob
}

/**
 * Diffs against the first parent only (merge commits are not diffed against
 * every parent) — the same simplification blame.ts uses, so churn and
 * ownership stay consistent with each other for merge-heavy histories.
 */
export async function computeCommitStats(ctx: RepoContext, commit: CommitInfo): Promise<CommitStats> {
  const parentOid = commit.parentOids[0] ?? null
  const changedFiles = await listChangedFiles(ctx, commit.oid, parentOid)

  const files: FileLineStats[] = []
  for (const change of changedFiles) {
    const beforeBlob = change.beforeOid ? await readBlob(ctx, change.beforeOid) : new Uint8Array()
    const afterBlob = change.afterOid ? await readBlob(ctx, change.afterOid) : new Uint8Array()
    if (isBinaryBlob(beforeBlob) || isBinaryBlob(afterBlob)) continue

    const beforeText = decoder.decode(beforeBlob)
    const afterText = decoder.decode(afterBlob)
    const { added, deleted } = countLineChanges(beforeText, afterText)
    files.push({ filepath: change.filepath, added, deleted })
  }

  return {
    commit,
    files,
    totalAdded: files.reduce((sum, f) => sum + f.added, 0),
    totalDeleted: files.reduce((sum, f) => sum + f.deleted, 0),
  }
}

export async function computeAllCommitStats(
  ctx: RepoContext,
  commits: CommitInfo[],
  onProgress?: (done: number, total: number) => void
): Promise<CommitStats[]> {
  return mapWithConcurrency(
    commits,
    GIT_READ_CONCURRENCY,
    (commit) => computeCommitStats(ctx, commit),
    onProgress
  )
}
