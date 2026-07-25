import express from 'express'
import path from 'node:path'

export function createApp(staticDir?: string): express.Express {
  const app = express()

  app.get('/api/analyze', (_req, res) => {
    res.status(501).json({ error: 'not implemented yet' })
  })

  if (staticDir) {
    app.use(express.static(staticDir))
    app.get('*', (_req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'))
    })
  }

  return app
}
