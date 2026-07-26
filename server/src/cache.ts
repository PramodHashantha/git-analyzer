import type { RepoAnalysis } from '../../shared/types'

const cache = new Map<string, RepoAnalysis>()

export function makeCacheKey(repoPath: string, branch: string, headOid: string): string {
  return `${repoPath}::${branch}::${headOid}`
}

export function getCached(key: string): RepoAnalysis | undefined {
  return cache.get(key)
}

export function setCached(key: string, analysis: RepoAnalysis): void {
  cache.set(key, analysis)
}
