# Blame Through Merges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace first-parent ownership blame with real `git blame` semantics (multi-parent, no rename detection) so merged-in code is credited to its true author, validated against the real `git` CLI.

**Architecture:** Generalize `blameFile` to a multi-parent backward blame (priority queue by commit date; at each commit, pass unchanged lines to the parent that contains them, blame the commit only for lines changed vs every parent). Rewrite `aggregateOwnership` to blame each text file at HEAD per-file (concurrency + identity resolver + binary skip), retire the first-parent single-pass `ownership-walk.ts`, and bump the cache version. Correctness is proven against `git blame`.

**Tech Stack:** TypeScript (strict), isomorphic-git, `diff`, Vitest, the real `git` CLI (tests only, via `child_process`).

## Global Constraints

- **Multi-parent blame = real git blame minus rename detection.** A line unchanged vs a parent is passed to that parent (first parent that contains it wins); a line changed vs ALL parents is blamed on the commit. No `-M`/`-C`.
- **Correctness is validated against `git blame`** on real repos built with the `git` CLI, including merges authored across branches. Tests require `git` on PATH.
- Linear-history behavior must be unchanged — the existing `blame.test.ts` linear cases must still pass.
- Ownership excludes **binary files** (`isBinaryBlob`) and applies the injected **`IdentityResolver`**, exactly as it does today. Output shape `{ files: FileOwnership[]; authors: AuthorOwnership[] }` is unchanged.
- Bump `ANALYSIS_VERSION` so pre-change ownership caches are not served.
- TypeScript strict; no React in `src/lib`; every git call keeps `cache: ctx.cache`.
- Do not touch churn, activity, commit-pattern, merge-insights, filters, or dashboard shapes.

---

## File Structure Overview

```
src/lib/git/
  blame.ts             (modified: extract mapUnchangedToParent; multi-parent blameFile)
  aggregate-ownership.ts (rewritten: per-file blame over text files at HEAD)
  ownership-walk.ts    (DELETED — first-parent single-pass, superseded)
src/lib/cache/db.ts    (modified: ANALYSIS_VERSION bump)
src/components/Dashboard/StatusPanel.tsx (modified: ownership progress label back to "files")
tests/fixtures/
  realGitRepo.ts       (new: build real git repos w/ merges via the git CLI)
tests/lib/git/
  blame.test.ts        (modified: mapUnchangedToParent unit tests; keep linear cases)
  blame-parity.test.ts (new: our blame vs `git blame` on real merge repos)
  ownership-walk.test.ts (DELETED with the module)
tests/components/Dashboard/StatusPanel.test.tsx (modified: label assertion)
```

---

### Task 1: Extract `mapUnchangedToParent` (behavior-preserving)

**Files:**
- Modify: `src/lib/git/blame.ts`
- Test: `tests/lib/git/blame.test.ts`

**Interfaces:**
- Produces: `mapUnchangedToParent(parentLines: string[], currentLines: string[]): Map<number, number>` — maps each **current** line index to its index in the **parent** for lines unchanged between them (a current index absent from the map was added/changed vs the parent). Consumed by the multi-parent `blameFile` (Task 2).

- [ ] **Step 1: Write the failing unit test**

Add to `tests/lib/git/blame.test.ts`:
```ts
import { mapUnchangedToParent } from '../../../src/lib/git/blame'

describe('mapUnchangedToParent', () => {
  it('maps unchanged current lines to their parent positions', () => {
    // parent: [a, b]; current: [a, b, c] -> a,b unchanged (0->0, 1->1); c added
    const m = mapUnchangedToParent(['a', 'b'], ['a', 'b', 'c'])
    expect([...m.entries()].sort((x, y) => x[0] - y[0])).toEqual([[0, 0], [1, 1]])
  })

  it('accounts for deletions when mapping positions', () => {
    // parent: [a, b, c]; current: [a, c] -> a:0->0, c:1->2 ; b was deleted
    const m = mapUnchangedToParent(['a', 'b', 'c'], ['a', 'c'])
    expect([...m.entries()].sort((x, y) => x[0] - y[0])).toEqual([[0, 0], [1, 2]])
  })

  it('maps nothing when everything changed', () => {
    expect([...mapUnchangedToParent(['a'], ['b']).entries()]).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/git/blame.test.ts`
