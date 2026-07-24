import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from '../src/App'

describe('App', () => {
  it('renders the dashboard heading', () => {
    // Mock the File System Access API
    window.showDirectoryPicker = vi.fn()
    render(<App />)
    expect(screen.getByText('Git Contribution Dashboard')).toBeInTheDocument()
  })
})
