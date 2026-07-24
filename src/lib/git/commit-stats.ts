import * as git from 'isomorphic-git'
import type { CommitInfo, CommitStats, FileLineStats } from '../types'
import type { RepoContext } from './repo'
import { listChangedFiles, countLineChanges } from './line-diff'

const decoder = new TextDecoder('utf-8', { fatal: false })

async function readBlobText(ctx: RepoContext, oid: string): Promise<string> {
  const { blob } = await git.readBlob({ fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, oid })
  return decoder.decode(blob)
}

function isBinary(text: string): boolean {
  return text.includes(String.fromCharCode(0))
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
    const beforeText = change.beforeOid ? await readBlobText(ctx, change.beforeOid) : ''
    const afterText = change.afterOid ? await readBlobText(ctx, change.afterOid) : ''
    if (isBinary(beforeText) || isBinary(afterText)) continue

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
  const results: CommitStats[] = []
  for (let i = 0; i < commits.length; i++) {
    results.push(await computeCommitStats(ctx, commits[i]))
    onProgress?.(i + 1, commits.length)
  }
  return results
}
