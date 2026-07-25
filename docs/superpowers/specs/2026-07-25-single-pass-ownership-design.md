# Single-Pass Ownership — Design

## Origin

Current ownership analysis (`src/lib/git/aggregate-ownership.ts` +
`src/lib/git/blame.ts`) blames each file independently, and each blame walks
the file's entire first-parent history. That is O(files × commits): a
500-commit repo with ~200 files does up to ~100,000 per-file history passes,
re-reading and re-diffing the same blobs repeatedly. Even after the shared
isomorphic-git cache, directory-handle caching, and bounded concurrency
already landed, this remains the dominant cost on large repos.

This design replaces the per-file backward blame with a single forward pass
over history that only touches the files changed in each commit, computing
the identical per-line ownership far faster.

## Decisions (settled during brainstorming)

- **Exact parity.** The new algorithm must produce byte-for-byte the same
  per-line attribution as the current `blameFile`. The current blame is kept
  as a test oracle; fixture tests assert the two agree line-for-line.
- **Ownership only.** This rewrite touches only the ownership path. The churn
  path (`computeAllCommitStats`) is left as-is; unifying the two walks is a
  possible future step, explicitly out of scope here.

## Why the result is identical

A surviving HEAD line's owner is "the most recent first-parent commit that
added or changed it."
- Backward blame finds it by walking back until the line first appears as an
  added line.
- The forward pass finds it by stamping the owner every time a line is added,
  letting later commits overwrite earlier ones — so what remains at HEAD is
  the most-recent add.

Both select the same commit for every line, provided both use the identical
diff and newline handling. That last condition is why parity must be proven
by test, not assumed (see Parity Strategy).

## Architecture

New module `src/lib/git/ownership-walk.ts` with two exports:

1. **`applyChangeToOwners(beforeOwners, beforeText, afterText, commitOid): string[]`**
   — a pure function (no git, no I/O). Given the owner-oid of each line of a
   file's parent version (`beforeOwners`), the parent text, the child text,
   and the current commit oid, it returns the owner-oid of each line of the
   child version:
   - unchanged (context) lines inherit their owner from `beforeOwners` by
     position,
   - added lines are owned by `commitOid`,
   - removed lines are dropped.
   This reuses the same `diffLines` engine and the same newline-normalized
   line splitting as `blame.ts`. All correctness lives here; it is unit-tested
   directly.

2. **`computeAllOwnership(ctx, headOid, onProgress?): Promise<Map<string, string[]>>`**
   — the forward walk. Returns a map of filepath → owner-oid-per-line for
   every file present at `headOid`.

### The forward walk

1. Build the first-parent chain from `headOid` back to the root commit
   (follow `parent[0]` repeatedly), then process it oldest → newest.
2. Maintain `state: Map<filepath, string[]>` = current owner-oid per line for
   each file as it exists at the commit being processed.
3. For each commit `C` with first parent `P` (or no parent at the root):
   - `listChangedFiles(ctx, C.oid, P?.oid ?? null)` (reused verbatim from
     `line-diff.ts`) gives the changed files with `beforeOid`/`afterOid`,
     already skipping trees and submodule/non-blob entries.
   - For each changed file (processed with bounded concurrency —
     `mapWithConcurrency` / `GIT_READ_CONCURRENCY`, safe because each file's
     `state` entry is independent within a commit):
     - **Deleted** (`afterOid === null`): remove the file from `state`.
     - **Added** (`beforeOid === null`): read `after` lines; owners = every
       line owned by `C`.
     - **Modified**: read `before` lines and `after` lines (via the same
       readBlob path and newline normalization as `blame.ts`); compute new
       owners = `applyChangeToOwners(state[file], beforeText, afterText,
       C.oid)`.
     - Set `state[file]` to the new owner array.
   - Report progress once per commit.
4. After the walk, `state` holds owner-oid-per-line for every file at HEAD.

### Rolling up

`aggregateOwnership(ctx, headOid, onProgress)` is rewritten to:
1. call `computeAllOwnership` to get the per-line owners for all files,
2. resolve owner oids to author names (via `git.readCommit`, using the same
   `authorNameCache` approach as today) and count lines per author per file,
3. produce the exact same `{ files: FileOwnership[]; authors: AuthorOwnership[] }`
   output it produces now (same `FileOwnership`/`AuthorOwnership` shapes,
   same sorting, same percentage math).

Its public signature is unchanged, so `useRepoAnalysis` needs no change beyond
progress semantics (below).

## Parity strategy

- `blame.ts`'s `blameFile` is retained and becomes the correctness oracle.
- A dedicated test builds several fixture repos and asserts, for every file at
  HEAD, that the new single-pass owner array equals `blameFile`'s output
  exactly. Fixtures must cover: linear history, a merge commit (first-parent
  only), a file deleted then re-added, a file with no trailing newline, and a
  file whose original lines survive to HEAD (forces full-history attribution).
- `applyChangeToOwners` also has focused unit tests (pure add, pure delete,
  context-preserving edit, full replacement, empty file).

## State invariant (correctness-critical)

`state[file].length` must always equal the line count of that file's current
version (as produced by the shared newline-normalized splitter). Because the
walk follows the first parent and updates `state[file]` on every change, the
entry present when commit `C` changes a file equals that file's owners at
`P` — matching `C`'s `beforeOid` content. The implementation asserts
`beforeOwners.length === beforeLines.length` before mapping and fails loudly
on mismatch rather than producing silently wrong ownership.

## Progress and UI

The ownership phase now reports progress per **commit** rather than per file.
`AnalysisStatus`'s `computing-ownership` phase keeps its `{ done, total }`
shape, but `StatusPanel` copy for that phase changes from "N / M files" to a
file-agnostic label (e.g. "N / M commits") so the text matches what is being
counted.

## Concurrency

Commits are processed strictly sequentially (state evolves commit to commit).
Changed files within a single commit are processed concurrently via the
existing `mapWithConcurrency` helper. The dominant speedup is algorithmic
(only changed files, each diffed once) rather than from concurrency.

## Edge cases

- **Root commit**: `listChangedFiles(C, null)` returns every file as added →
  all lines owned by the root commit. No special-casing needed.
- **Merges**: first-parent only, identical to the current blame and to
  `commit-stats.ts`, keeping churn and ownership consistent.
- **Binary / submodule / tree entries**: skipped by the reused
  `listChangedFiles`, exactly as today.
- **Delete then re-add**: the delete removes the file from `state`; the re-add
  re-creates it with all lines owned by the re-adding commit — matching
  backward blame.
- **Trailing-newline normalization**: the walk MUST use the same line-splitting
  helper as `blame.ts` (which strips a trailing empty element and re-adds a
  newline before diffing); any divergence breaks parity.

## Out of scope (this change)

- Unifying churn and ownership into one history walk.
- Rename/copy detection (isomorphic-git does not infer renames; the current
  blame does not either).
- Any change to churn, activity, commit-pattern, merge, or filter logic.
- Large-repo streaming/memory strategy beyond the existing small/medium target
  (the full per-line owner map for all HEAD files is held in memory, as the
  per-file approach effectively did too).
