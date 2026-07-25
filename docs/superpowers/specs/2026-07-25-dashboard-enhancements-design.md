# Dashboard Enhancements — Design

## Origin

With the local git backend in place (real `git` shelling out, no more in-browser
reimplementation), a "next phase" list of possible features was drawn up:
UI polish, a repo-hygiene warning, two new analyses, and surfacing data the
backend already computes but the UI never rendered. This spec covers the
first five items from that list, chosen as the next round:

1. An indeterminate progress bar instead of loading text.
2. A stale-branch warning (motivated directly by a real incident this
   session: a local `main` branch was far behind `origin/main`, silently
   producing misleadingly low contribution numbers).
3. Hotspots — files with high churn and many distinct authors.
4. Bus factor — files owned almost entirely by one author.
5. Wiring up hour-of-day/largest-commit (already computed, never rendered)
   and a week/month granularity toggle for the activity chart.

Deferred to a later round: temporal coupling, code age, per-release
comparison, on-disk/persistent cache, clone-by-URL, desktop packaging, AI
summaries.

## 1. Indeterminate progress bar

`src/components/StatusPanel.tsx`'s `loading` case currently renders
`<p>Analyzing repository…</p>`. This becomes an animated bar (a thin
striped/gradient bar with a CSS keyframe animation, added to `src/index.css`)
alongside or instead of the text. No change to `AnalysisStatus` or any other
component's interface — this is a pure rendering change in one file plus a
CSS animation definition.

This is deliberately **not** real progress (no percentage) — the backend
returns the full `RepoAnalysis` in one response, so the frontend has no
mid-request visibility into how far along the analysis is. A real
percentage-based bar would require streaming (e.g. Server-Sent Events) and
is out of scope here; the design explicitly settled for an indeterminate
bar since current analysis times don't yet justify that complexity.

## 2. Stale-branch warning

**Backend:** add to `server/src/git/repo.ts`:

```ts
export interface BranchUpstreamStatus {
  hasUpstream: boolean
  upstreamName?: string
  ahead: number
  behind: number
}

export async function getUpstreamStatus(repoPath: string, branch: string): Promise<BranchUpstreamStatus>
```

Implementation: resolve `<branch>@{upstream}` via
`git rev-parse --abbrev-ref <branch>@{upstream}`; if that git call fails
(non-zero exit — no upstream configured, the common case for feature
branches), return `{ hasUpstream: false, ahead: 0, behind: 0 }`. Otherwise
run `git rev-list --left-right --count <branch>...<upstream>` and parse the
two counts (ahead, behind) from the tab-separated output.

`shared/types.ts`'s `RepoAnalysis` gains a `branchStatus: BranchUpstreamStatus`
field. `server/src/analyzer.ts`'s `computeAnalysis` calls `getUpstreamStatus`
alongside its other reads and includes the result.

**Frontend:** `App.tsx` renders a dismissible banner above the dashboard
when `analysis.branchStatus.hasUpstream && analysis.branchStatus.behind > 0`:

> ⚠️ Local branch "main" is 12 commits behind origin/main — results may be
> missing recent work. Run `git fetch origin main:main` to update.

Dismiss state is local component state (`useState`), reset whenever the
branch or repo changes (not persisted) — reappears next time a stale branch
is analyzed rather than being permanently silenced.

## 3. Hotspots

New pure module `shared/aggregate-hotspots.ts`:

```ts
export interface HotspotEntry {
  filepath: string
  totalChurn: number     // sum of added+deleted across all commitStats entries for this file
  authorCount: number     // distinct authors who touched this file
  score: number            // totalChurn * authorCount
}

export function aggregateHotspots(commitStats: CommitStats[], limit = 20): HotspotEntry[]
```

Sorted by `score` descending, capped to `limit`. Computed **client-side**:
`App.tsx`'s existing `filtered` `useMemo` (which already re-derives
`authorTotals`/`activity`/`commitPatterns` from date/author-filtered
`commitStats`) gains `hotspots: aggregateHotspots(authorAndDateFilteredStats)`.
This means hotspots automatically respect the existing filters for free, and
needs no backend or `RepoAnalysis` change — `commitStats` is already shipped
to the frontend in full.

