import { useState } from 'react'

const RECENT_KEY = 'git-analyser:recent-repos'
const MAX_RECENT = 8

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

function saveRecent(repoPath: string, current: string[]): string[] {
  const next = [repoPath, ...current.filter((p) => p !== repoPath)].slice(0, MAX_RECENT)
  localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  return next
}

export function RepoPicker({ onSelect }: { onSelect: (repoPath: string) => void }) {
  const [path, setPath] = useState('')
  const [recent, setRecent] = useState<string[]>(() => loadRecent())

  const choose = (candidate: string) => {
    const trimmed = candidate.trim()
    if (!trimmed) return
    setRecent(saveRecent(trimmed, recent))
    onSelect(trimmed)
  }

  return (
    <div className="rounded bg-white p-4 shadow">
      <label className="mb-2 block text-sm font-medium" htmlFor="repo-path">
        Local repository path
      </label>
      <div className="flex gap-2">
        <input
          id="repo-path"
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') choose(path)
          }}
          placeholder="D:\Projects\my-repo"
          className="flex-1 rounded border p-2"
        />
        <button
          type="button"
          onClick={() => choose(path)}
          className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          Analyze
        </button>
      </div>

      {recent.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-sm font-medium">Recent</p>
          <div className="flex flex-wrap gap-2">
            {recent.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => choose(p)}
                className="rounded-full border px-3 py-1 text-sm hover:bg-gray-50"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
