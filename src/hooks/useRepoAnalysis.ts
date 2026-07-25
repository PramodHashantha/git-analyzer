import { useCallback, useState } from 'react'
import { createFsAdapter } from '../lib/fs-adapter'
import {
  assertIsGitRepo,
  makeRepoContext,
  listBranches,
  resolveBranchHead,
  getCurrentBranch,
} from '../lib/git/repo'
import { walkHistory } from '../lib/git/history'
import { computeAllCommitStats } from '../lib/git/commit-stats'
import {
  aggregateAuthorTotals,
  aggregateActivityOverTime,
  aggregateCommitPatterns,
  filterNonMergeCommits,
} from '../lib/git/aggregate-churn'
import { aggregateMergeInsights } from '../lib/git/aggregate-merges'
import { aggregateOwnership } from '../lib/git/aggregate-ownership'
import { readMailmap, buildIdentityResolver } from '../lib/git/identity'
import { getCachedAnalysis, setCachedAnalysis, makeCacheKey } from '../lib/cache/db'
import type { RepoAnalysis } from '../lib/types'

export type AnalysisStatus =
  | { phase: 'idle' }
  | { phase: 'reading-repo' }
  | { phase: 'walking-history' }
  | { phase: 'computing-churn'; done: number; total: number }
  | { phase: 'computing-ownership'; done: number; total: number }
  | { phase: 'done'; analysis: RepoAnalysis }
  | { phase: 'error'; message: string; permissionDenied?: boolean }

export function useRepoAnalysis() {
  const [status, setStatus] = useState<AnalysisStatus>({ phase: 'idle' })

  const analyze = useCallback(async (root: FileSystemDirectoryHandle, branchOverride?: string) => {
    setStatus({ phase: 'reading-repo' })
    try {
      const fs = createFsAdapter(root)
      await assertIsGitRepo(fs, '/')
      const ctx = makeRepoContext(fs, '/')

      const branches = await listBranches(ctx)
      const branch = branchOverride ?? (await getCurrentBranch(ctx)) ?? branches[0]
      const headOid = await resolveBranchHead(ctx, branch)

      const cacheKey = makeCacheKey(root.name, branch, headOid)
      const cached = await getCachedAnalysis(cacheKey)
      if (cached) {
        setStatus({ phase: 'done', analysis: cached })
        return
      }

      setStatus({ phase: 'walking-history' })
      const rawCommits = await walkHistory(ctx, branch)
      const resolver = buildIdentityResolver(await readMailmap(ctx), rawCommits)
      const commits = rawCommits.map((c) => ({ ...c, author: resolver.resolve(c.author, c.email) }))
      const churnCommits = filterNonMergeCommits(commits)

      const commitStats = await computeAllCommitStats(ctx, churnCommits, (done, total) =>
        setStatus({ phase: 'computing-churn', done, total })
      )

      const { files: fileOwnership, authors: authorOwnership } = await aggregateOwnership(
        ctx,
        headOid,
        (done, total) => setStatus({ phase: 'computing-ownership', done, total }),
        resolver
      )

      const analysis: RepoAnalysis = {
        repoName: root.name,
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

      await setCachedAnalysis(cacheKey, analysis)
      setStatus({ phase: 'done', analysis })
    } catch (error) {
      console.error('Repo analysis failed:', error)
      const permissionDenied = error instanceof DOMException && error.name === 'NotAllowedError'
      setStatus({
        phase: 'error',
        message: error instanceof Error ? error.message : String(error),
        permissionDenied,
      })
    }
  }, [])

  return { status, analyze }
}