New component `src/components/Dashboard/HotspotsTable.tsx`: a ranked table
(File, Total churn, Authors, Score), same visual style as the existing
`OverviewTable`.

## 4. Bus factor

New pure module `shared/aggregate-bus-factor.ts`:

```ts
export interface BusFactorEntry {
  filepath: string
  totalLines: number
  topAuthor: string
  topAuthorPercentage: number   // topAuthor's share of totalLines, 0-100
}

export function aggregateBusFactor(
  fileOwnership: FileOwnership[],
  thresholdPercentage = 80,
  minLines = 5
): BusFactorEntry[]
```

Filters to files where `totalLines >= minLines` and the top owner's share is
`>= thresholdPercentage`, sorted by percentage descending, capped to top 20.
Operates on `analysis.fileOwnership` directly (the HEAD blame snapshot) —
like the existing `OwnershipView`, this is **not** affected by the
date-range/author filters, since ownership reflects current state rather
than a historical range. Computed once per analysis, not inside the
filtered `useMemo`.

New component `src/components/Dashboard/BusFactorTable.tsx`: ranked table
(File, Total lines, Top author, % owned).

## 5. Wire up already-computed data

**Hour-of-day + largest commit:** `shared/aggregate-churn.ts`'s
`aggregateCommitPatterns` already computes `hourOfDayCounts: number[]` (24
entries) and `largestCommit: { oid, lines }` per author, but
`CommitPatternsHeatmap.tsx` only renders `dayOfWeekCounts` and
`avgLinesPerCommit`. Add a second heatmap row (24 cells, same
color-intensity styling as the existing day-of-week row) and a
"largest commit: N lines" caption next to the existing average.

**Week/month granularity toggle:** currently `analysis.activity` is
computed once, server-side, at a fixed `'month'` granularity
(`server/src/analyzer.ts` calls `aggregateActivityOverTime(commitStats,
'month')`), and the frontend filters that pre-bucketed data by date range
after the fact. This add a `granularity` state (`'week' | 'month'`, default
`'month'`) in `App.tsx` with two toggle buttons near
`ActivityOverTimeChart`. Instead of reading `analysis.activity`, the
frontend's `filtered` `useMemo` now calls the existing shared
`aggregateActivityOverTime(authorAndDateFilteredStats, granularity)`
directly — computing activity from the already-filtered `commitStats`
rather than filtering pre-bucketed monthly data. This is strictly more
correct (a partial-month date range no longer risks including/excluding a
whole bucket) as a side effect, and needs no backend or type change; the
server-computed `analysis.activity` field remains in `RepoAnalysis` for
API-shape stability but the dashboard stops reading it directly.

## Testing

- `shared/aggregate-hotspots.ts` / `aggregate-bus-factor.ts`: unit tests
  with hand-built `commitStats`/`fileOwnership` fixtures, covering scoring,
  the `minLines`/threshold filters, and the top-N cap.
- `server/src/git/repo.ts`'s `getUpstreamStatus`: tested with
  `tests/fixtures/realGitRepo.ts`-built repos — a branch with a real
  upstream configured and ahead/behind commits (via a local bare remote),
  and a branch with no upstream at all (asserting `hasUpstream: false`).
- `server/src/analyzer.test.ts`: extended to assert `branchStatus` appears
  in the composed `RepoAnalysis`.
- New component tests for `HotspotsTable`, `BusFactorTable`, the extended
  `CommitPatternsHeatmap` (hour-of-day + largest commit rendered), the
  granularity toggle, and the stale-branch banner (rendered only when
  `behind > 0`, absent otherwise).
- `StatusPanel`'s progress-bar test just confirms the loading state still
  renders (visual-only change, no new behavioral assertions needed beyond
  what exists).

## Out of scope (this round)

Temporal coupling, code age/staleness, per-release comparison, real
percentage-based streaming progress, on-disk/persistent cache, clone-by-URL,
desktop packaging, AI summaries — all remain deferred candidates for a
future round.
