# Blame Through Merges — Design

## Origin

Current ownership uses **first-parent-only** blame. In a PR-merge workflow
(confirmed on the real `Promis v2` repo: 502 commits, only 125 on the
first-parent chain, 196 merges), work merged in via someone else's PR lives on
the *second* parent of a merge. The first-parent walk never visits those
commits, so it credits the merged-in lines to whoever performed the merge — not
the real author. That is why Lahiru Jayarathne and Rashi are absent from
Current Ownership despite writing code that survives at HEAD, and why the
GitHub-merge identities (DinilDulneth / "Hashantha Pramod") show inflated
ownership.

This design replaces first-parent ownership with real `git blame` semantics
(minus rename detection) so each surviving line is credited to the commit — on
whatever parent path — that actually introduced it.

## Decisions (settled during brainstorming)

- **Pragmatic real blame:** follow the correct parent at each merge so true
  authors are credited. **No rename/copy detection** (`-M`/`-C`) — a renamed
  file's pre-rename history is attributed to the rename commit, matching plain
  `git blame`.
- **Accept slower, rely on the cache:** ownership goes back to per-file blame
  (the fast first-parent single-pass cannot express multi-parent blame). It is
  slower to compute but cached in IndexedDB per repo+branch+HEAD, so the cost is
  one-time. Keep the existing bounded concurrency; no heavier perf work.

## Algorithm: multi-parent backward blame

Standard `git blame` (without rename detection). For one file at HEAD:

- Represent progress as a set of **line claims**: each HEAD line has a current
  *suspect* commit and its *position* (line index) in that suspect's version of
  the file, or is *resolved* (final owner assigned).
- Process suspects **newest-first** using a priority queue keyed by commit
  timestamp (git's default ordering). A commit is processed once, with all
  currently-pending lines that point at it.
- For the suspect commit `C` with pending lines `L`:
  - If `C` has no parents: every line in `L` is introduced here → resolve them
    to `C`.
  - Otherwise, for each parent `P` of `C` (in parent order):
    - Read `C`'s and `P`'s version of the file; diff them (same `diffLines` +
      shared newline normalization used everywhere else).
    - For each still-pending line in `L` whose position in `C` maps to an
      **unchanged** position in `P` (context line), reassign its suspect to `P`
      at the mapped position. Once a line is passed to a parent, later parents
      are not considered for it (first parent that contains it wins — git's
      behavior).
  - Any line in `L` that was **not** passed to any parent (changed relative to
    every parent) is introduced at `C` → resolve to `C`.
  - Enqueue every parent that received lines.
- Terminate when no pending lines remain.

For linear (single-parent) history this reduces to the current backward blame.
For a merge, a line unchanged vs the second parent is handed to that parent and
followed into the merged branch, landing on the real author. A line changed vs
**all** parents (e.g. a conflict resolution written during the merge) is
correctly blamed on the merge commit's author. Octopus merges (>2 parents) work
via the generic per-parent loop.

## Architecture

- **`src/lib/git/blame.ts`**: replace the first-parent `blameFile` with a
  multi-parent implementation `blameFile(ctx, headOid, filepath): Promise<string[]>`
  (unchanged signature — returns owner-oid per HEAD line). It reads file
  versions via the shared blob helpers and uses the shared `applyChange`-style
  diff mapping.
- **`src/lib/git/aggregate-ownership.ts`**: blame each **text** file present at
  HEAD (via `git.listFiles`), skipping binary files (`isBinaryBlob`), using the
  existing `mapWithConcurrency` / `GIT_READ_CONCURRENCY`. Resolve owner oids to
  author names through the injected `IdentityResolver` (unchanged), roll up to
  the same `{ files: FileOwnership[]; authors: AuthorOwnership[] }` shape.
- **Retire `src/lib/git/ownership-walk.ts`** (`computeAllOwnership` and its
  first-parent forward walk) and its tests — it is inherently first-parent and
  is fully replaced by per-file multi-parent blame. `applyChangeToOwners` /
  helpers move into `blame.ts` if still needed, or are removed.
- **Cache**: bump `ANALYSIS_VERSION` (to 4) so pre-change ownership results are
  not served.
- Binary exclusion, `.mailmap` identity resolution, dashboard shapes, and the
  churn/merge/activity paths are unchanged.

## Validation: match real `git blame`

Correctness is proven against the reference implementation, not hand-written
expectations:

- A test helper builds **real git repositories** in a temp dir using the `git`
  CLI (`child_process`), including **merge commits** with work authored by
  different people on branches merged by someone else.
- For each file at HEAD, the test runs `git blame --line-porcelain <file>` to
  get git's per-line author, runs our `blameFile`, resolves our owner oids to
  authors, and asserts they **match line-for-line**.
- Scenarios: linear edits; a feature branch merged by a different author
  (the core case); multiple merges; a conflict resolved in the merge commit
  (blamed on the merger); a file added only on a merged branch.
- Tests require `git` on PATH (documented). Pure-logic pieces (the diff
  line-mapping) keep fast unit tests that don't shell out.

## Edge cases

- **Root commit / no parent**: remaining lines blamed on that commit.
- **Merge conflict resolution** (line differs from all parents): blamed on the
  merge author — matches `git blame`.
- **File added on the merged branch only**: `beforeOid` absent on the
  first-parent side but present via the second parent; the per-parent diff
  passes those lines to the second parent → real author.
- **Octopus merges (>2 parents)**: generic per-parent loop.
- **Clock skew**: timestamp-priority ordering can mis-order commits with bad
  clocks (same limitation as git's default, which also uses commit date); not
  handled specially.
- **Binary files**: excluded before blame (never enumerated for ownership).

## Out of scope

- Rename/copy detection (`-M`/`-C`).
- Exact parity with git in pathological tie-break/clock-skew cases.
- Any change to churn, activity, commit-pattern, merge-insights, filters, or UI
  shapes.
- Re-optimizing ownership back to single-pass speed (accepted trade-off).
