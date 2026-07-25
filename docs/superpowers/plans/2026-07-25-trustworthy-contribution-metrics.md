# Trustworthy Contribution Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Contribution Overview reflect authored code by one canonical person: exclude merge commits from churn, and unify fragmented author identities via email grouping + a standard `.mailmap`.

**Architecture:** Merge exclusion is a filter in the orchestrator (`useRepoAnalysis`) feeding the churn aggregators non-merge commits only. Identity unification is a new pure `identity.ts` (mailmap parser + resolver) plus a `.mailmap` read; the resolver canonicalizes `CommitInfo.author` before aggregation (covering churn + merges) and is passed into ownership aggregation.

**Tech Stack:** TypeScript (strict), isomorphic-git, Vitest, the existing `@isomorphic-git/lightning-fs` fixture builder.

## Global Constraints

- **Exclude merges entirely** from contribution churn (not counted as commits, zero lines). `aggregateMergeInsights` is the ONLY consumer that still receives merge commits.
- **Identity via email + `.mailmap`** only — no heuristic/auto guessing. Absent `.mailmap` degrades to pure email-grouping. Emails compared case-insensitively.
- Canonicalization happens after the history walk and BEFORE any per-author aggregation, so split identities are unified everywhere (churn, merge-insights, ownership).
- Changing analysis output means **stale caches must be invalidated** — bump the cache key so pre-change cached results are not served.
- TypeScript strict; no React in `src/lib`; every git call keeps `cache: ctx.cache`.
- Do not change ownership's first-parent blame semantics or any chart/table shape.

---

## File Structure Overview

```
src/lib/git/
  identity.ts          (new: parseMailmap, buildIdentityResolver, readMailmap)
  aggregate-churn.ts   (modified: add filterNonMergeCommits helper)
  aggregate-ownership.ts (modified: accept + apply an identity resolver)
src/lib/cache/
  db.ts                (modified: version the cache key)
src/hooks/
  useRepoAnalysis.ts   (modified: exclude merges, read mailmap, canonicalize authors, pass resolver)
tests/lib/git/
  identity.test.ts     (new)
  aggregate-churn.test.ts (modified: filterNonMergeCommits tests)
  aggregate-ownership.test.ts (modified: resolver param)
tests/hooks/
  useRepoAnalysis.test.ts (modified: merge-exclusion + identity integration)
```

---

### Task 1: Exclude merge commits from churn + invalidate stale caches

**Files:**
- Modify: `src/lib/git/aggregate-churn.ts`, `src/lib/cache/db.ts`, `src/hooks/useRepoAnalysis.ts`
- Test: `tests/lib/git/aggregate-churn.test.ts`

**Interfaces:**
- Produces: `filterNonMergeCommits(commits: CommitInfo[]): CommitInfo[]` (aggregate-churn.ts) — used by `useRepoAnalysis`. Cache key gains an internal version prefix.

- [ ] **Step 1: Write the failing test for `filterNonMergeCommits`**

Add to `tests/lib/git/aggregate-churn.test.ts`:
```ts
import { filterNonMergeCommits } from '../../../src/lib/git/aggregate-churn'
import type { CommitInfo } from '../../../src/lib/types'

function commit(oid: string, isMerge: boolean): CommitInfo {
  return { oid, parentOids: [], author: 'A', email: 'a@x.com', timestamp: 0, message: 'm', isMerge }
}

describe('filterNonMergeCommits', () => {
  it('drops merge commits and keeps the rest in order', () => {
    const commits = [commit('a', false), commit('b', true), commit('c', false)]
    expect(filterNonMergeCommits(commits).map((c) => c.oid)).toEqual(['a', 'c'])
  })

  it('returns everything when there are no merges', () => {
    const commits = [commit('a', false), commit('b', false)]
    expect(filterNonMergeCommits(commits)).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/git/aggregate-churn.test.ts`
Expected: FAIL — `filterNonMergeCommits` not exported.

- [ ] **Step 3: Implement `filterNonMergeCommits` in `src/lib/git/aggregate-churn.ts`**

