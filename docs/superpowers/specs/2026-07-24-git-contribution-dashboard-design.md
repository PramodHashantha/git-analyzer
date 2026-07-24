# Git Contribution Dashboard — Design

## Origin

The idea started from a PowerShell script (see `readme.txt`) that runs inside a local
git repo and tallies added/deleted/net lines per author via `git shortlog` and
`git log --numstat`. The goal is to turn that one-off script into a proper web app
with a dashboard UI and richer analysis, hosted on Vercel.

## 1. Architecture

Vercel hosting rules out a traditional backend that shells out to `git` on the
user's machine (a serverless function runs on Vercel's infra, not the user's
computer, and has no access to an arbitrary local folder path). To reconcile
"hosted on Vercel" with "analyze a local folder," this app is **fully client-side**:

- **Vite + React + TypeScript** single-page app, deployed as a static site on
  Vercel. No backend/API routes.
- **Repo access**: the browser's File System Access API
  (`window.showDirectoryPicker()`). This restricts the app to Chromium browsers
  (Chrome, Edge) — Firefox and Safari don't support it. The app detects
  unsupported browsers and shows an explicit message.
- **Git parsing**: `isomorphic-git`, used to walk commits, resolve refs/branches,
  and read tree/blob objects. isomorphic-git expects a Node-fs-like interface
  (`readFile`, `readdir`, `stat`, etc.); there is no existing off-the-shelf
  adapter that bridges a `FileSystemDirectoryHandle` to that interface, so a
  **custom read-only fs adapter** is a required, non-trivial build item.
- **Line diffing**: a JS line-diff library (e.g. the `diff` package, Myers
  algorithm) is used both for computing per-commit added/deleted line counts and
  as the base of the blame algorithm (see below), so the same diff engine
  serves both features.
- **Caching**: IndexedDB (via the `idb` package), keyed by repo + branch head
  commit SHA, so re-opening an already-analyzed repo at the same commit loads
  instantly, and new commits trigger incremental recompute rather than a full
  history re-walk.

Because repos are expected to be small/medium (up to a few thousand commits,
a few hundred files), eager whole-repo blame computation on load is acceptable
performance-wise, with a progress indicator.

## 2. Analysis pipeline

1. **Commit history walk**: for the selected branch, walk commits collecting
   author, timestamp, message, and parent links.
2. **Per-commit line stats**: for each commit, diff each changed blob against
   its parent version to get added/deleted line counts per file per commit —
   this reproduces (and generalizes) the original script's
   `git log --numstat` behavior, computed in-browser.
3. **Current ownership (blame)**: for the selected branch's HEAD, walk every
   tracked file and attribute each line to the commit that last modified it,
   built on the same diff engine as step 2. Produces per-author "lines
   currently owned" and per-file line counts/owners.
4. **Aggregation**: roll up per-commit and per-blame data into the metrics the
   dashboard displays (see below), with results cached per repo+commit in
   IndexedDB.

## 3. Dashboard features

- **Overview**: total commits, total authors, added/deleted/net lines per
  author — sortable table and chart (the original script's output, upgraded).
- **Activity over time**: commits and lines per author charted weekly/monthly.
- **Commit patterns**: average commit size, largest commits, contribution
  streaks, day-of-week / time-of-day heatmap.
- **Current ownership**: percentage of lines in HEAD owned per author,
  drill-down to per-file line counts and owners.
- **File/directory ownership**: sortable table (and/or treemap) of
  directories by contribution — both historical churn (from step 2) and
  current-blame based (from step 3).
- **Branch & merge insights**: merge commit counts per author; contribution
  breakdown updates when the branch selector changes.
- **Filters**:
  - *Branch selector* — changes which branch's HEAD is walked/blamed.
  - *Date range* — scopes time-series and churn views (does not affect
    blame/ownership, which is inherently a snapshot of a given HEAD).
  - *Author filter/search* — isolate or exclude specific authors (e.g. bots)
    across all views.

## 4. Error handling

- Unsupported browser → explicit message naming Chrome/Edge as required.
- Selected folder has no `.git` → friendly error, back to picker.
- Folder picker cancelled → no-op, return to start screen.
- File System Access permission revoked mid-session → re-prompt for access.
- Large repo detected → show commit/file counts and a progress bar with a
  cancel option before running the eager blame pass.
- Unsupported git features encountered (submodules, LFS pointers, etc.) →
  skip the affected file/entry with a visible note rather than failing the
  whole analysis.

## 5. Testing

- Diff/blame/aggregation logic is written as pure functions and unit-tested
  with Vitest against fixture repos built on an in-memory fs implementation
  (not the real File System Access API), so the core analysis pipeline is
  fully testable in Node.
- The File System Access adapter and folder-picker flow are covered by a
  manual test checklist, since that browser API can't be meaningfully
  automated in CI.

## Out of scope (v1)

- Non-Chromium browser support.
- Remote/GitHub-URL analysis (server-side cloning) — local folder only.
- Very large monorepos (10k+ commits) — would need a lazy per-file blame
  strategy instead of the eager approach designed here.
