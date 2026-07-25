// server/src/git/repo.test.ts
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildRealGitRepo } from '../../../tests/fixtures/realGitRepo'
import { assertIsGitRepo, listBranches, getCurrentBranch, resolveBranchHead, NotAGitRepoError } from './repo'

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