Expected: FAIL — `mapUnchangedToParent` is not exported.

- [ ] **Step 3: Extract the helper in `src/lib/git/blame.ts`**

Add this exported function (it is exactly the diff-mapping the current `blameFile` does inline):
```ts
/**
 * Map each line index in `currentLines` to its index in `parentLines` for lines
 * UNCHANGED between them. A current index absent from the returned map was
 * added or changed relative to the parent. Uses the shared diff + newline
 * normalization so results are consistent across the codebase.
 */
export function mapUnchangedToParent(
  parentLines: string[],
  currentLines: string[]
): Map<number, number> {
  const parts = diffLines(linesToText(parentLines), linesToText(currentLines))
  const curToParent = new Map<number, number>()
  let curIdx = 0
  let parIdx = 0
  for (const part of parts) {
    const count = part.count ?? 0
    if (part.added) {
      curIdx += count
    } else if (part.removed) {
      parIdx += count
    } else {
      for (let k = 0; k < count; k++) curToParent.set(curIdx + k, parIdx + k)
      curIdx += count
      parIdx += count
    }
  }
  return curToParent
}
```

Then refactor the EXISTING `blameFile`'s inline diff loop to use it (behavior-preserving): replace the `addedAtCurIdx`/`curToParIdx` construction with `const curToPar = mapUnchangedToParent(parentLines, currentLines)`, and in the per-line loop treat "added" as `!curToPar.has(pos)`:
```ts
    const curToPar = mapUnchangedToParent(parentLines, currentLines)
    const currentCommitOid = currentOid
    for (let headLine = 0; headLine < positions.length; headLine++) {
      const pos = positions[headLine]
      if (pos === null) continue
      const mapped = curToPar.get(pos)
      if (mapped === undefined) {
        owners[headLine] = currentCommitOid
        positions[headLine] = null
      } else {
        positions[headLine] = mapped
      }
    }
```
(This preserves current behavior; the multi-parent rewrite in Task 2 replaces the loop body entirely, but keeping `blameFile` correct here lets the existing linear tests stay green between tasks.)

- [ ] **Step 4: Run the blame tests**

Run: `npx vitest run tests/lib/git/blame.test.ts`
Expected: PASS — the 3 new helper tests plus the existing linear `blameFile` tests (unchanged behavior).

- [ ] **Step 5: Commit**

```bash
git add src/lib/git/blame.ts tests/lib/git/blame.test.ts
git commit -m "refactor: extract mapUnchangedToParent from blame (behavior-preserving)"
```

---

### Task 2: Multi-parent `blameFile` + `git blame` parity harness

**Files:**
- Modify: `src/lib/git/blame.ts`
- Create: `tests/fixtures/realGitRepo.ts`, `tests/lib/git/blame-parity.test.ts`

**Interfaces:**
- Consumes: `mapUnchangedToParent` (Task 1), `RepoContext`, `readFileLinesAtCommit`.
- Produces: multi-parent `blameFile(ctx, headOid, filepath): Promise<string[]>` (same signature; now follows all parents). `buildRealGitRepo(commands): string` test helper.

- [ ] **Step 1: Write the real-git-repo test helper**

