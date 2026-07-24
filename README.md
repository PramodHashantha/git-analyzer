# Git Contribution Dashboard

A fully client-side dashboard that analyzes a local git repository's
contribution history — added/deleted lines, activity over time, commit
patterns, and current line ownership (blame-based) — with no backend.

## Requirements

- **Chrome or Edge** (the File System Access API this app depends on has no
  Firefox or Safari equivalent).
- Node.js 18+ to build/run locally.

## Local development

```bash
npm install
npm run dev
```

Open the printed local URL, click **Select a git repo folder**, and choose
any local git repository. All analysis (commit walking, line diffing,
blame) runs in your browser — nothing is uploaded anywhere.

## Testing

```bash
npm test
```

## Deploying to Vercel

This is a static Vite build with no server component. Push to a Git
repository connected to Vercel, or run `vercel deploy` from this directory —
`vercel.json` points Vercel at `npm run build` and the `dist/` output.

## Origin

This project began as a PowerShell script
(`docs/original-powershell-script.txt`) that used `git shortlog` and
`git log --numstat` to tally per-author line changes. The design rationale
for turning it into a hosted dashboard is in
`docs/superpowers/specs/2026-07-24-git-contribution-dashboard-design.md`.
