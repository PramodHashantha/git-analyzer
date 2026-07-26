# Trustworthy Contribution Metrics — Design

## Origin

Comparing the app's Contribution Overview against a `git`-based PowerShell
script on a real repo revealed two systematic distortions, confirmed by
diagnostics on that repo (`Promis v2`, branch `Pramod-dev`):

- **Merge-heavy history**: 502 commits reachable from HEAD, only 125 on the
  first-parent chain, 196 merge commits. The app diffs every commit against
  its first parent — including merges — so merge commits credit whoever
  performed the merge with all the merged-in work. `git log --numstat` (and
  most contribution tools) skip merges.
- **Fragmented author identity**: the same humans commit under multiple
  name/email pairs (`git shortlog -sne --all` output):
  - Pramod: `PramodHashantha <hashanthapramod00@gmail.com>` and
    `Hashantha Pramod <…+PramodHashantha@users.noreply.github.com>`
  - Dinil: `DinilDulneth <dinildulneth123@gmail.com>` and
    `Dinil Dulneth <…+DinilDulneth@users.noreply.github.com>`
  - `ravindu0823` and `R R D Perera`, both `<guestpc87@gmail.com>`
  The app groups by exact author name, so one person is split across rows.

This design makes the contribution numbers reflect authored code by one
canonical person, matching git/`shortlog` conventions.

## Decisions (settled during brainstorming)

- **Exclude merge commits entirely** from contribution stats — not counted as
  commits and contributing zero lines. Merge-insights (which counts merges) is
  the only place that still consumes merge commits.
- **Unify identities by email + `.mailmap`** (git standard). No auto/heuristic
  guessing. Absent `.mailmap` degrades gracefully to email-grouping.

## Part A — Exclude merge commits from contribution stats

`walkHistory` already returns every commit with an `isMerge` flag. Contribution
churn — `computeAllCommitStats` and the aggregations it feeds
(`aggregateAuthorTotals`, `aggregateActivityOverTime`, `aggregateCommitPatterns`)
— operates on the **non-merge commits only**. `aggregateMergeInsights` continues
to receive the full commit list (it counts merges per author).

Implementation point: the filter lives in the orchestrator (`useRepoAnalysis`),
which already holds the full `commits` array. It passes
`commits.filter((c) => !c.isMerge)` to `computeAllCommitStats`, and the full
`commits` to `aggregateMergeInsights`. No change to `commit-stats.ts` or the
churn aggregators themselves. Because `aggregateAuthorTotals` derives the
per-author commit count from the `CommitStats[]` it receives, excluding merges
from that input also makes the Commits column reflect real code commits.

Ownership/blame is unaffected: it is first-parent based and already attributes
lines to the commit that introduced them.

## Part B — Author identity unification

### New module `src/lib/git/identity.ts`

1. **`parseMailmap(text: string): MailmapEntry[]`** — parse the standard git
   `.mailmap` format, supporting all four line forms:
   - `Proper Name <proper@email>`
   - `<proper@email> <commit@email>`
   - `Proper Name <proper@email> <commit@email>`
   - `Proper Name <proper@email> Commit Name <commit@email>`
   Comment lines (`#`) and blank/malformed lines are skipped. Emails are
   compared case-insensitively (git lowercases them for matching).

2. **`buildIdentityResolver(entries, commits): IdentityResolver`** — returns
   `resolve(name: string, email: string): string` yielding the canonical
   display name. Resolution order:
   1. Mailmap match — by commit email (and name+email form) — returns the
      declared proper name.
   2. Otherwise group by lowercased email; the canonical name is the mailmap
      proper name if any entry declares that email, else the most frequently
      used name for that email across `commits` (ties broken deterministically,
      e.g. lexicographically, so results are stable).
   3. Missing/empty email → fall back to the raw name as its own group.

   The resolver is built once per analysis run from the parsed mailmap plus a
   single scan of the commit corpus (for the most-frequent-name choice).

### Wiring

- `useRepoAnalysis` reads `.mailmap` from the repo root via the fs adapter
  (absent → empty mailmap), builds the resolver from the parsed entries and the
  walked commits, then **rewrites each `CommitInfo.author` to the canonical
  name** (and keeps the raw email). Because every churn and merge aggregation
  keys on `commit.author`, they all pick up unified identities with no further
  change.
- **Ownership** (`aggregate-ownership.ts`) resolves an owner commit oid to an
  author via `git.readCommit`. It applies the same resolver
  (`resolve(commit.author.name, commit.author.email)`) so ownership rows use the
  same canonical identities. The resolver is passed in (dependency injection)
  rather than rebuilt, keeping `aggregate-ownership` free of mailmap I/O.

### Canonicalization timing

Identity canonicalization happens AFTER the merge-exclusion filter and history
walk but BEFORE aggregation, so a person's split identities are unified before
any per-author rollup.

## Edge cases

- **No `.mailmap`**: resolver does pure email-grouping. The `ravindu0823` /
  `R R D Perera` shared-email case merges automatically; distinct-email
  identities (Pramod, Dinil) remain separate until the user adds mailmap lines.
- **Missing email on a commit**: grouped under the raw name (its own identity).
- **Malformed mailmap lines**: skipped, not fatal.
- **Case-only email differences**: treated as the same identity.
- **A commit authored on the first commit (no parent)**: unaffected — identity
  logic is orthogonal to diffing.

## Testing

- `parseMailmap`: each of the four line forms, comments, blank/malformed lines.
- `buildIdentityResolver`: email-grouping (shared-email merge), mailmap override
  uniting two emails into one person, most-frequent-name selection, missing
  email fallback, no-mailmap behavior.
- Merge exclusion: a fixture with a merge commit; assert churn totals/commit
  counts exclude the merge while merge-insights still counts it.
- Integration: `useRepoAnalysis` end-to-end over a fixture with split
  identities + a `.mailmap`, asserting unified author rows and merge-excluded
  churn.

## Out of scope

- Auto/heuristic identity guessing (e.g. deriving usernames from github
  noreply emails) — the user chose explicit `.mailmap`.
- Rename/copy detection.
- Changing ownership's first-parent blame semantics.
- Any UI redesign; the existing tables/charts consume the same shapes.
