import { runGit, runGitBuffer } from './exec'
import { isBinaryBlob } from '../../../shared/binary'
import type { FileOwnership, AuthorOwnership, SkippedFile } from '../../../shared/types'

interface TreeEntry {
  filepath: string
  isSubmodule: boolean
}

/**
 * `git ls-tree -r` (full form, not --name-only) so each line carries
 * `<mode> <type> <oid>\t<path>` — a submodule (gitlink) entry has type
 * `commit`, letting us skip it before ever attempting `git show` on it
 * (which fails: there is no blob object for a gitlink entry).
 */
async function listFilesAtCommit(repoPath: string, headOid: string): Promise<TreeEntry[]> {
  const out = await runGit(repoPath, ['ls-tree', '-r', headOid])
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [meta, filepath] = line.split('\t')
      const type = meta.split(' ')[1]
      return { filepath, isSubmodule: type === 'commit' }
    })
    .sort((a, b) => a.filepath.localeCompare(b.filepath))
}

/**
 * Per-line author for `filepath` as of `headOid`, via real `git blame`
 * (--line-porcelain repeats full metadata for every line, so no state
 * tracking across abbreviated commit references is needed). `author` is
 * already .mailmap-resolved by git itself.
 */
async function blameFileCounts(repoPath: string, headOid: string, filepath: string): Promise<Record<string, number>> {
  const out = await runGit(repoPath, ['blame', headOid, '--line-porcelain', '--', filepath])
  const counts: Record<string, number> = {}
  for (const line of out.split('\n')) {
    if (line.startsWith('author ')) {
      const name = line.slice('author '.length)
      counts[name] = (counts[name] ?? 0) + 1
    }
  }
  return counts
}

export async function aggregateOwnership(
  repoPath: string,
  headOid: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ files: FileOwnership[]; authors: AuthorOwnership[]; skipped: SkippedFile[] }> {
  const entries = await listFilesAtCommit(repoPath, headOid)

  const files: FileOwnership[] = []
  const skipped: SkippedFile[] = []
  const authorLineTotals = new Map<string, number>()
  let grandTotal = 0

  for (let i = 0; i < entries.length; i++) {
    const { filepath, isSubmodule } = entries[i]

    if (isSubmodule) {
      skipped.push({ filepath, reason: 'submodule' })
      onProgress?.(i + 1, entries.length)
      continue
    }

    const content = await runGitBuffer(repoPath, ['show', `${headOid}:${filepath}`])

    if (isBinaryBlob(content)) {
      skipped.push({ filepath, reason: 'binary' })
    } else {
      const ownerLineCounts = await blameFileCounts(repoPath, headOid, filepath)
      const totalLines = Object.values(ownerLineCounts).reduce((a, b) => a + b, 0)
      files.push({ filepath, totalLines, ownerLineCounts })

      for (const [author, count] of Object.entries(ownerLineCounts)) {
        authorLineTotals.set(author, (authorLineTotals.get(author) ?? 0) + count)
        grandTotal += count
      }
    }

    onProgress?.(i + 1, entries.length)
  }

  const authors: AuthorOwnership[] = [...authorLineTotals.entries()]
    .map(([author, linesOwned]) => ({
      author,
      linesOwned,
      percentage: grandTotal ? (linesOwned / grandTotal) * 100 : 0,
    }))
    .sort((a, b) => b.linesOwned - a.linesOwned)

  return { files, authors, skipped }
}
