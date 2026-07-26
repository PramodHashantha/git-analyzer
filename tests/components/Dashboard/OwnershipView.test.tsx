import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { FileOwnership, SkippedFile } from '../../../shared/types'
import { OwnershipView } from '../../../src/components/Dashboard/OwnershipView'

describe('OwnershipView', () => {
  const authorOwnership = [{ author: 'Alice', linesOwned: 3, percentage: 100 }]
  const fileOwnership: FileOwnership[] = [
    { filepath: 'src/a.ts', totalLines: 2, ownerLineCounts: { Alice: 2 } },
    { filepath: 'src/b.ts', totalLines: 1, ownerLineCounts: { Bob: 1 } },
  ]

  it("reveals a file's owners at the top of the Files section when a row is clicked", () => {
    render(
      <OwnershipView authorOwnership={authorOwnership} fileOwnership={fileOwnership} skippedFiles={[]} />
    )

    // No detail panel before clicking.
    expect(screen.queryByTestId('file-owner-detail')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('src/b.ts'))

    const detail = screen.getByTestId('file-owner-detail')
    expect(within(detail).getByText('src/b.ts')).toBeInTheDocument()
    expect(within(detail).getByText(/Bob: 1 lines/)).toBeInTheDocument()
  })

  it('renders no skipped-files note when nothing was skipped', () => {
    render(
      <OwnershipView authorOwnership={authorOwnership} fileOwnership={fileOwnership} skippedFiles={[]} />
    )
    expect(screen.queryByText(/excluded from ownership/i)).not.toBeInTheDocument()
  })

  it('shows a summary with the binary/submodule breakdown when files are skipped', () => {
    const skippedFiles: SkippedFile[] = [
      { filepath: 'image.bin', reason: 'binary' },
      { filepath: 'assets/logo.png', reason: 'binary' },
      { filepath: 'vendor/lib', reason: 'submodule' },
    ]
    render(
      <OwnershipView
        authorOwnership={authorOwnership}
        fileOwnership={fileOwnership}
        skippedFiles={skippedFiles}
      />
    )
    expect(screen.getByText(/3 files excluded from ownership/i)).toBeInTheDocument()
    expect(screen.getByText(/2 binary, 1 submodule/i)).toBeInTheDocument()
  })

  it('expands to list the skipped files when the summary is clicked', () => {
    const skippedFiles: SkippedFile[] = [{ filepath: 'image.bin', reason: 'binary' }]
    render(
      <OwnershipView
        authorOwnership={authorOwnership}
        fileOwnership={fileOwnership}
        skippedFiles={skippedFiles}
      />
    )

    expect(screen.queryByText('image.bin (binary)')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText(/1 file excluded from ownership/i))
    expect(screen.getByText('image.bin (binary)')).toBeInTheDocument()
  })
})
