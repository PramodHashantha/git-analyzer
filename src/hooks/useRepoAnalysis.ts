import { useCallback, useState } from 'react'
import type { RepoAnalysis } from '../../shared/types'

export type AnalysisStatus =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'done'; analysis: RepoAnalysis }
  | { phase: 'error'; message: string }

export function useRepoAnalysis() {
  const [status, setStatus] = useState<AnalysisStatus>({ phase: 'idle' })

  const analyze = useCallback(async (repoPath: string, branchOverride?: string) => {
    setStatus({ phase: 'loading' })
    try {
      const params = new URLSearchParams({ path: repoPath })
      if (branchOverride) params.set('branch', branchOverride)

      const res = await fetch(`/api/analyze?${params.toString()}`)
      const body = await res.json()

      if (!res.ok) {
        throw new Error(body?.error ?? `Request failed with status ${res.status}`)
      }

      setStatus({ phase: 'done', analysis: body as RepoAnalysis })
    } catch (error) {
      console.error('Repo analysis failed:', error)
      setStatus({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }, [])

  return { status, analyze }
}
