import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UnsupportedBrowserNotice } from '../../src/components/UnsupportedBrowserNotice'

describe('UnsupportedBrowserNotice', () => {
  it('names Chrome and Edge as the supported browsers', () => {
    render(<UnsupportedBrowserNotice />)
    expect(screen.getByText(/Unsupported browser/i)).toBeInTheDocument()
    expect(screen.getByText(/Chrome, Edge/i)).toBeInTheDocument()
  })
})