Add the import if not present and the helper (place near the top, after imports):
```ts
import type { CommitInfo } from '../types'

/**
 * Merge commits combine branches rather than authoring code; git's own
 * `log --numstat` shows nothing for them. Exclude them from contribution
 * churn so mergers aren't credited with everyone's merged-in work.
 */
export function filterNonMergeCommits(commits: CommitInfo[]): CommitInfo[] {
  return commits.filter((c) => !c.isMerge)
}
```
(If `aggregate-churn.ts` already imports `CommitInfo` via an existing `import type { ... } from '../types'`, add `CommitInfo` to that import instead of duplicating.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/git/aggregate-churn.test.ts`
Expected: PASS (the new tests plus the existing churn tests).

- [ ] **Step 5: Version the cache key in `src/lib/cache/db.ts`**

Replace `makeCacheKey`:
```ts
// Bump when analysis logic changes so pre-change cached results are not served.
const ANALYSIS_VERSION = 2

export function makeCacheKey(repoName: string, branch: string, headOid: string): string {
  return `v${ANALYSIS_VERSION}::${repoName}::${branch}::${headOid}`
}
```
The existing `db.test.ts` (distinctness + round-trip) still passes since keys remain distinct strings.

- [ ] **Step 6: Exclude merges in `useRepoAnalysis`**

In `src/hooks/useRepoAnalysis.ts`, add to the churn imports:
```ts
import {
  aggregateAuthorTotals,
  aggregateActivityOverTime,
  aggregateCommitPatterns,
  filterNonMergeCommits,
} from '../lib/git/aggregate-churn'
```
Then change the churn input to non-merge commits (leave `aggregateMergeInsights(commits)` on the full list):
```ts
      setStatus({ phase: 'walking-history' })
      const commits = await walkHistory(ctx, branch)
      const churnCommits = filterNonMergeCommits(commits)

      const commitStats = await computeAllCommitStats(ctx, churnCommits, (done, total) =>
        setStatus({ phase: 'computing-churn', done, total })
      )
```
Everything else (aggregateAuthorTotals/activity/commitPatterns over `commitStats`, and `aggregateMergeInsights(commits)`) is unchanged.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS. The existing `useRepoAnalysis` test's fixture has no merges, so `churnCommits === commits` there and its assertions are unaffected.

- [ ] **Step 8: Commit**

```bash
git add src/lib/git/aggregate-churn.ts src/lib/cache/db.ts src/hooks/useRepoAnalysis.ts tests/lib/git/aggregate-churn.test.ts
git commit -m "feat: exclude merge commits from contribution churn and bump cache version"
```

---

### Task 2: `parseMailmap`

**Files:**
- Create: `src/lib/git/identity.ts`
- Test: `tests/lib/git/identity.test.ts`

**Interfaces:**
- Produces: `MailmapEntry` type and `parseMailmap(text: string): MailmapEntry[]` — consumed by `buildIdentityResolver` (Task 3).

`MailmapEntry` shape:
```ts
export interface MailmapEntry {
  properName?: string
  properEmail: string
  commitName?: string
  commitEmail?: string
}
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/git/identity.test.ts
import { describe, expect, it } from 'vitest'
import { parseMailmap } from '../../../src/lib/git/identity'

describe('parseMailmap', () => {
  it('parses "Proper Name <proper@email>" (name for an email)', () => {
    expect(parseMailmap('Proper Name <proper@x.com>')).toEqual([
      { properName: 'Proper Name', properEmail: 'proper@x.com' },
    ])
  })

  it('parses "<proper@email> <commit@email>" (email remap)', () => {
    expect(parseMailmap('<proper@x.com> <old@x.com>')).toEqual([
      { properEmail: 'proper@x.com', commitEmail: 'old@x.com' },
    ])
  })

  it('parses "Proper Name <proper@email> <commit@email>"', () => {
    expect(parseMailmap('Proper Name <proper@x.com> <old@x.com>')).toEqual([
      { properName: 'Proper Name', properEmail: 'proper@x.com', commitEmail: 'old@x.com' },
    ])
  })

  it('parses "Proper Name <proper@email> Commit Name <commit@email>"', () => {
    expect(parseMailmap('Proper Name <proper@x.com> Commit Name <old@x.com>')).toEqual([
      {
        properName: 'Proper Name',
        properEmail: 'proper@x.com',
        commitName: 'Commit Name',
        commitEmail: 'old@x.com',
      },
    ])
  })

  it('skips comments, blank lines, and malformed lines', () => {
    const text = [
      '# a comment',
      '',
      'Proper Name <proper@x.com>  # trailing comment',
      'garbage with no email',
      '   ',
    ].join('\n')
    expect(parseMailmap(text)).toEqual([{ properName: 'Proper Name', properEmail: 'proper@x.com' }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/git/identity.test.ts`
Expected: FAIL — `identity.ts` does not exist.

- [ ] **Step 3: Implement `parseMailmap` in `src/lib/git/identity.ts`**

```ts
export interface MailmapEntry {
  properName?: string
  properEmail: string
  commitName?: string
  commitEmail?: string
}

const NAME_EMAIL = /([^<>]*)<([^<>]+)>/g

/**
 * Parse a git .mailmap. Supports the four standard line forms:
 *   Proper Name <proper@email>
 *   <proper@email> <commit@email>
 *   Proper Name <proper@email> <commit@email>
 *   Proper Name <proper@email> Commit Name <commit@email>
 * Comments (`#`), blank lines, and lines without a usable <email> are skipped.
 */
export function parseMailmap(text: string): MailmapEntry[] {
  const entries: MailmapEntry[] = []

  for (const rawLine of text.split('\n')) {
    const line = rawLine.split('#')[0].trim()
    if (!line) continue

    const pairs: Array<{ name: string; email: string }> = []
    for (const match of line.matchAll(NAME_EMAIL)) {
      pairs.push({ name: match[1].trim(), email: match[2].trim() })
    }
    if (pairs.length === 0) continue

    const [proper, commit] = pairs
    const entry: MailmapEntry = { properEmail: proper.email }
    if (proper.name) entry.properName = proper.name
    if (commit) {
      entry.commitEmail = commit.email
      if (commit.name) entry.commitName = commit.name
    }
    entries.push(entry)
  }

  return entries
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/git/identity.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/git/identity.ts tests/lib/git/identity.test.ts
git commit -m "feat: add .mailmap parser"
```

---

### Task 3: `buildIdentityResolver`

**Files:**
- Modify: `src/lib/git/identity.ts`
- Test: `tests/lib/git/identity.test.ts` (add to existing file)

**Interfaces:**
- Consumes: `MailmapEntry` (Task 2), `CommitInfo` (types.ts).
- Produces: `IdentityResolver` type (`{ resolve(name: string, email: string): string }`) and `buildIdentityResolver(entries: MailmapEntry[], commits: CommitInfo[]): IdentityResolver` — consumed by `useRepoAnalysis` and `aggregate-ownership` (Task 4).

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/git/identity.test.ts`:
```ts
import { buildIdentityResolver } from '../../../src/lib/git/identity'
import type { CommitInfo } from '../../../src/lib/types'

function c(author: string, email: string): CommitInfo {
  return { oid: Math.random().toString(), parentOids: [], author, email, timestamp: 0, message: 'm', isMerge: false }
}

describe('buildIdentityResolver', () => {
  it('groups identities that share an email (no mailmap needed)', () => {
    const commits = [
      c('ravindu0823', 'guestpc87@gmail.com'),
      c('ravindu0823', 'guestpc87@gmail.com'),
      c('R R D Perera', 'guestpc87@gmail.com'),
    ]
    const resolver = buildIdentityResolver([], commits)
    // Both names resolve to the most frequent name for that shared email.
    expect(resolver.resolve('ravindu0823', 'guestpc87@gmail.com')).toBe('ravindu0823')
    expect(resolver.resolve('R R D Perera', 'guestpc87@gmail.com')).toBe('ravindu0823')
  })

  it('unites two emails into one person via a mailmap entry', () => {
    const entries = parseMailmap('PramodHashantha <primary@x.com> <secondary@x.com>')
    const commits = [c('PramodHashantha', 'primary@x.com'), c('Hashantha Pramod', 'secondary@x.com')]
    const resolver = buildIdentityResolver(entries, commits)
    expect(resolver.resolve('PramodHashantha', 'primary@x.com')).toBe('PramodHashantha')
    expect(resolver.resolve('Hashantha Pramod', 'secondary@x.com')).toBe('PramodHashantha')
  })

  it('matches emails case-insensitively', () => {
    const commits = [c('Alice', 'alice@x.com'), c('Alice', 'alice@x.com')]
    const resolver = buildIdentityResolver([], commits)
    expect(resolver.resolve('Alice', 'ALICE@X.COM')).toBe('Alice')
  })

  it('falls back to the raw name when the commit has no email', () => {
    const resolver = buildIdentityResolver([], [])
    expect(resolver.resolve('Nameless', '')).toBe('Nameless')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/git/identity.test.ts`
Expected: FAIL — `buildIdentityResolver` not exported.

- [ ] **Step 3: Implement `buildIdentityResolver` (append to `src/lib/git/identity.ts`)**

```ts
import type { CommitInfo } from '../types'

export interface IdentityResolver {
  resolve(name: string, email: string): string
}

export function buildIdentityResolver(
  entries: MailmapEntry[],
  commits: CommitInfo[]
): IdentityResolver {
  const lower = (s: string) => s.toLowerCase()

  // Map a commit (name, email) to its canonical email (lowercased). A mailmap
  // entry with a commitEmail remaps to properEmail; name+email entries are more
  // specific and win over email-only ones. Entries without a commitEmail (form
  // "Proper Name <email>") don't remap the email, they only name it (below).
  function canonEmail(name: string, email: string): string {
    const el = lower(email)
    let emailOnly: string | undefined
    for (const e of entries) {
      if (!e.commitEmail) continue
      if (lower(e.commitEmail) !== el) continue
      if (e.commitName !== undefined) {
        if (e.commitName === name) return lower(e.properEmail) // most specific
      } else if (emailOnly === undefined) {
        emailOnly = lower(e.properEmail)
      }
    }
    return emailOnly ?? el
  }

  // A mailmap-declared proper name for a canonical email, if any.
  function mailmapName(canonicalEmail: string): string | undefined {
    for (const e of entries) {
      if (e.properName && lower(e.properEmail) === canonicalEmail) return e.properName
    }
    return undefined
  }

  // Most frequent raw name per canonical email across the corpus (ties broken
  // lexicographically for determinism).
  const nameCounts = new Map<string, Map<string, number>>()
  for (const commit of commits) {
    if (!commit.email) continue
    const ce = canonEmail(commit.author, commit.email)
    const counts = nameCounts.get(ce) ?? new Map<string, number>()
    counts.set(commit.author, (counts.get(commit.author) ?? 0) + 1)
    nameCounts.set(ce, counts)
  }

  const displayName = new Map<string, string>()
  for (const [ce, counts] of nameCounts) {
    const declared = mailmapName(ce)
    if (declared) {
      displayName.set(ce, declared)
      continue
    }
    let best = ''
    let bestCount = -1
    for (const [name, count] of counts) {
      if (count > bestCount || (count === bestCount && name < best)) {
        best = name
        bestCount = count
      }
    }
    displayName.set(ce, best)
  }

  return {
    resolve(name: string, email: string): string {
      if (!email) return name
      const ce = canonEmail(name, email)
      return displayName.get(ce) ?? mailmapName(ce) ?? name
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/git/identity.test.ts`
Expected: PASS (5 parse + 4 resolver tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/git/identity.ts tests/lib/git/identity.test.ts
git commit -m "feat: add email + mailmap identity resolver"
```

---

### Task 4: Read `.mailmap`, wire identity through the pipeline, verify end-to-end

**Files:**
- Modify: `src/lib/git/identity.ts` (add `readMailmap`), `src/lib/git/aggregate-ownership.ts`, `src/hooks/useRepoAnalysis.ts`
- Test: `tests/lib/git/aggregate-ownership.test.ts`, `tests/hooks/useRepoAnalysis.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2-3, `RepoContext`.
- Produces: `readMailmap(ctx: RepoContext): Promise<MailmapEntry[]>`; `aggregateOwnership` gains a trailing `resolver?: IdentityResolver` parameter.

- [ ] **Step 1: Add `readMailmap` (append to `src/lib/git/identity.ts`) with a test**

Add to `src/lib/git/identity.ts`:
```ts
import type { RepoContext } from './repo'

/** Read and parse the repo-root .mailmap, or [] if none exists. */
export async function readMailmap(ctx: RepoContext): Promise<MailmapEntry[]> {
  try {
    const text = (await ctx.fs.promises.readFile(`${ctx.dir === '/' ? '' : ctx.dir}/.mailmap`, {
      encoding: 'utf8',
    })) as string
    return parseMailmap(text)
  } catch {
    return []
  }
}
```

Add to `tests/lib/git/identity.test.ts`:
```ts
import { buildFixtureRepo } from '../../fixtures/gitFixture'
import { makeRepoContext } from '../../../src/lib/git/repo'
import { readMailmap } from '../../../src/lib/git/identity'

describe('readMailmap', () => {
  it('reads and parses a repo-root .mailmap', async () => {
    const { fs, dir } = await buildFixtureRepo('mailmap-1', [
      {
        message: 'add mailmap',
        author: { name: 'Alice', email: 'alice@x.com' },
        files: { '.mailmap': 'Alice A <alice@x.com> <old@x.com>\n' },
      },
    ])
    const entries = await readMailmap(makeRepoContext(fs, dir))
    expect(entries).toEqual([{ properName: 'Alice A', properEmail: 'alice@x.com', commitEmail: 'old@x.com' }])
  })

  it('returns [] when there is no .mailmap', async () => {
    const { fs, dir } = await buildFixtureRepo('mailmap-2', [
      { message: 'c1', author: { name: 'Alice', email: 'alice@x.com' }, files: { 'a.txt': 'x\n' } },
    ])
    expect(await readMailmap(makeRepoContext(fs, dir))).toEqual([])
  })
})
```

Run: `npx vitest run tests/lib/git/identity.test.ts` — Expected: PASS (now 11 tests).

- [ ] **Step 2: Add resolver param to `aggregateOwnership` (write the failing test first)**

Update the existing rollup-correctness test in `tests/lib/git/aggregate-ownership.test.ts` to pass a resolver that unifies two names, and assert the unified author. Add a new test:
```ts
import { buildIdentityResolver } from '../../../src/lib/git/identity'

it('applies an identity resolver to owner author names', async () => {
  const { fs, dir, headOid } = await buildFixtureRepo('aggregate-ownership-identity', [
    {
      message: 'first',
      author: { name: 'Alice', email: 'shared@x.com' },
      files: { 'a.txt': 'one\n' },
    },
    {
      message: 'second',
      author: { name: 'Alice Alt', email: 'shared@x.com' },
      files: { 'a.txt': 'one\ntwo\n' },
    },
  ])
  const ctx = makeRepoContext(fs, dir)
  const commits = await walkHistory(ctx, 'main')
  const resolver = buildIdentityResolver([], commits)

  const { authors } = await aggregateOwnership(ctx, headOid, undefined, resolver)

  // Both commits share an email, so ownership collapses to one author.
  expect(authors).toHaveLength(1)
  expect(authors[0].linesOwned).toBe(2)
})
```
(Import `walkHistory` and `buildIdentityResolver` at the top if not already imported.)

Run: `npx vitest run tests/lib/git/aggregate-ownership.test.ts` — Expected: FAIL (aggregateOwnership takes no resolver yet).

- [ ] **Step 3: Implement the resolver param in `src/lib/git/aggregate-ownership.ts`**

Add the import and the optional param, and apply it where the author name is resolved:
```ts
import type { IdentityResolver } from './identity'
```
Change the signature:
```ts
export async function aggregateOwnership(
  ctx: RepoContext,
  headOid: string,
  onProgress?: (done: number, total: number) => void,
  resolver?: IdentityResolver
): Promise<{ files: FileOwnership[]; authors: AuthorOwnership[] }> {
```
In the owner-oid → author resolution loop, apply the resolver to the commit's author name+email:
```ts
      let author = authorNameCache.get(oid)
      if (!author) {
        const { commit } = await git.readCommit({
          fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, oid, cache: ctx.cache,
        })
        const rawName = commit.author.name
        author = resolver ? resolver.resolve(rawName, commit.author.email) : rawName
        authorNameCache.set(oid, author)
      }
```

Run: `npx vitest run tests/lib/git/aggregate-ownership.test.ts` — Expected: PASS (existing rollup + progress tests unchanged since resolver is optional, plus the new identity test).

- [ ] **Step 4: Wire identity into `useRepoAnalysis`**

In `src/hooks/useRepoAnalysis.ts` add imports:
```ts
import { readMailmap, buildIdentityResolver } from '../lib/git/identity'
```
After `const commits = await walkHistory(ctx, branch)`, build the resolver and canonicalize author names on every commit, then use canonicalized commits everywhere downstream:
```ts
      setStatus({ phase: 'walking-history' })
      const rawCommits = await walkHistory(ctx, branch)
      const resolver = buildIdentityResolver(await readMailmap(ctx), rawCommits)
      const commits = rawCommits.map((c) => ({ ...c, author: resolver.resolve(c.author, c.email) }))
      const churnCommits = filterNonMergeCommits(commits)
```
Pass the resolver to ownership:
```ts
      const { files: fileOwnership, authors: authorOwnership } = await aggregateOwnership(
        ctx,
        headOid,
        (done, total) => setStatus({ phase: 'computing-ownership', done, total }),
        resolver
      )
```
`aggregateMergeInsights(commits)` now uses the canonicalized full list automatically (merges keep their canonical author). Everything else is unchanged.

- [ ] **Step 5: Extend the `useRepoAnalysis` integration test**

Add a test to `tests/hooks/useRepoAnalysis.test.ts` that builds a fixture with two names sharing one email and asserts the author totals collapse to one identity. Follow the existing test's setup (it mocks `createFsAdapter` to return the fixture fs and builds the repo at mount `/`):
```ts
it('unifies author identities that share an email', async () => {
  const { fs } = await buildFixtureRepo(
    'use-repo-analysis-identity',
    [
      { message: 'c1', author: { name: 'Alice', email: 'shared@x.com' }, files: { 'a.txt': 'one\n' } },
      { message: 'c2', author: { name: 'Alice Alt', email: 'shared@x.com' }, files: { 'a.txt': 'one\ntwo\n' } },
    ],
    '/'
  )
  vi.mocked(createFsAdapter).mockReturnValue(fs as unknown as ReturnType<typeof createFsAdapter>)

  const { result } = renderHook(() => useRepoAnalysis())
  await act(async () => {
    await result.current.analyze({ name: 'demo' } as unknown as FileSystemDirectoryHandle)
  })
  await waitFor(() => expect(result.current.status.phase).toBe('done'))

  if (result.current.status.phase !== 'done') throw new Error('expected done')
  expect(result.current.status.analysis.authorTotals).toHaveLength(1)
})
```
(Match the exact import/mock style already used in this test file.)

- [ ] **Step 6: Full verification**

Run: `npm test` — entire suite green.
Run: `npx tsc -b --force` — zero errors.
Run: `npm run build` — succeeds.

- [ ] **Step 7: Manual browser check (environment permitting)**

If a Chromium browser is available: run against the `Promis v2` repo, confirm merge commits no longer inflate mergers, add a `.mailmap` uniting Pramod's/Dinil's identities, reload, and confirm their rows merge. If no browser, note it as outstanding.

- [ ] **Step 8: Commit**

```bash
git add src/lib/git/identity.ts src/lib/git/aggregate-ownership.ts src/hooks/useRepoAnalysis.ts tests/lib/git/identity.test.ts tests/lib/git/aggregate-ownership.test.ts tests/hooks/useRepoAnalysis.test.ts
git commit -m "feat: unify author identities via email + .mailmap across churn, merges, and ownership"
```
