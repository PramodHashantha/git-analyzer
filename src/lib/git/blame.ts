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

export async function blameFile(
  ctx: RepoContext,
  headOid: string,
  filepath: string
): Promise<string[]> {
  const headLines = await readFileLinesAtCommit(ctx, headOid, filepath)
  const owners: (string | null)[] = new Array(headLines.length).fill(null)
  const positions: (number | null)[] = headLines.map((_, i) => i)

  let currentOid: string | null = headOid
  let currentLines = headLines

  while (currentOid && positions.some((p) => p !== null)) {
    const commit = await git.readCommit({ fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, oid: currentOid, cache: ctx.cache })
    const parentOid = commit.commit.parent[0] ?? null
    const parentLines = parentOid ? await readFileLinesAtCommit(ctx, parentOid, filepath) : []

    const curToPar = mapUnchangedToParent(parentLines, currentLines)
    const currentCommitOid = currentOid
    for (let headLine = 0; headLine < positions.length; headLine++) {
      const pos = positions[headLine]
      if (pos === null) continue
      const mapped = curToPar.get(pos)
      if (mapped === undefined) {
        owners[headLine] = currentCommitOid
        positions[headLine] = null
      } else {
        positions[headLine] = mapped
      }
    }

    currentOid = parentOid
    currentLines = parentLines
  }

  for (let i = 0; i < owners.length; i++) {
    if (owners[i] === null) owners[i] = headOid
  }

  return owners as string[]
}
