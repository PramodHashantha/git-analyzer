// server/src/git/repo.test.ts
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { buildRealGitRepo } from '../../../tests/fixtures/realGitRepo'
import { assertIsGitRepo, listBranches, getCurrentBranch, resolveBranchHead, getUpstreamStatus, NotAGitRepoError } from './repo'

describe('repo', () => {
  it('resolves the current branch and its head commit', async () => {
    const dir = buildRealGitRepo((run, d) => {
      fs.writeFileSync(`${d}/a.txt`, 'hello\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'first'])
    })

    await assertIsGitRepo(dir)
    expect(await getCurrentBranch(dir)).toBe('main')
    expect(await listBranches(dir)).toContain('main')
    expect(await resolveBranchHead(dir, 'main')).toMatch(/^[0-9a-f]{40}$/)
  })

  it('throws NotAGitRepoError for a folder that is not a git repo', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'))
    await expect(assertIsGitRepo(dir)).rejects.toBeInstanceOf(NotAGitRepoError)
  })

  it('throws NotAGitRepoError for a path that does not exist', async () => {
    await expect(assertIsGitRepo('/definitely/does/not/exist/xyz')).rejects.toBeInstanceOf(NotAGitRepoError)
  })
})

describe('getUpstreamStatus', () => {
  it('reports no upstream for a branch that never tracked a remote', async () => {
    const dir = buildRealGitRepo((run, d) => {
      fs.writeFileSync(`${d}/a.txt`, 'one\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'first'])
    })

    const status = await getUpstreamStatus(dir, 'main')
    expect(status).toEqual({ hasUpstream: false, ahead: 0, behind: 0 })
  })

  it('reports ahead/behind counts against a configured upstream', async () => {
    const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bare-remote-'))
    execFileSync('git', ['init', '-q', '--bare', remoteDir])

    const dir = buildRealGitRepo((run, d) => {
      fs.writeFileSync(`${d}/a.txt`, 'one\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'first'])
    })
    execFileSync('git', ['remote', 'add', 'origin', remoteDir], { cwd: dir })
    execFileSync('git', ['push', '-q', '-u', 'origin', 'main'], { cwd: dir })

    // A second clone advances origin/main by one commit that `dir` hasn't seen.
    const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clone-'))
    execFileSync('git', ['clone', '-q', remoteDir, cloneDir])
    // On machines without `init.defaultBranch=main` set globally, the bare
    // remote's HEAD symref still points at the nonexistent default (e.g.
    // `master`), so the clone lands on an unborn branch instead of `main`.
    // Check out `main` explicitly (it exists as `origin/main`) so the
    // upcoming commit lands on the branch we intend to push.
    execFileSync('git', ['checkout', '-q', 'main'], { cwd: cloneDir })
    fs.writeFileSync(`${cloneDir}/b.txt`, 'two\n')
    execFileSync('git', ['add', '-A'], { cwd: cloneDir })
    execFileSync(
      'git',
      ['-c', 'user.name=Bob', '-c', 'user.email=bob@example.com', 'commit', '-q', '-m', 'second'],
      { cwd: cloneDir }
    )
    execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: cloneDir })

    // `dir` also makes an unpushed local commit, so it is ahead by one too.
    fs.writeFileSync(`${dir}/c.txt`, 'three\n')
    execFileSync('git', ['add', '-A'], { cwd: dir })
    execFileSync(
      'git',
      ['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'third'],
      { cwd: dir }
    )

    // Fetch (not merge/pull) so origin/main updates without touching local main.
    execFileSync('git', ['fetch', '-q', 'origin'], { cwd: dir })

    const status = await getUpstreamStatus(dir, 'main')
    expect(status.hasUpstream).toBe(true)
    expect(status.upstreamName).toBe('origin/main')
    expect(status.ahead).toBe(1)
    expect(status.behind).toBe(1)
  })
})
