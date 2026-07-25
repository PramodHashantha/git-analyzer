import { diffLines } from 'diff'
import * as git from 'isomorphic-git'
import type { RepoContext } from './repo'
import { listChangedFiles } from './line-diff'
import { decodeLines, linesToText } from './line-text'
import { mapWithConcurrency, GIT_READ_CONCURRENCY } from '../concurrency'
import { isBinaryBlob } from './binary'

/**
 * Given the owner commit-oid of each line of a file's parent version, and the
 * parent/child text, return the owner of each line of the child version:
 * added lines are owned by `commitOid`, unchanged (context) lines inherit
 * their parent owner by position, removed lines are dropped.
 *
 * Uses the same diffLines engine and (via callers) the same linesToText
 * normalization as blame.ts, so forward attribution matches backward blame.
 */
export function applyChangeToOwners(
  beforeOwners: string[],
  beforeText: string,
  afterText: string,
  commitOid: string
): string[] {
  const parts = diffLines(beforeText, afterText)
  const afterOwners: string[] = []
  let beforeIdx = 0

  for (const part of parts) {
    const count = part.count ?? 0
    if (part.added) {
      for (let k = 0; k < count; k++) afterOwners.push(commitOid)
    } else if (part.removed) {
      beforeIdx += count
    } else {
      for (let k = 0; k < count; k++) afterOwners.push(beforeOwners[beforeIdx + k])
      beforeIdx += count
    }
  }

  return afterOwners
}

async function readBlob(ctx: RepoContext, oid: string): Promise<Uint8Array> {
  const { blob } = await git.readBlob({
    fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, oid, cache: ctx.cache,
  })
  return blob
}

async function readBlobLines(ctx: RepoContext, oid: string): Promise<string[]> {
  const blob = await readBlob(ctx, oid)
  return decodeLines(blob)
}

/** First-parent chain from the root commit up to headOid (oldest first). */
async function firstParentChain(ctx: RepoContext, headOid: string): Promise<string[]> {
  const chain: string[] = []
  let oid: string | null = headOid
  while (oid) {
    chain.push(oid)
    const { commit } = await git.readCommit({
      fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, oid, cache: ctx.cache,
    })
    oid = commit.parent[0] ?? null
  }
  return chain.reverse()
}

export async function computeAllOwnership(
  ctx: RepoContext,
  headOid: string,
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, string[]>> {
  const chain = await firstParentChain(ctx, headOid) // oldest -> newest
  const state = new Map<string, string[]>()

  for (let i = 0; i < chain.length; i++) {
    const commitOid = chain[i]
    const parentOid = i > 0 ? chain[i - 1] : null
    const changed = await listChangedFiles(ctx, commitOid, parentOid)

    // Files within one commit are independent (each path appears once), so
    // they can be processed concurrently even though commits are sequential.
    await mapWithConcurrency(changed, GIT_READ_CONCURRENCY, async (change) => {
      if (change.afterOid === null) {
        state.delete(change.filepath)
        return
      }
      const afterBlob = await readBlob(ctx, change.afterOid)
      if (isBinaryBlob(afterBlob)) {
        state.delete(change.filepath)
        return
      }
      const afterLines = decodeLines(afterBlob)
      if (change.beforeOid === null) {
        state.set(change.filepath, afterLines.map(() => commitOid))
        return
      }
      const beforeBlob = await readBlob(ctx, change.beforeOid)
      const beforeLines = decodeLines(beforeBlob)
      const beforeOwners = state.get(change.filepath)
      if (!beforeOwners || beforeOwners.length !== beforeLines.length) {
        throw new Error(
          `ownership-walk: state invariant violated for "${change.filepath}" at ${commitOid} ` +
            `(have ${beforeOwners?.length ?? 'none'} owners, expected ${beforeLines.length})`
        )
      }
      state.set(
        change.filepath,
        applyChangeToOwners(beforeOwners, linesToText(beforeLines), linesToText(afterLines), commitOid)
      )
    })

    onProgress?.(i + 1, chain.length)
  }

  return state
}
