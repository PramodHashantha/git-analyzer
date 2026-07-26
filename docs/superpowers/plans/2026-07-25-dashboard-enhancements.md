# Dashboard Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five dashboard improvements on top of the local git backend: an indeterminate progress bar, a stale-branch warning, a hotspots analysis, a bus-factor analysis, and surfacing hour-of-day/largest-commit data plus a week/month granularity toggle that were already computed but never rendered.

**Architecture:** All five build on the existing `RepoAnalysis` contract and the existing client-side filtering pattern (client-side `useMemo` re-aggregation over already-fetched `commitStats`/`fileOwnership`, same as today's author/date filters). Only the stale-branch feature needs a new backend git call and a new `RepoAnalysis` field; hotspots and bus-factor are pure frontend aggregations over data already shipped to the browser.

**Tech Stack:** Same as the rest of the project — Node/Express backend shelling out to real `git`, Vite + React + TypeScript frontend, Vitest + Testing Library for tests, Tailwind for styling.

## Global Constraints

- Hotspot score = `totalChurn × distinct author count` over `commitStats`, sorted descending, capped to the top 20 (default `limit` param, overridable).
- Bus factor flags a file when one author's line share is `>= 80%` (default, overridable) AND the file has `>= 5` total lines (default, overridable) — sorted by percentage descending, capped to top 20.
- Hotspots respect the existing author/date-range filters (computed from already-filtered `commitStats`); bus factor does NOT (it's a HEAD ownership snapshot, same convention as the existing `OwnershipView`).
- The stale-branch check only ever applies to the currently-analyzed branch; a branch with no configured upstream must silently produce `{ hasUpstream: false, ahead: 0, behind: 0 }`, never an error.
- The progress bar is deliberately indeterminate (no percentage) — no backend streaming is introduced in this plan.
- The week/month toggle recomputes `activity` client-side from filtered `commitStats` via the existing shared `aggregateActivityOverTime`; the server-computed `analysis.activity` field stays in the `RepoAnalysis` shape for API stability but the dashboard stops reading it directly.
- All new git invocations go through the existing `runGit`/`runGitBuffer` wrappers (array-args `execFile`, never a shell string) — this project's established security constraint from the local-git-backend migration.
- New types live in `shared/types.ts`; new pure aggregation logic lives in `shared/`; new UI-only logic lives in `src/`.

---

### Task 1: Indeterminate progress bar

**Files:**
- Modify: `src/index.css`, `src/components/StatusPanel.tsx`, `tests/components/StatusPanel.test.tsx`

**Interfaces:**
- No new exports; `StatusPanel`'s prop type (`AnalysisStatus`) is unchanged.

- [ ] **Step 1: Add the animation to `src/index.css`**

```css
@import "tailwindcss";

@keyframes progress-bar-indeterminate-slide {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(300%);
  }
}

.progress-bar-indeterminate {
  animation: progress-bar-indeterminate-slide 1.2s ease-in-out infinite;
}
```

- [ ] **Step 2: Write the failing test for the progress bar**

Add this test to the end of `tests/components/StatusPanel.test.tsx` (existing tests in that file stay as-is):

```tsx
it('shows a progress bar while loading', () => {
  render(<StatusPanel status={{ phase: 'loading' }} />)
  expect(screen.getByRole('status')).toBeInTheDocument()
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/components/StatusPanel.test.tsx`
Expected: FAIL — no element with `role="status"` exists yet.

- [ ] **Step 4: Update `src/components/StatusPanel.tsx`**

```tsx
import type { AnalysisStatus } from '../hooks/useRepoAnalysis'

export function StatusPanel({ status }: { status: AnalysisStatus }) {
  switch (status.phase) {
    case 'loading':
      return (
        <div role="status" aria-label="Analyzing repository">
          <p className="mb-2">Analyzing repository…</p>
          <div className="h-2 w-full overflow-hidden rounded bg-gray-200">
            <div className="progress-bar-indeterminate h-full w-1/3 rounded bg-blue-600" />
          </div>
        </div>
      )
    case 'error':
      return <p className="text-red-600">Error: {status.message}</p>
    case 'idle':
    case 'done':
      return null
  }
}
```

- [ ] **Step 5: Run all StatusPanel tests to verify they pass**

Run: `npx vitest run tests/components/StatusPanel.test.tsx`
Expected: PASS, 4 tests (the 3 existing plus the new one).

- [ ] **Step 6: Commit**

```bash
git add src/index.css src/components/StatusPanel.tsx tests/components/StatusPanel.test.tsx
git commit -m "feat: replace loading text with an indeterminate progress bar"
```

---

### Task 2: Stale-branch detection — backend

**Files:**
- Modify: `shared/types.ts`, `server/src/git/repo.ts`, `server/src/git/repo.test.ts`, `server/src/analyzer.ts`, `server/src/analyzer.test.ts`

**Interfaces:**
- Produces: `BranchUpstreamStatus` type (`shared/types.ts`); `getUpstreamStatus(repoPath, branch): Promise<BranchUpstreamStatus>` (`server/src/git/repo.ts`) — consumed by `analyzer.ts` and, in Task 3, by the frontend via `RepoAnalysis.branchStatus`.
- `RepoAnalysis` gains a `branchStatus: BranchUpstreamStatus` field.

- [ ] **Step 1: Add `BranchUpstreamStatus` to `shared/types.ts`**

Add this interface, and add `branchStatus: BranchUpstreamStatus` as a new field on `RepoAnalysis` (placed after `branches: string[]`):

```ts
export interface BranchUpstreamStatus {
  hasUpstream: boolean
  upstreamName?: string
  ahead: number
  behind: number
}
```

The `RepoAnalysis` interface becomes:

```ts
export interface RepoAnalysis {
  repoName: string
  branch: string
  branches: string[]
  branchStatus: BranchUpstreamStatus
  headOid: string
  commits: CommitInfo[]
  commitStats: CommitStats[]
  authorTotals: AuthorTotals[]
  activity: ActivityBucket[]
  commitPatterns: CommitPatternSummary[]
  fileOwnership: FileOwnership[]
  authorOwnership: AuthorOwnership[]
  mergeInsights: BranchMergeInsights[]
}
```

- [ ] **Step 2: Write the failing tests for `getUpstreamStatus`**

Add to `server/src/git/repo.test.ts` — first add `execFileSync` to the existing imports (change the `import fs from 'node:fs'` block to also import `execFileSync`), then add a new `describe` block:

```ts
// add to the top of the file, alongside the existing imports:
import { execFileSync } from 'node:child_process'
```

```ts
// append to the end of the file, after the existing `describe('repo', ...)` block:
describe('getUpstreamStatus', () => {
  it('reports no upstream for a branch that never tracked a remote', async () => {
    const dir = buildRealGitRepo((run, d) => {
      fs.writeFileSync(`${d}/a.txt`, 'one\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'first'])
    })

    const status = await getUpstreamStatus(dir, 'main')
    expect(status).toEqual({ hasUpstream: false, ahead: 0, behind: 0 })
  })

  it('reports ahead/behind counts against a configured upstream', async () => {
    const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bare-remote-'))
    execFileSync('git', ['init', '-q', '--bare', remoteDir])

    const dir = buildRealGitRepo((run, d) => {
      fs.writeFileSync(`${d}/a.txt`, 'one\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'first'])
    })
    execFileSync('git', ['remote', 'add', 'origin', remoteDir], { cwd: dir })
    execFileSync('git', ['push', '-q', '-u', 'origin', 'main'], { cwd: dir })

    // A second clone advances origin/main by one commit that `dir` hasn't seen.
    const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clone-'))
    execFileSync('git', ['clone', '-q', remoteDir, cloneDir])
    fs.writeFileSync(`${cloneDir}/b.txt`, 'two\n')
    execFileSync('git', ['add', '-A'], { cwd: cloneDir })
    execFileSync(
      'git',
      ['-c', 'user.name=Bob', '-c', 'user.email=bob@example.com', 'commit', '-q', '-m', 'second'],
      { cwd: cloneDir }
    )
    execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: cloneDir })

    // `dir` also makes an unpushed local commit, so it is ahead by one too.
    fs.writeFileSync(`${dir}/c.txt`, 'three\n')
    execFileSync('git', ['add', '-A'], { cwd: dir })
    execFileSync(
      'git',
      ['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'third'],
      { cwd: dir }
    )

    // Fetch (not merge/pull) so origin/main updates without touching local main.
    execFileSync('git', ['fetch', '-q', 'origin'], { cwd: dir })

    const status = await getUpstreamStatus(dir, 'main')
    expect(status.hasUpstream).toBe(true)
    expect(status.upstreamName).toBe('origin/main')
    expect(status.ahead).toBe(1)
    expect(status.behind).toBe(1)
  })
})
```

Also update the existing import line to bring in `getUpstreamStatus`:

```ts
import { assertIsGitRepo, listBranches, getCurrentBranch, resolveBranchHead, getUpstreamStatus, NotAGitRepoError } from './repo'
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run server/src/git/repo.test.ts`
Expected: FAIL — `getUpstreamStatus` is not exported from `./repo`.

- [ ] **Step 4: Implement `getUpstreamStatus` in `server/src/git/repo.ts`**

Add this import at the top (alongside the existing `import { runGit } from './exec'`):

```ts
import type { BranchUpstreamStatus } from '../../../shared/types'
```

Add this function at the end of the file:

```ts
export async function getUpstreamStatus(repoPath: string, branch: string): Promise<BranchUpstreamStatus> {
  let upstreamName: string
  try {
    const out = await runGit(repoPath, ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`])
    upstreamName = out.trim()
  } catch {
    return { hasUpstream: false, ahead: 0, behind: 0 }
  }

  const out = await runGit(repoPath, ['rev-list', '--left-right', '--count', `${branch}...${upstreamName}`])
  const [aheadStr, behindStr] = out.trim().split(/\s+/)

  return {
    hasUpstream: true,
    upstreamName,
    ahead: Number(aheadStr),
    behind: Number(behindStr),
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run server/src/git/repo.test.ts`
Expected: PASS, 5 tests (3 existing plus the 2 new ones).

- [ ] **Step 6: Wire `branchStatus` into `server/src/analyzer.ts`**

Change the import line:

```ts
import { assertIsGitRepo, listBranches, getCurrentBranch, resolveBranchHead, getUpstreamStatus, InvalidBranchError } from './git/repo'
```

In `computeAnalysis`, add the call and include it in the returned object. The function becomes:

```ts
export async function computeAnalysis(
  repoPath: string,
  head: RepoHead,
  onOwnershipProgress?: (done: number, total: number) => void
): Promise<RepoAnalysis> {
  const { branch, branches, headOid } = head

  const commits = await readHistory(repoPath, branch)
  const churnCommits = filterNonMergeCommits(commits)
  const churnByOid = await readChurnByCommit(repoPath, branch)

  const commitStats: CommitStats[] = churnCommits.map((commit) => {
    const files = churnByOid.get(commit.oid) ?? []
    return {
      commit,
      files,
      totalAdded: files.reduce((sum, f) => sum + f.added, 0),
      totalDeleted: files.reduce((sum, f) => sum + f.deleted, 0),
    }
  })

  const { files: fileOwnership, authors: authorOwnership } = await aggregateOwnership(
    repoPath,
    headOid,
    onOwnershipProgress
  )

  const branchStatus = await getUpstreamStatus(repoPath, branch)

  return {
    repoName: path.basename(repoPath),
    branch,
    branches,
    branchStatus,
    headOid,
    commits,
    commitStats,
    authorTotals: aggregateAuthorTotals(commitStats),
    activity: aggregateActivityOverTime(commitStats, 'month'),
    commitPatterns: aggregateCommitPatterns(commitStats),
    fileOwnership,
    authorOwnership,
    mergeInsights: aggregateMergeInsights(commits),
  }
}
```

- [ ] **Step 7: Add a `branchStatus` assertion to `server/src/analyzer.test.ts`**

In the first test (`'composes a full RepoAnalysis matching the expected shape'`), add this assertion alongside the existing ones (the test repo has no remote, so no upstream is configured):

```ts
expect(analysis.branchStatus).toEqual({ hasUpstream: false, ahead: 0, behind: 0 })
```

- [ ] **Step 8: Run the full backend suite**

Run: `npx vitest run server`
Expected: PASS — all server tests green, including the new ones.

- [ ] **Step 9: Commit**

```bash
git add shared/types.ts server/src/git/repo.ts server/src/git/repo.test.ts server/src/analyzer.ts server/src/analyzer.test.ts
git commit -m "feat: detect branch upstream ahead/behind status (backend)"
```

---

### Task 3: Stale-branch warning — frontend banner

**Files:**
- Create: `src/components/StaleBranchBanner.tsx`, `tests/components/StaleBranchBanner.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `BranchUpstreamStatus` (`shared/types.ts`, from Task 2).
- Produces: `StaleBranchBanner({ branch, status }: { branch: string; status: BranchUpstreamStatus })`.

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/components/StaleBranchBanner.test.tsx
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
    expect(screen.getByText(/git fetch origin main:main/i)).toBeInTheDocument()
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/StaleBranchBanner.test.tsx`
Expected: FAIL — `StaleBranchBanner.tsx` does not exist.

- [ ] **Step 3: Implement `src/components/StaleBranchBanner.tsx`**

```tsx
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/StaleBranchBanner.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire the banner into `src/App.tsx`**

Add the import after the `StatusPanel` import:

```tsx
import { StaleBranchBanner } from './components/StaleBranchBanner'
```

Add the banner as the first child inside the analysis block, right after the opening `<div className="mt-6 space-y-6">`:

```tsx
{repoPath && analysis && filtered && (
  <div className="mt-6 space-y-6">
    <StaleBranchBanner branch={analysis.branch} status={analysis.branchStatus} />
    <div className="flex flex-wrap items-center gap-4 rounded bg-white p-4 shadow">
```

(Only the two lines shown above are new — everything else in that block stays as it is.)

- [ ] **Step 6: Run the touched frontend tests**

Run: `npx vitest run tests/components/StaleBranchBanner.test.tsx tests/App.test.tsx`
Expected: PASS — all green (`App.test.tsx`'s single test never reaches the analysis block since `fetch` never resolves, so it's unaffected).

- [ ] **Step 7: Commit**

```bash
git add src/components/StaleBranchBanner.tsx tests/components/StaleBranchBanner.test.tsx src/App.tsx
git commit -m "feat: show a dismissible warning when the analyzed branch is behind its upstream"
```

---

### Task 4: Hotspots

**Files:**
- Create: `shared/aggregate-hotspots.ts`, `tests/shared/aggregate-hotspots.test.ts`, `src/components/Dashboard/HotspotsTable.tsx`, `tests/components/Dashboard/HotspotsTable.test.tsx`
- Modify: `shared/types.ts`, `src/App.tsx`

**Interfaces:**
- Produces: `HotspotEntry` type (`shared/types.ts`); `aggregateHotspots(commitStats: CommitStats[], limit = 20): HotspotEntry[]` (`shared/aggregate-hotspots.ts`); `HotspotsTable({ hotspots }: { hotspots: HotspotEntry[] })`.

- [ ] **Step 1: Add `HotspotEntry` to `shared/types.ts`**

```ts
export interface HotspotEntry {
  filepath: string
  totalChurn: number
  authorCount: number
  score: number
}
```

- [ ] **Step 2: Write the failing tests for the aggregator**

```ts
// tests/shared/aggregate-hotspots.test.ts
import { describe, expect, it } from 'vitest'
import { aggregateHotspots } from '../../shared/aggregate-hotspots'
import type { CommitStats } from '../../shared/types'

function stat(
  author: string,
  oid: string,
  files: { filepath: string; added: number; deleted: number }[]
): CommitStats {
  return {
    commit: { oid, parentOids: [], author, email: `${author}@example.com`, timestamp: 0, message: 'x', isMerge: false },
    files,
    totalAdded: files.reduce((s, f) => s + f.added, 0),
    totalDeleted: files.reduce((s, f) => s + f.deleted, 0),
  }
}

describe('aggregateHotspots', () => {
  it('scores files by total churn times distinct author count', () => {
    const commitStats: CommitStats[] = [
      stat('Alice', 'c1', [{ filepath: 'a.txt', added: 10, deleted: 0 }]),
      stat('Bob', 'c2', [{ filepath: 'a.txt', added: 5, deleted: 5 }]),
      stat('Alice', 'c3', [{ filepath: 'b.txt', added: 100, deleted: 0 }]),
    ]

    const hotspots = aggregateHotspots(commitStats)

    const a = hotspots.find((h) => h.filepath === 'a.txt')!
    expect(a.totalChurn).toBe(20)
    expect(a.authorCount).toBe(2)
    expect(a.score).toBe(40)

    const b = hotspots.find((h) => h.filepath === 'b.txt')!
    expect(b.totalChurn).toBe(100)
    expect(b.authorCount).toBe(1)
    expect(b.score).toBe(100)

    // b.txt has the higher score (100 vs 40) despite fewer distinct authors.
    expect(hotspots[0].filepath).toBe('b.txt')
  })

  it('caps results to the given limit, defaulting to 20', () => {
    const commitStats: CommitStats[] = Array.from({ length: 30 }, (_, i) =>
      stat('Alice', `c${i}`, [{ filepath: `file${i}.txt`, added: i + 1, deleted: 0 }])
    )
    expect(aggregateHotspots(commitStats, 5)).toHaveLength(5)
    expect(aggregateHotspots(commitStats)).toHaveLength(20)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/shared/aggregate-hotspots.test.ts`
Expected: FAIL — `shared/aggregate-hotspots.ts` does not exist.

- [ ] **Step 4: Implement `shared/aggregate-hotspots.ts`**

```ts
import type { CommitStats, HotspotEntry } from './types'

export function aggregateHotspots(commitStats: CommitStats[], limit = 20): HotspotEntry[] {
  const byFile = new Map<string, { totalChurn: number; authors: Set<string> }>()

  for (const stat of commitStats) {
    for (const file of stat.files) {
      const entry = byFile.get(file.filepath) ?? { totalChurn: 0, authors: new Set<string>() }
      entry.totalChurn += file.added + file.deleted
      entry.authors.add(stat.commit.author)
      byFile.set(file.filepath, entry)
    }
  }

  return [...byFile.entries()]
    .map(([filepath, { totalChurn, authors }]) => ({
      filepath,
      totalChurn,
      authorCount: authors.size,
      score: totalChurn * authors.size,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/shared/aggregate-hotspots.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Write the failing test for `HotspotsTable`**

```tsx
// tests/components/Dashboard/HotspotsTable.test.tsx
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
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run tests/components/Dashboard/HotspotsTable.test.tsx`
Expected: FAIL — `HotspotsTable.tsx` does not exist.

- [ ] **Step 8: Implement `src/components/Dashboard/HotspotsTable.tsx`**

```tsx
import type { HotspotEntry } from '../../../shared/types'

export function HotspotsTable({ hotspots }: { hotspots: HotspotEntry[] }) {
  return (
    <section className="rounded bg-white p-4 shadow">
      <h2 className="mb-4 text-lg font-semibold">Hotspots</h2>
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            <th className="p-2">File</th>
            <th className="p-2">Total churn</th>
            <th className="p-2">Authors</th>
            <th className="p-2">Score</th>
          </tr>
        </thead>
        <tbody>
          {hotspots.map((h) => (
            <tr key={h.filepath} className="border-t">
              <td className="p-2">{h.filepath}</td>
              <td className="p-2">{h.totalChurn}</td>
              <td className="p-2">{h.authorCount}</td>
              <td className="p-2">{h.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run tests/components/Dashboard/HotspotsTable.test.tsx`
Expected: PASS, 1 test.

- [ ] **Step 10: Wire hotspots into `src/App.tsx`**

Add the import after the `MergeInsightsTable` import:

```tsx
import { HotspotsTable } from './components/Dashboard/HotspotsTable'
```

Add the import for the aggregator, alongside the existing `shared/aggregate-churn` import:

```tsx
import { aggregateHotspots } from '../shared/aggregate-hotspots'
```

In the `filtered` `useMemo`, add a `hotspots` field (no new dependency needed — it only uses `authorAndDateFilteredStats`, already in scope):

```tsx
const filtered = useMemo(() => {
  if (!analysis) return null
  const dateFilteredStats = filterCommitStatsByDateRange(analysis.commitStats, dateRange)
  const authorAndDateFilteredStats = filterCommitStatsByAuthors(dateFilteredStats, selectedAuthors)
  return {
    authorTotals: aggregateAuthorTotals(authorAndDateFilteredStats),
    activity: filterActivityByDateRange(
      filterByAuthors(analysis.activity, selectedAuthors),
      dateRange
    ),
    commitPatterns: aggregateCommitPatterns(authorAndDateFilteredStats),
    hotspots: aggregateHotspots(authorAndDateFilteredStats),
  }
}, [analysis, selectedAuthors, dateRange])
```

Render the table after `<MergeInsightsTable mergeInsights={analysis.mergeInsights} />`:

```tsx
<MergeInsightsTable mergeInsights={analysis.mergeInsights} />
<HotspotsTable hotspots={filtered.hotspots} />
```

- [ ] **Step 11: Run the touched frontend tests**

Run: `npx vitest run tests/components/Dashboard/HotspotsTable.test.tsx tests/App.test.tsx`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add shared/types.ts shared/aggregate-hotspots.ts tests/shared/aggregate-hotspots.test.ts src/components/Dashboard/HotspotsTable.tsx tests/components/Dashboard/HotspotsTable.test.tsx src/App.tsx
git commit -m "feat: add hotspots analysis (churn x distinct authors)"
```

---

### Task 5: Bus factor

**Files:**
- Create: `shared/aggregate-bus-factor.ts`, `tests/shared/aggregate-bus-factor.test.ts`, `src/components/Dashboard/BusFactorTable.tsx`, `tests/components/Dashboard/BusFactorTable.test.tsx`
- Modify: `shared/types.ts`, `src/App.tsx`

**Interfaces:**
- Produces: `BusFactorEntry` type (`shared/types.ts`); `aggregateBusFactor(fileOwnership: FileOwnership[], thresholdPercentage = 80, minLines = 5, limit = 20): BusFactorEntry[]` (`shared/aggregate-bus-factor.ts`); `BusFactorTable({ busFactor }: { busFactor: BusFactorEntry[] })`.

- [ ] **Step 1: Add `BusFactorEntry` to `shared/types.ts`**

```ts
export interface BusFactorEntry {
  filepath: string
  totalLines: number
  topAuthor: string
  topAuthorPercentage: number
}
```

- [ ] **Step 2: Write the failing tests for the aggregator**

```ts
// tests/shared/aggregate-bus-factor.test.ts
import { describe, expect, it } from 'vitest'
import { aggregateBusFactor } from '../../shared/aggregate-bus-factor'
import type { FileOwnership } from '../../shared/types'

describe('aggregateBusFactor', () => {
  it('flags files where one author owns at least the threshold share', () => {
    const fileOwnership: FileOwnership[] = [
      { filepath: 'risky.txt', totalLines: 10, ownerLineCounts: { Alice: 9, Bob: 1 } },
      { filepath: 'shared.txt', totalLines: 10, ownerLineCounts: { Alice: 5, Bob: 5 } },
    ]

    const result = aggregateBusFactor(fileOwnership)

    expect(result.some((f) => f.filepath === 'risky.txt')).toBe(true)
    expect(result.some((f) => f.filepath === 'shared.txt')).toBe(false)

    const risky = result.find((f) => f.filepath === 'risky.txt')!
    expect(risky.topAuthor).toBe('Alice')
    expect(risky.topAuthorPercentage).toBeCloseTo(90)
  })

  it('excludes files below the minimum line count', () => {
    const fileOwnership: FileOwnership[] = [
      { filepath: 'tiny.txt', totalLines: 2, ownerLineCounts: { Alice: 2 } },
    ]
    expect(aggregateBusFactor(fileOwnership)).toHaveLength(0)
  })

  it('respects a custom threshold and minLines', () => {
    const fileOwnership: FileOwnership[] = [
      { filepath: 'tiny.txt', totalLines: 2, ownerLineCounts: { Alice: 2 } },
    ]
    const result = aggregateBusFactor(fileOwnership, 100, 1)
    expect(result).toHaveLength(1)
    expect(result[0].topAuthorPercentage).toBe(100)
  })

  it('caps results to the given limit, defaulting to 20', () => {
    const fileOwnership: FileOwnership[] = Array.from({ length: 25 }, (_, i) => ({
      filepath: `file${i}.txt`,
      totalLines: 10,
      ownerLineCounts: { Alice: 10 },
    }))
    expect(aggregateBusFactor(fileOwnership, 80, 5, 5)).toHaveLength(5)
    expect(aggregateBusFactor(fileOwnership)).toHaveLength(20)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/shared/aggregate-bus-factor.test.ts`
Expected: FAIL — `shared/aggregate-bus-factor.ts` does not exist.

- [ ] **Step 4: Implement `shared/aggregate-bus-factor.ts`**

```ts
import type { FileOwnership, BusFactorEntry } from './types'

export function aggregateBusFactor(
  fileOwnership: FileOwnership[],
  thresholdPercentage = 80,
  minLines = 5,
  limit = 20
): BusFactorEntry[] {
  const entries: BusFactorEntry[] = []

  for (const file of fileOwnership) {
    if (file.totalLines < minLines) continue

    let topAuthor = ''
    let topLines = -1
    for (const [author, lines] of Object.entries(file.ownerLineCounts)) {
      if (lines > topLines) {
        topAuthor = author
        topLines = lines
      }
    }

    const topAuthorPercentage = (topLines / file.totalLines) * 100
    if (topAuthorPercentage >= thresholdPercentage) {
      entries.push({ filepath: file.filepath, totalLines: file.totalLines, topAuthor, topAuthorPercentage })
    }
  }

  return entries.sort((a, b) => b.topAuthorPercentage - a.topAuthorPercentage).slice(0, limit)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/shared/aggregate-bus-factor.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Write the failing test for `BusFactorTable`**

```tsx
// tests/components/Dashboard/BusFactorTable.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BusFactorTable } from '../../../src/components/Dashboard/BusFactorTable'

describe('BusFactorTable', () => {
  it('renders a row per flagged file', () => {
    render(
      <BusFactorTable
        busFactor={[{ filepath: 'risky.txt', totalLines: 10, topAuthor: 'Alice', topAuthorPercentage: 90 }]}
      />
    )
    expect(screen.getByText('risky.txt')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('90.0%')).toBeInTheDocument()
  })
})
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run tests/components/Dashboard/BusFactorTable.test.tsx`
Expected: FAIL — `BusFactorTable.tsx` does not exist.

- [ ] **Step 8: Implement `src/components/Dashboard/BusFactorTable.tsx`**

```tsx
import type { BusFactorEntry } from '../../../shared/types'

export function BusFactorTable({ busFactor }: { busFactor: BusFactorEntry[] }) {
  return (
    <section className="rounded bg-white p-4 shadow">
      <h2 className="mb-4 text-lg font-semibold">Bus factor risk</h2>
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            <th className="p-2">File</th>
            <th className="p-2">Total lines</th>
            <th className="p-2">Top author</th>
            <th className="p-2">% owned</th>
          </tr>
        </thead>
        <tbody>
          {busFactor.map((f) => (
            <tr key={f.filepath} className="border-t">
              <td className="p-2">{f.filepath}</td>
              <td className="p-2">{f.totalLines}</td>
              <td className="p-2">{f.topAuthor}</td>
              <td className="p-2">{f.topAuthorPercentage.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run tests/components/Dashboard/BusFactorTable.test.tsx`
Expected: PASS, 1 test.

- [ ] **Step 10: Wire bus factor into `src/App.tsx`**

Add the import after the `HotspotsTable` import:

```tsx
import { BusFactorTable } from './components/Dashboard/BusFactorTable'
```

Add the import for the aggregator, alongside the `aggregate-hotspots` import:

```tsx
import { aggregateBusFactor } from '../shared/aggregate-bus-factor'
```

Add a new `useMemo` for bus factor, right after the existing `filtered` `useMemo`:

```tsx
const busFactor = useMemo(() => {
  if (!analysis) return null
  return aggregateBusFactor(analysis.fileOwnership)
}, [analysis])
```

Update the render guard to also require `busFactor` (it changes from `{repoPath && analysis && filtered && (` to include `busFactor`):

```tsx
{repoPath && analysis && filtered && busFactor && (
```

Render the table after `<HotspotsTable hotspots={filtered.hotspots} />`:

```tsx
<HotspotsTable hotspots={filtered.hotspots} />
<BusFactorTable busFactor={busFactor} />
```

- [ ] **Step 11: Run the touched frontend tests**

Run: `npx vitest run tests/components/Dashboard/BusFactorTable.test.tsx tests/App.test.tsx`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add shared/types.ts shared/aggregate-bus-factor.ts tests/shared/aggregate-bus-factor.test.ts src/components/Dashboard/BusFactorTable.tsx tests/components/Dashboard/BusFactorTable.test.tsx src/App.tsx
git commit -m "feat: add bus-factor analysis (single-owner file risk)"
```

---

### Task 6: Wire up hour-of-day, largest commit, and a week/month granularity toggle

**Files:**
- Modify: `src/components/Dashboard/CommitPatternsHeatmap.tsx`, `src/components/Dashboard/ActivityOverTimeChart.tsx`, `src/App.tsx`
- Create: `tests/components/Dashboard/CommitPatternsHeatmap.test.tsx`

**Interfaces:**
- `ActivityOverTimeChart`'s props change from `{ activity }` to `{ activity, granularity, onGranularityChange }`.

- [ ] **Step 1: Write the failing test for the extended `CommitPatternsHeatmap`**

```tsx
// tests/components/Dashboard/CommitPatternsHeatmap.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CommitPatternsHeatmap } from '../../../src/components/Dashboard/CommitPatternsHeatmap'
import type { CommitPatternSummary } from '../../../shared/types'

describe('CommitPatternsHeatmap', () => {
  it('renders the largest commit and an hour-of-day cell per author', () => {
    const patterns: CommitPatternSummary[] = [
      {
        author: 'Alice',
        avgLinesPerCommit: 12.5,
        largestCommit: { oid: 'abcdef1234567', lines: 450 },
        dayOfWeekCounts: [0, 1, 0, 0, 0, 0, 0],
        hourOfDayCounts: new Array(24).fill(0).map((_, i) => (i === 9 ? 3 : 0)),
      },
    ]

    render(<CommitPatternsHeatmap patterns={patterns} />)

    expect(screen.getByText(/largest commit: 450 lines \(abcdef1\)/i)).toBeInTheDocument()
    expect(screen.getByTitle('9:00 — 3 commits')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/Dashboard/CommitPatternsHeatmap.test.tsx`
Expected: FAIL — no "largest commit" text or hour-of-day cell exists yet.

- [ ] **Step 3: Update `src/components/Dashboard/CommitPatternsHeatmap.tsx`**

```tsx
import type { CommitPatternSummary } from '../../../shared/types'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function CommitPatternsHeatmap({ patterns }: { patterns: CommitPatternSummary[] }) {
  return (
    <section className="rounded bg-white p-4 shadow">
      <h2 className="mb-4 text-lg font-semibold">Commit patterns</h2>
      {patterns.map((pattern) => {
        const maxDay = Math.max(...pattern.dayOfWeekCounts, 1)
        const maxHour = Math.max(...pattern.hourOfDayCounts, 1)
        return (
          <div key={pattern.author} className="mb-6">
            <p className="mb-1 text-sm font-medium">
              {pattern.author} · avg {pattern.avgLinesPerCommit.toFixed(1)} lines/commit · largest commit:{' '}
              {pattern.largestCommit.lines} lines ({pattern.largestCommit.oid.slice(0, 7)})
            </p>
            <div className="mb-2 flex gap-1">
              {pattern.dayOfWeekCounts.map((count, i) => (
                <div
                  key={DAY_LABELS[i]}
                  title={`${DAY_LABELS[i]}: ${count} commits`}
                  className="flex h-8 w-8 items-center justify-center rounded text-[10px] text-white"
                  style={{ backgroundColor: `rgba(37, 99, 235, ${0.15 + 0.85 * (count / maxDay)})` }}
                >
                  {DAY_LABELS[i]}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {pattern.hourOfDayCounts.map((count, i) => (
                <div
                  key={i}
                  title={`${i}:00 — ${count} commits`}
                  className="flex h-6 w-6 items-center justify-center rounded text-[9px] text-white"
                  style={{ backgroundColor: `rgba(22, 163, 74, ${0.15 + 0.85 * (count / maxHour)})` }}
                >
                  {i}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </section>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/Dashboard/CommitPatternsHeatmap.test.tsx`
Expected: PASS, 1 test.

- [ ] **Step 5: Add the granularity toggle to `src/components/Dashboard/ActivityOverTimeChart.tsx`**

```tsx
import { useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { ActivityBucket } from '../../../shared/types'
import type { BucketGranularity } from '../../../shared/aggregate-churn'

const COLORS = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c']

export function ActivityOverTimeChart({
  activity,
  granularity,
  onGranularityChange,
}: {
  activity: ActivityBucket[]
  granularity: BucketGranularity
  onGranularityChange: (granularity: BucketGranularity) => void
}) {
  const { rows, authors } = useMemo(() => {
    const byBucket = new Map<number, Record<string, number>>()
    const authorSet = new Set<string>()

    for (const entry of activity) {
      authorSet.add(entry.author)
      const row = byBucket.get(entry.bucketStart) ?? { bucketStart: entry.bucketStart }
      row[entry.author] = entry.added
      byBucket.set(entry.bucketStart, row)
    }

    return {
      rows: [...byBucket.values()].sort((a, b) => a.bucketStart - b.bucketStart),
      authors: [...authorSet],
    }
  }, [activity])

  return (
    <section className="rounded bg-white p-4 shadow">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Activity over time</h2>
        <div className="flex gap-1 text-sm">
          <button
            type="button"
            onClick={() => onGranularityChange('week')}
            className={`rounded px-2 py-1 ${granularity === 'week' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
          >
            Week
          </button>
          <button
            type="button"
            onClick={() => onGranularityChange('month')}
            className={`rounded px-2 py-1 ${granularity === 'month' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
          >
            Month
          </button>
        </div>
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows}>
            <XAxis
              dataKey="bucketStart"
              tickFormatter={(value) => new Date(value).toLocaleDateString()}
            />
            <YAxis />
            <Tooltip labelFormatter={(value) => new Date(value).toLocaleDateString()} />
            <Legend />
            {authors.map((author, i) => (
              <Line
                key={author}
                type="monotone"
                dataKey={author}
                stroke={COLORS[i % COLORS.length]}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
```

- [ ] **Step 6: Wire the granularity state into `src/App.tsx`**

Change the `shared/aggregate-churn` import line to also bring in `aggregateActivityOverTime` and the `BucketGranularity` type:

```tsx
import {
  aggregateAuthorTotals,
  aggregateCommitPatterns,
  aggregateActivityOverTime,
  type BucketGranularity,
} from '../shared/aggregate-churn'
```

Remove `filterByAuthors` and `filterActivityByDateRange` from the `./lib/filters` import (they become unused after this step) — it becomes:

```tsx
import {
  filterCommitStatsByDateRange,
  filterCommitStatsByAuthors,
  type DateRange,
} from './lib/filters'
```

Add a `granularity` state, alongside the existing `dateRange`/`selectedAuthors` state:

```tsx
const [granularity, setGranularity] = useState<BucketGranularity>('month')
```

Change the `activity` line inside the `filtered` `useMemo` to recompute client-side from the filtered stats, and add `granularity` to the dependency array:

```tsx
const filtered = useMemo(() => {
  if (!analysis) return null
  const dateFilteredStats = filterCommitStatsByDateRange(analysis.commitStats, dateRange)
  const authorAndDateFilteredStats = filterCommitStatsByAuthors(dateFilteredStats, selectedAuthors)
  return {
    authorTotals: aggregateAuthorTotals(authorAndDateFilteredStats),
    activity: aggregateActivityOverTime(authorAndDateFilteredStats, granularity),
    commitPatterns: aggregateCommitPatterns(authorAndDateFilteredStats),
    hotspots: aggregateHotspots(authorAndDateFilteredStats),
  }
}, [analysis, selectedAuthors, dateRange, granularity])
```

Update the `ActivityOverTimeChart` usage to pass the new props:

```tsx
<ActivityOverTimeChart
  activity={filtered.activity}
  granularity={granularity}
  onGranularityChange={setGranularity}
/>
```

- [ ] **Step 7: Run the full frontend + shared test suite**

Run: `npx vitest run tests shared`
Expected: PASS — all green, including every test added across Tasks 1-6.

- [ ] **Step 8: Full project verification**

Run: `npx tsc -b --force`
Expected: zero errors.

Run: `npm test`
Expected: entire suite green (frontend + `shared/` + `server/`).

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 9: Commit**

```bash
git add src/components/Dashboard/CommitPatternsHeatmap.tsx tests/components/Dashboard/CommitPatternsHeatmap.test.tsx src/components/Dashboard/ActivityOverTimeChart.tsx src/App.tsx
git commit -m "feat: surface hour-of-day/largest-commit data and add a week/month activity toggle"
```
