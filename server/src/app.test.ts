// server/src/app.test.ts
import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'

describe('createApp', () => {
  it('responds to GET /api/analyze with a stub payload', async () => {
    const app = createApp()
    const res = await request(app).get('/api/analyze?path=/tmp/whatever')
    expect(res.status).toBe(501)
    expect(res.body).toEqual({ error: 'not implemented yet' })
  })
})
