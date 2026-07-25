import { useEffect, useState } from 'react'
import type { BranchUpstreamStatus } from '../../shared/types'

export function StaleBranchBanner({ branch, status }: { branch: string; status: BranchUpstreamStatus }) {
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    setDismissed(false)
  }, [branch, status.upstreamName, status.behind])

  if (dismissed || !status.hasUpstream || status.behind === 0 || !status.upstreamName) return null

  const [remote, ...rest] = status.upstreamName.split('/')
  const remoteBranch = rest.join('/')

  return (
    <div className="mb-4 flex items-center justify-between gap-4 rounded border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
      <span>
        Local branch &quot;{branch}&quot; is {status.behind} commit{status.behind === 1 ? '' : 's'} behind{' '}
        {status.upstreamName} — results may be missing recent work. Run{' '}
        <code className="rounded bg-yellow-100 px-1">
          git fetch {remote} {remoteBranch}:{branch}
        </code>{' '}
        to update.
      </span>
      <button type="button" onClick={() => setDismissed(true)} className="shrink-0 underline">
        Dismiss
      </button>
    </div>
  )
}
