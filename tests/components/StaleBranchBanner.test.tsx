import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StaleBranchBanner } from '../../src/components/StaleBranchBanner'

describe('StaleBranchBanner', () => {
  it('renders nothing when there is no upstream', () => {
    const { container } = render(
      <StaleBranchBanner branch="main" status={{ hasUpstream: false, ahead: 0, behind: 0 }} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when up to date with its upstream', () => {
    const { container } = render(
      <StaleBranchBanner
        branch="main"
        status={{ hasUpstream: true, upstreamName: 'origin/main', ahead: 0, behind: 0 }}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a warning with the behind-count, upstream name, and fetch hint when stale', () => {
    render(
      <StaleBranchBanner
        branch="main"
        status={{ hasUpstream: true, upstreamName: 'origin/main', ahead: 0, behind: 12 }}
      />
    )
    expect(screen.getByText(/12 commits behind/i)).toBeInTheDocument()
    expect(screen.getByText(/origin\/main/i)).toBeInTheDocument()
    expect(screen.getByText(/git fetch origin/i)).toBeInTheDocument()
  })

  it('can be dismissed', () => {
    render(
      <StaleBranchBanner
        branch="main"
        status={{ hasUpstream: true, upstreamName: 'origin/main', ahead: 0, behind: 12 }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(screen.queryByText(/commits behind/i)).not.toBeInTheDocument()
  })
})
