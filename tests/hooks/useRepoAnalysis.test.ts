import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { buildFixtureRepo } from '../fixtures/gitFixture'

vi.mock('../../src/lib/fs-adapter', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/fs-adapter')>(
    '../../src/lib/fs-adapter'
  )
  return {
    ...actual,
    createFsAdapter: vi.fn(),
  }
})

import { createFsAdapter } from '../../src/lib/fs-adapter'
import { useRepoAnalysis } from '../../src/hooks/useRepoAnalysis'

describe('useRepoAnalysis', () => {
  it('walks the analysis pipeline and lands on a done state', async () => {
    const { fs } = await buildFixtureRepo(
      'use-repo-analysis-test-1',
      [
        {
          message: 'first',
          author: { name: 'Alice', email: 'alice@example.com' },
          files: { 'a.txt': 'one\n' },
        },
      ],
      '/'
    )

    vi.mocked(createFsAdapter).mockReturnValue(fs as unknown as ReturnType<typeof createFsAdapter>)

    const { result } = renderHook(() => useRepoAnalysis())
    const fakeRoot = { name: 'demo-repo' } as unknown as FileSystemDirectoryHandle

    await act(async () => {
      await result.current.analyze(fakeRoot)
    })

    await waitFor(() => expect(result.current.status.phase).toBe('done'))

    if (result.current.status.phase !== 'done') throw new Error('expected done phase')
    expect(result.current.status.analysis.branch).toBe('main')
    expect(result.current.status.analysis.commits).toHaveLength(1)
    expect(result.current.status.analysis.authorTotals[0].author).toBe('Alice')
  })

  it('reports an error state when the folder has no .git directory', async () => {
    const LightningFS = (await import('@isomorphic-git/lightning-fs')).default
    const plainFs = new LightningFS('use-repo-analysis-test-2')
    await plainFs.promises.mkdir('/plain')

    vi.mocked(createFsAdapter).mockReturnValue(plainFs as unknown as ReturnType<typeof createFsAdapter>)

    const { result } = renderHook(() => useRepoAnalysis())
    const fakeRoot = { name: 'plain' } as unknown as FileSystemDirectoryHandle

    await act(async () => {
      await result.current.analyze(fakeRoot)
    })

    await waitFor(() => expect(result.current.status.phase).toBe('error'))
  })
})
