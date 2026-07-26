# Local Git Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the in-browser isomorphic-git layer with a local Node/Express backend that shells out to the real `git` binary, serving the existing dashboard — faster, correct (rename-aware blame, native mailmap), any browser, any repo size.

**Architecture:** A Node/Express server (`server/`) runs `git` via `child_process.execFile` (argument arrays only) and composes the existing `RepoAnalysis` shape. Pure aggregation math that both sides need (`types.ts`, `aggregate-churn.ts`, `aggregate-merges.ts`, `binary.ts`) moves to a new top-level `shared/` folder. The React frontend (`src/`) keeps its dashboard components essentially unchanged; only its data source swaps from isomorphic-git to `fetch('/api/analyze')`, and `FolderPicker` is replaced by a local-path `RepoPicker`. The entire in-browser git-reading layer (isomorphic-git, the File System Access adapter, hand-written blame/mailmap/binary-in-browser/Buffer-polyfill code) is deleted once the backend covers the same ground.

**Tech Stack:** TypeScript (strict), Node.js `child_process`, Express, real `git` CLI, React, Vite, Vitest, `tsx` (dev/run), `concurrently`, `supertest`.

## Global Constraints

- **No shell strings.** Every git invocation uses `execFile('git', [...args])` with an argument array — never string interpolation into a shell command.
- **`-c color.ui=false` on every git call** (baked into the shared exec wrapper) so a user's global gitconfig can never inject ANSI codes into output we parse.
- **`git blame`/`git log` operate on the target commit/branch, never the working tree.** Use `git ls-tree -r --name-only <headOid>` (not `git ls-files`) and `git blame <headOid> -- <path>` (not blame-the-working-copy) so analysis is correct regardless of what branch happens to be checked out.
- **Binary exclusion stays our own NUL-byte check** (`shared/binary.ts`, moved rather than deleted — a deliberate, documented adjustment to the design spec's looser wording, since git has no single clean "is this blob binary" flag to shell out to). Applied before blame; binary files never appear in `fileOwnership`.
- **Identity unification is native**: `%aN`/`%aE` (capital N/E) in `git log` format strings are already `.mailmap`-resolved by git itself, and `git blame`'s `author`/`author-mail` porcelain fields are too. No JS mailmap parser.
- **The `RepoAnalysis` JSON contract is unchanged** — same fields/shapes as today. Dashboard components must not need edits beyond import-path fixes.
- **Server binds to `127.0.0.1` only.**
- TypeScript strict everywhere (`tsc -b` covers `src`, `tests`, `shared`, `server`). No dangling imports of deleted modules.
- Backend tests build **real git repos via the `git` CLI** (reusing `tests/fixtures/realGitRepo.ts`) — no mocking of git itself.
- Colocate backend tests next to their source (`server/src/git/repo.test.ts` beside `repo.ts`) — a deliberate convention for the new `server/` subsystem; `shared/` and `src/` keep the existing `tests/` mirror convention already used throughout this project.

---

## File Structure Overview

```
shared/
  types.ts                 (moved from src/lib/types.ts)
  aggregate-churn.ts        (moved from src/lib/git/aggregate-churn.ts)
  aggregate-merges.ts       (moved from src/lib/git/aggregate-merges.ts)
  binary.ts                 (moved from src/lib/git/binary.ts)
server/
  src/
    git/
      exec.ts                (new: runGit/runGitBuffer wrapper)
      repo.ts                 (new: validate path, branches, head oid)
      repo.test.ts
      history.ts               (new: git log -> CommitInfo[])
      history.test.ts
      churn.ts                  (new: git log --numstat -> per-commit FileLineStats[])
      churn.test.ts
      ownership.ts               (new: ls-tree + blame -> FileOwnership[]/AuthorOwnership[])
      ownership.test.ts
    analyzer.ts               (new: compose RepoAnalysis; resolveRepoHead/computeAnalysis)
    analyzer.test.ts
    cache.ts                   (new: in-memory cache keyed by path+branch+headOid)
    app.ts                      (new: Express app, /api/analyze route, prod static serving)
    app.test.ts
    index.ts                     (new: entrypoint, listen)
src/
  App.tsx                    (rewritten: RepoPicker + fetch-based hook)
  main.tsx                   (drop polyfills import)
  components/
    RepoPicker.tsx            (new, replaces FolderPicker.tsx)
    StatusPanel.tsx           (rewritten: simplified idle/loading/done/error)
    Dashboard/*.tsx            (import path fix only)
  hooks/
    useRepoAnalysis.ts        (rewritten: fetch-based)
  lib/
    directory-rollup.ts        (import path fix only)
    filters.ts                  (import path fix only)
tests/
  shared/
    aggregate-churn.test.ts    (moved)
    aggregate-merges.test.ts   (moved)
    binary.test.ts              (moved)
  components/
    RepoPicker.test.tsx        (new)
    StatusPanel.test.tsx       (rewritten)
    Dashboard/OwnershipView.test.tsx (import path fix only)
  hooks/
    useRepoAnalysis.test.ts    (rewritten)
  lib/
    directory-rollup.test.ts   (import path fix only)
    filters.test.ts             (import path fix only)
  App.test.tsx                (small fix: drop stale showDirectoryPicker mock)
  fixtures/
    realGitRepo.ts             (kept, reused by server tests)

DELETED (Task 8): src/lib/browser-support.ts, src/lib/cache/db.ts,
src/lib/concurrency.ts, src/lib/fs-adapter.ts, src/lib/git/aggregate-ownership.ts,
src/lib/git/blame.ts, src/lib/git/commit-stats.ts, src/lib/git/history.ts,
src/lib/git/identity.ts, src/lib/git/line-diff.ts, src/lib/git/line-text.ts,
src/lib/git/repo.ts, src/components/FolderPicker.tsx,
src/components/UnsupportedBrowserNotice.tsx, src/polyfills.ts, and every test
file for the above (see Task 8 for the exact list).
```

---

### Task 1: Backend scaffold — Express skeleton, dev/build/start wiring

**Files:**
- Create: `server/src/app.ts`, `server/src/app.test.ts`, `server/src/index.ts`
- Modify: `package.json`, `vite.config.ts`, `tsconfig.json`, create `tsconfig.server.json`

**Interfaces:**
- Produces: `createApp(staticDir?: string): express.Express` — an Express app with a stub `GET /api/analyze` (replaced with real logic in Task 6) and optional static-file serving. Consumed by `server/src/index.ts` and by `app.test.ts` directly (no port binding needed for tests).

- [ ] **Step 1: Add backend dependencies and scripts to `package.json`**

Add to `dependencies`: `"express": "^4.19.2"`.
Add to `devDependencies`: `"@types/express": "^4.17.21"`, `"concurrently": "^8.2.2"`, `"cross-env": "^7.0.3"`, `"tsx": "^4.19.0"`, `"supertest": "^7.0.0"`, `"@types/supertest": "^6.0.2"`.

Replace the `scripts` block:
```json
  "scripts": {
    "dev": "concurrently -n web,api -c blue,green \"vite\" \"tsx watch server/src/index.ts\"",
    "build": "tsc -b && vite build",
    "start": "cross-env NODE_ENV=production tsx server/src/index.ts",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
```

- [ ] **Step 2: Run install**

Run: `npm install`
Expected: succeeds, `express`/`tsx`/`concurrently`/etc. present in `node_modules`.

- [ ] **Step 3: Add `tsconfig.server.json` and reference it from the root**

Create `tsconfig.server.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["server", "shared"]
}
```

Update `tsconfig.json`:
```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.server.json" }
  ]
}
```

Update `tsconfig.app.json`'s `include` to add `shared` (it doesn't exist yet as a directory with files — that's fine, Task 2 populates it):
```json
  "include": ["src", "tests", "shared"]
```

- [ ] **Step 4: Write the failing test for the stub endpoint**

```ts
// server/src/app.test.ts
import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'

describe('createApp', () => {
  it('responds to GET /api/analyze with a stub payload', async () => {
    const app = createApp()
    const res = await request(app).get('/api/analyze?path=/tmp/whatever')
    expect(res.status).toBe(501)
    expect(res.body).toEqual({ error: 'not implemented yet' })
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run server/src/app.test.ts`
Expected: FAIL — `server/src/app.ts` does not exist.

- [ ] **Step 6: Implement `server/src/app.ts`**

```ts
import express from 'express'
import path from 'node:path'

export function createApp(staticDir?: string): express.Express {
  const app = express()

  app.get('/api/analyze', (_req, res) => {
    res.status(501).json({ error: 'not implemented yet' })
  })

  if (staticDir) {
    app.use(express.static(staticDir))
    app.get('*', (_req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'))
    })
  }

  return app
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run server/src/app.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 8: Implement `server/src/index.ts`**

```ts
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app'

const PORT = Number(process.env.PORT ?? 3001)
const HOST = '127.0.0.1'
const isProd = process.env.NODE_ENV === 'production'
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = createApp(isProd ? path.resolve(__dirname, '../../dist') : undefined)

app.listen(PORT, HOST, () => {
  console.log(`Git Contribution Dashboard backend listening on http://${HOST}:${PORT}`)
})
```

- [ ] **Step 9: Add the dev proxy to `vite.config.ts`**

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
})
```

- [ ] **Step 10: Verify the whole thing boots**

Run: `npx tsc -b --force` — expect zero errors.
Run: `npx vitest run server/src/app.test.ts` — expect PASS.
Run (manually, then stop it): `npm run dev` — expect both `vite` and the backend to start without errors; visiting `http://localhost:5173` should still show the (old, not-yet-rewired) app shell. Ctrl+C to stop.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json vite.config.ts tsconfig.json tsconfig.app.json tsconfig.server.json server/src/app.ts server/src/app.test.ts server/src/index.ts
git commit -m "feat: scaffold local Express backend (stub /api/analyze) and dev proxy"
```

---

### Task 2: Move shared modules to `shared/`; fix surviving imports

**Files:**
- Create: `shared/types.ts`, `shared/aggregate-churn.ts`, `shared/aggregate-merges.ts`, `shared/binary.ts`
- Create: `tests/shared/aggregate-churn.test.ts`, `tests/shared/aggregate-merges.test.ts`, `tests/shared/binary.test.ts`
- Delete: `src/lib/types.ts`, `src/lib/git/aggregate-churn.ts`, `src/lib/git/aggregate-merges.ts`, `src/lib/git/binary.ts`, `tests/lib/git/aggregate-churn.test.ts`, `tests/lib/git/aggregate-merges.test.ts`, `tests/lib/git/binary.test.ts`
- Modify (import path only): `src/lib/directory-rollup.ts`, `src/lib/filters.ts`, `src/components/Dashboard/ActivityOverTimeChart.tsx`, `src/components/Dashboard/CommitPatternsHeatmap.tsx`, `src/components/Dashboard/MergeInsightsTable.tsx`, `src/components/Dashboard/OverviewTable.tsx`, `src/components/Dashboard/OwnershipView.tsx`, `tests/lib/directory-rollup.test.ts`, `tests/lib/filters.test.ts`, `tests/components/Dashboard/OwnershipView.test.tsx`

**Interfaces:**
- Produces: `shared/types.ts` (all `RepoAnalysis`-family types), `shared/aggregate-churn.ts` (`filterNonMergeCommits`, `aggregateAuthorTotals`, `aggregateActivityOverTime`, `aggregateCommitPatterns`, `BucketGranularity`), `shared/aggregate-merges.ts` (`aggregateMergeInsights`), `shared/binary.ts` (`isBinaryBlob`) — consumed by both `src/` (Tasks 7-8) and `server/` (Tasks 3-6).

This task is a pure relocation — no logic changes. `src/App.tsx` and `src/hooks/useRepoAnalysis.ts` still reference the OLD paths at the end of this task (they get rewritten wholesale in Task 7), so they are intentionally left broken by `tsc` until then — do not attempt to patch them here.

- [ ] **Step 1: Create the `shared/` files (verbatim content, relocated)**

`shared/types.ts` — copy the full current content of `src/lib/types.ts` unchanged (all 10 interfaces: `CommitInfo`, `FileLineStats`, `CommitStats`, `AuthorTotals`, `ActivityBucket`, `CommitPatternSummary`, `FileOwnership`, `AuthorOwnership`, `BranchMergeInsights`, `RepoAnalysis`).

`shared/binary.ts` — copy the full current content of `src/lib/git/binary.ts` unchanged:
```ts
/**
 * A git blob is treated as binary if it contains a NUL byte — the same
 * heuristic git itself uses to decide a file has no meaningful line diff.
 * Binary files (images, fonts, compiled assets) must not be counted as
 * lines in churn or ownership.
 */
export function isBinaryBlob(blob: Uint8Array): boolean {
  return blob.includes(0)
}
```

`shared/aggregate-churn.ts` — copy `src/lib/git/aggregate-churn.ts`'s content, changing only the type import path from `'../types'` to `'./types'`:
```ts
import { startOfWeek, startOfMonth } from 'date-fns'
import type { AuthorTotals, ActivityBucket, CommitPatternSummary, CommitStats, CommitInfo } from './types'

/**
 * Merge commits combine branches rather than authoring code; git's own
 * `log --numstat` shows nothing for them. Exclude them from contribution
 * churn so mergers aren't credited with everyone's merged-in work.
 */
export function filterNonMergeCommits(commits: CommitInfo[]): CommitInfo[] {
  return commits.filter((c) => !c.isMerge)
}

export function aggregateAuthorTotals(commitStats: CommitStats[]): AuthorTotals[] {
  const byAuthor = new Map<string, AuthorTotals>()
  for (const stat of commitStats) {
    const author = stat.commit.author
    const existing = byAuthor.get(author) ?? { author, commits: 0, added: 0, deleted: 0, net: 0 }
    existing.commits += 1
    existing.added += stat.totalAdded
    existing.deleted += stat.totalDeleted
    existing.net = existing.added - existing.deleted
    byAuthor.set(author, existing)
  }
  return [...byAuthor.values()].sort((a, b) => b.added - a.added)
}

export type BucketGranularity = 'week' | 'month'

export function aggregateActivityOverTime(
  commitStats: CommitStats[],
  granularity: BucketGranularity
): ActivityBucket[] {
  const bucketFn = granularity === 'week' ? startOfWeek : startOfMonth
  const byKey = new Map<string, ActivityBucket>()

  for (const stat of commitStats) {
    const date = new Date(stat.commit.timestamp * 1000)
    const bucketStart = bucketFn(date).getTime()
    const author = stat.commit.author
    const key = `${bucketStart}::${author}`

    const existing = byKey.get(key) ?? { bucketStart, author, commits: 0, added: 0, deleted: 0 }
    existing.commits += 1
    existing.added += stat.totalAdded
    existing.deleted += stat.totalDeleted
    byKey.set(key, existing)
  }

  return [...byKey.values()].sort((a, b) => a.bucketStart - b.bucketStart)
}

export function aggregateCommitPatterns(commitStats: CommitStats[]): CommitPatternSummary[] {
  const byAuthor = new Map<string, CommitStats[]>()
  for (const stat of commitStats) {
    const list = byAuthor.get(stat.commit.author) ?? []
    list.push(stat)
    byAuthor.set(stat.commit.author, list)
  }

  const summaries: CommitPatternSummary[] = []
  for (const [author, stats] of byAuthor) {
    const dayOfWeekCounts = new Array(7).fill(0)
    const hourOfDayCounts = new Array(24).fill(0)
    let totalLines = 0
    let largestCommit = { oid: '', lines: -1 }

    for (const stat of stats) {
      const lines = stat.totalAdded + stat.totalDeleted
      totalLines += lines
      if (lines > largestCommit.lines) largestCommit = { oid: stat.commit.oid, lines }

      const date = new Date(stat.commit.timestamp * 1000)
      dayOfWeekCounts[date.getDay()] += 1
      hourOfDayCounts[date.getHours()] += 1
    }

    summaries.push({
      author,
      avgLinesPerCommit: stats.length ? totalLines / stats.length : 0,
      largestCommit,
      dayOfWeekCounts,
      hourOfDayCounts,
    })
  }

  return summaries
}
```

`shared/aggregate-merges.ts` — copy `src/lib/git/aggregate-merges.ts`'s content, changing the import path from `'../types'` to `'./types'`:
```ts
import type { CommitInfo, BranchMergeInsights } from './types'

export function aggregateMergeInsights(commits: CommitInfo[]): BranchMergeInsights[] {
  const byAuthor = new Map<string, number>()
  for (const commit of commits) {
    if (!commit.isMerge) continue
    byAuthor.set(commit.author, (byAuthor.get(commit.author) ?? 0) + 1)
  }
  return [...byAuthor.entries()]
    .map(([author, mergeCommits]) => ({ author, mergeCommits }))
    .sort((a, b) => b.mergeCommits - a.mergeCommits)
}
```

- [ ] **Step 2: Move the three test files verbatim, fixing import paths**

`tests/shared/binary.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { isBinaryBlob } from '../../shared/binary'

const enc = (s: string) => new TextEncoder().encode(s)

describe('isBinaryBlob', () => {
  it('treats a blob containing a NUL byte as binary', () => {
    expect(isBinaryBlob(new Uint8Array([104, 105, 0, 106]))).toBe(true)
  })
  it('treats plain text as not binary', () => {
    expect(isBinaryBlob(enc('hello\nworld\n'))).toBe(false)
  })
  it('treats an empty blob as not binary', () => {
    expect(isBinaryBlob(new Uint8Array([]))).toBe(false)
  })
})
```

`tests/shared/aggregate-churn.test.ts` — identical to the current `tests/lib/git/aggregate-churn.test.ts`, with its two import lines changed to:
```ts
import type { CommitStats, CommitInfo } from '../../shared/types'
import {
  aggregateAuthorTotals,
  aggregateActivityOverTime,
  aggregateCommitPatterns,
  filterNonMergeCommits,
} from '../../shared/aggregate-churn'
```
(Keep the rest of the file — `makeStat`, all `describe`/`it` blocks — byte-for-byte identical to the current file.)

`tests/shared/aggregate-merges.test.ts` — identical to the current `tests/lib/git/aggregate-merges.test.ts`, with its two import lines changed to:
```ts
import type { CommitInfo } from '../../shared/types'
import { aggregateMergeInsights } from '../../shared/aggregate-merges'
```
(Keep `makeCommit` and the `describe`/`it` block identical.)

- [ ] **Step 3: Run the moved tests**

Run: `npx vitest run tests/shared/`
Expected: PASS — 3 test files (binary: 3 tests, aggregate-churn: 4 tests, aggregate-merges: 1 test).

- [ ] **Step 4: Delete the old source and test files**

```bash
git rm src/lib/types.ts src/lib/git/aggregate-churn.ts src/lib/git/aggregate-merges.ts src/lib/git/binary.ts
git rm tests/lib/git/aggregate-churn.test.ts tests/lib/git/aggregate-merges.test.ts tests/lib/git/binary.test.ts
```

- [ ] **Step 5: Fix import paths in surviving `src/` files**

`src/lib/directory-rollup.ts` — change:
```ts
import type { FileOwnership } from './types'
```
to:
```ts
import type { FileOwnership } from '../../shared/types'
```

`src/lib/filters.ts` — change:
```ts
import type { ActivityBucket, CommitStats } from './types'
```
to:
```ts
import type { ActivityBucket, CommitStats } from '../../shared/types'
```

`src/components/Dashboard/ActivityOverTimeChart.tsx` — change:
```ts
import type { ActivityBucket } from '../../lib/types'
```
to:
```ts
import type { ActivityBucket } from '../../../shared/types'
```

`src/components/Dashboard/CommitPatternsHeatmap.tsx` — change:
```ts
import type { CommitPatternSummary } from '../../lib/types'
```
to:
```ts
import type { CommitPatternSummary } from '../../../shared/types'
```

`src/components/Dashboard/MergeInsightsTable.tsx` — change:
```ts
import type { BranchMergeInsights } from '../../lib/types'
```
to:
```ts
import type { BranchMergeInsights } from '../../../shared/types'
```

`src/components/Dashboard/OverviewTable.tsx` — change:
```ts
import type { AuthorTotals } from '../../lib/types'
```
to:
```ts
import type { AuthorTotals } from '../../../shared/types'
```

`src/components/Dashboard/OwnershipView.tsx` — change:
```ts
import type { AuthorOwnership, FileOwnership } from '../../lib/types'
```
to:
```ts
import type { AuthorOwnership, FileOwnership } from '../../../shared/types'
```
(Its other import, `import { rollupByDirectory } from '../../lib/directory-rollup'`, is unchanged — `directory-rollup.ts` stays in `src/lib/`.)

- [ ] **Step 6: Fix import paths in surviving `tests/` files**

`tests/lib/directory-rollup.test.ts` — change:
```ts
import type { FileOwnership } from '../../src/lib/types'
```
to:
```ts
import type { FileOwnership } from '../../shared/types'
```

`tests/lib/filters.test.ts` — change:
```ts
import type { ActivityBucket, CommitStats } from '../../src/lib/types'
```
to:
```ts
import type { ActivityBucket, CommitStats } from '../../shared/types'
```

`tests/components/Dashboard/OwnershipView.test.tsx` — change:
```ts
import type { FileOwnership } from '../../../src/lib/types'
```
to:
```ts
import type { FileOwnership } from '../../../shared/types'
```

- [ ] **Step 7: Run the tests that should now be fixed**

Run: `npx vitest run tests/lib/directory-rollup.test.ts tests/lib/filters.test.ts tests/components/Dashboard/OwnershipView.test.tsx`
Expected: PASS (these three files only reference relocated types, nothing else changed).

- [ ] **Step 8: Confirm the expected remaining breakage**

Run: `npx tsc -b --force`
Expected: errors ONLY in `src/App.tsx`, `src/hooks/useRepoAnalysis.ts`, and any file still under `src/lib/git/` that imports the moved modules (e.g. `aggregate-ownership.ts`, `commit-stats.ts` importing `../types`) — all of which are rewritten (Task 7) or deleted (Task 8) later in this plan. Confirm no OTHER unexpected errors appear. Do not fix these now.

- [ ] **Step 9: Commit**

```bash
git add shared tests/shared src/lib/directory-rollup.ts src/lib/filters.ts src/components/Dashboard tests/lib/directory-rollup.test.ts tests/lib/filters.test.ts tests/components/Dashboard/OwnershipView.test.tsx
git rm src/lib/types.ts src/lib/git/aggregate-churn.ts src/lib/git/aggregate-merges.ts src/lib/git/binary.ts tests/lib/git/aggregate-churn.test.ts tests/lib/git/aggregate-merges.test.ts tests/lib/git/binary.test.ts
git commit -m "refactor: move shared types/aggregators/binary-check into shared/"
```

---

### Task 3: Server git-reader — repo validation, branches, commit history

**Files:**
- Create: `server/src/git/exec.ts`, `server/src/git/repo.ts`, `server/src/git/repo.test.ts`, `server/src/git/history.ts`, `server/src/git/history.test.ts`

**Interfaces:**
- Produces: `runGit(repoPath, args): Promise<string>`, `runGitBuffer(repoPath, args): Promise<Buffer>` (exec.ts); `NotAGitRepoError`, `assertIsGitRepo(repoPath)`, `listBranches(repoPath): Promise<string[]>`, `getCurrentBranch(repoPath): Promise<string>`, `resolveBranchHead(repoPath, branch): Promise<string>` (repo.ts); `readHistory(repoPath, branch): Promise<CommitInfo[]>` (history.ts) — consumed by `analyzer.ts` (Task 6).

- [ ] **Step 1: Implement `server/src/git/exec.ts`**

```ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// Generous buffer for large repos' log/blame output.
const MAX_BUFFER = 1024 * 1024 * 200

function withSafeDefaults(args: string[]): string[] {
  // Force color off regardless of the user's global gitconfig, so ANSI
  // escape codes can never contaminate output we parse.
  return ['-c', 'color.ui=false', ...args]
}

export async function runGit(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = (await execFileAsync('git', withSafeDefaults(args), {
    cwd: repoPath,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  })) as { stdout: string; stderr: string }
  return stdout
}

export async function runGitBuffer(repoPath: string, args: string[]): Promise<Buffer> {
  const { stdout } = (await execFileAsync('git', withSafeDefaults(args), {
    cwd: repoPath,
    encoding: 'buffer',
    maxBuffer: MAX_BUFFER,
  })) as { stdout: Buffer; stderr: Buffer }
  return stdout
}
```

- [ ] **Step 2: Write the failing test for `repo.ts`**

```ts
// server/src/git/repo.test.ts
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildRealGitRepo } from '../../../tests/fixtures/realGitRepo'
import { assertIsGitRepo, listBranches, getCurrentBranch, resolveBranchHead, NotAGitRepoError } from './repo'

