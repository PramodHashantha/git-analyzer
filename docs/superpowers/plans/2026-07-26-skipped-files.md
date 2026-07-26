# Skipped-Files UI Note Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix a real crash — analyzing any repo containing a git submodule currently throws, because `aggregateOwnership` runs `git show` on every listed path without first checking whether it's a submodule (gitlink) entry — and, since the fix naturally produces a list of skipped paths and why, surface that list in the dashboard's ownership view.

**Architecture:** `server/src/git/ownership.ts`'s file enumeration switches from `git ls-tree -r --name-only` to `git ls-tree -r` (full output, exposing each entry's type) so submodules are detected and skipped *before* `git show` is ever attempted on them. Binary files (already skipped, previously with no record at all) and submodules are both now recorded in a new `skipped: SkippedFile[]` list, which flows through `aggregateOwnership` → `computeAnalysis` → a new `RepoAnalysis.skippedFiles` field → a small expandable summary in `OwnershipView`.

**Tech Stack:** Same as the rest of the project — Node/Express backend shelling out to real `git`, Vite + React + TypeScript frontend, Vitest + Testing Library for tests, Tailwind for styling.

## Global Constraints

- Submodule detection must happen from `git ls-tree -r <headOid>`'s type column (`commit` = submodule) — never by attempting `git show` on a submodule path and catching the failure.
- `SkippedFile` has exactly two reasons: `'binary' | 'submodule'`.
- `skippedFiles` is a new top-level field on `RepoAnalysis`, populated unconditionally (an empty array when nothing was skipped, never omitted).
- The `OwnershipView` summary renders nothing when `skippedFiles` is empty — no "0 files excluded" clutter.
- All git invocations stay behind the existing `runGit`/`runGitBuffer` wrappers (array-args `execFile`, never a shell string).

---

### Task 1: Backend — detect submodules before `git show`, report skipped files

**Files:**
- Modify: `shared/types.ts`, `server/src/git/ownership.ts`, `server/src/git/ownership.test.ts`, `server/src/analyzer.ts`, `server/src/analyzer.test.ts`

**Interfaces:**
- Produces: `SkippedFile` type (`shared/types.ts`); `aggregateOwnership`'s return type gains `skipped: SkippedFile[]`; `RepoAnalysis` gains `skippedFiles: SkippedFile[]`.

- [ ] **Step 1: Add `SkippedFile` to `shared/types.ts`, and `skippedFiles` to `RepoAnalysis`**

Add this interface (placed after `BusFactorEntry`):

```ts
export interface SkippedFile {
  filepath: string
  reason: 'binary' | 'submodule'
}
```

