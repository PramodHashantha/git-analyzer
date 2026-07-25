import * as git from 'isomorphic-git'
import { diffLines } from 'diff'
import type { RepoContext } from './repo'
import { decodeLines, linesToText } from './line-text'

/**
 * Map each line index in `currentLines` to its index in `parentLines` for lines
 * UNCHANGED between them. A current index absent from the returned map was
 * added or changed relative to the parent. Uses the shared diff + newline
 * normalization so results are consistent across the codebase.
 */
export function mapUnchangedToParent(
  parentLines: string[],
  currentLines: string[]
): Map<number, number> {
  const parts = diffLines(linesToText(parentLines), linesToText(currentLines))
  const curToParent = new Map<number, number>()
  let curIdx = 0
  let parIdx = 0
  for (const part of parts) {
    const count = part.count ?? 0
    if (part.added) {
      curIdx += count
    } else if (part.removed) {
      parIdx += count
    } else {
      for (let k = 0; k < count; k++) curToParent.set(curIdx + k, parIdx + k)
      curIdx += count
      parIdx += count
    }
  }
  return curToParent
}

async function readFileLinesAtCommit(
  ctx: RepoContext,
  commitOid: string,
  filepath: string
): Promise<string[]> {
  try {
    const { blob } = await git.readBlob({
      fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, oid: commitOid, filepath, cache: ctx.cache,
    })
    return decodeLines(blob)
  } catch {
    return []
  }
}

interface Claim {
  headLine: number
  pos: number
}

export async function blameFile(
  ctx: RepoContext,
  headOid: string,
  filepath: string
): Promise<string[]> {
  const headLines = await readFileLinesAtCommit(ctx, headOid, filepath)
  if (headLines.length === 0) return []
  const owners: (string | null)[] = new Array(headLines.length).fill(null)

  // Unresolved line claims grouped by their current suspect commit. Each HEAD
  // line is in exactly one group at a time (it moves suspect to suspect).
  const pending = new Map<string, Claim[]>()
  pending.set(headOid, headLines.map((_, i) => ({ headLine: i, pos: i })))

  const commitCache = new Map<string, { parent: string[]; ts: number }>()
  async function getCommit(oid: string): Promise<{ parent: string[]; ts: number }> {
    let c = commitCache.get(oid)
    if (!c) {
      const { commit } = await git.readCommit({ fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, oid, cache: ctx.cache })
      c = { parent: commit.parent, ts: commit.committer.timestamp }
      commitCache.set(oid, c)
    }
    return c
  }

  while (pending.size > 0) {
    // Process the newest pending suspect (git orders blame by commit date).
    let suspect = ''
    let newestTs = -Infinity
    for (const oid of pending.keys()) {
      const { ts } = await getCommit(oid)
      if (ts > newestTs) {
        newestTs = ts
        suspect = oid
      }
    }
    const claims = pending.get(suspect)!
    pending.delete(suspect)

    const { parent: parents } = await getCommit(suspect)
    if (parents.length === 0) {
      for (const c of claims) owners[c.headLine] = suspect
      continue
    }

    const currentLines = await readFileLinesAtCommit(ctx, suspect, filepath)
    let remaining = claims
    for (const parentOid of parents) {
      if (remaining.length === 0) break
      const parentLines = await readFileLinesAtCommit(ctx, parentOid, filepath)
      const curToPar = mapUnchangedToParent(parentLines, currentLines)
      const stillRemaining: Claim[] = []
      const passed: Claim[] = []
      for (const c of remaining) {
        const parentPos = curToPar.get(c.pos)
        if (parentPos !== undefined) passed.push({ headLine: c.headLine, pos: parentPos })
        else stillRemaining.push(c)
      }
      if (passed.length) {
        const list = pending.get(parentOid) ?? []
        list.push(...passed)
        pending.set(parentOid, list)
      }
      remaining = stillRemaining
    }
    // Lines changed relative to every parent were introduced by this commit.
    for (const c of remaining) owners[c.headLine] = suspect
  }

  for (let i = 0; i < owners.length; i++) {
    if (owners[i] === null) owners[i] = headOid
  }
  return owners as string[]
}
