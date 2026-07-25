# Git Contribution Dashboard

A fully local dashboard that analyzes a local git repository's contribution
history — added/deleted lines, activity over time, commit patterns, and
current line ownership (blame-based) — by shelling out to your real `git`
binary. Nothing is uploaded anywhere.

## Requirements

- Node.js 18+
- `git` available on your PATH

## Local development

```bash
npm install
npm run dev
```

This starts the Vite dev server (frontend) and the local Express backend
together. Open the printed URL, paste the path to a local git repository you
have a clone of (ownership doesn't matter — your local clone has the full
history), and click Analyze.

## Running it for real use

```bash
npm install
npm run build
npm start
```

`npm start` serves the built frontend and the API from one local process at
`http://127.0.0.1:3001`.

## Testing

```bash
npm test
```

## Architecture

This is a fully local tool: a small Express backend (`server/`) shells out to
your real `git` binary to read repo history, diffs, and blame — no data ever
leaves your machine, and there's no hosted/shared version. `shared/` holds
the types and aggregation logic used by both the backend and the React
dashboard (`src/`).

## Origin

This project began as a PowerShell script
(`docs/original-powershell-script.txt`) that used `git shortlog` and
`git log --numstat` to tally per-author line changes. The design rationale
for turning it into a hosted dashboard is in
`docs/superpowers/specs/2026-07-24-git-contribution-dashboard-design.md`.
