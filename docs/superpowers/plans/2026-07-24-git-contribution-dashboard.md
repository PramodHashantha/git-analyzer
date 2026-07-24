# Git Contribution Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully client-side web dashboard (hosted on Vercel) that analyzes a locally-selected git repo folder — contribution totals, activity trends, commit patterns, and current line ownership — replacing the original PowerShell script.

**Architecture:** Vite + React + TypeScript SPA with no backend. The browser's File System Access API supplies a folder handle, a custom read-only adapter bridges that handle to isomorphic-git's expected fs interface, and isomorphic-git walks commit history / reads blobs entirely in-browser. Results are cached in IndexedDB keyed by repo + branch head commit.

**Tech Stack:** React 18, TypeScript (strict), Vite 5, Tailwind CSS v4, isomorphic-git, `diff` (jsdiff), `idb`, `date-fns`, Recharts, Vitest + Testing Library, `@isomorphic-git/lightning-fs` (test fixtures only).

## Global Constraints

- Chromium-only browser support (Chrome/Edge) — File System Access API has no Firefox/Safari equivalent. Every task touching browser APIs must account for this; no polyfill attempts.
- No backend/server code of any kind — this is a static site deployed to Vercel.
- TypeScript strict mode across `src/` and `tests/`.
- First-parent-only simplification for both diff stats (commit-stats.ts) and blame (blame.ts) — documented, deliberate, consistent across both modules. Do not special-case merge commits differently between them.
- All git-reading modules (`repo.ts`, `history.ts`, `line-diff.ts`, `commit-stats.ts`, `blame.ts`, `aggregate-ownership.ts`) take a shared `RepoContext` (`{ fs, dir, gitdir }`, defined in `src/lib/git/repo.ts`) rather than separate `fs`/`dir`/`gitdir` params — this keeps them testable against fixture repos mounted at any path, not just `/`.
- Repo scale target is small/medium (per spec): eager whole-repo blame on load is acceptable; no lazy per-file blame in this plan.
- Every module under `src/lib/` must be a pure-function or class module with no React dependency, so it can be unit-tested with Vitest without a browser.
- Progress is surfaced live during the churn and ownership passes (`StatusPanel`, Task 13), but this plan does not implement a cancel button for an in-progress analysis — true cancellation would require threading an abort signal through every async loop in Tasks 7, 9, and 10. Given the confirmed small/medium repo scale, this is a deliberate v1 scope cut, not an oversight; revisit only if large-repo support is added later.

---

## File Structure Overview

```
git-analyser/
  vercel.json
  index.html
  vite.config.ts
  tsconfig.json / tsconfig.app.json / tsconfig.node.json
  package.json
  src/
    main.tsx
    App.tsx
    index.css
    lib/
      browser-support.ts
      fs-adapter.ts
      filters.ts
      directory-rollup.ts
      types.ts
      git/
        repo.ts
        history.ts
        line-diff.ts
        commit-stats.ts
        blame.ts
        aggregate-churn.ts
        aggregate-merges.ts
        aggregate-ownership.ts
      cache/
        db.ts
    hooks/
      useRepoAnalysis.ts
    components/
      FolderPicker.tsx
      UnsupportedBrowserNotice.tsx
      StatusPanel.tsx
      BranchSelector.tsx
      DateRangeFilter.tsx
      AuthorFilter.tsx
      Dashboard/
        OverviewTable.tsx
        ActivityOverTimeChart.tsx
        CommitPatternsHeatmap.tsx
        OwnershipView.tsx
  tests/
    setup.ts
    App.test.tsx
    fixtures/
      gitFixture.ts
      fakeFileSystemAccess.ts
    lib/
      fs-adapter.test.ts
      filters.test.ts
      directory-rollup.test.ts
      git/
        repo.test.ts
        history.test.ts
        line-diff.test.ts
        commit-stats.test.ts
        blame.test.ts
        aggregate-churn.test.ts
        aggregate-merges.test.ts
        aggregate-ownership.test.ts
      cache/
        db.test.ts
    components/
      Dashboard/
        OverviewTable.test.tsx
```

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `index.html`, `.gitignore`
- Create: `src/main.tsx`, `src/App.tsx`, `src/index.css`
- Test: `tests/setup.ts`, `tests/App.test.tsx`

**Interfaces:**
- Produces: `App` default export (`src/App.tsx`) — a React component every later App.tsx rewrite (Task 13, Task 16) replaces in place; `npm test`, `npm run dev`, `npm run build` scripts.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "git-analyser",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "isomorphic-git": "^1.27.1",
    "diff": "^5.2.0",
    "idb": "^8.0.0",
    "date-fns": "^3.6.0",
    "recharts": "^2.12.7"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@types/diff": "^5.2.1",
    "@types/wicg-file-system-access": "^2023.10.5",
    "@vitejs/plugin-react": "^4.3.1",
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.4.8",
    "@isomorphic-git/lightning-fs": "^4.6.2",
    "typescript": "^5.5.4",
    "vite": "^5.4.0",
    "vitest": "^2.0.5",
    "jsdom": "^24.1.1",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0"
  }
}
```

- [ ] **Step 2: Create `vite.config.ts`**

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
})
```

- [ ] **Step 3: Create `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`**

`tsconfig.json`:
```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

`tsconfig.app.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "types": ["@types/wicg-file-system-access", "vite/client"]
  },
  "include": ["src", "tests"]
}
```

`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Git Contribution Dashboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `src/main.tsx`, `src/App.tsx`, `src/index.css`**

`src/main.tsx`:
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

`src/App.tsx`:
```tsx
export default function App() {
  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <h1 className="text-2xl font-bold">Git Contribution Dashboard</h1>
    </main>
  )
}
```

`src/index.css`:
```css
@import "tailwindcss";
```

- [ ] **Step 6: Create `.gitignore`**

```
node_modules
dist
.vercel
*.local
```

- [ ] **Step 7: Write the failing smoke test**

`tests/setup.ts`:
```ts
import '@testing-library/jest-dom'
```

`tests/App.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../src/App'

describe('App', () => {
  it('renders the dashboard heading', () => {
    render(<App />)
    expect(screen.getByText('Git Contribution Dashboard')).toBeInTheDocument()
  })
})
```

- [ ] **Step 8: Install dependencies and run the test**

Run: `npm install && npm test`
Expected: 1 test file, 1 test, PASS.

- [ ] **Step 9: Verify dev server starts**

Run: `npm run dev` (then Ctrl+C once it prints a local URL)
Expected: Vite prints a `Local:` URL with no errors.

- [ ] **Step 10: Commit**

```bash
git add package.json vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json index.html .gitignore src tests package-lock.json
git commit -m "chore: scaffold Vite + React + TS project with Tailwind and Vitest"
```

---

### Task 2: Shared types and browser-support detection

**Files:**
- Create: `src/lib/types.ts`, `src/lib/browser-support.ts`
- Test: `tests/lib/browser-support.test.ts`

**Interfaces:**
- Produces: every type in `src/lib/types.ts` (`CommitInfo`, `FileLineStats`, `CommitStats`, `AuthorTotals`, `ActivityBucket`, `CommitPatternSummary`, `FileOwnership`, `AuthorOwnership`, `BranchMergeInsights`, `RepoAnalysis`) — every later task imports from here, field names are final and must not drift. `isFileSystemAccessSupported(): boolean` from `browser-support.ts`.

- [ ] **Step 1: Create `src/lib/types.ts`**

```ts
export interface CommitInfo {
  oid: string
  parentOids: string[]
  author: string
  email: string
  timestamp: number
  message: string
  isMerge: boolean
}

export interface FileLineStats {
  filepath: string
  added: number
  deleted: number
}

export interface CommitStats {
  commit: CommitInfo
  files: FileLineStats[]
  totalAdded: number
  totalDeleted: number
}

export interface AuthorTotals {
  author: string
  commits: number
  added: number
  deleted: number
  net: number
}

export interface ActivityBucket {
  bucketStart: number
  author: string
  commits: number
  added: number
  deleted: number
}

export interface CommitPatternSummary {
  author: string
  avgLinesPerCommit: number
  largestCommit: { oid: string; lines: number }
  dayOfWeekCounts: number[]
  hourOfDayCounts: number[]
}

export interface FileOwnership {
  filepath: string
  totalLines: number
  ownerLineCounts: Record<string, number>
}

export interface AuthorOwnership {
  author: string
  linesOwned: number
  percentage: number
}

export interface BranchMergeInsights {
  author: string
  mergeCommits: number
}

export interface RepoAnalysis {
  repoName: string
  branch: string
  branches: string[]
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

- [ ] **Step 2: Write the failing test for browser support detection**

```ts
// tests/lib/browser-support.test.ts
import { describe, expect, it, vi, afterEach } from 'vitest'
import { isFileSystemAccessSupported } from '../../src/lib/browser-support'

