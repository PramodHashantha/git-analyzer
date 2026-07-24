import * as git from 'isomorphic-git'
import { diffLines, type Change } from 'diff'
import type { RepoContext } from './repo'

export interface ChangedFile {
  filepath: string
  beforeOid: string | null
  afterOid: string | null
}

export async function listChangedFiles(
  ctx: RepoContext,
  commitOid: string,
  parentOid: string | null
): Promise<ChangedFile[]> {
  const trees = parentOid
    ? [git.TREE({ ref: parentOid }), git.TREE({ ref: commitOid })]
    : [git.TREE({ ref: commitOid })]

  const results: ChangedFile[] = []

  await git.walk({
    fs: ctx.fs,
    dir: ctx.dir,
    gitdir: ctx.gitdir,
    trees,
    map: async (filepath, entries) => {
      if (filepath === '.') return
      const [beforeEntry, afterEntry] = parentOid ? entries : [undefined, entries[0]]
      const beforeType = beforeEntry ? await beforeEntry.type() : undefined
      const afterType = afterEntry ? await afterEntry.type() : undefined
      // Skip trees and anything that isn't a plain blob (e.g. mode-160000
      // submodule entries report type 'commit') so a submodule reference
      // never reaches readBlob and throws.
      const presentTypes = [beforeType, afterType].filter((t): t is string => t !== undefined)
      if (presentTypes.some((t) => t !== 'blob')) return

      const beforeOid = beforeEntry ? await beforeEntry.oid() : null
      const afterOid = afterEntry ? await afterEntry.oid() : null
      if (beforeOid === afterOid) return

      results.push({ filepath, beforeOid, afterOid })
    },
  })

  return results
}

export function countLineChanges(beforeText: string, afterText: string) {
  const parts: Change[] = diffLines(beforeText, afterText)
  let added = 0
  let deleted = 0
  for (const part of parts) {
    const lineCount = part.count ?? 0
    if (part.added) added += lineCount
    else if (part.removed) deleted += lineCount
  }
  return { added, deleted }
}
