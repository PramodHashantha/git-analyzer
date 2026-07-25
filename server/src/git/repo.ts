import { runGit } from './exec'

export class NotAGitRepoError extends Error {}

export async function assertIsGitRepo(repoPath: string): Promise<void> {
  try {
    const out = await runGit(repoPath, ['rev-parse', '--is-inside-work-tree'])
    if (out.trim() !== 'true') throw new NotAGitRepoError(`Not a git repository: ${repoPath}`)
  } catch (err) {
    if (err instanceof NotAGitRepoError) throw err
    throw new NotAGitRepoError(`Not a git repository: ${repoPath}`)
  }
}

export async function listBranches(repoPath: string): Promise<string[]> {
  const out = await runGit(repoPath, ['branch', '--format=%(refname:short)'])
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

export async function getCurrentBranch(repoPath: string): Promise<string> {
  const out = await runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return out.trim()
}

export async function resolveBranchHead(repoPath: string, branch: string): Promise<string> {
  const out = await runGit(repoPath, ['rev-parse', branch])
  return out.trim()
}
