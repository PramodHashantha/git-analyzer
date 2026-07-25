# Single-Pass Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the O(files × commits) per-file backward blame with one forward first-parent walk that only processes files changed in each commit, producing byte-for-byte identical per-line ownership, far faster.

**Architecture:** A new `ownership-walk.ts` module walks the first-parent chain oldest→newest, maintaining a `Map<filepath, ownerOid[]>` and updating only the files changed at each commit via a pure `applyChangeToOwners` line-mapping function. `aggregate-ownership.ts` is rewritten to drive this walk and roll up results into the unchanged `{ files, authors }` shape. The existing `blameFile` is retained as a correctness oracle that parity tests check against.

**Tech Stack:** TypeScript (strict), isomorphic-git, `diff` (jsdiff), Vitest, the existing `@isomorphic-git/lightning-fs` fixture builder.

## Global Constraints

- **Exact parity:** the new single-pass per-line owners MUST equal `blameFile`'s output exactly. Parity is proven by tests that run both over fixture repos; never weaken a parity assertion to make it pass.
- **Shared normalization:** blame and the ownership walk MUST decode blobs to lines and rebuild diff text through the SAME helpers (`decodeLines` / `linesToText`). Any divergence silently breaks parity.
- **First-parent only:** follow `commit.parent[0]` exactly as `blame.ts` and `commit-stats.ts` do. Do not diff against every parent of a merge.
- **Ownership-only scope:** do not touch churn, activity, commit-pattern, merge, or filter logic.
- **TypeScript strict**, and `npm run build` (`tsc -b && vite build`) must pass with zero errors — verify independently, not just `npm test` (Vitest does not type-check).
- **No React dependency** in any `src/lib/` module.
- Reuse the existing shared isomorphic-git cache (`ctx.cache`) on every git call, and the existing `mapWithConcurrency` / `GIT_READ_CONCURRENCY` helpers.
- `aggregateOwnership`'s public signature stays `(ctx, headOid, onProgress?) => Promise<{ files: FileOwnership[]; authors: AuthorOwnership[] }>`; only its progress semantics change (now per commit, not per file).

---

## File Structure Overview

```
src/lib/git/
  line-text.ts        (new: shared blob→lines / lines→text normalization)
  ownership-walk.ts   (new: applyChangeToOwners + computeAllOwnership)
  blame.ts            (modified: use line-text helpers; kept as parity oracle)
  aggregate-ownership.ts (rewritten: drive the single-pass walk)
src/components/
  StatusPanel.tsx     (modified: ownership progress label "commits" not "files")
tests/lib/git/
  line-text.test.ts        (new)
  ownership-walk.test.ts    (new: unit + parity vs blameFile)
  aggregate-ownership.test.ts (modified: per-commit progress expectation)
tests/components/
  StatusPanel.test.tsx     (modified: assert new ownership label)
```

---

### Task 1: Shared line normalization helpers

**Files:**
- Create: `src/lib/git/line-text.ts`
- Modify: `src/lib/git/blame.ts`
- Test: `tests/lib/git/line-text.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `decodeLines(blob: Uint8Array): string[]` and `linesToText(lines: string[]): string` — used by `blame.ts` (this task) and `ownership-walk.ts` (Tasks 2-3). These encode the EXACT normalization parity depends on.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/git/line-text.test.ts
import { describe, expect, it } from 'vitest'
import { decodeLines, linesToText } from '../../../src/lib/git/line-text'

const enc = (s: string) => new TextEncoder().encode(s)

describe('decodeLines', () => {
  it('returns [] for an empty blob', () => {
    expect(decodeLines(enc(''))).toEqual([])
  })
  it('drops the trailing empty element from a final newline', () => {
    expect(decodeLines(enc('one\ntwo\n'))).toEqual(['one', 'two'])
  })
  it('keeps all lines when there is no trailing newline', () => {
    expect(decodeLines(enc('one\ntwo'))).toEqual(['one', 'two'])
  })
})

describe('linesToText', () => {
  it('returns empty string for no lines', () => {
    expect(linesToText([])).toBe('')
  })
  it('joins with newlines and re-adds the trailing newline', () => {
    expect(linesToText(['one', 'two'])).toBe('one\ntwo\n')
  })
  it('round-trips with decodeLines for newline-terminated content', () => {
    expect(linesToText(decodeLines(enc('a\nb\n')))).toBe('a\nb\n')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/git/line-text.test.ts`
