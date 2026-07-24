import { useState } from 'react'
import { FolderPicker } from './components/FolderPicker'
import { UnsupportedBrowserNotice } from './components/UnsupportedBrowserNotice'
import { StatusPanel } from './components/StatusPanel'
import { isFileSystemAccessSupported } from './lib/browser-support'
import { useRepoAnalysis } from './hooks/useRepoAnalysis'

export default function App() {
  const [root, setRoot] = useState<FileSystemDirectoryHandle | null>(null)
  const { status, analyze } = useRepoAnalysis()

  if (!isFileSystemAccessSupported()) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <UnsupportedBrowserNotice />
      </main>
    )
  }

  const handleFolderSelected = async (handle: FileSystemDirectoryHandle) => {
    setRoot(handle)
    await analyze(handle)
  }

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <h1 className="mb-6 text-2xl font-bold">Git Contribution Dashboard</h1>
      {!root && <FolderPicker onFolderSelected={handleFolderSelected} />}
      {root && <StatusPanel status={status} />}
    </main>
  )
}
