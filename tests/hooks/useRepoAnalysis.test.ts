import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useRepoAnalysis } from '../../src/hooks/useRepoAnalysis'
import type { RepoAnalysis } from '../../shared/types'

const makeAnalysis = (): RepoAnalysis => ({
  repoName: 'demo',
  branch: 'main',
  branches: ['main'],
  branchStatus: { hasUpstream: false, ahead: 0, behind: 0 },
  headOid: 'abc123',
  commits: [],
  commitStats: [],
  authorTotals: [],
  activity: [],
  commitPatterns: [],
  fileOwnership: [],
  authorOwnership: [],
  mergeInsights: [],
})

describe('useRepoAnalysis', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches /api/analyze and lands on a done state', async () => {
    const analysis = makeAnalysis()
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => analysis,
    } as Response)

    const { result } = renderHook(() => useRepoAnalysis())
    await act(async () => {
      await result.current.analyze('D:\\repo')
    })

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/analyze?path=D%3A%5Crepo'))
    await waitFor(() => expect(result.current.status.phase).toBe('done'))
    if (result.current.status.phase !== 'done') throw new Error('expected done')
    expect(result.current.status.analysis.branch).toBe('main')
  })

  it('includes the branch override in the request', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => makeAnalysis() } as Response)

    const { result } = renderHook(() => useRepoAnalysis())
    await act(async () => {
      await result.current.analyze('D:\\repo', 'dev')
    })

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('branch=dev'))
  })

  it('surfaces a server error message', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Not a git repository: D:\\repo' }),
    } as Response)

    const { result } = renderHook(() => useRepoAnalysis())
    await act(async () => {
      await result.current.analyze('D:\\repo')
    })

    await waitFor(() => expect(result.current.status.phase).toBe('error'))
    if (result.current.status.phase !== 'error') throw new Error('expected error')
    expect(result.current.status.message).toMatch(/not a git repository/i)
  })
})