Add `skippedFiles: SkippedFile[]` to `RepoAnalysis`, placed after `authorOwnership`:

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
  skippedFiles: SkippedFile[]
  mergeInsights: BranchMergeInsights[]
}
```

- [ ] **Step 2: Write the failing tests for `aggregateOwnership`'s new `skipped` return value**

Replace the existing `'excludes binary files from ownership'` test in `server/src/git/ownership.test.ts` with this (same setup, extended assertions), and add the new submodule test right after it:

```ts
  it('excludes binary files from ownership and reports them as skipped', async () => {
    const dir = buildRealGitRepo((run, d) => {
      fs.writeFileSync(`${d}/code.txt`, 'a\nb\n')
      fs.writeFileSync(`${d}/image.bin`, Buffer.from([0x89, 0x50, 0x00, 0x47]))
      run(['add', '-A'])
      run(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'mixed'])
    })

    const { files, skipped } = await aggregateOwnership(dir, headOidOf(dir))

    expect(files.some((f) => f.filepath === 'code.txt')).toBe(true)
    expect(files.some((f) => f.filepath === 'image.bin')).toBe(false)
    expect(skipped).toContainEqual({ filepath: 'image.bin', reason: 'binary' })
  })

  it('detects a submodule without crashing and reports it as skipped', async () => {
    const innerDir = buildRealGitRepo((run, d) => {
      fs.writeFileSync(`${d}/inner.txt`, 'inner\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'inner commit'])
    })

    const dir = buildRealGitRepo((run, d) => {
      fs.writeFileSync(`${d}/code.txt`, 'a\nb\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'add code'])
    })

    execFileSync(
      'git',
      ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', innerDir, 'sub'],
      { cwd: dir }
    )
    execFileSync(
      'git',
      ['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'add submodule'],
      { cwd: dir }
    )

    const { files, skipped } = await aggregateOwnership(dir, headOidOf(dir))

    expect(files.some((f) => f.filepath === 'code.txt')).toBe(true)
    expect(files.some((f) => f.filepath === 'sub')).toBe(false)
    expect(skipped).toContainEqual({ filepath: 'sub', reason: 'submodule' })
  })
```

(The other two existing tests in this file — `'credits merged-in code to its true author...'` and `'computes percentages that sum to 100'` — are unchanged.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run server/src/git/ownership.test.ts`
Expected: FAIL — `skipped` is `undefined` on the returned object (not yet implemented), and the submodule test either crashes or fails the `sub` assertions.

- [ ] **Step 4: Rewrite `server/src/git/ownership.ts`**

```ts
import { runGit, runGitBuffer } from './exec'
import { isBinaryBlob } from '../../../shared/binary'
import type { FileOwnership, AuthorOwnership, SkippedFile } from '../../../shared/types'

interface TreeEntry {
  filepath: string
  isSubmodule: boolean
}

/**
 * `git ls-tree -r` (full form, not --name-only) so each line carries
 * `<mode> <type> <oid>\t<path>` — a submodule (gitlink) entry has type
 * `commit`, letting us skip it before ever attempting `git show` on it
 * (which fails: there is no blob object for a gitlink entry).
 */
async function listFilesAtCommit(repoPath: string, headOid: string): Promise<TreeEntry[]> {
  const out = await runGit(repoPath, ['ls-tree', '-r', headOid])
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [meta, filepath] = line.split('\t')
      const type = meta.split(' ')[1]
      return { filepath, isSubmodule: type === 'commit' }
    })
    .sort((a, b) => a.filepath.localeCompare(b.filepath))
}

/**
 * Per-line author for `filepath` as of `headOid`, via real `git blame`
 * (--line-porcelain repeats full metadata for every line, so no state
 * tracking across abbreviated commit references is needed). `author` is
 * already .mailmap-resolved by git itself.
 */
async function blameFileCounts(repoPath: string, headOid: string, filepath: string): Promise<Record<string, number>> {
  const out = await runGit(repoPath, ['blame', headOid, '--line-porcelain', '--', filepath])
  const counts: Record<string, number> = {}
  for (const line of out.split('\n')) {
    if (line.startsWith('author ')) {
      const name = line.slice('author '.length)
      counts[name] = (counts[name] ?? 0) + 1
    }
  }
  return counts
}

export async function aggregateOwnership(
  repoPath: string,
  headOid: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ files: FileOwnership[]; authors: AuthorOwnership[]; skipped: SkippedFile[] }> {
  const entries = await listFilesAtCommit(repoPath, headOid)

  const files: FileOwnership[] = []
  const skipped: SkippedFile[] = []
  const authorLineTotals = new Map<string, number>()
  let grandTotal = 0

  for (let i = 0; i < entries.length; i++) {
    const { filepath, isSubmodule } = entries[i]

    if (isSubmodule) {
      skipped.push({ filepath, reason: 'submodule' })
      onProgress?.(i + 1, entries.length)
      continue
    }

    const content = await runGitBuffer(repoPath, ['show', `${headOid}:${filepath}`])

    if (isBinaryBlob(content)) {
      skipped.push({ filepath, reason: 'binary' })
    } else {
      const ownerLineCounts = await blameFileCounts(repoPath, headOid, filepath)
      const totalLines = Object.values(ownerLineCounts).reduce((a, b) => a + b, 0)
      files.push({ filepath, totalLines, ownerLineCounts })

      for (const [author, count] of Object.entries(ownerLineCounts)) {
        authorLineTotals.set(author, (authorLineTotals.get(author) ?? 0) + count)
        grandTotal += count
      }
    }

    onProgress?.(i + 1, entries.length)
  }

  const authors: AuthorOwnership[] = [...authorLineTotals.entries()]
    .map(([author, linesOwned]) => ({
      author,
      linesOwned,
      percentage: grandTotal ? (linesOwned / grandTotal) * 100 : 0,
    }))
    .sort((a, b) => b.linesOwned - a.linesOwned)

  return { files, authors, skipped }
}
```

- [ ] **Step 5: Add `execFileSync` to `server/src/git/ownership.test.ts`'s imports**

The file already imports `execFileSync` (used by the existing `headOidOf` helper) — confirm it's there; no change needed if so. (It is: `import { execFileSync } from 'node:child_process'` is already present.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run server/src/git/ownership.test.ts`
Expected: PASS, 4 tests (2 unchanged, 1 extended, 1 new).

- [ ] **Step 7: Wire `skippedFiles` into `server/src/analyzer.ts`**

Change the destructuring and the returned object:

```ts
  const { files: fileOwnership, authors: authorOwnership, skipped: skippedFiles } = await aggregateOwnership(
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
    skippedFiles,
    mergeInsights: aggregateMergeInsights(commits),
  }
```

(Only the `skipped: skippedFiles` destructure and the `skippedFiles,` line are new — everything else in `computeAnalysis` stays as it is.)

- [ ] **Step 8: Add a `skippedFiles` assertion to `server/src/analyzer.test.ts`**

In the first test (`'composes a full RepoAnalysis matching the expected shape'`), add this assertion alongside the existing ones (the test repo has only one text file, so nothing is skipped):

```ts
expect(analysis.skippedFiles).toEqual([])
```

- [ ] **Step 9: Run the full backend suite**

Run: `npx vitest run server`
Expected: PASS — all server tests green, including the new/extended ones.

- [ ] **Step 10: Commit**

```bash
git add shared/types.ts server/src/git/ownership.ts server/src/git/ownership.test.ts server/src/analyzer.ts server/src/analyzer.test.ts
git commit -m "fix: detect submodules before git show (was crashing) and report skipped files"
```

---

### Task 2: Frontend — expandable skipped-files summary in `OwnershipView`

**Files:**
- Modify: `src/components/Dashboard/OwnershipView.tsx`, `tests/components/Dashboard/OwnershipView.test.tsx`, `src/App.tsx`

**Interfaces:**
- `OwnershipView`'s props change from `{ authorOwnership, fileOwnership }` to `{ authorOwnership, fileOwnership, skippedFiles }`.

- [ ] **Step 1: Write the failing tests**

Replace `tests/components/Dashboard/OwnershipView.test.tsx` in full with:

```tsx
import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { FileOwnership, SkippedFile } from '../../../shared/types'
import { OwnershipView } from '../../../src/components/Dashboard/OwnershipView'

describe('OwnershipView', () => {
  const authorOwnership = [{ author: 'Alice', linesOwned: 3, percentage: 100 }]
  const fileOwnership: FileOwnership[] = [
    { filepath: 'src/a.ts', totalLines: 2, ownerLineCounts: { Alice: 2 } },
    { filepath: 'src/b.ts', totalLines: 1, ownerLineCounts: { Bob: 1 } },
  ]

  it("reveals a file's owners at the top of the Files section when a row is clicked", () => {
    render(
      <OwnershipView authorOwnership={authorOwnership} fileOwnership={fileOwnership} skippedFiles={[]} />
    )

    // No detail panel before clicking.
    expect(screen.queryByTestId('file-owner-detail')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('src/b.ts'))

    const detail = screen.getByTestId('file-owner-detail')
    expect(within(detail).getByText('src/b.ts')).toBeInTheDocument()
    expect(within(detail).getByText(/Bob: 1 lines/)).toBeInTheDocument()
  })

  it('renders no skipped-files note when nothing was skipped', () => {
    render(
      <OwnershipView authorOwnership={authorOwnership} fileOwnership={fileOwnership} skippedFiles={[]} />
    )
    expect(screen.queryByText(/excluded from ownership/i)).not.toBeInTheDocument()
  })

  it('shows a summary with the binary/submodule breakdown when files are skipped', () => {
    const skippedFiles: SkippedFile[] = [
      { filepath: 'image.bin', reason: 'binary' },
      { filepath: 'assets/logo.png', reason: 'binary' },
      { filepath: 'vendor/lib', reason: 'submodule' },
    ]
    render(
      <OwnershipView
        authorOwnership={authorOwnership}
        fileOwnership={fileOwnership}
        skippedFiles={skippedFiles}
      />
    )
    expect(screen.getByText(/3 files excluded from ownership/i)).toBeInTheDocument()
    expect(screen.getByText(/2 binary, 1 submodule/i)).toBeInTheDocument()
  })

  it('expands to list the skipped files when the summary is clicked', () => {
    const skippedFiles: SkippedFile[] = [{ filepath: 'image.bin', reason: 'binary' }]
    render(
      <OwnershipView
        authorOwnership={authorOwnership}
        fileOwnership={fileOwnership}
        skippedFiles={skippedFiles}
      />
    )

    expect(screen.queryByText('image.bin (binary)')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText(/1 file excluded from ownership/i))
    expect(screen.getByText('image.bin (binary)')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/Dashboard/OwnershipView.test.tsx`
Expected: FAIL — `OwnershipView` doesn't accept a `skippedFiles` prop yet, and none of the skipped-summary behavior exists.

- [ ] **Step 3: Update `src/components/Dashboard/OwnershipView.tsx`**

```tsx
import { useState } from 'react'
import type { AuthorOwnership, FileOwnership, SkippedFile } from '../../../shared/types'
import { rollupByDirectory } from '../../lib/directory-rollup'

export function OwnershipView({
  authorOwnership,
  fileOwnership,
  skippedFiles,
}: {
  authorOwnership: AuthorOwnership[]
  fileOwnership: FileOwnership[]
  skippedFiles: SkippedFile[]
}) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [skippedExpanded, setSkippedExpanded] = useState(false)
  const selected = fileOwnership.find((f) => f.filepath === selectedFile) ?? null
  const directories = rollupByDirectory(fileOwnership)

  const binaryCount = skippedFiles.filter((f) => f.reason === 'binary').length
  const submoduleCount = skippedFiles.filter((f) => f.reason === 'submodule').length

  return (
    <section className="rounded bg-white p-4 shadow">
      <h2 className="mb-4 text-lg font-semibold">Current line ownership (HEAD)</h2>

      {skippedFiles.length > 0 && (
        <div className="mb-4 text-sm text-gray-600">
          <button type="button" onClick={() => setSkippedExpanded((v) => !v)} className="underline">
            {skippedFiles.length} file{skippedFiles.length === 1 ? '' : 's'} excluded from ownership (
            {binaryCount} binary, {submoduleCount} submodule{submoduleCount === 1 ? '' : 's'})
          </button>
          {skippedExpanded && (
            <ul className="mt-2 list-disc pl-5">
              {skippedFiles.map((f) => (
                <li key={f.filepath}>
                  {f.filepath} ({f.reason})
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <table className="mb-6 w-full text-left text-sm">
        <thead>
          <tr>
            <th className="p-2">Author</th>
            <th className="p-2">Lines owned</th>
            <th className="p-2">% of codebase</th>
          </tr>
        </thead>
        <tbody>
          {authorOwnership.map((row) => (
            <tr key={row.author} className="border-t">
              <td className="p-2">{row.author}</td>
              <td className="p-2">{row.linesOwned}</td>
              <td className="p-2">{row.percentage.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="mb-2 text-sm font-semibold">Directories</h3>
      <table className="mb-6 w-full text-left text-sm">
        <thead>
          <tr>
            <th className="p-2">Directory</th>
            <th className="p-2">Lines</th>
          </tr>
        </thead>
        <tbody>
          {directories.map((dir) => (
            <tr key={dir.filepath} className="border-t">
              <td className="p-2">{dir.filepath}</td>
              <td className="p-2">{dir.totalLines}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="mb-2 text-sm font-semibold">Files (click to see owners)</h3>

      {selected && (
        <div data-testid="file-owner-detail" className="mb-4 rounded border p-3">
          <p className="mb-2 font-medium">{selected.filepath}</p>
          <ul className="text-sm">
            {Object.entries(selected.ownerLineCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([author, count]) => (
                <li key={author}>
                  {author}: {count} lines
                </li>
              ))}
          </ul>
        </div>
      )}

      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            <th className="p-2">File</th>
            <th className="p-2">Lines</th>
          </tr>
        </thead>
        <tbody>
          {fileOwnership
            .slice()
            .sort((a, b) => b.totalLines - a.totalLines)
            .map((file) => (
              <tr
                key={file.filepath}
                className="cursor-pointer border-t hover:bg-gray-50"
                onClick={() => setSelectedFile(file.filepath)}
              >
                <td className="p-2">{file.filepath}</td>
                <td className="p-2">{file.totalLines}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </section>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/Dashboard/OwnershipView.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire `skippedFiles` into `src/App.tsx`**

Change the `OwnershipView` usage at the end of the dashboard body:

```tsx
<OwnershipView
  authorOwnership={analysis.authorOwnership}
  fileOwnership={analysis.fileOwnership}
  skippedFiles={analysis.skippedFiles}
/>
```

(Only the added `skippedFiles={analysis.skippedFiles}` line is new — nothing else in `App.tsx` changes.)

- [ ] **Step 6: Run the touched frontend tests**

Run: `npx vitest run tests/components/Dashboard/OwnershipView.test.tsx tests/App.test.tsx`
Expected: PASS.

- [ ] **Step 7: Full project verification**

Run: `npx tsc -b --force`
Expected: zero errors.

Run: `npm test`
Expected: entire suite green (frontend + `shared/` + `server/`).

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/components/Dashboard/OwnershipView.tsx tests/components/Dashboard/OwnershipView.test.tsx src/App.tsx
git commit -m "feat: show an expandable skipped-files summary in the ownership view"
```
