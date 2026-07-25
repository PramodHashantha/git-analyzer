import path from 'node:path'
import { assertIsGitRepo, listBranches, getCurrentBranch, resolveBranchHead, InvalidBranchError } from './git/repo'
import { readHistory } from './git/history'
import { readChurnByCommit } from './git/churn'
import { aggregateOwnership } from './git/ownership'
import {
  aggregateAuthorTotals,
  aggregateActivityOverTime,
  aggregateCommitPatterns,
  filterNonMergeCommits,
} from '../../shared/aggregate-churn'
import { aggregateMergeInsights } from '../../shared/aggregate-merges'
import type { RepoAnalysis, CommitStats } from '../../shared/types'

export interface RepoHead {
  branch: string
  branches: string[]
  headOid: string
}

export async function resolveRepoHead(repoPath: string, branchOverride?: string): Promise<RepoHead> {
  await assertIsGitRepo(repoPath)
  const branches = await listBranches(repoPath)
  if (branchOverride !== undefined && !branches.includes(branchOverride)) {
    throw new InvalidBranchError(`Unknown branch: ${branchOverride}`)
  }
  const branch = branchOverride ?? (await getCurrentBranch(repoPath)) ?? branches[0]
  const headOid = await resolveBranchHead(repoPath, branch)
  return { branch, branches, headOid }
}

export async function computeAnalysis(
  repoPath: string,
  head: RepoHead,
  onOwnershipProgress?: (done: number, total: number) => void
): Promise<RepoAnalysis> {
  const { branch, branches, headOid } = head

  const commits = await readHistory(repoPath, branch)
  const churnCommits = filterNonMergeCommits(commits)
  const churnByOid = await readChurnByCommit(repoPath, branch)

  const commitStats: CommitStats[] = churnCommits.map((commit) => {
    const files = churnByOid.get(commit.oid) ?? []
    return {
      commit,
      files,
      totalAdded: files.reduce((sum, f) => sum + f.added, 0),
      totalDeleted: files.reduce((sum, f) => sum + f.deleted, 0),
    }
  })

  const { files: fileOwnership, authors: authorOwnership } = await aggregateOwnership(
    repoPath,
    headOid,
    onOwnershipProgress
  )

  return {
    repoName: path.basename(repoPath),
    branch,
    branches,
    headOid,
    commits,
    commitStats,
    authorTotals: aggregateAuthorTotals(commitStats),
    activity: aggregateActivityOverTime(commitStats, 'month'),
    commitPatterns: aggregateCommitPatterns(commitStats),
    fileOwnership,
    authorOwnership,
    mergeInsights: aggregateMergeInsights(commits),
  }
}
