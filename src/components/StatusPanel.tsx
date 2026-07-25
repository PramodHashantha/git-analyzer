import type { AnalysisStatus } from '../hooks/useRepoAnalysis'

export function StatusPanel({ status }: { status: AnalysisStatus }) {
  switch (status.phase) {
    case 'idle':
    case 'reading-repo':
      return <p>Reading repository…</p>
    case 'walking-history':
      return <p>Walking commit history…</p>
    case 'computing-churn':
      return (
        <p>
          Computing line changes: {status.done} / {status.total} commits
        </p>
      )
    case 'computing-ownership':
      return (
        <p>
          Computing current ownership: {status.done} / {status.total} commits
        </p>
      )
    case 'error':
      return <p className="text-red-600">Error: {status.message}</p>
    case 'done':
      return (
        <pre className="max-h-[60vh] overflow-auto rounded bg-white p-4 text-xs shadow">
          {JSON.stringify(
            {
              branch: status.analysis.branch,
              commits: status.analysis.commits.length,
              authorTotals: status.analysis.authorTotals,
            },
            null,
            2
          )}
        </pre>
      )
  }
}
