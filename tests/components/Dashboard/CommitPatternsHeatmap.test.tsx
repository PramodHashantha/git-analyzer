import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CommitPatternsHeatmap } from '../../../src/components/Dashboard/CommitPatternsHeatmap'
import type { CommitPatternSummary } from '../../../shared/types'

describe('CommitPatternsHeatmap', () => {
  it('renders the largest commit and an hour-of-day cell per author', () => {
    const patterns: CommitPatternSummary[] = [
      {
        author: 'Alice',
        avgLinesPerCommit: 12.5,
        largestCommit: { oid: 'abcdef1234567', lines: 450 },
        dayOfWeekCounts: [0, 1, 0, 0, 0, 0, 0],
        hourOfDayCounts: new Array(24).fill(0).map((_, i) => (i === 9 ? 3 : 0)),
      },
    ]

    render(<CommitPatternsHeatmap patterns={patterns} />)

    expect(screen.getByText(/largest commit: 450 lines \(abcdef1\)/i)).toBeInTheDocument()
    expect(screen.getByTitle('9:00 — 3 commits')).toBeInTheDocument()
  })
})
