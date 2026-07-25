import { runGit } from './exec'
import type { FileLineStats } from '../../../shared/types'

const FS = '\x1f'
const MARKER = `C${FS}`

/**
 * Per non-merge commit, the added/deleted lines for each changed file
 * (diffed against the commit's first parent). Binary files report as
 * "-\t-\t<path>" in --numstat and are skipped. --no-renames keeps path
 * parsing simple and independent of the user's gitconfig.
 */
export async function readChurnByCommit(repoPath: string, branch: string): Promise<Map<string, FileLineStats[]>> {
  const out = await runGit(repoPath, [
    'log',
    branch,
    '--no-merges',
    '--no-renames',
    '--numstat',
    `--pretty=format:${MARKER}%H`,
  ])

  const result = new Map<string, FileLineStats[]>()
  let currentOid: string | null = null
  let currentFiles: FileLineStats[] = []

  function flush() {
    if (currentOid) result.set(currentOid, currentFiles)
  }

  for (const rawLine of out.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    if (line.startsWith(MARKER)) {
      flush()
      currentOid = line.slice(MARKER.length)
      currentFiles = []
      continue
    }

    const parts = line.split('\t')
    if (parts.length === 3) {
      const [addedStr, deletedStr, filepath] = parts
      if (addedStr === '-' || deletedStr === '-') continue // binary, skip
      currentFiles.push({ filepath, added: Number(addedStr), deleted: Number(deletedStr) })
    }
  }
  flush()

  return result
}
