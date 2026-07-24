import type { CommitInfo, BranchMergeInsights } from '../types'

export function aggregateMergeInsights(commits: CommitInfo[]): BranchMergeInsights[] {
  const byAuthor = new Map<string, number>()
  for (const commit of commits) {
    if (!commit.isMerge) continue
    byAuthor.set(commit.author, (byAuthor.get(commit.author) ?? 0) + 1)
  }
  return [...byAuthor.entries()]
    .map(([author, mergeCommits]) => ({ author, mergeCommits }))
    .sort((a, b) => b.mergeCommits - a.mergeCommits)
}
