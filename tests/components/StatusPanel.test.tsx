import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusPanel } from '../../src/components/StatusPanel'
import type { AnalysisStatus } from '../../src/hooks/useRepoAnalysis'

describe('StatusPanel', () => {
  it('shows progress counts while computing churn', () => {
    const status: AnalysisStatus = { phase: 'computing-churn', done: 3, total: 10 }
    render(<StatusPanel status={status} />)
    expect(screen.getByText(/3 \/ 10 commits/i)).toBeInTheDocument()
  })

  it('shows the error message on failure', () => {
    const status: AnalysisStatus = { phase: 'error', message: 'No .git directory found' }
    render(<StatusPanel status={status} />)
    expect(screen.getByText(/No .git directory found/i)).toBeInTheDocument()
  })
})
