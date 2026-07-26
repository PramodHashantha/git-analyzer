# Skipped-Files UI Note — Design

## Origin

`OwnershipView` silently excludes files from ownership when they aren't
plain text — today that means binary files only. While scoping this as a
small "add a UI note" feature, a real bug surfaced: `aggregateOwnership`
has **no submodule handling at all**. `git ls-tree -r` lists submodule
paths (gitlink entries, mode `160000`, pointing at a commit rather than a
blob), and the current code unconditionally runs `git show
<headOid>:<filepath>` on every listed path to check for binary content —
which **fails for a submodule path**, since there's no blob object for a
gitlink entry. That rejection is never caught, so analyzing any repo that
contains a submodule crashes the whole `/api/analyze` request today.

This design fixes that (by detecting submodules before ever attempting
`git show` on them) and, since the fix naturally produces a list of
skipped paths and why, surfaces that list in the UI — closing out the
"skipped-file UI note" item from the deferred backlog.

## Backend: detect submodules without crashing, and report what's skipped

`server/src/git/ownership.ts`'s `listFilesAtCommit` currently runs
`git ls-tree -r --name-only <headOid>` and returns bare paths. It changes
to run `git ls-tree -r <headOid>` (dropping `--name-only`, so each line
carries `<mode> <type> <oid>\t<path>`) and returns `{ filepath, isSubmodule
}[]`, where `isSubmodule` is `type === 'commit'`.

`aggregateOwnership` then branches on `isSubmodule` **before** calling
`git show`:

- Submodule entries are recorded as `{ filepath, reason: 'submodule' }`
  and never reach `git show`/`git blame`.
- Non-submodule entries proceed exactly as today: fetch the blob, check
  `isBinaryBlob`; binary ones are now recorded as `{ filepath, reason:
  'binary' }` (previously silently dropped with no record at all); text
  files are blamed and counted as before.

New shared type:

```ts
export interface SkippedFile {
  filepath: string
  reason: 'binary' | 'submodule'
}
```

`aggregateOwnership`'s return type gains `skipped: SkippedFile[]` alongside
the existing `files`/`authors`. `RepoAnalysis` gains a top-level
`skippedFiles: SkippedFile[]` field, populated in `analyzer.ts` from
`aggregateOwnership`'s new return value — no other analyzer wiring changes.

## Frontend: a small, expandable note

`OwnershipView` gains a summary line above the existing tables — e.g.
*"14 files excluded from ownership (12 binary, 2 submodules)"* — that,
when clicked, expands into a simple list of `{ filepath, reason }`, in the
same click-to-expand interaction style already used for the file/owner
detail panel. When `skippedFiles` is empty, nothing renders (no empty
"0 files excluded" clutter).

## Testing

- `server/src/git/ownership.test.ts`: a new test builds a real repo with
  an actual submodule (via `git submodule add <otherRepoDir>`, both built
  with `buildRealGitRepo`) and asserts `aggregateOwnership` no longer
  throws, the submodule path appears in `skipped` with `reason:
  'submodule'`, and does not appear in `files`. The existing binary-file
  test is extended to also assert the binary path now appears in
  `skipped` with `reason: 'binary'` (previously only asserted its absence
  from `files`).
- `server/src/analyzer.test.ts`: extended to assert `skippedFiles` appears
  in the composed `RepoAnalysis`.
- New `OwnershipView` component tests: the summary line renders with the
  correct counts and reasons breakdown, expands on click to show the list,
  and renders nothing when `skippedFiles` is empty.

## Out of scope

Everything else still deferred from the earlier backlog list (real
streaming progress, temporal coupling, code age, per-release comparison,
on-disk cache, clone-by-URL, desktop packaging, AI summaries) is untouched
by this round.
