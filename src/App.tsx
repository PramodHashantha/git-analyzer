import { useMemo, useState } from 'react'
import { RepoPicker } from './components/RepoPicker'
import { StatusPanel } from './components/StatusPanel'
import { StaleBranchBanner } from './components/StaleBranchBanner'
import { OverviewTable } from './components/Dashboard/OverviewTable'
import { ActivityOverTimeChart } from './components/Dashboard/ActivityOverTimeChart'
import { CommitPatternsHeatmap } from './components/Dashboard/CommitPatternsHeatmap'
import { OwnershipView } from './components/Dashboard/OwnershipView'
import { MergeInsightsTable } from './components/Dashboard/MergeInsightsTable'
import { BranchSelector } from './components/BranchSelector'
import { DateRangeFilter } from './components/DateRangeFilter'
import { AuthorFilter } from './components/AuthorFilter'
import { useRepoAnalysis } from './hooks/useRepoAnalysis'
import {
  filterByAuthors,
  filterActivityByDateRange,
  filterCommitStatsByDateRange,
  filterCommitStatsByAuthors,
  type DateRange,
} from './lib/filters'
import { aggregateAuthorTotals, aggregateCommitPatterns } from '../shared/aggregate-churn'

export default function App() {
  const [repoPath, setRepoPath] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState<DateRange>({ start: null, end: null })
  const [selectedAuthors, setSelectedAuthors] = useState<string[]>([])
  const { status, analyze } = useRepoAnalysis()

  const analysis = status.phase === 'done' ? status.analysis : null

  const filtered = useMemo(() => {
    if (!analysis) return null
    const dateFilteredStats = filterCommitStatsByDateRange(analysis.commitStats, dateRange)
    const authorAndDateFilteredStats = filterCommitStatsByAuthors(dateFilteredStats, selectedAuthors)
    return {
      authorTotals: aggregateAuthorTotals(authorAndDateFilteredStats),
      activity: filterActivityByDateRange(
        filterByAuthors(analysis.activity, selectedAuthors),
        dateRange
      ),
      commitPatterns: aggregateCommitPatterns(authorAndDateFilteredStats),
    }
  }, [analysis, selectedAuthors, dateRange])

  const handleRepoSelected = async (path: string) => {
    setRepoPath(path)
    setSelectedAuthors([])
    setDateRange({ start: null, end: null })
    await analyze(path)
  }

  const handleBranchChange = async (branch: string) => {
    if (repoPath) await analyze(repoPath, branch)
  }

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <h1 className="mb-6 text-2xl font-bold">Git Contribution Dashboard</h1>

      <RepoPicker onSelect={handleRepoSelected} />

      {repoPath && !analysis && <StatusPanel status={status} />}

      {repoPath && analysis && filtered && (
        <div className="mt-6 space-y-6">
          <StaleBranchBanner branch={analysis.branch} status={analysis.branchStatus} />
          <div className="flex flex-wrap items-center gap-4 rounded bg-white p-4 shadow">
            <BranchSelector
              branches={analysis.branches}
              selected={analysis.branch}
              onChange={handleBranchChange}
            />
            <DateRangeFilter range={dateRange} onChange={setDateRange} />
          </div>
          <AuthorFilter
            allAuthors={analysis.authorTotals.map((a) => a.author)}
            selected={selectedAuthors}
            onChange={setSelectedAuthors}
          />
          <OverviewTable authorTotals={filtered.authorTotals} />
          <ActivityOverTimeChart activity={filtered.activity} />
          <CommitPatternsHeatmap patterns={filtered.commitPatterns} />
          <MergeInsightsTable mergeInsights={analysis.mergeInsights} />
          <OwnershipView
            authorOwnership={analysis.authorOwnership}
            fileOwnership={analysis.fileOwnership}
          />
        </div>
      )}
    </main>
  )
}
