import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BusFactorTable } from '../../../src/components/Dashboard/BusFactorTable'

describe('BusFactorTable', () => {
  it('renders a row per flagged file', () => {
    render(
      <BusFactorTable
        busFactor={[{ filepath: 'risky.txt', totalLines: 10, topAuthor: 'Alice', topAuthorPercentage: 90 }]}
      />
    )
    expect(screen.getByText('risky.txt')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('90.0%')).toBeInTheDocument()
  })
})
