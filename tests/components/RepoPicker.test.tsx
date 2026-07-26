import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { RepoPicker } from '../../src/components/RepoPicker'

describe('RepoPicker', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('calls onSelect with the typed path', () => {
    const onSelect = vi.fn()
    render(<RepoPicker onSelect={onSelect} />)

    fireEvent.change(screen.getByPlaceholderText(/D:\\Projects/i), { target: { value: 'D:\\repo' } })
    fireEvent.click(screen.getByRole('button', { name: /analyze/i }))

    expect(onSelect).toHaveBeenCalledWith('D:\\repo')
  })

  it('remembers a selected path as a recent entry across renders', () => {
    const onSelect = vi.fn()
    const { unmount } = render(<RepoPicker onSelect={onSelect} />)
    fireEvent.change(screen.getByPlaceholderText(/D:\\Projects/i), { target: { value: 'D:\\repo-a' } })
    fireEvent.click(screen.getByRole('button', { name: /analyze/i }))
    unmount()

    render(<RepoPicker onSelect={onSelect} />)
    expect(screen.getByText('D:\\repo-a')).toBeInTheDocument()
  })
})
