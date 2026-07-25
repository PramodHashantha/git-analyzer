import { runGit } from './exec'
import type { BranchUpstreamStatus } from '../../../shared/types'

export class NotAGitRepoError extends Error {}

/**
 * Thrown when a caller-supplied branch override does not match any branch
 * returned by `listBranches`. Guards against passing untrusted input
 * (e.g. an HTTP query parameter) straight through to `git log <branch> ...`
 * as a positional argument, where a value starting with `-` would otherwise
 * be parsed by git as an option (argument injection).
 */
export class InvalidBranchError extends Error {}

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

export async function getUpstreamStatus(repoPath: string, branch: string): Promise<BranchUpstreamStatus> {
  let upstreamName: string
  try {
    const out = await runGit(repoPath, ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`])
    upstreamName = out.trim()
  } catch {
    return { hasUpstream: false, ahead: 0, behind: 0 }
  }

  const out = await runGit(repoPath, ['rev-list', '--left-right', '--count', `${branch}...${upstreamName}`])
  const [aheadStr, behindStr] = out.trim().split(/\s+/)

  return {
    hasUpstream: true,
    upstreamName,
    ahead: Number(aheadStr),
    behind: Number(behindStr),
  }
}