```ts
// tests/fixtures/realGitRepo.ts
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Create a real git repository in a fresh temp dir and run the given git
 * argument-lists in it (author identity is set per-commit by the caller via
 * `-c user.name=... -c user.email=...` on the commit commands, or globally
 * here). Returns the repo path. Requires `git` on PATH.
 */
export function buildRealGitRepo(steps: (run: (args: string[]) => void, dir: string) => void): string {
  const dir = mkdtempSync(join(tmpdir(), 'blame-parity-'))
  const run = (args: string[]) => {
    execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  }
  run(['init', '-q', '-b', 'main'])
  run(['config', 'user.name', 'Setup'])
  run(['config', 'user.email', 'setup@example.com'])
  steps(run, dir)
  return dir
}

/** Parse `git blame --line-porcelain` output into a per-line author email array. */
export function gitBlameEmails(dir: string, filepath: string): string[] {
  const out = execFileSync('git', ['blame', '--line-porcelain', filepath], {
    cwd: dir,
    encoding: 'utf8',
  })
  const emails: string[] = []
  for (const line of out.split('\n')) {
    if (line.startsWith('author-mail ')) {
      emails.push(line.slice('author-mail '.length).replace(/^<|>$/g, ''))
    }
  }
  return emails
}
```

- [ ] **Step 2: Write the failing parity test (merge scenario)**

```ts
// tests/lib/git/blame-parity.test.ts
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import * as git from 'isomorphic-git'
import { buildRealGitRepo, gitBlameEmails } from '../../fixtures/realGitRepo'
import { makeRepoContext } from '../../../src/lib/git/repo'
import { blameFile } from '../../../src/lib/git/blame'

// isomorphic-git accepts Node's fs directly.
const nodeCtx = (dir: string) => makeRepoContext(fs as never, dir)

async function ourBlameEmails(dir: string, filepath: string): Promise<string[]> {
  const ctx = nodeCtx(dir)
  const headOid = await git.resolveRef({ fs: fs as never, dir, gitdir: `${dir}/.git`, ref: 'HEAD' })
  const owners = await blameFile(ctx, headOid, filepath)
  const emailByOid = new Map<string, string>()
  const out: string[] = []
  for (const oid of owners) {
    let email = emailByOid.get(oid)
    if (!email) {
      const { commit } = await git.readCommit({ fs: fs as never, dir, gitdir: `${dir}/.git`, oid })
      email = commit.author.email
      emailByOid.set(oid, email)
    }
    out.push(email)
  }
  return out
}

async function expectBlameMatchesGit(dir: string, filepath: string) {
  const ours = await ourBlameEmails(dir, filepath)
  const theirs = gitBlameEmails(dir, filepath)
  expect(ours).toEqual(theirs)
}

describe('blameFile parity with git blame', () => {
  it('credits merged-in lines to their true author, not the merger', async () => {
    const dir = buildRealGitRepo((run) => {
      const commit = (name: string, email: string, msg: string) =>
        run(['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', msg])
      const write = (rel: string, content: string) => fs.writeFileSync(`${dir}/${rel}`, content)

      // main: base file by Alice
      write('f.txt', 'a1\na2\n')
      run(['add', '-A']); commit('Alice', 'alice@example.com', 'base')

      // feature branch: Lahiru appends lines
      run(['checkout', '-q', '-b', 'feature'])
      write('f.txt', 'a1\na2\nL1\nL2\n')
      run(['add', '-A']); commit('Lahiru', 'lahiru@example.com', 'feature work')

      // back to main, an unrelated edit by Alice
      run(['checkout', '-q', 'main'])
      write('other.txt', 'x\n')
      run(['add', '-A']); commit('Alice', 'alice@example.com', 'other')

      // Dinil merges the feature branch (merger != author)
      run(['-c', 'user.name=Dinil', '-c', 'user.email=dinil@example.com', 'merge', '-q', '--no-ff', 'feature', '-m', 'Merge feature'])
    })

    // f.txt lines: a1,a2 -> Alice; L1,L2 -> Lahiru (NOT Dinil the merger)
    await expectBlameMatchesGit(dir, 'f.txt')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('matches git blame on a linear edit history', async () => {
    const dir = buildRealGitRepo((run) => {
      const commit = (name: string, email: string, msg: string) =>
        run(['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', msg])
      fs.writeFileSync(`${dir}/g.txt`, 'one\ntwo\n')
      run(['add', '-A']); commit('Alice', 'alice@example.com', 'c1')
      fs.writeFileSync(`${dir}/g.txt`, 'one\ntwo\nthree\n')
      run(['add', '-A']); commit('Bob', 'bob@example.com', 'c2')
    })
    await expectBlameMatchesGit(dir, 'g.txt')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('blames a merge-conflict resolution on the merge author', async () => {
    const dir = buildRealGitRepo((run) => {
      const commit = (name: string, email: string, msg: string) =>
        run(['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', msg])
      fs.writeFileSync(`${dir}/c.txt`, 'base\n')
      run(['add', '-A']); commit('Alice', 'alice@example.com', 'base')

      run(['checkout', '-q', '-b', 'feat'])
      fs.writeFileSync(`${dir}/c.txt`, 'feat-change\n')
      run(['add', '-A']); commit('Lahiru', 'lahiru@example.com', 'feat')

      run(['checkout', '-q', 'main'])
      fs.writeFileSync(`${dir}/c.txt`, 'main-change\n')
      run(['add', '-A']); commit('Alice', 'alice@example.com', 'main edit')

      // conflicting merge; Dinil resolves by writing a new line
      try {
        run(['-c', 'user.name=Dinil', '-c', 'user.email=dinil@example.com', 'merge', '--no-ff', 'feat', '-m', 'merge'])
      } catch {
        // conflict expected
      }
      fs.writeFileSync(`${dir}/c.txt`, 'resolved-by-dinil\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Dinil', '-c', 'user.email=dinil@example.com', 'commit', '-q', '--no-edit'])
    })
    await expectBlameMatchesGit(dir, 'c.txt')
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/lib/git/blame-parity.test.ts`
Expected: FAIL — the current first-parent `blameFile` credits the merged `L1/L2` lines to Dinil (merger), not Lahiru, so the first test's arrays differ. (If `git` is not on PATH the test errors — install/enable git.)

