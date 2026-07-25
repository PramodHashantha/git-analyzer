import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { FileOwnership } from '../../../shared/types'
import { OwnershipView } from '../../../src/components/Dashboard/OwnershipView'

describe('OwnershipView', () => {
  const authorOwnership = [{ author: 'Alice', linesOwned: 3, percentage: 100 }]
  const fileOwnership: FileOwnership[] = [
    { filepath: 'src/a.ts', totalLines: 2, ownerLineCounts: { Alice: 2 } },
    { filepath: 'src/b.ts', totalLines: 1, ownerLineCounts: { Bob: 1 } },
  ]

  it("reveals a file's owners at the top of the Files section when a row is clicked", () => {
    render(<OwnershipView authorOwnership={authorOwnership} fileOwnership={fileOwnership} />)

    // No detail panel before clicking.
    expect(screen.queryByTestId('file-owner-detail')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('src/b.ts'))

    const detail = screen.getByTestId('file-owner-detail')
    expect(within(detail).getByText('src/b.ts')).toBeInTheDocument()
    expect(within(detail).getByText(/Bob: 1 lines/)).toBeInTheDocument()
  })
})
