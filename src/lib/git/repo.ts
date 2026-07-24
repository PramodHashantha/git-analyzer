import * as git from 'isomorphic-git'
import type { PromiseFsClient } from 'isomorphic-git'

export interface RepoContext {
  fs: PromiseFsClient
  dir: string
  gitdir: string
}

export class NotAGitRepoError extends Error {}

function joinPath(dir: string, ...parts: string[]): string {
  const base = dir.endsWith('/') ? dir.slice(0, -1) : dir
  return [base, ...parts].join('/')
}

export async function assertIsGitRepo(fs: PromiseFsClient, dir: string): Promise<void> {
  try {
    await fs.promises.stat(joinPath(dir, '.git'))
  } catch {
    throw new NotAGitRepoError('No .git directory found in the selected folder')
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
