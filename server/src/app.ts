import express from 'express'
import path from 'node:path'
import { resolveRepoHead, computeAnalysis } from './analyzer'
import { getCached, setCached, makeCacheKey } from './cache'
import { NotAGitRepoError } from './git/repo'

export function createApp(staticDir?: string): express.Express {
  const app = express()

  app.get('/api/analyze', async (req, res) => {
    const repoPath = typeof req.query.path === 'string' ? req.query.path : ''
    const branchOverride = typeof req.query.branch === 'string' ? req.query.branch : undefined

    if (!repoPath) {
      res.status(400).json({ error: 'Missing required "path" query parameter' })
      return
    }

    try {
      const head = await resolveRepoHead(repoPath, branchOverride)
      const key = makeCacheKey(repoPath, head.branch, head.headOid)

      const cached = getCached(key)
      if (cached) {
        res.json(cached)
        return
      }

      const analysis = await computeAnalysis(repoPath, head)
      setCached(key, analysis)
      res.json(analysis)
    } catch (err) {
      if (err instanceof NotAGitRepoError) {
        res.status(400).json({ error: err.message })
        return
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  if (staticDir) {
    app.use(express.static(staticDir))
    app.get('*', (_req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'))
    })
  }

  return app
}