- [ ] **Step 4: Replace `blameFile` with the multi-parent implementation**

In `src/lib/git/blame.ts`, replace the body of `blameFile` with a multi-parent backward blame. Keep `readFileLinesAtCommit` and `mapUnchangedToParent`.
```ts
interface Claim {
  headLine: number
  pos: number
}

export async function blameFile(
  ctx: RepoContext,
  headOid: string,
  filepath: string
): Promise<string[]> {
  const headLines = await readFileLinesAtCommit(ctx, headOid, filepath)
  if (headLines.length === 0) return []
  const owners: (string | null)[] = new Array(headLines.length).fill(null)

  // Unresolved line claims grouped by their current suspect commit. Each HEAD
  // line is in exactly one group at a time (it moves suspect to suspect).
  const pending = new Map<string, Claim[]>()
  pending.set(headOid, headLines.map((_, i) => ({ headLine: i, pos: i })))

  const commitCache = new Map<string, { parent: string[]; ts: number }>()
  async function getCommit(oid: string): Promise<{ parent: string[]; ts: number }> {
    let c = commitCache.get(oid)
    if (!c) {
      const { commit } = await git.readCommit({ fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, oid, cache: ctx.cache })
      c = { parent: commit.parent, ts: commit.committer.timestamp }
      commitCache.set(oid, c)
    }
    return c
  }

  while (pending.size > 0) {
    // Process the newest pending suspect (git orders blame by commit date).
    let suspect = ''
    let newestTs = -Infinity
    for (const oid of pending.keys()) {
      const { ts } = await getCommit(oid)
      if (ts > newestTs) {
        newestTs = ts
        suspect = oid
      }
    }
    const claims = pending.get(suspect)!
    pending.delete(suspect)

    const { parent: parents } = await getCommit(suspect)
    if (parents.length === 0) {
      for (const c of claims) owners[c.headLine] = suspect
      continue
    }

    const currentLines = await readFileLinesAtCommit(ctx, suspect, filepath)
    let remaining = claims
    for (const parentOid of parents) {
      if (remaining.length === 0) break
      const parentLines = await readFileLinesAtCommit(ctx, parentOid, filepath)
      const curToPar = mapUnchangedToParent(parentLines, currentLines)
      const stillRemaining: Claim[] = []
      const passed: Claim[] = []
      for (const c of remaining) {
        const parentPos = curToPar.get(c.pos)
        if (parentPos !== undefined) passed.push({ headLine: c.headLine, pos: parentPos })
        else stillRemaining.push(c)
      }
      if (passed.length) {
        const list = pending.get(parentOid) ?? []
        list.push(...passed)
        pending.set(parentOid, list)
      }
      remaining = stillRemaining
    }
    // Lines changed relative to every parent were introduced by this commit.
    for (const c of remaining) owners[c.headLine] = suspect
  }

  for (let i = 0; i < owners.length; i++) {
    if (owners[i] === null) owners[i] = headOid
  }
  return owners as string[]
}
```
Ensure `import * as git from 'isomorphic-git'` and the `Claim` interface are present. Remove any now-unused first-parent-only locals.

