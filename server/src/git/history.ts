import { runGit } from './exec'
import type { CommitInfo } from '../../../shared/types'

const RS = '\x1e' // record separator
const FS = '\x1f' // field separator

/**
 * Full ancestry reachable from `branch` (all parents, not first-parent-only),
 * newest first — matches git log's default order. %aN/%aE are mailmap-
 * resolved by git itself, so author identity is unified for free.
 */
export async function readHistory(repoPath: string, branch: string): Promise<CommitInfo[]> {
  const format = `%H${FS}%P${FS}%aN${FS}%aE${FS}%at${FS}%s${RS}`
  const out = await runGit(repoPath, ['log', branch, `--pretty=format:${format}`])

  const records = out
    .split(RS)
    .map((r) => r.trim())
    .filter(Boolean)

  return records.map((record) => {
    const [oid, parentStr, author, email, ts, message] = record.split(FS)
    const parentOids = parentStr ? parentStr.split(' ').filter(Boolean) : []
    return {
      oid,
      parentOids,
      author,
      email,
      timestamp: Number(ts),
      message,
      isMerge: parentOids.length > 1,
    }
  })
}
