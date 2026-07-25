import { diffLines } from 'diff'

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
