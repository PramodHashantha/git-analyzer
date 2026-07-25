// tests/components/StatusPanel.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusPanel } from '../../src/components/StatusPanel'
import type { AnalysisStatus } from '../../src/hooks/useRepoAnalysis'

describe('StatusPanel', () => {
  it('shows a loading message while analyzing', () => {
    render(<StatusPanel status={{ phase: 'loading' }} />)
    expect(screen.getByText(/analyzing/i)).toBeInTheDocument()
  })

  it('shows the error message on failure', () => {
    const status: AnalysisStatus = { phase: 'error', message: 'Not a git repository: D:\\repo' }
    render(<StatusPanel status={status} />)
    expect(screen.getByText(/not a git repository/i)).toBeInTheDocument()
  })

  it('renders nothing when idle or done', () => {
    const { container: idle } = render(<StatusPanel status={{ phase: 'idle' }} />)
    expect(idle).toBeEmptyDOMElement()
  })
})
