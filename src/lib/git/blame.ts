import * as git from 'isomorphic-git'
import { diffLines } from 'diff'
import type { RepoContext } from './repo'

const decoder = new TextDecoder('utf-8', { fatal: false })

async function readFileLinesAtCommit(
  ctx: RepoContext,
  commitOid: string,
  filepath: string
): Promise<string[]> {
  try {
    const { blob } = await git.readBlob({
      fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, oid: commitOid, filepath,
    })
    const text = decoder.decode(blob)
    if (!text.length) return []
    const lines = text.split('\n')
    // Remove trailing empty line if text ends with newline
    return lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines
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
    const commit = await git.readCommit({ fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, oid: currentOid })
    const parentOid = commit.commit.parent[0] ?? null
    const parentLines = parentOid ? await readFileLinesAtCommit(ctx, parentOid, filepath) : []

    const parentText = parentLines.length ? parentLines.join('\n') + '\n' : ''
    const currentText = currentLines.length ? currentLines.join('\n') + '\n' : ''
    const parts = diffLines(parentText, currentText)

    const addedAtCurIdx = new Set<number>()
    const curToParIdx = new Map<number, number>()
    let curIdx = 0
    let parIdx = 0

    for (const part of parts) {
      const lineCount = part.count ?? 0
      if (part.added) {
        for (let k = 0; k < lineCount; k++) addedAtCurIdx.add(curIdx + k)
        curIdx += lineCount
      } else if (part.removed) {
        parIdx += lineCount
      } else {
        for (let k = 0; k < lineCount; k++) curToParIdx.set(curIdx + k, parIdx + k)
        curIdx += lineCount
        parIdx += lineCount
      }
    }

    const currentCommitOid = currentOid
    for (let headLine = 0; headLine < positions.length; headLine++) {
      const pos = positions[headLine]
      if (pos === null) continue
      if (addedAtCurIdx.has(pos)) {
        owners[headLine] = currentCommitOid
        positions[headLine] = null
      } else {
        const mapped = curToParIdx.get(pos)
        positions[headLine] = mapped ?? null
        if (mapped === undefined) owners[headLine] = currentCommitOid
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

export async function computeFileOwnership(
  ctx: RepoContext,
  headOid: string,
  filepath: string,
  authorNameCache: Map<string, string>
): Promise<Record<string, number>> {
  const owners = await blameFile(ctx, headOid, filepath)
  const counts: Record<string, number> = {}

  for (const oid of owners) {
    let author = authorNameCache.get(oid)
    if (!author) {
      const commit = await git.readCommit({ fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, oid })
      author = commit.commit.author.name
      authorNameCache.set(oid, author)
    }
    counts[author] = (counts[author] ?? 0) + 1
  }

  return counts
}
