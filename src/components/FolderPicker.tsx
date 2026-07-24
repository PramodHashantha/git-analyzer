interface FolderPickerProps {
  onFolderSelected: (handle: FileSystemDirectoryHandle) => void
  disabled?: boolean
}

export function FolderPicker({ onFolderSelected, disabled }: FolderPickerProps) {
  const handleClick = async () => {
    try {
      const handle = await window.showDirectoryPicker()
      onFolderSelected(handle)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      throw error
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
    >
      Select a git repo folder
    </button>
  )
}
