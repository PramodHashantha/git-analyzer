import type { AnalysisStatus } from '../hooks/useRepoAnalysis'

export function StatusPanel({ status }: { status: AnalysisStatus }) {
  switch (status.phase) {
    case 'loading':
      return <p>Analyzing repository…</p>
    case 'error':
      return <p className="text-red-600">Error: {status.message}</p>
    case 'idle':
    case 'done':
      return null
  }
}
