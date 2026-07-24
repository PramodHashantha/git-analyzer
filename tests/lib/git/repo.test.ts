import { describe, expect, it } from 'vitest'
import LightningFS from '@isomorphic-git/lightning-fs'
import { buildFixtureRepo } from '../../fixtures/gitFixture'
import {
  assertIsGitRepo,
  makeRepoContext,
  listBranches,
  resolveBranchHead,
  getCurrentBranch,
  NotAGitRepoError,
  UnsupportedWorktreeError,
} from '../../../src/lib/git/repo'

describe('repo', () => {
  it('resolves the current branch and its head commit', async () => {
    const { fs, dir } = await buildFixtureRepo('repo-test-1', [
      {
        message: 'first commit',
        author: { name: 'Alice', email: 'alice@example.com' },
        files: { 'a.txt': 'hello\n' },
      },
    ])

    await assertIsGitRepo(fs, dir)
    const ctx = makeRepoContext(fs, dir)

    expect(await getCurrentBranch(ctx)).toBe('main')
    expect(await listBranches(ctx)).toContain('main')
    expect(await resolveBranchHead(ctx, 'main')).toMatch(/^[0-9a-f]{40}$/)
  })

  it('throws NotAGitRepoError for a folder without .git', async () => {
    const fs = new LightningFS('repo-test-2')
    await fs.promises.mkdir('/plain')
    await expect(assertIsGitRepo(fs, '/plain')).rejects.toBeInstanceOf(NotAGitRepoError)
  })

  it('throws UnsupportedWorktreeError when .git is a file, not a folder', async () => {
    const fs = new LightningFS('repo-test-3')
    await fs.promises.mkdir('/worktree')
    await fs.promises.writeFile(
      '/worktree/.git',
      'gitdir: /path/to/main/repo/.git/worktrees/worktree\n',
      'utf8'
    )
    await expect(assertIsGitRepo(fs, '/worktree')).rejects.toBeInstanceOf(UnsupportedWorktreeError)
  })
})
