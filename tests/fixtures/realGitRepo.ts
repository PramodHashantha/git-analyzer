import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Create a real git repository in a fresh temp dir and run the given git
 * argument-lists in it (author identity is set per-commit by the caller via
 * `-c user.name=... -c user.email=...` on the commit commands, or globally
 * here). Returns the repo path. Requires `git` on PATH.
 */
export function buildRealGitRepo(steps: (run: (args: string[]) => void, dir: string) => void): string {
  const dir = mkdtempSync(join(tmpdir(), 'blame-parity-'))
  const run = (args: string[]) => {
    execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  }
  run(['init', '-q', '-b', 'main'])
  run(['config', 'user.name', 'Setup'])
  run(['config', 'user.email', 'setup@example.com'])
  steps(run, dir)
  return dir
}

/** Parse `git blame --line-porcelain` output into a per-line author email array. */
export function gitBlameEmails(dir: string, filepath: string): string[] {
  const out = execFileSync('git', ['blame', '--line-porcelain', filepath], {
    cwd: dir,
    encoding: 'utf8',
  })
  const emails: string[] = []
  for (const line of out.split('\n')) {
    if (line.startsWith('author-mail ')) {
      emails.push(line.slice('author-mail '.length).replace(/^<|>$/g, ''))
    }
  }
  return emails
}