- [ ] **Step 5: Run the parity + existing blame tests**

Run: `npx vitest run tests/lib/git/blame-parity.test.ts tests/lib/git/blame.test.ts`
Expected: PASS — our blame now matches `git blame` for the merge, conflict, and linear scenarios, and the existing linear `blameFile`/`mapUnchangedToParent` tests still pass. If a parity test fails, our blame diverges from git — fix the algorithm; do not weaken the assertion.

- [ ] **Step 6: Commit**

```bash
git add src/lib/git/blame.ts tests/fixtures/realGitRepo.ts tests/lib/git/blame-parity.test.ts
git commit -m "feat: multi-parent blame that credits merged-in code to its true author"
```

---

### Task 3: Per-file ownership, retire the single-pass, bump cache, fix progress label

**Files:**
- Rewrite: `src/lib/git/aggregate-ownership.ts`
- Delete: `src/lib/git/ownership-walk.ts`, `tests/lib/git/ownership-walk.test.ts`
- Modify: `src/lib/cache/db.ts`, `src/components/Dashboard/StatusPanel.tsx`
- Test: `tests/lib/git/aggregate-ownership.test.ts`, `tests/components/Dashboard/StatusPanel.test.tsx`

**Interfaces:**
- Consumes: `blameFile` (Task 2), `isBinaryBlob`, `IdentityResolver`, `mapWithConcurrency`/`GIT_READ_CONCURRENCY`, `git.listFiles`/`readBlob`/`readCommit`.
- Produces: `aggregateOwnership(ctx, headOid, onProgress?, resolver?)` unchanged signature/shape; progress now per **file**.

- [ ] **Step 1: Rewrite `src/lib/git/aggregate-ownership.ts`**

