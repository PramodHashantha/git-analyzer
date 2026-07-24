import { useMemo, useState } from 'react'
import { FolderPicker } from './components/FolderPicker'
import { UnsupportedBrowserNotice } from './components/UnsupportedBrowserNotice'
import { StatusPanel } from './components/StatusPanel'
import { OverviewTable } from './components/Dashboard/OverviewTable'
import { ActivityOverTimeChart } from './components/Dashboard/ActivityOverTimeChart'
import { CommitPatternsHeatmap } from './components/Dashboard/CommitPatternsHeatmap'
import { OwnershipView } from './components/Dashboard/OwnershipView'
import { MergeInsightsTable } from './components/Dashboard/MergeInsightsTable'
import { BranchSelector } from './components/BranchSelector'
import { DateRangeFilter } from './components/DateRangeFilter'
import { AuthorFilter } from './components/AuthorFilter'
import { isFileSystemAccessSupported } from './lib/browser-support'
import { useRepoAnalysis } from './hooks/useRepoAnalysis'
import { filterByAuthors, filterActivityByDateRange, type DateRange } from './lib/filters'

export default function App() {
  const [root, setRoot] = useState<FileSystemDirectoryHandle | null>(null)
  const [dateRange, setDateRange] = useState<DateRange>({ start: null, end: null })
  const [selectedAuthors, setSelectedAuthors] = useState<string[]>([])
  const { status, analyze } = useRepoAnalysis()

  const analysis = status.phase === 'done' ? status.analysis : null

  const filtered = useMemo(() => {
    if (!analysis) return null
    return {
      authorTotals: filterByAuthors(analysis.authorTotals, selectedAuthors),
      activity: filterActivityByDateRange(
        filterByAuthors(analysis.activity, selectedAuthors),
        dateRange
      ),
      commitPatterns: filterByAuthors(analysis.commitPatterns, selectedAuthors),
    }
  }, [analysis, selectedAuthors, dateRange])

  if (!isFileSystemAccessSupported()) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <UnsupportedBrowserNotice />
      </main>
    )
  }

  const handleFolderSelected = async (handle: FileSystemDirectoryHandle) => {
    setRoot(handle)
    setSelectedAuthors([])
    setDateRange({ start: null, end: null })
    await analyze(handle)
  }

  const handleBranchChange = async (branch: string) => {
    if (root) await analyze(root, branch)
  }

  const handleGrantAccessAgain = async () => {
    if (!root) return
    await root.requestPermission({ mode: 'read' })
    await analyze(root)
  }

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <h1 className="mb-6 text-2xl font-bold">Git Contribution Dashboard</h1>
      {!root && <FolderPicker onFolderSelected={handleFolderSelected} />}

      {root && !analysis && <StatusPanel status={status} />}

      {root && status.phase === 'error' && status.permissionDenied && (
        <button
          type="button"
          onClick={handleGrantAccessAgain}
          className="mt-2 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          Grant access again
        </button>
      )}

      {root && analysis && filtered && (
        <div className="space-y-6">
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
