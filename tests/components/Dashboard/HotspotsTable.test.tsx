import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HotspotsTable } from '../../../src/components/Dashboard/HotspotsTable'

describe('HotspotsTable', () => {
  it('renders a row per hotspot', () => {
    render(
      <HotspotsTable hotspots={[{ filepath: 'a.txt', totalChurn: 20, authorCount: 2, score: 40 }]} />
    )
    expect(screen.getByText('a.txt')).toBeInTheDocument()
    expect(screen.getByText('40')).toBeInTheDocument()
  })
})
