// server/src/app.test.ts
import { describe, expect, it } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildRealGitRepo } from '../../tests/fixtures/realGitRepo'
import { createApp } from './app'

describe('createApp', () => {
  it('GET /api/analyze returns a full RepoAnalysis for a real repo', async () => {
    const dir = buildRealGitRepo((run, d) => {
      fs.writeFileSync(`${d}/a.txt`, 'one\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'first'])
    })

    const app = createApp()
    const res = await request(app).get('/api/analyze').query({ path: dir })

    expect(res.status).toBe(200)
    expect(res.body.branch).toBe('main')
    expect(res.body.authorTotals[0].author).toBe('Alice')
  })

  it('returns 400 with a clear message for a path that is not a git repo', async () => {
    const notARepo = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'))

    const app = createApp()
    const res = await request(app).get('/api/analyze').query({ path: notARepo })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/not a git repository/i)
  })

  it('returns 400 when the path query parameter is missing', async () => {
    const app = createApp()
    const res = await request(app).get('/api/analyze')
    expect(res.status).toBe(400)
  })
})