Expected: FAIL — `line-text.ts` does not exist.

- [ ] **Step 3: Implement `src/lib/git/line-text.ts`**

```ts
const decoder = new TextDecoder('utf-8', { fatal: false })

/**
 * Decode a git blob to lines using the normalization the blame and ownership
 * walks share: split on '\n' and drop a single trailing empty element left by
 * a final newline. Both paths MUST use this so their diff inputs are identical
 * — exact per-line ownership parity depends on it.
 */
export function decodeLines(blob: Uint8Array): string[] {
  const text = decoder.decode(blob)
  if (!text.length) return []
  const lines = text.split('\n')
  return lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines
}

/**
 * Rebuild diff-input text from lines: join with '\n' and re-add the trailing
 * newline (empty string for an empty file). Mirrors decodeLines so the text
 * fed to diffLines matches what blame.ts has always produced.
 */
export function linesToText(lines: string[]): string {
  return lines.length ? lines.join('\n') + '\n' : ''
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/git/line-text.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Refactor `blame.ts` to use the shared helpers (behavior-preserving)**

In `src/lib/git/blame.ts`, add the import and replace the inline normalization. The existing `blame.test.ts` must still pass unchanged — that is the proof this refactor preserves behavior.

Add after the existing imports:
```ts
import { decodeLines, linesToText } from './line-text'
```

Replace the body of `readFileLinesAtCommit` (currently lines ~12-23) so the `try` block reads:
```ts
  try {
    const { blob } = await git.readBlob({
      fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, oid: commitOid, filepath, cache: ctx.cache,
    })
    return decodeLines(blob)
  } catch {
    return []
  }
```

Remove the now-unused module-level `const decoder = new TextDecoder(...)` line from `blame.ts` (it moved into `line-text.ts`).

Replace the two text-building lines in `blameFile`:
```ts
    const parentText = linesToText(parentLines)
    const currentText = linesToText(currentLines)
```

- [ ] **Step 6: Run blame tests + the new test to confirm nothing changed**

Run: `npx vitest run tests/lib/git/blame.test.ts tests/lib/git/line-text.test.ts`
Expected: PASS — all blame tests still green (oracle unchanged), plus 6 line-text tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/git/line-text.ts src/lib/git/blame.ts tests/lib/git/line-text.test.ts
git commit -m "refactor: extract shared blob-to-lines normalization for blame and ownership"
```

---

### Task 2: `applyChangeToOwners` pure line-mapping function

**Files:**
- Create: `src/lib/git/ownership-walk.ts`
- Test: `tests/lib/git/ownership-walk.test.ts`

**Interfaces:**
- Consumes: `linesToText` (Task 1); `diffLines` from `diff`.
- Produces: `applyChangeToOwners(beforeOwners: string[], beforeText: string, afterText: string, commitOid: string): string[]` — the per-file line-owner mapping consumed by `computeAllOwnership` (Task 3).

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/git/ownership-walk.test.ts
import { describe, expect, it } from 'vitest'
import { applyChangeToOwners } from '../../../src/lib/git/ownership-walk'
import { linesToText } from '../../../src/lib/git/line-text'

const owners = (before: string[], beforeOwners: string[], after: string[], oid: string) =>
  applyChangeToOwners(beforeOwners, linesToText(before), linesToText(after), oid)