```ts
import * as git from 'isomorphic-git'
import type { FileOwnership, AuthorOwnership } from '../types'
import type { RepoContext } from './repo'
import type { IdentityResolver } from './identity'
import { blameFile } from './blame'
import { isBinaryBlob } from './binary'
import { mapWithConcurrency, GIT_READ_CONCURRENCY } from '../concurrency'

async function listTextFiles(ctx: RepoContext, headOid: string): Promise<string[]> {
  const files = await git.listFiles({ fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, ref: headOid })
  const textFiles: string[] = []
  await mapWithConcurrency(files, GIT_READ_CONCURRENCY, async (filepath) => {
    const { blob } = await git.readBlob({
      fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, oid: headOid, filepath, cache: ctx.cache,
    })
    if (!isBinaryBlob(blob)) textFiles.push(filepath)
  })
  return textFiles.sort()
}

export async function aggregateOwnership(
  ctx: RepoContext,
  headOid: string,
  onProgress?: (done: number, total: number) => void,
  resolver?: IdentityResolver
): Promise<{ files: FileOwnership[]; authors: AuthorOwnership[] }> {
  const filepaths = await listTextFiles(ctx, headOid)
  const authorNameCache = new Map<string, string>()

  async function ownersFor(filepath: string): Promise<Record<string, number>> {
    const owners = await blameFile(ctx, headOid, filepath)
    const counts: Record<string, number> = {}
    for (const oid of owners) {
      let author = authorNameCache.get(oid)
      if (!author) {
        const { commit } = await git.readCommit({
          fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, oid, cache: ctx.cache,
        })
        author = resolver ? resolver.resolve(commit.author.name, commit.author.email) : commit.author.name
        authorNameCache.set(oid, author)
      }
      counts[author] = (counts[author] ?? 0) + 1
    }
    return counts
  }

  const perFile = await mapWithConcurrency(filepaths, GIT_READ_CONCURRENCY, ownersFor, onProgress)

  const files: FileOwnership[] = []
  const authorLineTotals = new Map<string, number>()
  let grandTotal = 0
  for (let i = 0; i < filepaths.length; i++) {
    const ownerLineCounts = perFile[i]
    const totalLines = Object.values(ownerLineCounts).reduce((a, b) => a + b, 0)
    files.push({ filepath: filepaths[i], totalLines, ownerLineCounts })
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

- [ ] **Step 2: Delete the retired single-pass module and its tests**

```bash
git rm src/lib/git/ownership-walk.ts tests/lib/git/ownership-walk.test.ts
```
(The multi-parent blame in `blame.ts` + the `git blame` parity tests replace what `ownership-walk` and its parity tests covered. `mapUnchangedToParent` now lives in `blame.ts`.)

- [ ] **Step 3: Update `aggregate-ownership.test.ts`**

The existing rollup-correctness and identity tests should still pass (they build linear fixtures via `buildFixtureRepo`; per-file blame gives the same result on linear history). The progress test now counts **files**, not commits — confirm/adjust it to expect per-file progress. If the existing progress test was written for per-commit counts, update its expectation to the number of text files at HEAD (e.g. a 2-file fixture → `[{done:1,total:2},{done:2,total:2}]`). Run:
`npx vitest run tests/lib/git/aggregate-ownership.test.ts` — Expected: PASS.

- [ ] **Step 4: Bump the cache version in `src/lib/cache/db.ts`**

```ts
// v4: ownership now uses multi-parent blame (credits merged-in code to authors).
const ANALYSIS_VERSION = 4
```

- [ ] **Step 5: Set the ownership progress label back to "files"**

Ownership progress is per-file again. In `src/components/Dashboard/StatusPanel.tsx`, change the `computing-ownership` case wording from "commits" back to "files":
```tsx
    case 'computing-ownership':
      return (
        <p>
          Computing current ownership: {status.done} / {status.total} files
        </p>
      )
```
Update the assertion in `tests/components/Dashboard/StatusPanel.test.tsx` that checks the ownership-phase text (change "commits" → "files" for the `computing-ownership` case). Leave the `computing-churn` label ("commits") untouched.

- [ ] **Step 6: Full verification**

Run: `npm test` — entire suite green (note: `blame-parity.test.ts` requires `git` on PATH).
Run: `npx tsc -b --force` — zero errors (confirm no dangling imports of the deleted `ownership-walk`).
Run: `npm run build` — succeeds.

- [ ] **Step 7: Manual browser check (environment permitting)**

If a Chromium browser is available: analyze the `Promis v2` repo and confirm Current Ownership now credits Lahiru/Rashi for their merged-in code (and the GitHub-merge identities are no longer inflated), with binary files still excluded. If no browser, note it as outstanding.

- [ ] **Step 8: Commit**

```bash
git add src/lib/git/aggregate-ownership.ts src/lib/cache/db.ts src/components/Dashboard/StatusPanel.tsx tests/lib/git/aggregate-ownership.test.ts tests/components/Dashboard/StatusPanel.test.tsx
git commit -m "feat: ownership via multi-parent per-file blame; retire first-parent single-pass"
```
