import type { AnalysisStatus } from '../hooks/useRepoAnalysis'

export function StatusPanel({ status }: { status: AnalysisStatus }) {
  switch (status.phase) {
    case 'loading':
      return (
        <div role="status" aria-label="Analyzing repository">
          <p className="mb-2">Analyzing repository…</p>
          <div className="h-2 w-full overflow-hidden rounded bg-gray-200">
            <div className="progress-bar-indeterminate h-full w-1/3 rounded bg-blue-600" />
          </div>
        </div>
      )
    case 'error':
      return <p className="text-red-600">Error: {status.message}</p>
    case 'idle':
    case 'done':
      return null
  }
}
