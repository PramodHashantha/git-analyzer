import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OverviewTable } from '../../../src/components/Dashboard/OverviewTable'

describe('OverviewTable', () => {
  it('renders a row per author with commit and line totals', () => {
    render(
      <OverviewTable
        authorTotals={[{ author: 'Alice', commits: 3, added: 10, deleted: 2, net: 8 }]}
      />
    )
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
  })
})
