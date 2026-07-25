# Local Git Backend — Design

## Origin

The app currently reads repos entirely in the browser via the File System
Access API + isomorphic-git (a JS reimplementation of git). That drove real
pain: slow blame/object reads, Chromium-only, a hand-written multi-parent
blame, a mailmap parser, binary detection, a Buffer polyfill, pack-index
handling. The user only ever analyzes **local clones on their own machine**
and does not need a hosted/shareable URL — so the one advantage of the
client-side design is moot.

This design replaces the in-browser git layer with a **local Node backend
that shells out to the real `git` binary**, serving the existing dashboard.
Real git is faster, correct out of the box (rename-aware blame, native
mailmap, binary handling, merges), works in any browser, and handles any repo
size. Clone access is sufficient — repo ownership is irrelevant, since full
history lives in the local clone.

## Decisions (settled during brainstorming)

- **v1 = port the existing dashboard onto real git.** Same features/shape,
  now backed by git. New analyses (hotspots, bus factor, per-release,
  coupling, AI) are later rounds.
- **Fully replace the in-browser git layer.** Delete isomorphic-git, the File
  System Access adapter, and the hand-written blame/mailmap/binary/Buffer
  code. One path, much simpler.
- **Repo input = type/paste a local path + a recent-repos list.** No
  clone-by-URL or server-side folder browser in v1.

## Architecture

Two local processes, both on `127.0.0.1`:

- **Backend** (`server/`): Node + TypeScript + Express. Shells out to `git`
  via `child_process.execFile` (argument arrays — never a shell string).
  Exposes a small JSON API. Serves the built frontend in production.
- **Frontend** (`src/`): the existing Vite + React dashboard, visually
  unchanged. Its data source swaps from isomorphic-git to `fetch('/api/...')`.
  In dev, Vite proxies `/api` to the backend; in prod, one process serves both.

### API

- `GET /api/analyze?path=<repoPath>&branch=<branch?>` → `RepoAnalysis` JSON.
  - Validates `path` is a real git repo (`git -C <path> rev-parse
    --is-inside-work-tree`); 400 with a clear message otherwise.
  - `branch` optional; defaults to the repo's current branch.
- Errors return `{ error: string }` with an appropriate status.

### The data contract keeps the frontend intact

The backend returns the **existing `RepoAnalysis` shape** (`repoName`,
`branch`, `branches`, `headOid`, `commits`, `commitStats`, `authorTotals`,
`activity`, `commitPatterns`, `fileOwnership`, `authorOwnership`,
`mergeInsights`). Dashboard components, `types.ts`, and client-side filtering
carry over.

## Git commands behind each part of `RepoAnalysis`

The backend has a **git-reader** module that runs git and parses output into
the existing structures, then reuses the existing pure aggregators.

- **Branches / current branch / head oid**: `git branch --format`,
  `git rev-parse --abbrev-ref HEAD`, `git rev-parse <branch>`.
- **`commits: CommitInfo[]`**: `git log <branch> --pretty=format:<delimited>`
  capturing oid, parent oids, mailmap-resolved author (`%aN`), email (`%aE`),
  author timestamp (`%at`), subject. `isMerge = parentOids.length > 1`.
- **`commitStats: CommitStats[]`** (non-merge, for churn):
  `git log <branch> --no-merges --numstat --pretty=format:<delimited>`. Binary
  files appear as `-\t-` and are skipped — no `isBinaryBlob` needed.
- **`fileOwnership: FileOwnership[]`**: enumerate tracked files at the branch
  head (`git ls-files`), and for each **text** file run
  `git blame --line-porcelain <file>` to get per-line commit + author-mail.
  Files git reports as binary are skipped. Author identities are unified via
  git's mailmap (resolve each unique `Name <email>` once with
  `git check-mailmap`). Real blame handles renames and merges correctly.
- **`authorTotals` / `activity` / `commitPatterns`**: reuse the existing
  `aggregate-churn` functions over the parsed `commitStats`/`commits`.
- **`authorOwnership`**: roll up `fileOwnership` per author (existing math).
- **`mergeInsights`**: reuse `aggregate-merges` over `commits`.

Because git's `%aN`/`%aE` and `check-mailmap` apply `.mailmap` natively,
identity unification is free — the JS mailmap parser + resolver are removed.

## Filtering

Branch selection re-requests `/api/analyze?branch=`. Date-range and author
filters stay **client-side** (as today), re-aggregating from the returned
`commitStats` via the shared aggregators — instant, no re-fetch.

## Caching

Drop IndexedDB. The backend keeps a simple cache keyed by
`repoPath + branch + headOid` (headOid is a cheap `git rev-parse` up front).
In-memory per server run is sufficient for v1; on-disk is a later option.

## Project structure

- `shared/` — framework-agnostic modules imported by BOTH sides: `types.ts`
  and the pure aggregators (`aggregate-churn`, `aggregate-merges`). (Moved
  out of `src/lib`.)
- `server/` — Express app, the git-reader, the analyzer that composes
  `RepoAnalysis`, the cache, and prod static serving.
- `src/` — the React dashboard: components unchanged; a rewritten
  `useRepoAnalysis` that fetches the API; a new `RepoPicker` (path input +
  recent list via `localStorage`) replacing `FolderPicker`; client-side
  filters + `directory-rollup` stay here.

## What's deleted

`isomorphic-git`, `@isomorphic-git/lightning-fs`, `idb`, `buffer`,
`fs-adapter.ts`, `blame.ts`, `line-text.ts`, `line-diff.ts`, `history.ts`,
`commit-stats.ts`, `repo.ts` (isomorphic-git version), `binary.ts`,
`identity.ts`, `aggregate-ownership.ts` (browser version), `cache/db.ts`,
`polyfills.ts`, `browser-support.ts`, `UnsupportedBrowserNotice`,
`FolderPicker`, and their tests (including the blame-parity tests — we now use
real `git blame` directly rather than reimplementing it). The dashboard chart
components and the aggregation math survive.

## Security

- `git` is always invoked with `execFile('git', [...args])` — no shell,
  no interpolation of user input into a command string.
- The repo path is validated as an existing directory that is a git work tree
  before any other git call.
- The server binds to `127.0.0.1` only.

## Testing

- **Backend** (Vitest, node env): the git-reader/analyzer is tested by
  building **real git repos via the `git` CLI** (reusing the `realGitRepo`
  test helper) and asserting the parsed `RepoAnalysis` — churn totals,
  ownership (incl. a merged-in author credited correctly, and binary files
  excluded), activity/patterns, mailmap unification, merge insights.
- **API**: an integration test hits `/api/analyze` against a temp repo and
  checks the JSON shape + a few values; invalid-path returns 400.
- **Frontend**: existing dashboard component tests remain; `useRepoAnalysis`
  is tested with `fetch` mocked; `RepoPicker` gets a small test.

## Run

- `npm run dev` — Vite dev server + backend concurrently (Vite proxies `/api`).
- `npm start` — build the frontend, then run the server serving `dist` +
  the API. Requires `git` on PATH (documented in the README).

## Out of scope (later rounds)

- New analyses: hotspots, temporal coupling, bus factor, code-age, per-release
  comparison.
- Clone-by-URL, server-side folder browser.
- AI summaries, external data (GitHub API, language/complexity tools).
- On-disk/persistent cache and incremental updates.
- Packaging as a desktop app.