describe('applyChangeToOwners', () => {
  it('attributes appended lines to the new commit, keeping context owners', () => {
    expect(owners(['one', 'two'], ['c1', 'c1'], ['one', 'two', 'three'], 'c2')).toEqual([
      'c1', 'c1', 'c2',
    ])
  })

  it('keeps surviving owners when a line is deleted', () => {
    expect(owners(['a', 'b', 'c'], ['c1', 'c1', 'c1'], ['a', 'c'], 'c2')).toEqual(['c1', 'c1'])
  })

  it('attributes only the changed line on an in-place edit', () => {
    expect(owners(['a', 'b', 'c'], ['c1', 'c1', 'c1'], ['a', 'B', 'c'], 'c2')).toEqual([
      'c1', 'c2', 'c1',
    ])
  })

  it('attributes a full replacement to the new commit', () => {
    expect(owners(['x'], ['c1'], ['y'], 'c2')).toEqual(['c2'])
  })

  it('returns [] when the file becomes empty', () => {
    expect(owners(['a'], ['c1'], [], 'c2')).toEqual([])
  })

  it('attributes every line to the commit when adding to an empty file', () => {
    expect(owners([], [], ['a', 'b'], 'c2')).toEqual(['c2', 'c2'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/git/ownership-walk.test.ts`
Expected: FAIL — `ownership-walk.ts` does not exist.

- [ ] **Step 3: Implement `applyChangeToOwners` in `src/lib/git/ownership-walk.ts`**

```ts
import { diffLines } from 'diff'

/**
 * Given the owner commit-oid of each line of a file's parent version, and the
 * parent/child text, return the owner of each line of the child version:
 * added lines are owned by `commitOid`, unchanged (context) lines inherit
 * their parent owner by position, removed lines are dropped.
 *
 * Uses the same diffLines engine and (via callers) the same linesToText
 * normalization as blame.ts, so forward attribution matches backward blame.
 */
export function applyChangeToOwners(
  beforeOwners: string[],
  beforeText: string,
  afterText: string,
  commitOid: string
): string[] {
  const parts = diffLines(beforeText, afterText)
  const afterOwners: string[] = []
  let beforeIdx = 0

  for (const part of parts) {
    const count = part.count ?? 0
    if (part.added) {
      for (let k = 0; k < count; k++) afterOwners.push(commitOid)
    } else if (part.removed) {
      beforeIdx += count
    } else {
      for (let k = 0; k < count; k++) afterOwners.push(beforeOwners[beforeIdx + k])
      beforeIdx += count
    }
  }

  return afterOwners
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/git/ownership-walk.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/git/ownership-walk.ts tests/lib/git/ownership-walk.test.ts
git commit -m "feat: add applyChangeToOwners line-mapping for single-pass ownership"
```

---

### Task 3: `computeAllOwnership` forward walk

**Files:**
- Modify: `src/lib/git/ownership-walk.ts`
- Test: `tests/lib/git/ownership-walk.test.ts` (add to the existing file)

**Interfaces:**
- Consumes: `RepoContext` (repo.ts), `listChangedFiles` (line-diff.ts), `decodeLines`/`linesToText` (line-text.ts), `applyChangeToOwners` (Task 2), `mapWithConcurrency`/`GIT_READ_CONCURRENCY` (concurrency.ts), `git.readBlob`/`git.readCommit`.
- Produces: `computeAllOwnership(ctx: RepoContext, headOid: string, onProgress?: (done: number, total: number) => void): Promise<Map<string, string[]>>` — filepath → owner-oid-per-line for every file at HEAD; consumed by `aggregateOwnership` (Task 4) and the parity tests.

- [ ] **Step 1: Write the failing test (direct correctness on a fixture)**

Add to `tests/lib/git/ownership-walk.test.ts`:
```ts
import { buildFixtureRepo } from '../../fixtures/gitFixture'
import { makeRepoContext } from '../../../src/lib/git/repo'
import { walkHistory } from '../../../src/lib/git/history'
import { computeAllOwnership } from '../../../src/lib/git/ownership-walk'

describe('computeAllOwnership', () => {
  it('maps each HEAD line to the commit that introduced it', async () => {
    const { fs, dir, headOid } = await buildFixtureRepo('own-walk-1', [
      {
        message: 'first',
        author: { name: 'Alice', email: 'alice@example.com' },
        files: { 'a.txt': 'one\ntwo\n', 'b.txt': 'x\n' },
      },
      {
        message: 'second',
        author: { name: 'Bob', email: 'bob@example.com' },
        files: { 'a.txt': 'one\ntwo\nthree\n' },
      },
    ])
    const ctx = makeRepoContext(fs, dir)
    const commits = await walkHistory(ctx, 'main') // [second, first]

    const owners = await computeAllOwnership(ctx, headOid)

    expect(owners.get('a.txt')).toEqual([commits[1].oid, commits[1].oid, commits[0].oid])
    expect(owners.get('b.txt')).toEqual([commits[1].oid])
  })

  it('reports progress once per commit', async () => {
    const { fs, dir, headOid } = await buildFixtureRepo('own-walk-2', [
      { message: 'c1', author: { name: 'A', email: 'a@x.com' }, files: { 'a.txt': 'x\n' } },
      { message: 'c2', author: { name: 'A', email: 'a@x.com' }, files: { 'a.txt': 'x\ny\n' } },
    ])
    const ctx = makeRepoContext(fs, dir)

    const progress: Array<{ done: number; total: number }> = []
    await computeAllOwnership(ctx, headOid, (done, total) => progress.push({ done, total }))

    expect(progress).toEqual([
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/git/ownership-walk.test.ts`
Expected: FAIL — `computeAllOwnership` is not exported.

- [ ] **Step 3: Implement `computeAllOwnership` (append to `src/lib/git/ownership-walk.ts`)**

Add imports at the top of the file:
```ts
import * as git from 'isomorphic-git'
import type { RepoContext } from './repo'
import { listChangedFiles } from './line-diff'
import { decodeLines, linesToText } from './line-text'
import { mapWithConcurrency, GIT_READ_CONCURRENCY } from '../concurrency'
```

Append:
```ts
async function readBlobLines(ctx: RepoContext, oid: string): Promise<string[]> {
  const { blob } = await git.readBlob({
    fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, oid, cache: ctx.cache,
  })
  return decodeLines(blob)
}

/** First-parent chain from the root commit up to headOid (oldest first). */
async function firstParentChain(ctx: RepoContext, headOid: string): Promise<string[]> {
  const chain: string[] = []
  let oid: string | null = headOid
  while (oid) {
    chain.push(oid)
    const { commit } = await git.readCommit({
      fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, oid, cache: ctx.cache,
    })
    oid = commit.parent[0] ?? null
  }
  return chain.reverse()
}

export async function computeAllOwnership(
  ctx: RepoContext,
  headOid: string,
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, string[]>> {
  const chain = await firstParentChain(ctx, headOid) // oldest -> newest
  const state = new Map<string, string[]>()

  for (let i = 0; i < chain.length; i++) {
    const commitOid = chain[i]
    const parentOid = i > 0 ? chain[i - 1] : null
    const changed = await listChangedFiles(ctx, commitOid, parentOid)

    // Files within one commit are independent (each path appears once), so
    // they can be processed concurrently even though commits are sequential.
    await mapWithConcurrency(changed, GIT_READ_CONCURRENCY, async (change) => {
      if (change.afterOid === null) {
        state.delete(change.filepath)
        return
      }
      const afterLines = await readBlobLines(ctx, change.afterOid)
      if (change.beforeOid === null) {
        state.set(change.filepath, afterLines.map(() => commitOid))
        return
      }
      const beforeLines = await readBlobLines(ctx, change.beforeOid)
      const beforeOwners = state.get(change.filepath)
      if (!beforeOwners || beforeOwners.length !== beforeLines.length) {
        throw new Error(
          `ownership-walk: state invariant violated for "${change.filepath}" at ${commitOid} ` +
            `(have ${beforeOwners?.length ?? 'none'} owners, expected ${beforeLines.length})`
        )
      }
      state.set(
        change.filepath,
        applyChangeToOwners(beforeOwners, linesToText(beforeLines), linesToText(afterLines), commitOid)
      )
    })

    onProgress?.(i + 1, chain.length)
  }

  return state
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/git/ownership-walk.test.ts`
Expected: PASS — the 6 `applyChangeToOwners` tests plus the 2 `computeAllOwnership` tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/git/ownership-walk.ts tests/lib/git/ownership-walk.test.ts
git commit -m "feat: add computeAllOwnership single-pass first-parent walk"
```

---

### Task 4: Parity tests against `blameFile`

**Files:**
- Test: `tests/lib/git/ownership-walk.test.ts` (add a parity describe block)

**Interfaces:**
- Consumes: `blameFile` (blame.ts, the oracle), `computeAllOwnership` (Task 3), `git.listFiles`, `buildFixtureRepo`.
- Produces: nothing — this task adds no source, only the parity guarantee.

- [ ] **Step 1: Write the parity test**

Add to `tests/lib/git/ownership-walk.test.ts`:
```ts
import { blameFile } from '../../../src/lib/git/blame'
import * as git from 'isomorphic-git'
import type { FixtureCommit } from '../../fixtures/gitFixture'

async function assertParity(name: string, commits: FixtureCommit[]) {
  const { fs, dir, gitdir, headOid } = await buildFixtureRepo(name, commits)
  const ctx = makeRepoContext(fs, dir)

  const owners = await computeAllOwnership(ctx, headOid)
  const filesAtHead = await git.listFiles({ fs, dir, gitdir, ref: headOid })

  // Same set of files.
  expect([...owners.keys()].sort()).toEqual([...filesAtHead].sort())

  // Same per-line owners as the backward blame oracle, for every file.
  for (const filepath of filesAtHead) {
    const expected = await blameFile(ctx, headOid, filepath)
    expect(owners.get(filepath), `owners mismatch for ${filepath}`).toEqual(expected)
  }
}

describe('computeAllOwnership parity with blameFile', () => {
  it('matches on linear history with edits, a survivor line, and no trailing newline', async () => {
    await assertParity('parity-linear', [
      {
        message: 'c1',
        author: { name: 'Alice', email: 'a@x.com' },
        files: { 'keep.txt': 'root line\n', 'edit.txt': 'a\nb\nc\n', 'nonl.txt': 'x\ny' },
      },
      {
        message: 'c2',
        author: { name: 'Bob', email: 'b@x.com' },
        files: { 'edit.txt': 'a\nB\nc\nd\n' },
      },
      {
        message: 'c3',
        author: { name: 'Carol', email: 'c@x.com' },
        files: { 'nonl.txt': 'x\ny\nz' },
      },
    ])
  })

  it('matches when a file is deleted then re-added', async () => {
    await assertParity('parity-readd', [
      { message: 'c1', author: { name: 'A', email: 'a@x.com' }, files: { 'f.txt': 'one\ntwo\n' } },
      { message: 'c2', author: { name: 'B', email: 'b@x.com' }, files: { 'f.txt': null } },
      { message: 'c3', author: { name: 'C', email: 'c@x.com' }, files: { 'f.txt': 'fresh\n' } },
    ])
  })
})
```

Note: `buildFixtureRepo` builds linear history (each commit's first parent is the previous commit), which exercises the first-parent walk fully. A merge-specific fixture is not added here because the builder does not create merges; merge behavior is covered by the identical first-parent rule already shared with `blame.ts` and by the existing `history`/`commit-stats` merge tests. If a merge fixture helper is added later, extend this block.

- [ ] **Step 2: Run the parity tests**

Run: `npx vitest run tests/lib/git/ownership-walk.test.ts`
Expected: PASS — parity holds for every file in both fixtures. If any file mismatches, the single-pass mapping diverges from blame and must be fixed before proceeding (do NOT weaken the assertion).

- [ ] **Step 3: Commit**

```bash
git add tests/lib/git/ownership-walk.test.ts
git commit -m "test: prove single-pass ownership matches blameFile line-for-line"
```

---

### Task 5: Rewrite `aggregateOwnership` to drive the single pass

**Files:**
- Modify: `src/lib/git/aggregate-ownership.ts`
- Test: `tests/lib/git/aggregate-ownership.test.ts`

**Interfaces:**
- Consumes: `computeAllOwnership` (Task 3), `FileOwnership`/`AuthorOwnership` (types.ts), `git.readCommit`.
- Produces: `aggregateOwnership(ctx, headOid, onProgress?)` with the SAME return shape as before; consumed unchanged by `useRepoAnalysis`.

- [ ] **Step 1: Update the existing tests for per-commit progress**

In `tests/lib/git/aggregate-ownership.test.ts`, the first test (rollup correctness: per-file `ownerLineCounts`, per-author `linesOwned`/`percentage`) is unchanged and must still pass. Only the progress test changes, because progress is now per commit.

Replace the progress test's body so it builds a known number of commits and asserts commit-based progress:
```ts
  it('reports progress across commits', async () => {
    const { fs, dir, headOid } = await buildFixtureRepo('aggregate-ownership-progress', [
      { message: 'c1', author: { name: 'Alice', email: 'alice@example.com' }, files: { 'a.txt': 'x\n' } },
      { message: 'c2', author: { name: 'Alice', email: 'alice@example.com' }, files: { 'b.txt': 'y\n' } },
    ])
    const ctx = makeRepoContext(fs, dir)

    const progress: Array<{ done: number; total: number }> = []
    await aggregateOwnership(ctx, headOid, (done, total) => progress.push({ done, total }))

    expect(progress).toEqual([
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ])
  })
```

(Keep the imports and the existing first test as-is; only this progress test body changes. If the old test used `headOid` from a fixture that did not return it, note `buildFixtureRepo` returns `{ fs, dir, gitdir, headOid }`.)

- [ ] **Step 2: Run tests to verify the progress test now fails**

Run: `npx vitest run tests/lib/git/aggregate-ownership.test.ts`
Expected: FAIL on the progress test — the current per-file implementation reports `{done, total}` in files (a 2-file spread), not the new per-commit spread. (The rollup test may still pass.)

- [ ] **Step 3: Rewrite `src/lib/git/aggregate-ownership.ts`**

Replace the entire file with:
```ts
import * as git from 'isomorphic-git'
import type { FileOwnership, AuthorOwnership } from '../types'
import type { RepoContext } from './repo'
import { computeAllOwnership } from './ownership-walk'

export async function aggregateOwnership(
  ctx: RepoContext,
  headOid: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ files: FileOwnership[]; authors: AuthorOwnership[] }> {
  const ownersByFile = await computeAllOwnership(ctx, headOid, onProgress)

  const files: FileOwnership[] = []
  const authorLineTotals = new Map<string, number>()
  const authorNameCache = new Map<string, string>()
  let grandTotal = 0

  for (const filepath of [...ownersByFile.keys()].sort()) {
    const owners = ownersByFile.get(filepath)!
    const ownerLineCounts: Record<string, number> = {}

    for (const oid of owners) {
      let author = authorNameCache.get(oid)
      if (!author) {
        const { commit } = await git.readCommit({
          fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, oid, cache: ctx.cache,
        })
        author = commit.author.name
        authorNameCache.set(oid, author)
      }
      ownerLineCounts[author] = (ownerLineCounts[author] ?? 0) + 1
    }

    files.push({ filepath, totalLines: owners.length, ownerLineCounts })
    for (const [author, count] of Object.entries(ownerLineCounts)) {
      authorLineTotals.set(author, (authorLineTotals.get(author) ?? 0) + count)
      grandTotal += count
    }
  }

  const authors: AuthorOwnership[] = [...authorLineTotals.entries()]
    .map(([author, linesOwned]) => ({
      author,
      linesOwned,
      percentage: grandTotal ? (linesOwned / grandTotal) * 100 : 0,
    }))
    .sort((a, b) => b.linesOwned - a.linesOwned)

  return { files, authors }
}
```

- [ ] **Step 4: Run the aggregate-ownership tests**

Run: `npx vitest run tests/lib/git/aggregate-ownership.test.ts`
Expected: PASS — rollup correctness unchanged, progress now per-commit.

- [ ] **Step 5: Commit**

```bash
git add src/lib/git/aggregate-ownership.ts tests/lib/git/aggregate-ownership.test.ts
git commit -m "perf: drive ownership rollup from the single-pass walk"
```

---

### Task 6: Update ownership progress label and verify end-to-end

**Files:**
- Modify: `src/components/StatusPanel.tsx`
- Test: `tests/components/StatusPanel.test.tsx`

**Interfaces:**
- Consumes: `AnalysisStatus` (useRepoAnalysis.ts) — unchanged shape.
- Produces: corrected user-facing copy for the `computing-ownership` phase.

- [ ] **Step 1: Write the failing test**

Add to `tests/components/StatusPanel.test.tsx`:
```ts
  it('labels ownership progress by commits, not files', () => {
    const status: AnalysisStatus = { phase: 'computing-ownership', done: 4, total: 9 }
    render(<StatusPanel status={status} />)
    expect(screen.getByText(/4 \/ 9 commits/i)).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/StatusPanel.test.tsx`
Expected: FAIL — the current copy says "files".

- [ ] **Step 3: Update `StatusPanel.tsx`**

In the `computing-ownership` case, change the wording from files to commits:
```tsx
    case 'computing-ownership':
      return (
        <p>
          Computing current ownership: {status.done} / {status.total} commits
        </p>
      )
```

- [ ] **Step 4: Run the StatusPanel tests**

Run: `npx vitest run tests/components/StatusPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full verification**

Run: `npm test`
Expected: PASS — entire suite green.

Run: `npx tsc -b --force`
Expected: zero errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Manual browser check (environment permitting)**

If a Chromium browser is available: `npm run dev`, open the app, pick a real repo, and confirm the Current Ownership view still shows the same authors/percentages as before this change, now noticeably faster, with the progress label counting commits. If no browser is available, note this as an outstanding manual verification.

- [ ] **Step 7: Commit**

```bash
git add src/components/StatusPanel.tsx tests/components/StatusPanel.test.tsx
git commit -m "feat: label ownership progress by commits to match the single-pass walk"
```