describe('isFileSystemAccessSupported', () => {
  afterEach(() => {
    // @ts-expect-error test cleanup
    delete window.showDirectoryPicker
  })

  it('returns false when showDirectoryPicker is absent', () => {
    expect(isFileSystemAccessSupported()).toBe(false)
  })

  it('returns true when showDirectoryPicker is present', () => {
    // @ts-expect-error test stub
    window.showDirectoryPicker = vi.fn()
    expect(isFileSystemAccessSupported()).toBe(true)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/lib/browser-support.test.ts`
Expected: FAIL — `browser-support.ts` does not exist.

- [ ] **Step 4: Implement `src/lib/browser-support.ts`**

```ts
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/lib/browser-support.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/browser-support.ts tests/lib/browser-support.test.ts
git commit -m "feat: add shared analysis types and browser-support detection"
```

---

### Task 3: File System Access → isomorphic-git fs adapter

**Files:**
- Create: `src/lib/fs-adapter.ts`
- Test: `tests/fixtures/fakeFileSystemAccess.ts`, `tests/lib/fs-adapter.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `createFsAdapter(root: FileSystemDirectoryHandle): PromiseFsClient` and `ReadOnlyFileSystemError` — every git-reading module from Task 4 onward receives the object this returns as their `fs`.

- [ ] **Step 1: Create the fake File System Access test double**

```ts
// tests/fixtures/fakeFileSystemAccess.ts
type FakeTree = { [name: string]: string | FakeTree }

class FakeFileHandle {
  kind = 'file' as const
  constructor(private contents: string) {}
  async getFile() {
    const bytes = new TextEncoder().encode(this.contents)
    return {
      size: bytes.byteLength,
      lastModified: 0,
      async arrayBuffer() {
        return bytes.buffer
      },
    } as unknown as File
  }
}

class FakeDirectoryHandle {
  kind = 'directory' as const
  constructor(private tree: FakeTree) {}

  async getFileHandle(name: string): Promise<FakeFileHandle> {
    const entry = this.tree[name]
    if (typeof entry !== 'string') throw new DOMException('Not a file', 'NotFoundError')
    return new FakeFileHandle(entry)
  }

  async getDirectoryHandle(name: string): Promise<FakeDirectoryHandle> {
    const entry = this.tree[name]
    if (typeof entry !== 'object' || entry === null) {
      throw new DOMException('Not a directory', 'NotFoundError')
    }
    return new FakeDirectoryHandle(entry)
  }

  async *keys() {
    for (const name of Object.keys(this.tree)) yield name
  }
}

export function makeFakeRoot(tree: FakeTree): FileSystemDirectoryHandle {
  return new FakeDirectoryHandle(tree) as unknown as FileSystemDirectoryHandle
}
```

- [ ] **Step 2: Write the failing adapter test**

```ts
// tests/lib/fs-adapter.test.ts
import { describe, expect, it } from 'vitest'
import { createFsAdapter, ReadOnlyFileSystemError } from '../../src/lib/fs-adapter'
import { makeFakeRoot } from '../fixtures/fakeFileSystemAccess'

describe('createFsAdapter', () => {
  const root = makeFakeRoot({
    '.git': { HEAD: 'ref: refs/heads/main\n' },
    src: { 'index.ts': "console.log('hi')\n" },
  })

  it('reads a nested file as utf8 text', async () => {
    const fs = createFsAdapter(root)
    const contents = await fs.promises.readFile('/src/index.ts', { encoding: 'utf8' })
    expect(contents).toBe("console.log('hi')\n")
  })

  it('lists directory entries', async () => {
    const fs = createFsAdapter(root)
    const names = await fs.promises.readdir('/')
    expect(names.sort()).toEqual(['.git', 'src'])
  })

  it('reports file vs directory via stat', async () => {
    const fs = createFsAdapter(root)
    const fileStat = await fs.promises.stat('/src/index.ts')
    expect(fileStat.isFile()).toBe(true)

    const dirStat = await fs.promises.stat('/src')
    expect(dirStat.isDirectory()).toBe(true)
  })

  it('rejects writes as read-only', async () => {
    const fs = createFsAdapter(root)
    await expect(fs.promises.writeFile('/src/index.ts', 'x')).rejects.toBeInstanceOf(
      ReadOnlyFileSystemError
    )
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/lib/fs-adapter.test.ts`
Expected: FAIL — `src/lib/fs-adapter.ts` does not exist.

- [ ] **Step 4: Implement `src/lib/fs-adapter.ts`**

```ts
import type { PromiseFsClient } from 'isomorphic-git'

export interface Stat {
  type: 'file' | 'dir'
  mode: number
  size: number
  ino: number
  mtimeMs: number
  ctimeMs: number
  uid: number
  gid: number
  dev: number
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

function makeStat(partial: Omit<Stat, 'isFile' | 'isDirectory' | 'isSymbolicLink'>): Stat {
  return {
    ...partial,
    isFile: () => partial.type === 'file',
    isDirectory: () => partial.type === 'dir',
    isSymbolicLink: () => false,
  }
}

export class ReadOnlyFileSystemError extends Error {}

function splitPath(filepath: string): string[] {
  return filepath.split('/').filter(Boolean)
}

export function createFsAdapter(root: FileSystemDirectoryHandle): PromiseFsClient {
  async function resolveDir(segments: string[]): Promise<FileSystemDirectoryHandle> {
    let dir = root
    for (const segment of segments) {
      dir = await dir.getDirectoryHandle(segment)
    }
    return dir
  }

  async function getFileHandle(filepath: string): Promise<FileSystemFileHandle> {
    const segments = splitPath(filepath)
    const parent = await resolveDir(segments.slice(0, -1))
    return parent.getFileHandle(segments[segments.length - 1])
  }

  async function readFile(filepath: string, opts?: { encoding?: string } | string) {
    const handle = await getFileHandle(filepath)
    const file = await handle.getFile()
    const buffer = new Uint8Array(await file.arrayBuffer())
    const encoding = typeof opts === 'string' ? opts : opts?.encoding
    if (encoding === 'utf8') return new TextDecoder().decode(buffer)
    return buffer
  }

  async function readdir(filepath: string): Promise<string[]> {
    const segments = splitPath(filepath)
    const dir = segments.length ? await resolveDir(segments) : root
    const names: string[] = []
    for await (const name of dir.keys()) names.push(name)
    return names
  }

  async function stat(filepath: string): Promise<Stat> {
    const segments = splitPath(filepath)
    if (segments.length === 0) {
      return makeStat({
        type: 'dir', mode: 0o040000, size: 0, ino: 0, mtimeMs: 0, ctimeMs: 0, uid: 1, gid: 1, dev: 1,
      })
    }
    const parent = await resolveDir(segments.slice(0, -1))
    const name = segments[segments.length - 1]
    try {
      const fileHandle = await parent.getFileHandle(name)
      const file = await fileHandle.getFile()
      return makeStat({
        type: 'file', mode: 0o100644, size: file.size, ino: 0,
        mtimeMs: file.lastModified, ctimeMs: file.lastModified, uid: 1, gid: 1, dev: 1,
      })
    } catch {
      await parent.getDirectoryHandle(name)
      return makeStat({
        type: 'dir', mode: 0o040000, size: 0, ino: 0, mtimeMs: 0, ctimeMs: 0, uid: 1, gid: 1, dev: 1,
      })
    }
  }

  function readOnly(op: string) {
    return async () => {
      throw new ReadOnlyFileSystemError(`Read-only filesystem: ${op} is not supported`)
    }
  }

  return {
    promises: {
      readFile,
      readdir,
      stat,
      lstat: stat,
      writeFile: readOnly('writeFile'),
      unlink: readOnly('unlink'),
      mkdir: readOnly('mkdir'),
      rmdir: readOnly('rmdir'),
      readlink: readOnly('readlink'),
      symlink: readOnly('symlink'),
    },
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/lib/fs-adapter.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/fs-adapter.ts tests/fixtures/fakeFileSystemAccess.ts tests/lib/fs-adapter.test.ts
git commit -m "feat: add File System Access to isomorphic-git fs adapter"
```

---

### Task 4: Git fixture builder and `repo.ts`

**Files:**
- Create: `tests/fixtures/gitFixture.ts`
- Create: `src/lib/git/repo.ts`
- Test: `tests/lib/git/repo.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (uses `@isomorphic-git/lightning-fs` directly, not the Task 3 adapter — the adapter is browser-only and untestable against a real git ODB; every later git-logic task tests against this same fixture builder instead).
- Produces: `buildFixtureRepo(name, commits): Promise<{ fs, dir, gitdir, headOid }>` — used by every remaining `tests/lib/git/*.test.ts`. `RepoContext` type, `makeRepoContext(fs, dir): RepoContext`, `assertIsGitRepo(fs, dir): Promise<void>`, `NotAGitRepoError`, `listBranches(ctx): Promise<string[]>`, `resolveBranchHead(ctx, branch): Promise<string>`, `getCurrentBranch(ctx): Promise<string | undefined>` — every module from Task 5 onward takes a `RepoContext` as its first argument.

- [ ] **Step 1: Create the fixture repo builder**

```ts
// tests/fixtures/gitFixture.ts
import * as git from 'isomorphic-git'
import LightningFS from '@isomorphic-git/lightning-fs'

export interface FixtureCommit {
  message: string
  author: { name: string; email: string }
  files: Record<string, string | null>
  timestampSeconds?: number
}

export async function buildFixtureRepo(name: string, commits: FixtureCommit[]) {
  const fsInstance = new LightningFS(name)
  const fs = fsInstance
  const dir = '/repo'
  const gitdir = '/repo/.git'

  await fs.promises.mkdir(dir)
  await git.init({ fs, dir, gitdir, defaultBranch: 'main' })

  let headOid = ''
  for (const commit of commits) {
    for (const [filepath, contents] of Object.entries(commit.files)) {
      const fullPath = `${dir}/${filepath}`
      if (contents === null) {
        await fs.promises.unlink(fullPath)
        await git.remove({ fs, dir, gitdir, filepath })
        continue
      }

      const segments = filepath.split('/')
      let current = dir
      for (const segment of segments.slice(0, -1)) {
        current = `${current}/${segment}`
        try {
          await fs.promises.mkdir(current)
        } catch {
          // already exists
        }
      }
      await fs.promises.writeFile(fullPath, contents, 'utf8')
      await git.add({ fs, dir, gitdir, filepath })
    }

    headOid = await git.commit({
      fs,
      dir,
      gitdir,
      message: commit.message,
      author: {
        name: commit.author.name,
        email: commit.author.email,
        timestamp: commit.timestampSeconds ?? Math.floor(Date.now() / 1000),
      },
    })
  }

  return { fs, dir, gitdir, headOid }
}
```

- [ ] **Step 2: Write the failing `repo.ts` test**

```ts
// tests/lib/git/repo.test.ts
import { describe, expect, it } from 'vitest'
import LightningFS from '@isomorphic-git/lightning-fs'
import { buildFixtureRepo } from '../../fixtures/gitFixture'
import {
  assertIsGitRepo,
  makeRepoContext,
  listBranches,
  resolveBranchHead,
  getCurrentBranch,
  NotAGitRepoError,
} from '../../../src/lib/git/repo'

describe('repo', () => {
  it('resolves the current branch and its head commit', async () => {
    const { fs, dir } = await buildFixtureRepo('repo-test-1', [
      {
        message: 'first commit',
        author: { name: 'Alice', email: 'alice@example.com' },
        files: { 'a.txt': 'hello\n' },
      },
    ])

    await assertIsGitRepo(fs, dir)
    const ctx = makeRepoContext(fs, dir)

    expect(await getCurrentBranch(ctx)).toBe('main')
    expect(await listBranches(ctx)).toContain('main')
    expect(await resolveBranchHead(ctx, 'main')).toMatch(/^[0-9a-f]{40}$/)
  })

  it('throws NotAGitRepoError for a folder without .git', async () => {
    const fs = new LightningFS('repo-test-2')
    await fs.promises.mkdir('/plain')
    await expect(assertIsGitRepo(fs, '/plain')).rejects.toBeInstanceOf(NotAGitRepoError)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/lib/git/repo.test.ts`
Expected: FAIL — `src/lib/git/repo.ts` does not exist.

- [ ] **Step 4: Implement `src/lib/git/repo.ts`**

```ts
import * as git from 'isomorphic-git'
import type { PromiseFsClient } from 'isomorphic-git'

export interface RepoContext {
  fs: PromiseFsClient
  dir: string
  gitdir: string
}

export class NotAGitRepoError extends Error {}

function joinPath(dir: string, ...parts: string[]): string {
  const base = dir.endsWith('/') ? dir.slice(0, -1) : dir
  return [base, ...parts].join('/')
}

export async function assertIsGitRepo(fs: PromiseFsClient, dir: string): Promise<void> {
  try {
    await fs.promises.stat(joinPath(dir, '.git'))
  } catch {
    throw new NotAGitRepoError('No .git directory found in the selected folder')
  }
}

export function makeRepoContext(fs: PromiseFsClient, dir: string): RepoContext {
  return { fs, dir, gitdir: joinPath(dir, '.git') }
}

export async function listBranches(ctx: RepoContext): Promise<string[]> {
  return git.listBranches({ fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir })
}

export async function resolveBranchHead(ctx: RepoContext, branch: string): Promise<string> {
  return git.resolveRef({ fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, ref: branch })
}

export async function getCurrentBranch(ctx: RepoContext): Promise<string | undefined> {
  const branch = await git.currentBranch({
    fs: ctx.fs,
    dir: ctx.dir,
    gitdir: ctx.gitdir,
    fullname: false,
  })
  return branch ?? undefined
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/lib/git/repo.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/gitFixture.ts src/lib/git/repo.ts tests/lib/git/repo.test.ts
git commit -m "feat: add repo.ts (branch/HEAD resolution) and fixture repo builder"
```

---

### Task 5: Commit history walk (`history.ts`)

**Files:**
- Create: `src/lib/git/history.ts`
- Test: `tests/lib/git/history.test.ts`

**Interfaces:**
- Consumes: `RepoContext` and `buildFixtureRepo` from Task 4; `CommitInfo` from Task 2.
- Produces: `walkHistory(ctx: RepoContext, branch: string): Promise<CommitInfo[]>` (newest-first) — consumed by `commit-stats.ts` (Task 7), `aggregate-churn.ts`/`aggregate-merges.ts` (Task 8), and `useRepoAnalysis` (Task 12).

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/git/history.test.ts
import { describe, expect, it } from 'vitest'
import { buildFixtureRepo } from '../../fixtures/gitFixture'
import { makeRepoContext } from '../../../src/lib/git/repo'
import { walkHistory } from '../../../src/lib/git/history'

describe('walkHistory', () => {
  it('returns commits newest-first with author and merge info', async () => {
    const { fs, dir } = await buildFixtureRepo('history-test-1', [
      {
        message: 'first',
        author: { name: 'Alice', email: 'alice@example.com' },
        files: { 'a.txt': 'one\n' },
        timestampSeconds: 1000,
      },
      {
        message: 'second',
        author: { name: 'Bob', email: 'bob@example.com' },
        files: { 'a.txt': 'one\ntwo\n' },
        timestampSeconds: 2000,
      },
    ])

    const ctx = makeRepoContext(fs, dir)
    const commits = await walkHistory(ctx, 'main')

    expect(commits).toHaveLength(2)
    expect(commits[0].message).toBe('second')
    expect(commits[0].author).toBe('Bob')
    expect(commits[0].isMerge).toBe(false)
    expect(commits[1].message).toBe('first')
    expect(commits[1].parentOids).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/git/history.test.ts`
Expected: FAIL — `src/lib/git/history.ts` does not exist.

- [ ] **Step 3: Implement `src/lib/git/history.ts`**

```ts
import * as git from 'isomorphic-git'
import type { CommitInfo } from '../types'
import type { RepoContext } from './repo'

export async function walkHistory(ctx: RepoContext, branch: string): Promise<CommitInfo[]> {
  const oid = await git.resolveRef({ fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, ref: branch })
  const log = await git.log({ fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, ref: oid })

  return log.map((entry) => ({
    oid: entry.oid,
    parentOids: entry.commit.parent,
    author: entry.commit.author.name,
    email: entry.commit.author.email,
    timestamp: entry.commit.author.timestamp,
    message: entry.commit.message.trim(),
    isMerge: entry.commit.parent.length > 1,
  }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/git/history.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/git/history.ts tests/lib/git/history.test.ts
git commit -m "feat: add commit history walk"
```

---

### Task 6: Tree diff and line-count diff (`line-diff.ts`)

**Files:**
- Create: `src/lib/git/line-diff.ts`
- Test: `tests/lib/git/line-diff.test.ts`

**Interfaces:**
- Consumes: `RepoContext` from Task 4.
- Produces: `ChangedFile` type, `listChangedFiles(ctx, commitOid, parentOid): Promise<ChangedFile[]>`, `countLineChanges(beforeText, afterText): { added: number; deleted: number }` — both consumed by `commit-stats.ts` (Task 7).

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/git/line-diff.test.ts
import { describe, expect, it } from 'vitest'
import { buildFixtureRepo } from '../../fixtures/gitFixture'
import { makeRepoContext } from '../../../src/lib/git/repo'
import { walkHistory } from '../../../src/lib/git/history'
import { listChangedFiles, countLineChanges } from '../../../src/lib/git/line-diff'

describe('listChangedFiles', () => {
  it('detects the added file in the root commit and the modified file after', async () => {
    const { fs, dir } = await buildFixtureRepo('line-diff-test-1', [
      {
        message: 'first',
        author: { name: 'Alice', email: 'alice@example.com' },
        files: { 'a.txt': 'one\n', 'b.txt': 'x\n' },
      },
      {
        message: 'second',
        author: { name: 'Alice', email: 'alice@example.com' },
        files: { 'a.txt': 'one\ntwo\n' },
      },
    ])

    const ctx = makeRepoContext(fs, dir)
    const commits = await walkHistory(ctx, 'main')

    const rootChanges = await listChangedFiles(ctx, commits[1].oid, null)
    expect(rootChanges.map((c) => c.filepath).sort()).toEqual(['a.txt', 'b.txt'])

    const secondChanges = await listChangedFiles(ctx, commits[0].oid, commits[1].oid)
    expect(secondChanges.map((c) => c.filepath)).toEqual(['a.txt'])
  })
})

describe('countLineChanges', () => {
  it('counts added and deleted lines', () => {
    const result = countLineChanges('one\n', 'one\ntwo\n')
    expect(result).toEqual({ added: 1, deleted: 0 })
  })

  it('counts a full replacement as delete + add', () => {
    const result = countLineChanges('one\n', 'two\n')
    expect(result).toEqual({ added: 1, deleted: 1 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/git/line-diff.test.ts`
Expected: FAIL — `src/lib/git/line-diff.ts` does not exist.

- [ ] **Step 3: Implement `src/lib/git/line-diff.ts`**

```ts
import * as git from 'isomorphic-git'
import { diffLines, type Change } from 'diff'
import type { RepoContext } from './repo'

export interface ChangedFile {
  filepath: string
  beforeOid: string | null
  afterOid: string | null
}

export async function listChangedFiles(
  ctx: RepoContext,
  commitOid: string,
  parentOid: string | null
): Promise<ChangedFile[]> {
  const trees = parentOid
    ? [git.TREE({ ref: parentOid }), git.TREE({ ref: commitOid })]
    : [git.TREE({ ref: commitOid })]

  const results: ChangedFile[] = []

  await git.walk({
    fs: ctx.fs,
    dir: ctx.dir,
    gitdir: ctx.gitdir,
    trees,
    map: async (filepath, entries) => {
      if (filepath === '.') return
      const [beforeEntry, afterEntry] = parentOid ? entries : [undefined, entries[0]]
      const beforeType = beforeEntry ? await beforeEntry.type() : undefined
      const afterType = afterEntry ? await afterEntry.type() : undefined
      // Skip trees and anything that isn't a plain blob (e.g. mode-160000
      // submodule entries report type 'commit') so a submodule reference
      // never reaches readBlob and throws.
      const presentTypes = [beforeType, afterType].filter((t): t is string => t !== undefined)
      if (presentTypes.some((t) => t !== 'blob')) return

      const beforeOid = beforeEntry ? await beforeEntry.oid() : null
      const afterOid = afterEntry ? await afterEntry.oid() : null
      if (beforeOid === afterOid) return

      results.push({ filepath, beforeOid, afterOid })
    },
  })

  return results
}

export function countLineChanges(beforeText: string, afterText: string) {
  const parts: Change[] = diffLines(beforeText, afterText)
  let added = 0
  let deleted = 0
  for (const part of parts) {
    const lineCount = part.count ?? 0
    if (part.added) added += lineCount
    else if (part.removed) deleted += lineCount
  }
  return { added, deleted }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/git/line-diff.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/git/line-diff.ts tests/lib/git/line-diff.test.ts
git commit -m "feat: add tree diff and line-count diff helpers"
```

---

### Task 7: Per-commit line stats (`commit-stats.ts`)

**Files:**
- Create: `src/lib/git/commit-stats.ts`
- Test: `tests/lib/git/commit-stats.test.ts`

**Interfaces:**
- Consumes: `CommitInfo` (Task 2), `RepoContext` (Task 4), `listChangedFiles`/`countLineChanges` (Task 6).
- Produces: `computeCommitStats(ctx, commit): Promise<CommitStats>`, `computeAllCommitStats(ctx, commits, onProgress?): Promise<CommitStats[]>` — consumed by `aggregate-churn.ts` (Task 8) and `useRepoAnalysis` (Task 12).

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/git/commit-stats.test.ts
import { describe, expect, it } from 'vitest'
import { buildFixtureRepo } from '../../fixtures/gitFixture'
import { makeRepoContext } from '../../../src/lib/git/repo'
import { walkHistory } from '../../../src/lib/git/history'
import { computeAllCommitStats } from '../../../src/lib/git/commit-stats'

describe('computeAllCommitStats', () => {
  it('reports added/deleted lines per commit, newest first', async () => {
    const { fs, dir } = await buildFixtureRepo('commit-stats-test-1', [
      {
        message: 'first',
        author: { name: 'Alice', email: 'alice@example.com' },
        files: { 'a.txt': 'one\n' },
      },
      {
        message: 'second',
        author: { name: 'Bob', email: 'bob@example.com' },
        files: { 'a.txt': 'one\ntwo\nthree\n' },
      },
    ])

    const ctx = makeRepoContext(fs, dir)
    const commits = await walkHistory(ctx, 'main')
    const stats = await computeAllCommitStats(ctx, commits)

    expect(stats).toHaveLength(2)
    expect(stats[0].commit.message).toBe('second')
    expect(stats[0].totalAdded).toBe(2)
    expect(stats[0].totalDeleted).toBe(0)
    expect(stats[1].totalAdded).toBe(1)
  })

  it('reports progress as it goes', async () => {
    const { fs, dir } = await buildFixtureRepo('commit-stats-test-2', [
      { message: 'only', author: { name: 'Alice', email: 'a@example.com' }, files: { 'a.txt': 'x\n' } },
    ])
    const ctx = makeRepoContext(fs, dir)
    const commits = await walkHistory(ctx, 'main')

    const progress: Array<{ done: number; total: number }> = []
    await computeAllCommitStats(ctx, commits, (done, total) => progress.push({ done, total }))

    expect(progress).toEqual([{ done: 1, total: 1 }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/git/commit-stats.test.ts`
Expected: FAIL — `src/lib/git/commit-stats.ts` does not exist.

- [ ] **Step 3: Implement `src/lib/git/commit-stats.ts`**

```ts
import * as git from 'isomorphic-git'
import type { CommitInfo, CommitStats, FileLineStats } from '../types'
import type { RepoContext } from './repo'
import { listChangedFiles, countLineChanges } from './line-diff'

const decoder = new TextDecoder('utf-8', { fatal: false })

async function readBlobText(ctx: RepoContext, oid: string): Promise<string> {
  const { blob } = await git.readBlob({ fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, oid })
  return decoder.decode(blob)
}

function isBinary(text: string): boolean {
  return text.includes(String.fromCharCode(0))
}

/**
 * Diffs against the first parent only (merge commits are not diffed against
 * every parent) — the same simplification blame.ts uses, so churn and
 * ownership stay consistent with each other for merge-heavy histories.
 */
export async function computeCommitStats(ctx: RepoContext, commit: CommitInfo): Promise<CommitStats> {
  const parentOid = commit.parentOids[0] ?? null
  const changedFiles = await listChangedFiles(ctx, commit.oid, parentOid)

  const files: FileLineStats[] = []
  for (const change of changedFiles) {
    const beforeText = change.beforeOid ? await readBlobText(ctx, change.beforeOid) : ''
    const afterText = change.afterOid ? await readBlobText(ctx, change.afterOid) : ''
    if (isBinary(beforeText) || isBinary(afterText)) continue

    const { added, deleted } = countLineChanges(beforeText, afterText)
    files.push({ filepath: change.filepath, added, deleted })
  }

  return {
    commit,
    files,
    totalAdded: files.reduce((sum, f) => sum + f.added, 0),
    totalDeleted: files.reduce((sum, f) => sum + f.deleted, 0),
  }
}

export async function computeAllCommitStats(
  ctx: RepoContext,
  commits: CommitInfo[],
  onProgress?: (done: number, total: number) => void
): Promise<CommitStats[]> {
  const results: CommitStats[] = []
  for (let i = 0; i < commits.length; i++) {
    results.push(await computeCommitStats(ctx, commits[i]))
    onProgress?.(i + 1, commits.length)
  }
  return results
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/git/commit-stats.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/git/commit-stats.ts tests/lib/git/commit-stats.test.ts
git commit -m "feat: compute per-commit added/deleted line stats"
```

---

### Task 8: Churn and merge aggregation

**Files:**
- Create: `src/lib/git/aggregate-churn.ts`, `src/lib/git/aggregate-merges.ts`
- Test: `tests/lib/git/aggregate-churn.test.ts`, `tests/lib/git/aggregate-merges.test.ts`

**Interfaces:**
- Consumes: `CommitStats`, `CommitInfo`, `AuthorTotals`, `ActivityBucket`, `CommitPatternSummary`, `BranchMergeInsights` (all from Task 2's `types.ts`).
- Produces: `aggregateAuthorTotals(commitStats): AuthorTotals[]`, `aggregateActivityOverTime(commitStats, granularity): ActivityBucket[]`, `aggregateCommitPatterns(commitStats): CommitPatternSummary[]`, `aggregateMergeInsights(commits): BranchMergeInsights[]` — all consumed by `useRepoAnalysis` (Task 12).

- [ ] **Step 1: Write the failing churn aggregation test**

```ts
// tests/lib/git/aggregate-churn.test.ts
import { describe, expect, it } from 'vitest'
import type { CommitStats } from '../../../src/lib/types'
import {
  aggregateAuthorTotals,
  aggregateActivityOverTime,
  aggregateCommitPatterns,
} from '../../../src/lib/git/aggregate-churn'

function makeStat(overrides: Partial<CommitStats['commit']> & { totalAdded: number; totalDeleted: number }): CommitStats {
  return {
    commit: {
      oid: overrides.oid ?? 'oid1',
      parentOids: [],
      author: overrides.author ?? 'Alice',
      email: overrides.email ?? 'alice@example.com',
      timestamp: overrides.timestamp ?? 1700000000,
      message: overrides.message ?? 'msg',
      isMerge: overrides.isMerge ?? false,
    },
    files: [],
    totalAdded: overrides.totalAdded,
    totalDeleted: overrides.totalDeleted,
  }
}

describe('aggregateAuthorTotals', () => {
  it('sums commits/added/deleted per author, sorted by added desc', () => {
    const stats = [
      makeStat({ author: 'Alice', totalAdded: 10, totalDeleted: 2 }),
      makeStat({ author: 'Bob', totalAdded: 30, totalDeleted: 5 }),
      makeStat({ author: 'Alice', totalAdded: 5, totalDeleted: 1 }),
    ]

    const totals = aggregateAuthorTotals(stats)

    expect(totals[0]).toEqual({ author: 'Bob', commits: 1, added: 30, deleted: 5, net: 25 })
    expect(totals[1]).toEqual({ author: 'Alice', commits: 2, added: 15, deleted: 3, net: 12 })
  })
})

describe('aggregateActivityOverTime', () => {
  it('buckets commits by month per author', () => {
    const jan = Date.UTC(2024, 0, 15) / 1000
    const feb = Date.UTC(2024, 1, 10) / 1000

    const stats = [
      makeStat({ author: 'Alice', timestamp: jan, totalAdded: 5, totalDeleted: 0 }),
      makeStat({ author: 'Alice', timestamp: feb, totalAdded: 3, totalDeleted: 1 }),
    ]

    const activity = aggregateActivityOverTime(stats, 'month')

    expect(activity).toHaveLength(2)
    expect(activity[0].author).toBe('Alice')
    expect(activity[0].added).toBe(5)
    expect(activity[1].added).toBe(3)
  })
})

describe('aggregateCommitPatterns', () => {
  it('computes average lines per commit and largest commit per author', () => {
    const stats = [
      makeStat({ author: 'Alice', oid: 'a', totalAdded: 10, totalDeleted: 0 }),
      makeStat({ author: 'Alice', oid: 'b', totalAdded: 50, totalDeleted: 0 }),
    ]

    const patterns = aggregateCommitPatterns(stats)

    expect(patterns).toHaveLength(1)
    expect(patterns[0].author).toBe('Alice')
    expect(patterns[0].avgLinesPerCommit).toBe(30)
    expect(patterns[0].largestCommit).toEqual({ oid: 'b', lines: 50 })
    expect(patterns[0].dayOfWeekCounts).toHaveLength(7)
    expect(patterns[0].hourOfDayCounts).toHaveLength(24)
  })
})
```

- [ ] **Step 2: Write the failing merge aggregation test**

```ts
// tests/lib/git/aggregate-merges.test.ts
import { describe, expect, it } from 'vitest'
import type { CommitInfo } from '../../../src/lib/types'
import { aggregateMergeInsights } from '../../../src/lib/git/aggregate-merges'

function makeCommit(overrides: Partial<CommitInfo>): CommitInfo {
  return {
    oid: 'oid',
    parentOids: [],
    author: 'Alice',
    email: 'alice@example.com',
    timestamp: 0,
    message: 'msg',
    isMerge: false,
    ...overrides,
  }
}

describe('aggregateMergeInsights', () => {
  it('counts merge commits per author, ignoring non-merge commits', () => {
    const commits = [
      makeCommit({ author: 'Alice', isMerge: true }),
      makeCommit({ author: 'Alice', isMerge: false }),
      makeCommit({ author: 'Bob', isMerge: true }),
      makeCommit({ author: 'Bob', isMerge: true }),
    ]

    const insights = aggregateMergeInsights(commits)

    expect(insights).toEqual([
      { author: 'Bob', mergeCommits: 2 },
      { author: 'Alice', mergeCommits: 1 },
    ])
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/lib/git/aggregate-churn.test.ts tests/lib/git/aggregate-merges.test.ts`
Expected: FAIL — neither `aggregate-churn.ts` nor `aggregate-merges.ts` exist.

- [ ] **Step 4: Implement `src/lib/git/aggregate-churn.ts`**

```ts
import { startOfWeek, startOfMonth } from 'date-fns'
import type { AuthorTotals, ActivityBucket, CommitPatternSummary, CommitStats } from '../types'

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

- [ ] **Step 5: Implement `src/lib/git/aggregate-merges.ts`**

```ts
import type { CommitInfo, BranchMergeInsights } from '../types'

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

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/lib/git/aggregate-churn.test.ts tests/lib/git/aggregate-merges.test.ts`
Expected: PASS, 4 tests total.

- [ ] **Step 7: Commit**

```bash
git add src/lib/git/aggregate-churn.ts src/lib/git/aggregate-merges.ts tests/lib/git/aggregate-churn.test.ts tests/lib/git/aggregate-merges.test.ts
git commit -m "feat: add churn, activity, commit-pattern, and merge aggregation"
```

---

### Task 9: Current ownership / blame (`blame.ts`)

**Files:**
- Create: `src/lib/git/blame.ts`
- Test: `tests/lib/git/blame.test.ts`

**Interfaces:**
- Consumes: `RepoContext` (Task 4).
- Produces: `blameFile(ctx, headOid, filepath): Promise<string[]>` (one commit oid per line at `headOid`), `computeFileOwnership(ctx, headOid, filepath, authorNameCache): Promise<Record<string, number>>` — both consumed by `aggregate-ownership.ts` (Task 10).

This walks the first-parent chain only (see Global Constraints), diffing each commit's version of the file against its parent's version and carrying line positions backward through unchanged ("context") lines until every line at HEAD is attributed to the commit that introduced it.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/git/blame.test.ts
import { describe, expect, it } from 'vitest'
import { buildFixtureRepo } from '../../fixtures/gitFixture'
import { makeRepoContext } from '../../../src/lib/git/repo'
import { walkHistory } from '../../../src/lib/git/history'
import { blameFile, computeFileOwnership } from '../../../src/lib/git/blame'

describe('blameFile', () => {
  it('attributes each HEAD line to the commit that introduced it', async () => {
    const { fs, dir, headOid } = await buildFixtureRepo('blame-test-1', [
      {
        message: 'first',
        author: { name: 'Alice', email: 'alice@example.com' },
        files: { 'a.txt': 'one\ntwo\n' },
      },
      {
        message: 'second',
        author: { name: 'Bob', email: 'bob@example.com' },
        files: { 'a.txt': 'one\ntwo\nthree\n' },
      },
    ])

    const ctx = makeRepoContext(fs, dir)
    const commits = await walkHistory(ctx, 'main')
    const owners = await blameFile(ctx, headOid, 'a.txt')

    expect(owners).toHaveLength(3)
    expect(owners[0]).toBe(commits[1].oid) // "one" from first commit
    expect(owners[1]).toBe(commits[1].oid) // "two" from first commit
    expect(owners[2]).toBe(commits[0].oid) // "three" from second commit
  })

  it('resolves owner oids to author names and counts lines', async () => {
    const { fs, dir, headOid } = await buildFixtureRepo('blame-test-2', [
      {
        message: 'first',
        author: { name: 'Alice', email: 'alice@example.com' },
        files: { 'a.txt': 'one\ntwo\n' },
      },
      {
        message: 'second',
        author: { name: 'Bob', email: 'bob@example.com' },
        files: { 'a.txt': 'one\ntwo\nthree\n' },
      },
    ])

    const ctx = makeRepoContext(fs, dir)
    const counts = await computeFileOwnership(ctx, headOid, 'a.txt', new Map())

    expect(counts).toEqual({ Alice: 2, Bob: 1 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/git/blame.test.ts`
Expected: FAIL — `src/lib/git/blame.ts` does not exist.

- [ ] **Step 3: Implement `src/lib/git/blame.ts`**

```ts
import * as git from 'isomorphic-git'
import { diffLines } from 'diff'
import type { RepoContext } from './repo'

const decoder = new TextDecoder('utf-8', { fatal: false })

async function readFileLinesAtCommit(
  ctx: RepoContext,
  commitOid: string,
  filepath: string
): Promise<string[]> {
  try {
    const { blob } = await git.readBlob({
      fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, oid: commitOid, filepath,
    })
    const text = decoder.decode(blob)
    return text.length ? text.split('\n') : []
  } catch {
    return []
  }
}

export async function blameFile(
  ctx: RepoContext,
  headOid: string,
  filepath: string
): Promise<string[]> {
  const headLines = await readFileLinesAtCommit(ctx, headOid, filepath)
  const owners: (string | null)[] = new Array(headLines.length).fill(null)
  const positions: (number | null)[] = headLines.map((_, i) => i)

  let currentOid: string | null = headOid
  let currentLines = headLines

  while (currentOid && positions.some((p) => p !== null)) {
    const commit = await git.readCommit({ fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, oid: currentOid })
    const parentOid = commit.commit.parent[0] ?? null
    const parentLines = parentOid ? await readFileLinesAtCommit(ctx, parentOid, filepath) : []

    const parts = diffLines(parentLines.join('\n'), currentLines.join('\n'))

    const addedAtCurIdx = new Set<number>()
    const curToParIdx = new Map<number, number>()
    let curIdx = 0
    let parIdx = 0

    for (const part of parts) {
      const lineCount = part.count ?? 0
      if (part.added) {
        for (let k = 0; k < lineCount; k++) addedAtCurIdx.add(curIdx + k)
        curIdx += lineCount
      } else if (part.removed) {
        parIdx += lineCount
      } else {
        for (let k = 0; k < lineCount; k++) curToParIdx.set(curIdx + k, parIdx + k)
        curIdx += lineCount
        parIdx += lineCount
      }
    }

    const currentCommitOid = currentOid
    for (let headLine = 0; headLine < positions.length; headLine++) {
      const pos = positions[headLine]
      if (pos === null) continue
      if (addedAtCurIdx.has(pos)) {
        owners[headLine] = currentCommitOid
        positions[headLine] = null
      } else {
        const mapped = curToParIdx.get(pos)
        positions[headLine] = mapped ?? null
        if (mapped === undefined) owners[headLine] = currentCommitOid
      }
    }

    currentOid = parentOid
    currentLines = parentLines
  }

  for (let i = 0; i < owners.length; i++) {
    if (owners[i] === null) owners[i] = headOid
  }

  return owners as string[]
}

export async function computeFileOwnership(
  ctx: RepoContext,
  headOid: string,
  filepath: string,
  authorNameCache: Map<string, string>
): Promise<Record<string, number>> {
  const owners = await blameFile(ctx, headOid, filepath)
  const counts: Record<string, number> = {}

  for (const oid of owners) {
    let author = authorNameCache.get(oid)
    if (!author) {
      const commit = await git.readCommit({ fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, oid })
      author = commit.commit.author.name
      authorNameCache.set(oid, author)
    }
    counts[author] = (counts[author] ?? 0) + 1
  }

  return counts
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/git/blame.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/git/blame.ts tests/lib/git/blame.test.ts
git commit -m "feat: add first-parent line-attribution blame algorithm"
```

---

### Task 10: Ownership rollup (`aggregate-ownership.ts`)

**Files:**
- Create: `src/lib/git/aggregate-ownership.ts`
- Test: `tests/lib/git/aggregate-ownership.test.ts`

**Interfaces:**
- Consumes: `RepoContext` (Task 4), `blameFile`/`computeFileOwnership` (Task 9), `FileOwnership`/`AuthorOwnership` (Task 2).
- Produces: `aggregateOwnership(ctx, headOid, onProgress?): Promise<{ files: FileOwnership[]; authors: AuthorOwnership[] }>` — consumed by `useRepoAnalysis` (Task 12).

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/git/aggregate-ownership.test.ts
import { describe, expect, it } from 'vitest'
import { buildFixtureRepo } from '../../fixtures/gitFixture'
import { makeRepoContext } from '../../../src/lib/git/repo'
import { aggregateOwnership } from '../../../src/lib/git/aggregate-ownership'

describe('aggregateOwnership', () => {
  it('rolls up per-file ownership into per-author totals and percentages', async () => {
    const { fs, dir, headOid } = await buildFixtureRepo('aggregate-ownership-test-1', [
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
    const { files, authors } = await aggregateOwnership(ctx, headOid)

    const aTxt = files.find((f) => f.filepath === 'a.txt')
    expect(aTxt?.totalLines).toBe(3)
    expect(aTxt?.ownerLineCounts).toEqual({ Alice: 2, Bob: 1 })

    const bTxt = files.find((f) => f.filepath === 'b.txt')
    expect(bTxt?.ownerLineCounts).toEqual({ Alice: 1 })

    const alice = authors.find((a) => a.author === 'Alice')
    const bob = authors.find((a) => a.author === 'Bob')
    expect(alice?.linesOwned).toBe(3)
    expect(bob?.linesOwned).toBe(1)
    expect(alice?.percentage).toBeCloseTo(75)
    expect(bob?.percentage).toBeCloseTo(25)
  })

  it('reports progress across files', async () => {
    const { fs, dir, headOid } = await buildFixtureRepo('aggregate-ownership-test-2', [
      {
        message: 'first',
        author: { name: 'Alice', email: 'alice@example.com' },
        files: { 'a.txt': 'x\n', 'b.txt': 'y\n' },
      },
    ])
    const ctx = makeRepoContext(fs, dir)

    const progress: Array<{ done: number; total: number }> = []
    await aggregateOwnership(ctx, headOid, (done, total) => progress.push({ done, total }))

    expect(progress).toEqual([
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/git/aggregate-ownership.test.ts`
Expected: FAIL — `src/lib/git/aggregate-ownership.ts` does not exist.

- [ ] **Step 3: Implement `src/lib/git/aggregate-ownership.ts`**

```ts
import * as git from 'isomorphic-git'
import type { FileOwnership, AuthorOwnership } from '../types'
import type { RepoContext } from './repo'
import { computeFileOwnership } from './blame'

async function listFilesAtCommit(ctx: RepoContext, oid: string): Promise<string[]> {
  const files: string[] = []
  await git.walk({
    fs: ctx.fs,
    dir: ctx.dir,
    gitdir: ctx.gitdir,
    trees: [git.TREE({ ref: oid })],
    map: async (filepath, [entry]) => {
      if (filepath === '.' || !entry) return
      // Only walk plain blobs — trees recurse naturally, and mode-160000
      // submodule entries (type 'commit') must be skipped here too, since
      // blaming a submodule path would call readBlob on a commit object.
      if ((await entry.type()) !== 'blob') return
      files.push(filepath)
      return filepath
    },
  })
  return files.sort()
}

export async function aggregateOwnership(
  ctx: RepoContext,
  headOid: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ files: FileOwnership[]; authors: AuthorOwnership[] }> {
  const filepaths = await listFilesAtCommit(ctx, headOid)
  const files: FileOwnership[] = []
  const authorLineTotals = new Map<string, number>()
  const authorNameCache = new Map<string, string>()
  let grandTotal = 0

  for (let i = 0; i < filepaths.length; i++) {
    const filepath = filepaths[i]
    const ownerLineCounts = await computeFileOwnership(ctx, headOid, filepath, authorNameCache)
    const totalLines = Object.values(ownerLineCounts).reduce((a, b) => a + b, 0)

    files.push({ filepath, totalLines, ownerLineCounts })
    for (const [author, count] of Object.entries(ownerLineCounts)) {
      authorLineTotals.set(author, (authorLineTotals.get(author) ?? 0) + count)
      grandTotal += count
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

Run: `npx vitest run tests/lib/git/aggregate-ownership.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/git/aggregate-ownership.ts tests/lib/git/aggregate-ownership.test.ts
git commit -m "feat: roll up blame results into per-file and per-author ownership"
```

---

### Task 11: IndexedDB cache layer

**Files:**
- Create: `src/lib/cache/db.ts`
- Test: `tests/lib/cache/db.test.ts`

**Interfaces:**
- Consumes: `RepoAnalysis` (Task 2).
- Produces: `makeCacheKey(repoName, branch, headOid): string`, `getCachedAnalysis(key): Promise<RepoAnalysis | null>`, `setCachedAnalysis(key, analysis): Promise<void>` — consumed by `useRepoAnalysis` (Task 12). Note: Vitest's `jsdom` environment does not implement IndexedDB by default, so this task also adds `fake-indexeddb` as a dev dependency purely for the test environment.

- [ ] **Step 1: Add `fake-indexeddb` dev dependency**

```bash
npm install -D fake-indexeddb
```

- [ ] **Step 2: Register the IndexedDB polyfill for tests**

Update `tests/setup.ts`:
```ts
import '@testing-library/jest-dom'
import 'fake-indexeddb/auto'
```

- [ ] **Step 3: Write the failing test**

```ts
// tests/lib/cache/db.test.ts
import { describe, expect, it } from 'vitest'
import { makeCacheKey, getCachedAnalysis, setCachedAnalysis } from '../../../src/lib/cache/db'
import type { RepoAnalysis } from '../../../src/lib/types'

function makeAnalysis(overrides: Partial<RepoAnalysis> = {}): RepoAnalysis {
  return {
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
    ...overrides,
  }
}

describe('cache/db', () => {
  it('returns null for a key that was never cached', async () => {
    const key = makeCacheKey('demo', 'main', 'not-cached-oid')
    expect(await getCachedAnalysis(key)).toBeNull()
  })

  it('stores and retrieves an analysis by cache key', async () => {
    const key = makeCacheKey('demo', 'main', 'abc123')
    const analysis = makeAnalysis()

    await setCachedAnalysis(key, analysis)
    const retrieved = await getCachedAnalysis(key)

    expect(retrieved).toEqual(analysis)
  })

  it('builds distinct keys for different repo/branch/commit combinations', () => {
    const a = makeCacheKey('demo', 'main', 'oid1')
    const b = makeCacheKey('demo', 'dev', 'oid1')
    const c = makeCacheKey('other-repo', 'main', 'oid1')
    expect(new Set([a, b, c]).size).toBe(3)
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/lib/cache/db.test.ts`
Expected: FAIL — `src/lib/cache/db.ts` does not exist.

- [ ] **Step 5: Implement `src/lib/cache/db.ts`**

```ts
import { openDB, type IDBPDatabase } from 'idb'
import type { RepoAnalysis } from '../types'

const DB_NAME = 'git-analyser'
const STORE_NAME = 'repo-analysis'
const DB_VERSION = 1

interface CachedEntry {
  key: string
  analysis: RepoAnalysis
  cachedAt: number
}

let dbPromise: Promise<IDBPDatabase> | null = null

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' })
      },
    })
  }
  return dbPromise
}

export function makeCacheKey(repoName: string, branch: string, headOid: string): string {
  return `${repoName}::${branch}::${headOid}`
}

export async function getCachedAnalysis(key: string): Promise<RepoAnalysis | null> {
  const db = await getDb()
  const entry = (await db.get(STORE_NAME, key)) as CachedEntry | undefined
  return entry?.analysis ?? null
}

export async function setCachedAnalysis(key: string, analysis: RepoAnalysis): Promise<void> {
  const db = await getDb()
  const entry: CachedEntry = { key, analysis, cachedAt: Date.now() }
  await db.put(STORE_NAME, entry)
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/lib/cache/db.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tests/setup.ts src/lib/cache/db.ts tests/lib/cache/db.test.ts
git commit -m "feat: add IndexedDB cache for repo analysis results"
```

---

### Task 12: Orchestration hook (`useRepoAnalysis`)

**Files:**
- Create: `src/hooks/useRepoAnalysis.ts`
- Test: `tests/hooks/useRepoAnalysis.test.ts`

**Interfaces:**
- Consumes: `createFsAdapter` (Task 3); `assertIsGitRepo`, `makeRepoContext`, `listBranches`, `resolveBranchHead`, `getCurrentBranch` (Task 4); `walkHistory` (Task 5); `computeAllCommitStats` (Task 7); `aggregateAuthorTotals`, `aggregateActivityOverTime`, `aggregateCommitPatterns` (Task 8); `aggregateMergeInsights` (Task 8); `aggregateOwnership` (Task 10); `getCachedAnalysis`, `setCachedAnalysis`, `makeCacheKey` (Task 11).
- Produces: `AnalysisStatus` union type and `useRepoAnalysis()` returning `{ status: AnalysisStatus; analyze(root: FileSystemDirectoryHandle, branchOverride?: string): Promise<void> }` — consumed by `App.tsx` (Task 13, Task 16) and `BranchSelector` wiring (Task 16).

This is the one task in the plan that bridges pure logic and React state, so it is tested with `@testing-library/react`'s `renderHook` against a real fixture repo (built via the same `LightningFS`-backed `buildFixtureRepo` helper, passed in as if it were a `FileSystemDirectoryHandle`-shaped `fs` — the hook only calls `createFsAdapter` on the value it's given, so for this test we bypass `createFsAdapter` by stubbing it, since real `FileSystemDirectoryHandle` objects aren't constructible outside a browser).

- [ ] **Step 1: Write the failing test**

```ts
// tests/hooks/useRepoAnalysis.test.ts
import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { buildFixtureRepo } from '../fixtures/gitFixture'

vi.mock('../../src/lib/fs-adapter', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/fs-adapter')>(
    '../../src/lib/fs-adapter'
  )
  return {
    ...actual,
    createFsAdapter: vi.fn(),
  }
})

import { createFsAdapter } from '../../src/lib/fs-adapter'
import { useRepoAnalysis } from '../../src/hooks/useRepoAnalysis'

describe('useRepoAnalysis', () => {
  it('walks the analysis pipeline and lands on a done state', async () => {
    const { fs } = await buildFixtureRepo('use-repo-analysis-test-1', [
      {
        message: 'first',
        author: { name: 'Alice', email: 'alice@example.com' },
        files: { 'a.txt': 'one\n' },
      },
    ])

    vi.mocked(createFsAdapter).mockReturnValue(fs as unknown as ReturnType<typeof createFsAdapter>)

    const { result } = renderHook(() => useRepoAnalysis())
    const fakeRoot = { name: 'demo-repo' } as unknown as FileSystemDirectoryHandle

    await act(async () => {
      await result.current.analyze(fakeRoot)
    })

    await waitFor(() => expect(result.current.status.phase).toBe('done'))

    if (result.current.status.phase !== 'done') throw new Error('expected done phase')
    expect(result.current.status.analysis.branch).toBe('main')
    expect(result.current.status.analysis.commits).toHaveLength(1)
    expect(result.current.status.analysis.authorTotals[0].author).toBe('Alice')
  })

  it('reports an error state when the folder has no .git directory', async () => {
    const LightningFS = (await import('@isomorphic-git/lightning-fs')).default
    const plainFs = new LightningFS('use-repo-analysis-test-2')
    await plainFs.promises.mkdir('/plain')

    vi.mocked(createFsAdapter).mockReturnValue(plainFs as unknown as ReturnType<typeof createFsAdapter>)

    const { result } = renderHook(() => useRepoAnalysis())
    const fakeRoot = { name: 'plain' } as unknown as FileSystemDirectoryHandle

    await act(async () => {
      await result.current.analyze(fakeRoot)
    })

    await waitFor(() => expect(result.current.status.phase).toBe('error'))
  })
})
```

Note: this test calls `buildFixtureRepo` (which mounts the repo at `/repo`), but the real `createFsAdapter`/adapter always roots at `/`. Since `createFsAdapter` is mocked out entirely here, the hook's internal `assertIsGitRepo(fs, '/')` / `makeRepoContext(fs, '/')` calls resolve against `/` on the *mocked* fs instance — so the hook implementation (Step 2 below) must call `assertIsGitRepo`/`makeRepoContext` with `dir: '/repo'` to match this fixture's mount point in test, while in production it's always `/` since the real adapter roots the picked folder at `/`. To keep the hook itself simple and correct in both places, the hook derives `dir` from the fs adapter's own convention (`/`) — **this test fixture therefore builds its repo at `/` instead of `/repo`** by passing `dir: '/'` to a small local variant. Concretely: add an optional `mountAt` param to `buildFixtureRepo` (default `/repo`) so this test can request `mountAt: '/'`.

- [ ] **Step 2: Update `tests/fixtures/gitFixture.ts` to support a configurable mount point**

Change the signature and the two hardcoded `dir` assignments:
```ts
export async function buildFixtureRepo(
  name: string,
  commits: FixtureCommit[],
  mountAt = '/repo'
) {
  const fsInstance = new LightningFS(name)
  const fs = fsInstance
  const dir = mountAt
  const gitdir = `${mountAt === '/' ? '' : mountAt}/.git`

  await fs.promises.mkdir(dir).catch(() => {})
  await git.init({ fs, dir, gitdir, defaultBranch: 'main' })
  // ...rest of the function is unchanged
```

Then update the two calls in Step 1's test to pass `'/'` as the third argument: `buildFixtureRepo('use-repo-analysis-test-1', [...], '/')` and the plain-folder test's `mkdir('/plain')` stays as-is (no git repo involved there).

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/hooks/useRepoAnalysis.test.ts`
Expected: FAIL — `src/hooks/useRepoAnalysis.ts` does not exist.

- [ ] **Step 4: Implement `src/hooks/useRepoAnalysis.ts`**

```ts
import { useCallback, useState } from 'react'
import { createFsAdapter } from '../lib/fs-adapter'
import {
  assertIsGitRepo,
  makeRepoContext,
  listBranches,
  resolveBranchHead,
  getCurrentBranch,
} from '../lib/git/repo'
import { walkHistory } from '../lib/git/history'
import { computeAllCommitStats } from '../lib/git/commit-stats'
import {
  aggregateAuthorTotals,
  aggregateActivityOverTime,
  aggregateCommitPatterns,
} from '../lib/git/aggregate-churn'
import { aggregateMergeInsights } from '../lib/git/aggregate-merges'
import { aggregateOwnership } from '../lib/git/aggregate-ownership'
import { getCachedAnalysis, setCachedAnalysis, makeCacheKey } from '../lib/cache/db'
import type { RepoAnalysis } from '../lib/types'

export type AnalysisStatus =
  | { phase: 'idle' }
  | { phase: 'reading-repo' }
  | { phase: 'walking-history' }
  | { phase: 'computing-churn'; done: number; total: number }
  | { phase: 'computing-ownership'; done: number; total: number }
  | { phase: 'done'; analysis: RepoAnalysis }
  | { phase: 'error'; message: string; permissionDenied?: boolean }

export function useRepoAnalysis() {
  const [status, setStatus] = useState<AnalysisStatus>({ phase: 'idle' })

  const analyze = useCallback(async (root: FileSystemDirectoryHandle, branchOverride?: string) => {
    setStatus({ phase: 'reading-repo' })
    try {
      const fs = createFsAdapter(root)
      await assertIsGitRepo(fs, '/')
      const ctx = makeRepoContext(fs, '/')

      const branches = await listBranches(ctx)
      const branch = branchOverride ?? (await getCurrentBranch(ctx)) ?? branches[0]
      const headOid = await resolveBranchHead(ctx, branch)

      const cacheKey = makeCacheKey(root.name, branch, headOid)
      const cached = await getCachedAnalysis(cacheKey)
      if (cached) {
        setStatus({ phase: 'done', analysis: cached })
        return
      }

      setStatus({ phase: 'walking-history' })
      const commits = await walkHistory(ctx, branch)

      const commitStats = await computeAllCommitStats(ctx, commits, (done, total) =>
        setStatus({ phase: 'computing-churn', done, total })
      )

      const { files: fileOwnership, authors: authorOwnership } = await aggregateOwnership(
        ctx,
        headOid,
        (done, total) => setStatus({ phase: 'computing-ownership', done, total })
      )

      const analysis: RepoAnalysis = {
        repoName: root.name,
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

      await setCachedAnalysis(cacheKey, analysis)
      setStatus({ phase: 'done', analysis })
    } catch (error) {
      const permissionDenied = error instanceof DOMException && error.name === 'NotAllowedError'
      setStatus({
        phase: 'error',
        message: error instanceof Error ? error.message : String(error),
        permissionDenied,
      })
    }
  }, [])

  return { status, analyze }
}
```

`FileSystemDirectoryHandle` access can throw `NotAllowedError` if the user revokes the folder permission mid-session (e.g. via the browser's site-permissions UI); flagging it here lets `App.tsx` (Task 16) offer a "grant access again" retry instead of a dead-end error message, per the design spec's error-handling section.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/hooks/useRepoAnalysis.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useRepoAnalysis.ts tests/hooks/useRepoAnalysis.test.ts tests/fixtures/gitFixture.ts
git commit -m "feat: add useRepoAnalysis orchestration hook"
```

---

### Task 13: Folder picker, unsupported-browser notice, status panel, and App shell

**Files:**
- Create: `src/components/FolderPicker.tsx`, `src/components/UnsupportedBrowserNotice.tsx`, `src/components/StatusPanel.tsx`
- Modify: `src/App.tsx`
- Test: `tests/components/FolderPicker.test.tsx`, `tests/components/UnsupportedBrowserNotice.test.tsx`, `tests/components/StatusPanel.test.tsx`

**Interfaces:**
- Consumes: `isFileSystemAccessSupported` (Task 2), `useRepoAnalysis`/`AnalysisStatus` (Task 12).
- Produces: a working end-to-end vertical slice — pick a folder, see raw analysis counts rendered as JSON. `App.tsx`'s shape here (root state + analyze call) is what Task 16 extends with dashboard components and filters; keep the `root`/`analyze` wiring exactly as written so Task 16 can extend it in place rather than rewrite it.

- [ ] **Step 1: Write the failing `UnsupportedBrowserNotice` test**

```tsx
// tests/components/UnsupportedBrowserNotice.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UnsupportedBrowserNotice } from '../../src/components/UnsupportedBrowserNotice'

describe('UnsupportedBrowserNotice', () => {
  it('names Chrome and Edge as the supported browsers', () => {
    render(<UnsupportedBrowserNotice />)
    expect(screen.getByText(/Unsupported browser/i)).toBeInTheDocument()
    expect(screen.getByText(/Chrome, Edge/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Write the failing `FolderPicker` test**

```tsx
// tests/components/FolderPicker.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FolderPicker } from '../../src/components/FolderPicker'

describe('FolderPicker', () => {
  it('calls onFolderSelected with the chosen handle', async () => {
    const handle = { name: 'my-repo' } as unknown as FileSystemDirectoryHandle
    // @ts-expect-error test stub
    window.showDirectoryPicker = vi.fn().mockResolvedValue(handle)

    const onFolderSelected = vi.fn()
    render(<FolderPicker onFolderSelected={onFolderSelected} />)

    fireEvent.click(screen.getByRole('button', { name: /select a git repo folder/i }))

    await waitFor(() => expect(onFolderSelected).toHaveBeenCalledWith(handle))
  })

  it('does not call onFolderSelected when the picker is cancelled', async () => {
    // @ts-expect-error test stub
    window.showDirectoryPicker = vi
      .fn()
      .mockRejectedValue(new DOMException('cancelled', 'AbortError'))

    const onFolderSelected = vi.fn()
    render(<FolderPicker onFolderSelected={onFolderSelected} />)

    fireEvent.click(screen.getByRole('button', { name: /select a git repo folder/i }))

    await waitFor(() => expect(onFolderSelected).not.toHaveBeenCalled())
  })
})
```

- [ ] **Step 3: Write the failing `StatusPanel` test**

```tsx
// tests/components/StatusPanel.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusPanel } from '../../src/components/StatusPanel'
import type { AnalysisStatus } from '../../src/hooks/useRepoAnalysis'

describe('StatusPanel', () => {
  it('shows progress counts while computing churn', () => {
    const status: AnalysisStatus = { phase: 'computing-churn', done: 3, total: 10 }
    render(<StatusPanel status={status} />)
    expect(screen.getByText(/3 \/ 10 commits/i)).toBeInTheDocument()
  })

  it('shows the error message on failure', () => {
    const status: AnalysisStatus = { phase: 'error', message: 'No .git directory found' }
    render(<StatusPanel status={status} />)
    expect(screen.getByText(/No .git directory found/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run tests/components/UnsupportedBrowserNotice.test.tsx tests/components/FolderPicker.test.tsx tests/components/StatusPanel.test.tsx`
Expected: FAIL — none of the three components exist yet.

- [ ] **Step 5: Implement `src/components/UnsupportedBrowserNotice.tsx`**

```tsx
export function UnsupportedBrowserNotice() {
  return (
    <div className="rounded border border-amber-400 bg-amber-50 p-4 text-amber-900">
      <p className="font-semibold">Unsupported browser</p>
      <p>
        This app reads git repos directly from your machine using the File System Access
        API, which is only available in Chromium-based browsers (Chrome, Edge). Please open
        this page in one of those browsers to continue.
      </p>
    </div>
  )
}
```

- [ ] **Step 6: Implement `src/components/FolderPicker.tsx`**

```tsx
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
```

- [ ] **Step 7: Implement `src/components/StatusPanel.tsx`**

```tsx
import type { AnalysisStatus } from '../hooks/useRepoAnalysis'

export function StatusPanel({ status }: { status: AnalysisStatus }) {
  switch (status.phase) {
    case 'idle':
    case 'reading-repo':
      return <p>Reading repository…</p>
    case 'walking-history':
      return <p>Walking commit history…</p>
    case 'computing-churn':
      return (
        <p>
          Computing line changes: {status.done} / {status.total} commits
        </p>
      )
    case 'computing-ownership':
      return (
        <p>
          Computing current ownership: {status.done} / {status.total} files
        </p>
      )
    case 'error':
      return <p className="text-red-600">Error: {status.message}</p>
    case 'done':
      return (
        <pre className="max-h-[60vh] overflow-auto rounded bg-white p-4 text-xs shadow">
          {JSON.stringify(
            {
              branch: status.analysis.branch,
              commits: status.analysis.commits.length,
              authorTotals: status.analysis.authorTotals,
            },
            null,
            2
          )}
        </pre>
      )
  }
}
```

- [ ] **Step 8: Wire the shell together in `src/App.tsx`**

```tsx
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
```

- [ ] **Step 9: Update the Task 1 smoke test**

The original `tests/App.test.tsx` renders `<App />` and expects a static heading with no folder picker involved; that's still true since the heading always renders. Run it alongside the new tests to confirm nothing broke.

- [ ] **Step 10: Run all tests to verify they pass**

Run: `npm test`
Expected: PASS, all suites including the three new component tests and the original `App.test.tsx`.

- [ ] **Step 11: Commit**

```bash
git add src/components/FolderPicker.tsx src/components/UnsupportedBrowserNotice.tsx src/components/StatusPanel.tsx src/App.tsx tests/components
git commit -m "feat: wire folder picker, status panel, and browser-support gate into App shell"
```

---

### Task 14: Dashboard — overview, activity-over-time, commit-pattern, and merge-insight views

**Files:**
- Create: `src/components/Dashboard/OverviewTable.tsx`, `src/components/Dashboard/ActivityOverTimeChart.tsx`, `src/components/Dashboard/CommitPatternsHeatmap.tsx`, `src/components/Dashboard/MergeInsightsTable.tsx`
- Test: `tests/components/Dashboard/OverviewTable.test.tsx`

**Interfaces:**
- Consumes: `AuthorTotals`, `ActivityBucket`, `CommitPatternSummary`, `BranchMergeInsights` (Task 2).
- Produces: four presentational components — consumed by `App.tsx` in Task 16. No shared state between them; each takes only the slice of `RepoAnalysis` it renders.

Charts use Recharts. A smoke test is written only for `OverviewTable` (the others follow the identical presentational pattern — a smoke test per chart component would be repetitive without adding coverage of new logic); the pure aggregation logic backing all three was already covered by Task 8's tests.

- [ ] **Step 1: Write the failing `OverviewTable` test**

```tsx
// tests/components/Dashboard/OverviewTable.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OverviewTable } from '../../../src/components/Dashboard/OverviewTable'

describe('OverviewTable', () => {
  it('renders a row per author with commit and line totals', () => {
    render(
      <OverviewTable
        authorTotals={[{ author: 'Alice', commits: 3, added: 10, deleted: 2, net: 8 }]}
      />
    )
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/Dashboard/OverviewTable.test.tsx`
Expected: FAIL — `src/components/Dashboard/OverviewTable.tsx` does not exist.

- [ ] **Step 3: Implement `src/components/Dashboard/OverviewTable.tsx`**

```tsx
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { AuthorTotals } from '../../lib/types'

export function OverviewTable({ authorTotals }: { authorTotals: AuthorTotals[] }) {
  return (
    <section className="rounded bg-white p-4 shadow">
      <h2 className="mb-4 text-lg font-semibold">Contribution overview</h2>
      <div className="mb-6 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={authorTotals}>
            <XAxis dataKey="author" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="added" fill="#16a34a" />
            <Bar dataKey="deleted" fill="#dc2626" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            <th className="p-2">Author</th>
            <th className="p-2">Commits</th>
            <th className="p-2">Added</th>
            <th className="p-2">Deleted</th>
            <th className="p-2">Net</th>
          </tr>
        </thead>
        <tbody>
          {authorTotals.map((row) => (
            <tr key={row.author} className="border-t">
              <td className="p-2">{row.author}</td>
              <td className="p-2">{row.commits}</td>
              <td className="p-2">{row.added}</td>
              <td className="p-2">{row.deleted}</td>
              <td className="p-2">{row.net}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/Dashboard/OverviewTable.test.tsx`
Expected: PASS, 1 test.

- [ ] **Step 5: Implement `src/components/Dashboard/ActivityOverTimeChart.tsx`**

```tsx
import { useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { ActivityBucket } from '../../lib/types'

const COLORS = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c']

export function ActivityOverTimeChart({ activity }: { activity: ActivityBucket[] }) {
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
      <h2 className="mb-4 text-lg font-semibold">Activity over time</h2>
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

- [ ] **Step 6: Implement `src/components/Dashboard/CommitPatternsHeatmap.tsx`**

```tsx
import type { CommitPatternSummary } from '../../lib/types'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function CommitPatternsHeatmap({ patterns }: { patterns: CommitPatternSummary[] }) {
  return (
    <section className="rounded bg-white p-4 shadow">
      <h2 className="mb-4 text-lg font-semibold">Commit patterns</h2>
      {patterns.map((pattern) => {
        const max = Math.max(...pattern.dayOfWeekCounts, 1)
        return (
          <div key={pattern.author} className="mb-4">
            <p className="mb-1 text-sm font-medium">
              {pattern.author} · avg {pattern.avgLinesPerCommit.toFixed(1)} lines/commit
            </p>
            <div className="flex gap-1">
              {pattern.dayOfWeekCounts.map((count, i) => (
                <div
                  key={DAY_LABELS[i]}
                  title={`${DAY_LABELS[i]}: ${count} commits`}
                  className="flex h-8 w-8 items-center justify-center rounded text-[10px] text-white"
                  style={{ backgroundColor: `rgba(37, 99, 235, ${0.15 + 0.85 * (count / max)})` }}
                >
                  {DAY_LABELS[i]}
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

- [ ] **Step 7: Implement `src/components/Dashboard/MergeInsightsTable.tsx`**

```tsx
import type { BranchMergeInsights } from '../../lib/types'

export function MergeInsightsTable({ mergeInsights }: { mergeInsights: BranchMergeInsights[] }) {
  if (mergeInsights.length === 0) return null

  return (
    <section className="rounded bg-white p-4 shadow">
      <h2 className="mb-4 text-lg font-semibold">Merge commits</h2>
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            <th className="p-2">Author</th>
            <th className="p-2">Merge commits</th>
          </tr>
        </thead>
        <tbody>
          {mergeInsights.map((row) => (
            <tr key={row.author} className="border-t">
              <td className="p-2">{row.author}</td>
              <td className="p-2">{row.mergeCommits}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
```

- [ ] **Step 8: Commit**

```bash
git add src/components/Dashboard/OverviewTable.tsx src/components/Dashboard/ActivityOverTimeChart.tsx src/components/Dashboard/CommitPatternsHeatmap.tsx src/components/Dashboard/MergeInsightsTable.tsx tests/components/Dashboard/OverviewTable.test.tsx
git commit -m "feat: add overview, activity-over-time, commit-pattern, and merge-insight dashboard views"
```

---

### Task 15: Dashboard — current ownership view and directory rollup

**Files:**
- Create: `src/lib/directory-rollup.ts`, `src/components/Dashboard/OwnershipView.tsx`
- Test: `tests/lib/directory-rollup.test.ts`

**Interfaces:**
- Consumes: `FileOwnership`, `AuthorOwnership` (Task 2).
- Produces: `rollupByDirectory(files: FileOwnership[]): FileOwnership[]` and the `OwnershipView` component — consumed by `App.tsx` in Task 16.

- [ ] **Step 1: Write the failing `rollupByDirectory` test**

```ts
// tests/lib/directory-rollup.test.ts
import { describe, expect, it } from 'vitest'
import { rollupByDirectory } from '../../src/lib/directory-rollup'
import type { FileOwnership } from '../../src/lib/types'

describe('rollupByDirectory', () => {
  it('groups files by their top-level directory and sums line ownership', () => {
    const files: FileOwnership[] = [
      { filepath: 'src/a.ts', totalLines: 10, ownerLineCounts: { Alice: 10 } },
      { filepath: 'src/b.ts', totalLines: 5, ownerLineCounts: { Bob: 5 } },
      { filepath: 'readme.txt', totalLines: 2, ownerLineCounts: { Alice: 2 } },
    ]

    const rollup = rollupByDirectory(files)

    const src = rollup.find((r) => r.filepath === 'src')
    expect(src?.totalLines).toBe(15)
    expect(src?.ownerLineCounts).toEqual({ Alice: 10, Bob: 5 })

    const root = rollup.find((r) => r.filepath === '(root)')
    expect(root?.totalLines).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/directory-rollup.test.ts`
Expected: FAIL — `src/lib/directory-rollup.ts` does not exist.

- [ ] **Step 3: Implement `src/lib/directory-rollup.ts`**

```ts
import type { FileOwnership } from './types'

export function rollupByDirectory(files: FileOwnership[]): FileOwnership[] {
  const byDir = new Map<string, FileOwnership>()

  for (const file of files) {
    const dir = file.filepath.includes('/') ? file.filepath.split('/')[0] : '(root)'
    const existing = byDir.get(dir) ?? { filepath: dir, totalLines: 0, ownerLineCounts: {} }
    existing.totalLines += file.totalLines
    for (const [author, count] of Object.entries(file.ownerLineCounts)) {
      existing.ownerLineCounts[author] = (existing.ownerLineCounts[author] ?? 0) + count
    }
    byDir.set(dir, existing)
  }

  return [...byDir.values()].sort((a, b) => b.totalLines - a.totalLines)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/directory-rollup.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Implement `src/components/Dashboard/OwnershipView.tsx`**

```tsx
import { useState } from 'react'
import type { AuthorOwnership, FileOwnership } from '../../lib/types'
import { rollupByDirectory } from '../../lib/directory-rollup'

export function OwnershipView({
  authorOwnership,
  fileOwnership,
}: {
  authorOwnership: AuthorOwnership[]
  fileOwnership: FileOwnership[]
}) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const selected = fileOwnership.find((f) => f.filepath === selectedFile) ?? null
  const directories = rollupByDirectory(fileOwnership)

  return (
    <section className="rounded bg-white p-4 shadow">
      <h2 className="mb-4 text-lg font-semibold">Current line ownership (HEAD)</h2>

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

      {selected && (
        <div className="mt-4 rounded border p-3">
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
    </section>
  )
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/directory-rollup.ts src/components/Dashboard/OwnershipView.tsx tests/lib/directory-rollup.test.ts
git commit -m "feat: add directory ownership rollup and ownership dashboard view"
```

---

### Task 16: Filters (branch/date/author) and final dashboard wiring

**Files:**
- Create: `src/lib/filters.ts`, `src/components/BranchSelector.tsx`, `src/components/DateRangeFilter.tsx`, `src/components/AuthorFilter.tsx`
- Modify: `src/App.tsx`
- Test: `tests/lib/filters.test.ts`

**Interfaces:**
- Consumes: everything produced by Tasks 2, 12, 13, 14, 15.
- Produces: the final `App.tsx` — this is the last task that touches `App.tsx`.

Per the design spec, ownership is a HEAD snapshot: the branch selector changes which HEAD is analyzed (triggers `analyze(root, branch)` again), but date range and author filters only apply to the churn/activity/pattern views, not to `OwnershipView`.

- [ ] **Step 1: Write the failing `filters.ts` test**

```ts
// tests/lib/filters.test.ts
import { describe, expect, it } from 'vitest'
import { filterByAuthors, filterActivityByDateRange } from '../../src/lib/filters'
import type { ActivityBucket } from '../../src/lib/types'

describe('filterByAuthors', () => {
  it('returns everything when no authors are selected', () => {
    const items = [{ author: 'Alice' }, { author: 'Bob' }]
    expect(filterByAuthors(items, [])).toEqual(items)
  })

  it('keeps only the selected authors', () => {
    const items = [{ author: 'Alice' }, { author: 'Bob' }]
    expect(filterByAuthors(items, ['Bob'])).toEqual([{ author: 'Bob' }])
  })
})

describe('filterActivityByDateRange', () => {
  const activity: ActivityBucket[] = [
    { bucketStart: 1000, author: 'Alice', commits: 1, added: 1, deleted: 0 },
    { bucketStart: 2000, author: 'Alice', commits: 1, added: 1, deleted: 0 },
    { bucketStart: 3000, author: 'Alice', commits: 1, added: 1, deleted: 0 },
  ]

  it('returns everything when the range is unbounded', () => {
    expect(filterActivityByDateRange(activity, { start: null, end: null })).toHaveLength(3)
  })

  it('excludes buckets outside the given range', () => {
    const result = filterActivityByDateRange(activity, { start: 1500, end: 2500 })
    expect(result).toEqual([activity[1]])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/filters.test.ts`
Expected: FAIL — `src/lib/filters.ts` does not exist.

- [ ] **Step 3: Implement `src/lib/filters.ts`**

```ts
import type { ActivityBucket } from './types'

export function filterByAuthors<T extends { author: string }>(
  items: T[],
  selectedAuthors: string[]
): T[] {
  if (selectedAuthors.length === 0) return items
  const set = new Set(selectedAuthors)
  return items.filter((item) => set.has(item.author))
}

export interface DateRange {
  start: number | null
  end: number | null
}

export function filterActivityByDateRange(
  activity: ActivityBucket[],
  range: DateRange
): ActivityBucket[] {
  return activity.filter((bucket) => {
    if (range.start !== null && bucket.bucketStart < range.start) return false
    if (range.end !== null && bucket.bucketStart > range.end) return false
    return true
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/filters.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Implement `src/components/BranchSelector.tsx`**

```tsx
export function BranchSelector({
  branches,
  selected,
  onChange,
}: {
  branches: string[]
  selected: string
  onChange: (branch: string) => void
}) {
  return (
    <label className="text-sm">
      Branch:{' '}
      <select
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border p-1"
      >
        {branches.map((branch) => (
          <option key={branch} value={branch}>
            {branch}
          </option>
        ))}
      </select>
    </label>
  )
}
```

- [ ] **Step 6: Implement `src/components/DateRangeFilter.tsx`**

```tsx
import type { DateRange } from '../lib/filters'

export function DateRangeFilter({
  range,
  onChange,
}: {
  range: DateRange
  onChange: (range: DateRange) => void
}) {
  const toInputValue = (ms: number | null) =>
    ms === null ? '' : new Date(ms).toISOString().slice(0, 10)
  const fromInputValue = (value: string) => (value === '' ? null : new Date(value).getTime())

  return (
    <div className="flex items-center gap-2 text-sm">
      <label>
        From:{' '}
        <input
          type="date"
          value={toInputValue(range.start)}
          onChange={(e) => onChange({ ...range, start: fromInputValue(e.target.value) })}
          className="rounded border p-1"
        />
      </label>
      <label>
        To:{' '}
        <input
          type="date"
          value={toInputValue(range.end)}
          onChange={(e) => onChange({ ...range, end: fromInputValue(e.target.value) })}
          className="rounded border p-1"
        />
      </label>
    </div>
  )
}
```

- [ ] **Step 7: Implement `src/components/AuthorFilter.tsx`**

```tsx
export function AuthorFilter({
  allAuthors,
  selected,
  onChange,
}: {
  allAuthors: string[]
  selected: string[]
  onChange: (authors: string[]) => void
}) {
  const toggle = (author: string) => {
    onChange(
      selected.includes(author) ? selected.filter((a) => a !== author) : [...selected, author]
    )
  }

  return (
    <div className="flex flex-wrap gap-2 text-sm">
      {allAuthors.map((author) => (
        <button
          key={author}
          type="button"
          onClick={() => toggle(author)}
          className={`rounded-full border px-3 py-1 ${
            selected.includes(author) ? 'bg-blue-600 text-white' : 'bg-white'
          }`}
        >
          {author}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 8: Rewrite `src/App.tsx` to wire filters and the dashboard together**

```tsx
import { useMemo, useState } from 'react'
import { FolderPicker } from './components/FolderPicker'
import { UnsupportedBrowserNotice } from './components/UnsupportedBrowserNotice'
import { StatusPanel } from './components/StatusPanel'
import { OverviewTable } from './components/Dashboard/OverviewTable'
import { ActivityOverTimeChart } from './components/Dashboard/ActivityOverTimeChart'
import { CommitPatternsHeatmap } from './components/Dashboard/CommitPatternsHeatmap'
import { OwnershipView } from './components/Dashboard/OwnershipView'
import { MergeInsightsTable } from './components/Dashboard/MergeInsightsTable'
import { BranchSelector } from './components/BranchSelector'
import { DateRangeFilter } from './components/DateRangeFilter'
import { AuthorFilter } from './components/AuthorFilter'
import { isFileSystemAccessSupported } from './lib/browser-support'
import { useRepoAnalysis } from './hooks/useRepoAnalysis'
import { filterByAuthors, filterActivityByDateRange, type DateRange } from './lib/filters'

export default function App() {
  const [root, setRoot] = useState<FileSystemDirectoryHandle | null>(null)
  const [dateRange, setDateRange] = useState<DateRange>({ start: null, end: null })
  const [selectedAuthors, setSelectedAuthors] = useState<string[]>([])
  const { status, analyze } = useRepoAnalysis()

  const analysis = status.phase === 'done' ? status.analysis : null

  const filtered = useMemo(() => {
    if (!analysis) return null
    return {
      authorTotals: filterByAuthors(analysis.authorTotals, selectedAuthors),
      activity: filterActivityByDateRange(
        filterByAuthors(analysis.activity, selectedAuthors),
        dateRange
      ),
      commitPatterns: filterByAuthors(analysis.commitPatterns, selectedAuthors),
    }
  }, [analysis, selectedAuthors, dateRange])

  if (!isFileSystemAccessSupported()) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <UnsupportedBrowserNotice />
      </main>
    )
  }

  const handleFolderSelected = async (handle: FileSystemDirectoryHandle) => {
    setRoot(handle)
    setSelectedAuthors([])
    setDateRange({ start: null, end: null })
    await analyze(handle)
  }

  const handleBranchChange = async (branch: string) => {
    if (root) await analyze(root, branch)
  }

  const handleGrantAccessAgain = async () => {
    if (!root) return
    await root.requestPermission({ mode: 'read' })
    await analyze(root)
  }

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <h1 className="mb-6 text-2xl font-bold">Git Contribution Dashboard</h1>
      {!root && <FolderPicker onFolderSelected={handleFolderSelected} />}

      {root && !analysis && <StatusPanel status={status} />}

      {root && status.phase === 'error' && status.permissionDenied && (
        <button
          type="button"
          onClick={handleGrantAccessAgain}
          className="mt-2 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          Grant access again
        </button>
      )}

      {root && analysis && filtered && (
        <div className="space-y-6">
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

- [ ] **Step 9: Run the full test suite**

Run: `npm test`
Expected: PASS, every suite from Tasks 1–16.

- [ ] **Step 10: Manual browser check**

Run: `npm run dev`, open the printed URL in Chrome or Edge, click "Select a git repo folder," and pick a real local git repository. Confirm: the overview table populates, the activity chart renders, the ownership table's percentages sum to ~100%, the branch selector re-runs the analysis when changed, and the author filter narrows the overview/activity/pattern views without affecting the ownership view.

- [ ] **Step 11: Commit**

```bash
git add src/lib/filters.ts src/components/BranchSelector.tsx src/components/DateRangeFilter.tsx src/components/AuthorFilter.tsx src/App.tsx tests/lib/filters.test.ts
git commit -m "feat: add branch/date/author filters and finish dashboard wiring"
```

---

### Task 17: Vercel deployment config and README

**Files:**
- Create: `vercel.json`
- Modify: `readme.txt` → replaced by a new `README.md` (the original PowerShell script is preserved as a historical reference, not deleted)

**Interfaces:**
- Consumes: nothing — this is deployment/documentation only.
- Produces: nothing consumed by other tasks; this is the last task in the plan.

- [ ] **Step 1: Create `vercel.json`**

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist"
}
```

- [ ] **Step 2: Rename `readme.txt` to `docs/original-powershell-script.txt`**

```bash
git mv readme.txt docs/original-powershell-script.txt
```

- [ ] **Step 3: Write `README.md`**

```markdown
# Git Contribution Dashboard

A fully client-side dashboard that analyzes a local git repository's
contribution history — added/deleted lines, activity over time, commit
patterns, and current line ownership (blame-based) — with no backend.

## Requirements

- **Chrome or Edge** (the File System Access API this app depends on has no
  Firefox or Safari equivalent).
- Node.js 18+ to build/run locally.

## Local development

```bash
npm install
npm run dev
```

Open the printed local URL, click **Select a git repo folder**, and choose
any local git repository. All analysis (commit walking, line diffing,
blame) runs in your browser — nothing is uploaded anywhere.

## Testing

```bash
npm test
```

## Deploying to Vercel

This is a static Vite build with no server component. Push to a Git
repository connected to Vercel, or run `vercel deploy` from this directory —
`vercel.json` points Vercel at `npm run build` and the `dist/` output.

## Origin

This project began as a PowerShell script
(`docs/original-powershell-script.txt`) that used `git shortlog` and
`git log --numstat` to tally per-author line changes. The design rationale
for turning it into a hosted dashboard is in
`docs/superpowers/specs/2026-07-24-git-contribution-dashboard-design.md`.
```

- [ ] **Step 4: Commit**

```bash
git add vercel.json README.md docs/original-powershell-script.txt
git commit -m "docs: add Vercel deploy config and project README"
```

