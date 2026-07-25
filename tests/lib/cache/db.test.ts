import { describe, expect, it } from 'vitest'
import { makeCacheKey, getCachedAnalysis, setCachedAnalysis } from '../../../src/lib/cache/db'
import type { RepoAnalysis } from '../../../shared/types'

function makeAnalysis(overrides: Partial<RepoAnalysis> = {}): RepoAnalysis {
  return {
    repoName: 'demo',
    branch: 'main',
    branches: ['main'],
    headOid: 'abc123',
    commits: [],
    commitStats: [],
    authorTotals: [],
    activity: [],
    commitPatterns: [],
    fileOwnership: [],
    authorOwnership: [],
    mergeInsights: [],
    ...overrides,
  }
}

describe('cache/db', () => {
  it('returns null for a key that was never cached', async () => {
    const key = makeCacheKey('demo', 'main', 'not-cached-oid')
    expect(await getCachedAnalysis(key)).toBeNull()
  })

  it('stores and retrieves an analysis by cache key', async () => {
    const key = makeCacheKey('demo', 'main', 'abc123')
    const analysis = makeAnalysis()

    await setCachedAnalysis(key, analysis)
    const retrieved = await getCachedAnalysis(key)

    expect(retrieved).toEqual(analysis)
  })

  it('builds distinct keys for different repo/branch/commit combinations', () => {
    const a = makeCacheKey('demo', 'main', 'oid1')
    const b = makeCacheKey('demo', 'dev', 'oid1')
    const c = makeCacheKey('other-repo', 'main', 'oid1')
    expect(new Set([a, b, c]).size).toBe(3)
  })
})
