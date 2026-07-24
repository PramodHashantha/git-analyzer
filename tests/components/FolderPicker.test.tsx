import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FolderPicker } from '../../src/components/FolderPicker'

describe('FolderPicker', () => {
  it('calls onFolderSelected with the chosen handle', async () => {
    const handle = { name: 'my-repo' } as unknown as FileSystemDirectoryHandle
    window.showDirectoryPicker = vi.fn().mockResolvedValue(handle)

    const onFolderSelected = vi.fn()
    render(<FolderPicker onFolderSelected={onFolderSelected} />)

    fireEvent.click(screen.getByRole('button', { name: /select a git repo folder/i }))

    await waitFor(() => expect(onFolderSelected).toHaveBeenCalledWith(handle))
  })

  it('does not call onFolderSelected when the picker is cancelled', async () => {
    window.showDirectoryPicker = vi
      .fn()
      .mockRejectedValue(new DOMException('cancelled', 'AbortError'))

    const onFolderSelected = vi.fn()
    render(<FolderPicker onFolderSelected={onFolderSelected} />)

    fireEvent.click(screen.getByRole('button', { name: /select a git repo folder/i }))

    await waitFor(() => expect(onFolderSelected).not.toHaveBeenCalled())
  })
})