describe('repo', () => {
  it('resolves the current branch and its head commit', async () => {
    const dir = buildRealGitRepo((run, d) => {
      fs.writeFileSync(`${d}/a.txt`, 'hello\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'first'])
    })

    await assertIsGitRepo(dir)
    expect(await getCurrentBranch(dir)).toBe('main')
    expect(await listBranches(dir)).toContain('main')
    expect(await resolveBranchHead(dir, 'main')).toMatch(/^[0-9a-f]{40}$/)
  })

  it('throws NotAGitRepoError for a folder that is not a git repo', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'))
    await expect(assertIsGitRepo(dir)).rejects.toBeInstanceOf(NotAGitRepoError)
  })

  it('throws NotAGitRepoError for a path that does not exist', async () => {
    await expect(assertIsGitRepo('/definitely/does/not/exist/xyz')).rejects.toBeInstanceOf(NotAGitRepoError)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run server/src/git/repo.test.ts`
Expected: FAIL — `server/src/git/repo.ts` does not exist.

- [ ] **Step 4: Implement `server/src/git/repo.ts`**

```ts
import { runGit } from './exec'

export class NotAGitRepoError extends Error {}

export async function assertIsGitRepo(repoPath: string): Promise<void> {
  try {
    const out = await runGit(repoPath, ['rev-parse', '--is-inside-work-tree'])
    if (out.trim() !== 'true') throw new NotAGitRepoError(`Not a git repository: ${repoPath}`)
  } catch (err) {
    if (err instanceof NotAGitRepoError) throw err
    throw new NotAGitRepoError(`Not a git repository: ${repoPath}`)
  }
}

export async function listBranches(repoPath: string): Promise<string[]> {
  const out = await runGit(repoPath, ['branch', '--format=%(refname:short)'])
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

export async function getCurrentBranch(repoPath: string): Promise<string> {
  const out = await runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return out.trim()
}

export async function resolveBranchHead(repoPath: string, branch: string): Promise<string> {
  const out = await runGit(repoPath, ['rev-parse', branch])
  return out.trim()
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run server/src/git/repo.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Write the failing test for `history.ts`**

```ts
// server/src/git/history.test.ts
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { buildRealGitRepo } from '../../../tests/fixtures/realGitRepo'
import { readHistory } from './history'

function commit(run: (args: string[]) => void, dir: string, name: string, email: string, file: string, content: string, msg: string) {
  fs.writeFileSync(`${dir}/${file}`, content)
  run(['add', '-A'])
  run(['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', msg])
}

describe('readHistory', () => {
  it('parses commits newest-first with author/email/timestamp/message/parents', async () => {
    const dir = buildRealGitRepo((run, d) => {
      commit(run, d, 'Alice', 'alice@example.com', 'a.txt', 'one\n', 'first')
      commit(run, d, 'Bob', 'bob@example.com', 'a.txt', 'one\ntwo\n', 'second')
    })

    const commits = await readHistory(dir, 'main')

    expect(commits).toHaveLength(2)
    expect(commits[0].message).toBe('second')
    expect(commits[0].author).toBe('Bob')
    expect(commits[0].email).toBe('bob@example.com')
    expect(commits[0].isMerge).toBe(false)
    expect(commits[1].message).toBe('first')
    expect(commits[1].parentOids).toEqual([])
    expect(commits[0].parentOids).toEqual([commits[1].oid])
  })

  it('flags a merge commit (2+ parents) correctly', async () => {
    const dir = buildRealGitRepo((run, d) => {
      commit(run, d, 'Alice', 'alice@example.com', 'a.txt', 'base\n', 'base')
      run(['checkout', '-q', '-b', 'feature'])
      commit(run, d, 'Lahiru', 'lahiru@example.com', 'b.txt', 'feature\n', 'feature work')
      run(['checkout', '-q', 'main'])
      run(['-c', 'user.name=Dinil', '-c', 'user.email=dinil@example.com', 'merge', '-q', '--no-ff', 'feature', '-m', 'Merge feature'])
    })

    const commits = await readHistory(dir, 'main')
    const merge = commits.find((c) => c.message === 'Merge feature')

    expect(merge?.isMerge).toBe(true)
    expect(merge?.parentOids).toHaveLength(2)
  })
})
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run server/src/git/history.test.ts`
Expected: FAIL — `server/src/git/history.ts` does not exist.

- [ ] **Step 8: Implement `server/src/git/history.ts`**

```ts
import { runGit } from './exec'
import type { CommitInfo } from '../../../shared/types'

const RS = '\x1e' // record separator
const FS = '\x1f' // field separator

/**
 * Full ancestry reachable from `branch` (all parents, not first-parent-only),
 * newest first — matches git log's default order. %aN/%aE are mailmap-
 * resolved by git itself, so author identity is unified for free.
 */
export async function readHistory(repoPath: string, branch: string): Promise<CommitInfo[]> {
  const format = `%H${FS}%P${FS}%aN${FS}%aE${FS}%at${FS}%s${RS}`
  const out = await runGit(repoPath, ['log', branch, `--pretty=format:${format}`])

  const records = out
    .split(RS)
    .map((r) => r.trim())
    .filter(Boolean)

  return records.map((record) => {
    const [oid, parentStr, author, email, ts, message] = record.split(FS)
    const parentOids = parentStr ? parentStr.split(' ').filter(Boolean) : []
    return {
      oid,
      parentOids,
      author,
      email,
      timestamp: Number(ts),
      message,
      isMerge: parentOids.length > 1,
    }
  })
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run server/src/git/history.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 10: Commit**

```bash
git add server/src/git/exec.ts server/src/git/repo.ts server/src/git/repo.test.ts server/src/git/history.ts server/src/git/history.test.ts
git commit -m "feat: add server git-reader (repo validation, branches, commit history)"
```

---

### Task 4: Server churn reader — `git log --numstat` parsing

**Files:**
- Create: `server/src/git/churn.ts`, `server/src/git/churn.test.ts`

**Interfaces:**
- Consumes: `runGit` (exec.ts).
- Produces: `readChurnByCommit(repoPath, branch): Promise<Map<string, FileLineStats[]>>` — oid → per-file added/deleted for that commit's diff against its first parent, excluding merges and binary files. Consumed by `analyzer.ts` (Task 6).

- [ ] **Step 1: Write the failing test**

```ts
// server/src/git/churn.test.ts
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { buildRealGitRepo } from '../../../tests/fixtures/realGitRepo'
import { readHistory } from './history'
import { readChurnByCommit } from './churn'

describe('readChurnByCommit', () => {
  it('maps each non-merge commit to its per-file added/deleted lines', async () => {
    const dir = buildRealGitRepo((run, d) => {
      fs.writeFileSync(`${d}/a.txt`, 'one\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'first'])

      fs.writeFileSync(`${d}/a.txt`, 'one\ntwo\nthree\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Bob', '-c', 'user.email=bob@example.com', 'commit', '-q', '-m', 'second'])
    })

    const commits = await readHistory(dir, 'main')
    const churn = await readChurnByCommit(dir, 'main')

    const second = commits.find((c) => c.message === 'second')!
    expect(churn.get(second.oid)).toEqual([{ filepath: 'a.txt', added: 2, deleted: 0 }])

    const first = commits.find((c) => c.message === 'first')!
    expect(churn.get(first.oid)).toEqual([{ filepath: 'a.txt', added: 1, deleted: 0 }])
  })

  it('excludes binary files (numstat reports them as "-")', async () => {
    const dir = buildRealGitRepo((run, d) => {
      fs.writeFileSync(`${d}/code.txt`, 'a\nb\n')
      fs.writeFileSync(`${d}/image.bin`, Buffer.from([0x89, 0x50, 0x00, 0x47]))
      run(['add', '-A'])
      run(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'mixed'])
    })

    const commits = await readHistory(dir, 'main')
    const churn = await readChurnByCommit(dir, 'main')
    const files = churn.get(commits[0].oid) ?? []

    expect(files.some((f) => f.filepath === 'code.txt')).toBe(true)
    expect(files.some((f) => f.filepath === 'image.bin')).toBe(false)
  })

  it('excludes merge commits entirely from the map', async () => {
    const dir = buildRealGitRepo((run, d) => {
      fs.writeFileSync(`${d}/a.txt`, 'base\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'base'])
      run(['checkout', '-q', '-b', 'feature'])
      fs.writeFileSync(`${d}/b.txt`, 'feature\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Lahiru', '-c', 'user.email=lahiru@example.com', 'commit', '-q', '-m', 'feature work'])
      run(['checkout', '-q', 'main'])
      run(['-c', 'user.name=Dinil', '-c', 'user.email=dinil@example.com', 'merge', '-q', '--no-ff', 'feature', '-m', 'Merge feature'])
    })

    const commits = await readHistory(dir, 'main')
    const merge = commits.find((c) => c.isMerge)!
    const churn = await readChurnByCommit(dir, 'main')

    expect(churn.has(merge.oid)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/src/git/churn.test.ts`
Expected: FAIL — `server/src/git/churn.ts` does not exist.

- [ ] **Step 3: Implement `server/src/git/churn.ts`**

```ts
import { runGit } from './exec'
import type { FileLineStats } from '../../../shared/types'

const FS = '\x1f'
const MARKER = `C${FS}`

/**
 * Per non-merge commit, the added/deleted lines for each changed file
 * (diffed against the commit's first parent). Binary files report as
 * "-\t-\t<path>" in --numstat and are skipped. --no-renames keeps path
 * parsing simple and independent of the user's gitconfig.
 */
export async function readChurnByCommit(repoPath: string, branch: string): Promise<Map<string, FileLineStats[]>> {
  const out = await runGit(repoPath, [
    'log',
    branch,
    '--no-merges',
    '--no-renames',
    '--numstat',
    `--pretty=format:${MARKER}%H`,
  ])

  const result = new Map<string, FileLineStats[]>()
  let currentOid: string | null = null
  let currentFiles: FileLineStats[] = []

  function flush() {
    if (currentOid) result.set(currentOid, currentFiles)
  }

  for (const rawLine of out.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    if (line.startsWith(MARKER)) {
      flush()
      currentOid = line.slice(MARKER.length)
      currentFiles = []
      continue
    }

    const parts = line.split('\t')
    if (parts.length === 3) {
      const [addedStr, deletedStr, filepath] = parts
      if (addedStr === '-' || deletedStr === '-') continue // binary, skip
      currentFiles.push({ filepath, added: Number(addedStr), deleted: Number(deletedStr) })
    }
  }
  flush()

  return result
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/src/git/churn.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/git/churn.ts server/src/git/churn.test.ts
git commit -m "feat: add server churn reader (git log --numstat parsing)"
```

---

### Task 5: Server ownership reader — `ls-tree` + `git blame` per file

**Files:**
- Create: `server/src/git/ownership.ts`, `server/src/git/ownership.test.ts`

**Interfaces:**
- Consumes: `runGit`, `runGitBuffer` (exec.ts), `isBinaryBlob` (`shared/binary.ts`).
- Produces: `aggregateOwnership(repoPath, headOid): Promise<{ files: FileOwnership[]; authors: AuthorOwnership[] }>` — consumed by `analyzer.ts` (Task 6).

- [ ] **Step 1: Write the failing test**

```ts
// server/src/git/ownership.test.ts
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { buildRealGitRepo } from '../../../tests/fixtures/realGitRepo'
import { aggregateOwnership } from './ownership'

function headOidOf(dir: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
}

describe('aggregateOwnership', () => {
  it('credits merged-in code to its true author, not the merger', async () => {
    const dir = buildRealGitRepo((run, d) => {
      fs.writeFileSync(`${d}/f.txt`, 'a1\na2\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'base'])

      run(['checkout', '-q', '-b', 'feature'])
      fs.writeFileSync(`${d}/f.txt`, 'a1\na2\nL1\nL2\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Lahiru', '-c', 'user.email=lahiru@example.com', 'commit', '-q', '-m', 'feature work'])

      run(['checkout', '-q', 'main'])
      run(['-c', 'user.name=Dinil', '-c', 'user.email=dinil@example.com', 'merge', '-q', '--no-ff', 'feature', '-m', 'Merge feature'])
    })

    const { authors, files } = await aggregateOwnership(dir, headOidOf(dir))

    const f = files.find((file) => file.filepath === 'f.txt')!
    expect(f.ownerLineCounts).toEqual({ Alice: 2, Lahiru: 2 })
    expect(authors.find((a) => a.author === 'Dinil')).toBeUndefined()
    expect(authors.find((a) => a.author === 'Lahiru')?.linesOwned).toBe(2)
  })

  it('excludes binary files from ownership', async () => {
    const dir = buildRealGitRepo((run, d) => {
      fs.writeFileSync(`${d}/code.txt`, 'a\nb\n')
      fs.writeFileSync(`${d}/image.bin`, Buffer.from([0x89, 0x50, 0x00, 0x47]))
      run(['add', '-A'])
      run(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'mixed'])
    })

    const { files } = await aggregateOwnership(dir, headOidOf(dir))

    expect(files.some((f) => f.filepath === 'code.txt')).toBe(true)
    expect(files.some((f) => f.filepath === 'image.bin')).toBe(false)
  })

  it('computes percentages that sum to 100', async () => {
    const dir = buildRealGitRepo((run, d) => {
      fs.writeFileSync(`${d}/a.txt`, 'x\ny\ny\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'c1'])
      fs.writeFileSync(`${d}/a.txt`, 'x\ny\ny\nz\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Bob', '-c', 'user.email=bob@example.com', 'commit', '-q', '-m', 'c2'])
    })

    const { authors } = await aggregateOwnership(dir, headOidOf(dir))
    const total = authors.reduce((sum, a) => sum + a.percentage, 0)
    expect(total).toBeCloseTo(100)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/src/git/ownership.test.ts`
Expected: FAIL — `server/src/git/ownership.ts` does not exist.

- [ ] **Step 3: Implement `server/src/git/ownership.ts`**

```ts
import { runGit, runGitBuffer } from './exec'
import { isBinaryBlob } from '../../../shared/binary'
import type { FileOwnership, AuthorOwnership } from '../../../shared/types'

async function listFilesAtCommit(repoPath: string, headOid: string): Promise<string[]> {
  const out = await runGit(repoPath, ['ls-tree', '-r', '--name-only', headOid])
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .sort()
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
): Promise<{ files: FileOwnership[]; authors: AuthorOwnership[] }> {
  const filepaths = await listFilesAtCommit(repoPath, headOid)

  const files: FileOwnership[] = []
  const authorLineTotals = new Map<string, number>()
  let grandTotal = 0

  for (let i = 0; i < filepaths.length; i++) {
    const filepath = filepaths[i]
    const content = await runGitBuffer(repoPath, ['show', `${headOid}:${filepath}`])

    if (!isBinaryBlob(content)) {
      const ownerLineCounts = await blameFileCounts(repoPath, headOid, filepath)
      const totalLines = Object.values(ownerLineCounts).reduce((a, b) => a + b, 0)
      files.push({ filepath, totalLines, ownerLineCounts })

      for (const [author, count] of Object.entries(ownerLineCounts)) {
        authorLineTotals.set(author, (authorLineTotals.get(author) ?? 0) + count)
        grandTotal += count
      }
    }

    onProgress?.(i + 1, filepaths.length)
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/src/git/ownership.test.ts`
Expected: PASS, 3 tests — including the merge scenario proving Lahiru (not Dinil) is credited.

- [ ] **Step 5: Commit**

```bash
git add server/src/git/ownership.ts server/src/git/ownership.test.ts
git commit -m "feat: add server ownership reader (ls-tree + real git blame)"
```

---

### Task 6: Analyzer — compose `RepoAnalysis`, cache, wire the real endpoint

**Files:**
- Create: `server/src/analyzer.ts`, `server/src/analyzer.test.ts`, `server/src/cache.ts`
- Modify: `server/src/app.ts`, `server/src/app.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3-5, `shared/aggregate-churn.ts`, `shared/aggregate-merges.ts`.
- Produces: `RepoHead` type, `resolveRepoHead(repoPath, branchOverride?): Promise<RepoHead>`, `computeAnalysis(repoPath, head: RepoHead): Promise<RepoAnalysis>` (analyzer.ts); `makeCacheKey`, `getCached`, `setCached` (cache.ts). `app.ts`'s `/api/analyze` route now does real work.

- [ ] **Step 1: Write the failing test for `analyzer.ts`**

```ts
// server/src/analyzer.test.ts
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { buildRealGitRepo } from '../../tests/fixtures/realGitRepo'
import { resolveRepoHead, computeAnalysis } from './analyzer'

describe('analyzer', () => {
  it('composes a full RepoAnalysis matching the expected shape', async () => {
    const dir = buildRealGitRepo((run, d) => {
      fs.writeFileSync(`${d}/a.txt`, 'one\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'first'])
      fs.writeFileSync(`${d}/a.txt`, 'one\ntwo\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Bob', '-c', 'user.email=bob@example.com', 'commit', '-q', '-m', 'second'])
    })

    const head = await resolveRepoHead(dir)
    expect(head.branch).toBe('main')
    expect(head.branches).toContain('main')

    const analysis = await computeAnalysis(dir, head)

    expect(analysis.branch).toBe('main')
    expect(analysis.headOid).toBe(head.headOid)
    expect(analysis.commits).toHaveLength(2)
    expect(analysis.authorTotals.find((a) => a.author === 'Alice')?.added).toBe(1)
    expect(analysis.authorTotals.find((a) => a.author === 'Bob')?.added).toBe(1)
    expect(analysis.authorOwnership.find((a) => a.author === 'Bob')?.linesOwned).toBe(1)
    expect(analysis.fileOwnership.find((f) => f.filepath === 'a.txt')?.totalLines).toBe(2)
    expect(analysis.mergeInsights).toEqual([])
  })

  it('respects an explicit branch override', async () => {
    const dir = buildRealGitRepo((run, d) => {
      fs.writeFileSync(`${d}/a.txt`, 'base\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'base'])
      run(['checkout', '-q', '-b', 'other'])
      fs.writeFileSync(`${d}/b.txt`, 'other\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Bob', '-c', 'user.email=bob@example.com', 'commit', '-q', '-m', 'on other'])
    })

    const head = await resolveRepoHead(dir, 'other')
    expect(head.branch).toBe('other')
    const analysis = await computeAnalysis(dir, head)
    expect(analysis.commits.some((c) => c.message === 'on other')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/src/analyzer.test.ts`
Expected: FAIL — `server/src/analyzer.ts` does not exist.

- [ ] **Step 3: Implement `server/src/analyzer.ts`**

```ts
import path from 'node:path'
import { assertIsGitRepo, listBranches, getCurrentBranch, resolveBranchHead } from './git/repo'
import { readHistory } from './git/history'
import { readChurnByCommit } from './git/churn'
import { aggregateOwnership } from './git/ownership'
import {
  aggregateAuthorTotals,
  aggregateActivityOverTime,
  aggregateCommitPatterns,
  filterNonMergeCommits,
} from '../../shared/aggregate-churn'
import { aggregateMergeInsights } from '../../shared/aggregate-merges'
import type { RepoAnalysis, CommitStats } from '../../shared/types'

export interface RepoHead {
  branch: string
  branches: string[]
  headOid: string
}

export async function resolveRepoHead(repoPath: string, branchOverride?: string): Promise<RepoHead> {
  await assertIsGitRepo(repoPath)
  const branches = await listBranches(repoPath)
  const branch = branchOverride ?? (await getCurrentBranch(repoPath)) ?? branches[0]
  const headOid = await resolveBranchHead(repoPath, branch)
  return { branch, branches, headOid }
}

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

  return {
    repoName: path.basename(repoPath),
    branch,
    branches,
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/src/analyzer.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Implement `server/src/cache.ts`**

```ts
import type { RepoAnalysis } from '../../shared/types'

const cache = new Map<string, RepoAnalysis>()

export function makeCacheKey(repoPath: string, branch: string, headOid: string): string {
  return `${repoPath}::${branch}::${headOid}`
}

export function getCached(key: string): RepoAnalysis | undefined {
  return cache.get(key)
}

export function setCached(key: string, analysis: RepoAnalysis): void {
  cache.set(key, analysis)
}
```

- [ ] **Step 6: Write the failing test for the real `/api/analyze` route**

Replace the stub test in `server/src/app.test.ts`:
```ts
// server/src/app.test.ts
import { describe, expect, it } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildRealGitRepo } from '../../tests/fixtures/realGitRepo'
import { createApp } from './app'

describe('createApp', () => {
  it('GET /api/analyze returns a full RepoAnalysis for a real repo', async () => {
    const dir = buildRealGitRepo((run, d) => {
      fs.writeFileSync(`${d}/a.txt`, 'one\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'first'])
    })

    const app = createApp()
    const res = await request(app).get('/api/analyze').query({ path: dir })

    expect(res.status).toBe(200)
    expect(res.body.branch).toBe('main')
    expect(res.body.authorTotals[0].author).toBe('Alice')
  })

  it('returns 400 with a clear message for a path that is not a git repo', async () => {
    const notARepo = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'))

    const app = createApp()
    const res = await request(app).get('/api/analyze').query({ path: notARepo })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/not a git repository/i)
  })

  it('returns 400 when the path query parameter is missing', async () => {
    const app = createApp()
    const res = await request(app).get('/api/analyze')
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run server/src/app.test.ts`
Expected: FAIL — the stub route always returns 501.

- [ ] **Step 8: Wire the real endpoint in `server/src/app.ts`**

```ts
import express from 'express'
import path from 'node:path'
import { resolveRepoHead, computeAnalysis } from './analyzer'
import { getCached, setCached, makeCacheKey } from './cache'
import { NotAGitRepoError } from './git/repo'

export function createApp(staticDir?: string): express.Express {
  const app = express()

  app.get('/api/analyze', async (req, res) => {
    const repoPath = typeof req.query.path === 'string' ? req.query.path : ''
    const branchOverride = typeof req.query.branch === 'string' ? req.query.branch : undefined

    if (!repoPath) {
      res.status(400).json({ error: 'Missing required "path" query parameter' })
      return
    }

    try {
      const head = await resolveRepoHead(repoPath, branchOverride)
      const key = makeCacheKey(repoPath, head.branch, head.headOid)

      const cached = getCached(key)
      if (cached) {
        res.json(cached)
        return
      }

      const analysis = await computeAnalysis(repoPath, head)
      setCached(key, analysis)
      res.json(analysis)
    } catch (err) {
      if (err instanceof NotAGitRepoError) {
        res.status(400).json({ error: err.message })
        return
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  if (staticDir) {
    app.use(express.static(staticDir))
    app.get('*', (_req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'))
    })
  }

  return app
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run server/src/app.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 10: Run the whole backend test suite**

Run: `npx vitest run server`
Expected: PASS — all server tests (exec/repo/history/churn/ownership/analyzer/app) green.

- [ ] **Step 11: Commit**

```bash
git add server/src/analyzer.ts server/src/analyzer.test.ts server/src/cache.ts server/src/app.ts server/src/app.test.ts
git commit -m "feat: compose RepoAnalysis via the analyzer and wire the real /api/analyze endpoint"
```

---

### Task 7: Frontend — `RepoPicker`, fetch-based `useRepoAnalysis`, simplified `StatusPanel`, `App.tsx` rewiring

**Files:**
- Create: `src/components/RepoPicker.tsx`, `tests/components/RepoPicker.test.tsx`
- Rewrite: `src/hooks/useRepoAnalysis.ts`, `tests/hooks/useRepoAnalysis.test.ts`, `src/components/StatusPanel.tsx`, `tests/components/StatusPanel.test.tsx`, `src/App.tsx`, `src/main.tsx`
- Modify: `tests/App.test.tsx`

**Interfaces:**
- Produces: `RepoPicker({ onSelect }: { onSelect: (path: string) => void })`; `useRepoAnalysis()` returning `{ status: AnalysisStatus; analyze(repoPath: string, branchOverride?: string): Promise<void> }` where `AnalysisStatus = { phase: 'idle' } | { phase: 'loading' } | { phase: 'done'; analysis: RepoAnalysis } | { phase: 'error'; message: string }`.

This task does NOT delete the old browser-git modules yet (Task 8 does) — it only rewrites the four files above plus `main.tsx`, so `tsc -b` still shows errors in the doomed old modules until Task 8. That is expected.

- [ ] **Step 1: Write the failing `RepoPicker` test**

```tsx
// tests/components/RepoPicker.test.tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/RepoPicker.test.tsx`
Expected: FAIL — `RepoPicker.tsx` does not exist.

- [ ] **Step 3: Implement `src/components/RepoPicker.tsx`**

```tsx
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/RepoPicker.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 5: Rewrite `tests/hooks/useRepoAnalysis.test.ts`**

```ts
// tests/hooks/useRepoAnalysis.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useRepoAnalysis } from '../../src/hooks/useRepoAnalysis'
import type { RepoAnalysis } from '../../shared/types'

const makeAnalysis = (): RepoAnalysis => ({
  repoName: 'demo',
  branch: 'main',
  branches: ['main'],
  headOid: 'abc123',
  commits: [],
  commitStats: [],
  authorTotals: [],
  activity: [],
  commitPatterns: [],
  fileOwnership: [],
  authorOwnership: [],
  mergeInsights: [],
})

describe('useRepoAnalysis', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches /api/analyze and lands on a done state', async () => {
    const analysis = makeAnalysis()
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => analysis,
    } as Response)

    const { result } = renderHook(() => useRepoAnalysis())
    await act(async () => {
      await result.current.analyze('D:\\repo')
    })

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/analyze?path=D%3A%5Crepo'))
    await waitFor(() => expect(result.current.status.phase).toBe('done'))
    if (result.current.status.phase !== 'done') throw new Error('expected done')
    expect(result.current.status.analysis.branch).toBe('main')
  })

  it('includes the branch override in the request', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => makeAnalysis() } as Response)

    const { result } = renderHook(() => useRepoAnalysis())
    await act(async () => {
      await result.current.analyze('D:\\repo', 'dev')
    })

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('branch=dev'))
  })

  it('surfaces a server error message', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Not a git repository: D:\\repo' }),
    } as Response)

    const { result } = renderHook(() => useRepoAnalysis())
    await act(async () => {
      await result.current.analyze('D:\\repo')
    })

    await waitFor(() => expect(result.current.status.phase).toBe('error'))
    if (result.current.status.phase !== 'error') throw new Error('expected error')
    expect(result.current.status.message).toMatch(/not a git repository/i)
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/hooks/useRepoAnalysis.test.ts`
Expected: FAIL — the current hook doesn't call `fetch`.

- [ ] **Step 7: Rewrite `src/hooks/useRepoAnalysis.ts`**

```ts
import { useCallback, useState } from 'react'
import type { RepoAnalysis } from '../../shared/types'

export type AnalysisStatus =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'done'; analysis: RepoAnalysis }
  | { phase: 'error'; message: string }

export function useRepoAnalysis() {
  const [status, setStatus] = useState<AnalysisStatus>({ phase: 'idle' })

  const analyze = useCallback(async (repoPath: string, branchOverride?: string) => {
    setStatus({ phase: 'loading' })
    try {
      const params = new URLSearchParams({ path: repoPath })
      if (branchOverride) params.set('branch', branchOverride)

      const res = await fetch(`/api/analyze?${params.toString()}`)
      const body = await res.json()

      if (!res.ok) {
        throw new Error(body?.error ?? `Request failed with status ${res.status}`)
      }

      setStatus({ phase: 'done', analysis: body as RepoAnalysis })
    } catch (error) {
      console.error('Repo analysis failed:', error)
      setStatus({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }, [])

  return { status, analyze }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/hooks/useRepoAnalysis.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 9: Rewrite `tests/components/StatusPanel.test.tsx`**

```tsx
// tests/components/StatusPanel.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusPanel } from '../../src/components/StatusPanel'
import type { AnalysisStatus } from '../../src/hooks/useRepoAnalysis'

describe('StatusPanel', () => {
  it('shows a loading message while analyzing', () => {
    render(<StatusPanel status={{ phase: 'loading' }} />)
    expect(screen.getByText(/analyzing/i)).toBeInTheDocument()
  })

  it('shows the error message on failure', () => {
    const status: AnalysisStatus = { phase: 'error', message: 'Not a git repository: D:\\repo' }
    render(<StatusPanel status={status} />)
    expect(screen.getByText(/not a git repository/i)).toBeInTheDocument()
  })

  it('renders nothing when idle or done', () => {
    const { container: idle } = render(<StatusPanel status={{ phase: 'idle' }} />)
    expect(idle).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 10: Run test to verify it fails**

Run: `npx vitest run tests/components/StatusPanel.test.tsx`
Expected: FAIL — the current `StatusPanel` has different phases (`reading-repo`, `computing-churn`, etc.).

- [ ] **Step 11: Rewrite `src/components/StatusPanel.tsx`**

```tsx
import type { AnalysisStatus } from '../hooks/useRepoAnalysis'

export function StatusPanel({ status }: { status: AnalysisStatus }) {
  switch (status.phase) {
    case 'loading':
      return <p>Analyzing repository…</p>
    case 'error':
      return <p className="text-red-600">Error: {status.message}</p>
    case 'idle':
    case 'done':
      return null
  }
}
```

- [ ] **Step 12: Run test to verify it passes**

Run: `npx vitest run tests/components/StatusPanel.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 13: Rewrite `src/App.tsx`**

```tsx
import { useMemo, useState } from 'react'
import { RepoPicker } from './components/RepoPicker'
import { StatusPanel } from './components/StatusPanel'
import { OverviewTable } from './components/Dashboard/OverviewTable'
import { ActivityOverTimeChart } from './components/Dashboard/ActivityOverTimeChart'
import { CommitPatternsHeatmap } from './components/Dashboard/CommitPatternsHeatmap'
import { OwnershipView } from './components/Dashboard/OwnershipView'
import { MergeInsightsTable } from './components/Dashboard/MergeInsightsTable'
import { BranchSelector } from './components/BranchSelector'
import { DateRangeFilter } from './components/DateRangeFilter'
import { AuthorFilter } from './components/AuthorFilter'
import { useRepoAnalysis } from './hooks/useRepoAnalysis'
import {
  filterByAuthors,
  filterActivityByDateRange,
  filterCommitStatsByDateRange,
  filterCommitStatsByAuthors,
  type DateRange,
} from './lib/filters'
import { aggregateAuthorTotals, aggregateCommitPatterns } from '../shared/aggregate-churn'

export default function App() {
  const [repoPath, setRepoPath] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState<DateRange>({ start: null, end: null })
  const [selectedAuthors, setSelectedAuthors] = useState<string[]>([])
  const { status, analyze } = useRepoAnalysis()

  const analysis = status.phase === 'done' ? status.analysis : null

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
    }
  }, [analysis, selectedAuthors, dateRange])

  const handleRepoSelected = async (path: string) => {
    setRepoPath(path)
    setSelectedAuthors([])
    setDateRange({ start: null, end: null })
    await analyze(path)
  }

  const handleBranchChange = async (branch: string) => {
    if (repoPath) await analyze(repoPath, branch)
  }

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <h1 className="mb-6 text-2xl font-bold">Git Contribution Dashboard</h1>

      <RepoPicker onSelect={handleRepoSelected} />

      {repoPath && !analysis && <StatusPanel status={status} />}

      {repoPath && analysis && filtered && (
        <div className="mt-6 space-y-6">
          <div className="flex flex-wrap items-center gap-4 rounded bg-white p-4 shadow">
            <BranchSelector
              branches={analysis.branches}
              selected={analysis.branch}
              onChange={handleBranchChange}
            />
            <DateRangeFilter range={dateRange} onChange={setDateRange} />
          </div>
          <AuthorFilter
            allAuthors={analysis.authorTotals.map((a) => a.author)}
            selected={selectedAuthors}
            onChange={setSelectedAuthors}
          />
          <OverviewTable authorTotals={filtered.authorTotals} />
          <ActivityOverTimeChart activity={filtered.activity} />
          <CommitPatternsHeatmap patterns={filtered.commitPatterns} />
          <MergeInsightsTable mergeInsights={analysis.mergeInsights} />
          <OwnershipView
            authorOwnership={analysis.authorOwnership}
            fileOwnership={analysis.fileOwnership}
          />
        </div>
      )}
    </main>
  )
}
```

- [ ] **Step 14: Update `src/main.tsx`** — drop the polyfill import (removed in Task 8, but the import must go now since this task is what stops needing it):

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

- [ ] **Step 15: Fix `tests/App.test.tsx`** (drop the now-irrelevant File System Access mock):

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from '../src/App'

describe('App', () => {
  it('renders the dashboard heading', () => {
    vi.stubGlobal('fetch', vi.fn())
    render(<App />)
    expect(screen.getByText('Git Contribution Dashboard')).toBeInTheDocument()
  })
})
```

- [ ] **Step 16: Run the tests touched in this task**

Run: `npx vitest run tests/components/RepoPicker.test.tsx tests/hooks/useRepoAnalysis.test.ts tests/components/StatusPanel.test.tsx tests/App.test.tsx`
Expected: PASS — all green. (Full `tsc -b`/`npm test` still show errors from the not-yet-deleted old modules; that's Task 8.)

- [ ] **Step 17: Commit**

```bash
git add src/components/RepoPicker.tsx tests/components/RepoPicker.test.tsx src/hooks/useRepoAnalysis.ts tests/hooks/useRepoAnalysis.test.ts src/components/StatusPanel.tsx tests/components/StatusPanel.test.tsx src/App.tsx src/main.tsx tests/App.test.tsx
git commit -m "feat: rewire frontend onto the backend (RepoPicker, fetch-based analysis)"
```

---

### Task 8: Delete the in-browser git layer; remove unused dependencies; full verification; README

**Files:**
- Delete: see the exact list in Step 1.
- Modify: `package.json` (remove unused deps), `README.md`

**Interfaces:**
- Produces: nothing new — this task removes dead code and re-verifies the whole project.

- [ ] **Step 1: Delete every file made obsolete by the backend**

```bash
git rm src/lib/browser-support.ts
git rm src/lib/cache/db.ts
git rm src/lib/concurrency.ts
git rm src/lib/fs-adapter.ts
git rm src/lib/git/aggregate-ownership.ts
git rm src/lib/git/blame.ts
git rm src/lib/git/commit-stats.ts
git rm src/lib/git/history.ts
git rm src/lib/git/identity.ts
git rm src/lib/git/line-diff.ts
git rm src/lib/git/line-text.ts
git rm src/lib/git/repo.ts
git rm src/components/FolderPicker.tsx
git rm src/components/UnsupportedBrowserNotice.tsx
git rm src/polyfills.ts

git rm tests/components/FolderPicker.test.tsx
git rm tests/components/UnsupportedBrowserNotice.test.tsx
git rm tests/fixtures/fakeFileSystemAccess.ts
git rm tests/fixtures/gitFixture.ts
git rm tests/lib/browser-support.test.ts
git rm tests/lib/cache/db.test.ts
git rm tests/lib/concurrency.test.ts
git rm tests/lib/fs-adapter.test.ts
git rm tests/lib/git/aggregate-ownership.test.ts
git rm tests/lib/git/blame-parity.test.ts
git rm tests/lib/git/blame.test.ts
git rm tests/lib/git/commit-stats.test.ts
git rm tests/lib/git/history.test.ts
git rm tests/lib/git/identity.test.ts
git rm tests/lib/git/line-diff.test.ts
git rm tests/lib/git/line-text.test.ts
git rm tests/lib/git/repo.test.ts
git rm tests/polyfills.test.ts
```

(`tests/fixtures/realGitRepo.ts` is KEPT — it's reused by the server tests. `src/lib/git/` and `src/lib/cache/` end up empty and are not tracked by git once empty.)

- [ ] **Step 2: Remove `tests/setup.ts`'s now-unused fake-indexeddb import**

```ts
import '@testing-library/jest-dom'

// Polyfill ResizeObserver for Recharts testing
declare global {
  interface Window {
    ResizeObserver: typeof ResizeObserver
  }
}

if (typeof window !== 'undefined' && !window.ResizeObserver) {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = ResizeObserverPolyfill as any
}
```
(Only the `import 'fake-indexeddb/auto'` line is removed; everything else is unchanged.)

- [ ] **Step 3: Remove now-unused dependencies from `package.json`**

Remove from `dependencies`: `"buffer"`, `"diff"`, `"idb"`, `"isomorphic-git"`.
Remove from `devDependencies`: `"@isomorphic-git/lightning-fs"`, `"@types/diff"`, `"@types/wicg-file-system-access"`, `"fake-indexeddb"`.

Also remove `"@types/wicg-file-system-access"` from `tsconfig.app.json`'s `types` array (it now reads `["vite/client", "node"]`).

Run: `npm install` to refresh the lockfile after removing the dependencies.

- [ ] **Step 4: Full verification**

Run: `npx tsc -b --force`
Expected: zero errors.

Run: `npm test`
Expected: entire suite green (frontend + `shared/` + `server/`).

Run: `npm run build`
Expected: succeeds (Vite frontend build).

- [ ] **Step 5: Manual run check (environment permitting)**

If possible in this environment: `npm run dev`, open the printed URL, paste a real local repo path, confirm the dashboard renders with data from the real backend. Then Ctrl+C. If a full manual click-through isn't possible here, note it as an outstanding item for the user.

- [ ] **Step 6: Update `README.md`**

Rewrite the "Local development" and "Testing"/"Deploying" sections to match the new architecture:
```markdown
## Requirements

- Node.js 18+
- `git` available on your PATH

## Local development

```bash
npm install
npm run dev
```

This starts the Vite dev server (frontend) and the local Express backend
together. Open the printed URL, paste the path to a local git repository you
have a clone of (ownership doesn't matter — your local clone has the full
history), and click Analyze.

## Running it for real use

```bash
npm install
npm run build
npm start
```

`npm start` serves the built frontend and the API from one local process at
`http://127.0.0.1:3001`.

## Testing

```bash
npm test
```

## Architecture

This is a fully local tool: a small Express backend (`server/`) shells out to
your real `git` binary to read repo history, diffs, and blame — no data ever
leaves your machine, and there's no hosted/shared version. `shared/` holds
the types and aggregation logic used by both the backend and the React
dashboard (`src/`).
```
(Adjust wording to fit whatever the README currently contains around these sections; keep any unrelated existing content, such as the design-doc pointer, intact.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: remove the in-browser git layer now that the backend replaces it"
```
