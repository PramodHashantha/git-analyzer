import * as git from 'isomorphic-git'
import type { PromiseFsClient } from 'isomorphic-git'

export interface RepoContext {
  fs: PromiseFsClient
  dir: string
  gitdir: string
}

export class NotAGitRepoError extends Error {}

export class UnsupportedWorktreeError extends Error {}

function joinPath(dir: string, ...parts: string[]): string {
  const base = dir.endsWith('/') ? dir.slice(0, -1) : dir
  return [base, ...parts].join('/')
}

export async function assertIsGitRepo(fs: PromiseFsClient, dir: string): Promise<void> {
  let stat
  try {
    stat = await fs.promises.stat(joinPath(dir, '.git'))
  } catch {
    throw new NotAGitRepoError('No .git directory found in the selected folder')
  }
  // A linked git worktree (or submodule) has `.git` as a text file pointing
  // at the real git directory, which typically lives outside the selected
  // folder — the File System Access API cannot follow that pointer, since
  // browsers sandbox access to the picked folder and its descendants only.
  if (!stat.isDirectory()) {
    throw new UnsupportedWorktreeError(
      'This folder looks like a git worktree or submodule (.git is a file, not a folder). ' +
        'Select the main repository folder instead.'
    )
  }
}

export function makeRepoContext(fs: PromiseFsClient, dir: string): RepoContext {
  return { fs, dir, gitdir: joinPath(dir, '.git') }
}

export async function listBranches(ctx: RepoContext): Promise<string[]> {
  return git.listBranches({ fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir })
}

export async function resolveBranchHead(ctx: RepoContext, branch: string): Promise<string> {
  return git.resolveRef({ fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, ref: branch })
}

export async function getCurrentBranch(ctx: RepoContext): Promise<string | undefined> {
  const branch = await git.currentBranch({
    fs: ctx.fs,
    dir: ctx.dir,
    gitdir: ctx.gitdir,
    fullname: false,
  })
  return branch ?? undefined
}
