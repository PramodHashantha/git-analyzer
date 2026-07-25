import { openDB, type IDBPDatabase } from 'idb'
import type { RepoAnalysis } from '../types'

const DB_NAME = 'git-analyser'
const STORE_NAME = 'repo-analysis'
const DB_VERSION = 1

interface CachedEntry {
  key: string
  analysis: RepoAnalysis
  cachedAt: number
}

let dbPromise: Promise<IDBPDatabase> | null = null

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' })
      },
    })
  }
  return dbPromise
}

// Bump when analysis logic changes so pre-change cached results are not served.
const ANALYSIS_VERSION = 2

export function makeCacheKey(repoName: string, branch: string, headOid: string): string {
  return `v${ANALYSIS_VERSION}::${repoName}::${branch}::${headOid}`
}

export async function getCachedAnalysis(key: string): Promise<RepoAnalysis | null> {
  const db = await getDb()
  const entry = (await db.get(STORE_NAME, key)) as CachedEntry | undefined
  return entry?.analysis ?? null
}

export async function setCachedAnalysis(key: string, analysis: RepoAnalysis): Promise<void> {
  const db = await getDb()
  const entry: CachedEntry = { key, analysis, cachedAt: Date.now() }
  await db.put(STORE_NAME, entry)
}
