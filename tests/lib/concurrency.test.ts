import { describe, expect, it } from 'vitest'
import { mapWithConcurrency } from '../../src/lib/concurrency'

describe('mapWithConcurrency', () => {
  it('returns results in input order regardless of completion order', async () => {
    // Later items resolve sooner, so completion order != input order.
    const items = [30, 10, 20, 5]
    const result = await mapWithConcurrency(items, 4, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms))
      return `${i}:${ms}`
    })
    expect(result).toEqual(['0:30', '1:10', '2:20', '3:5'])
  })

  it('never runs more than `limit` tasks at once', async () => {
    let inFlight = 0
    let maxInFlight = 0
    await mapWithConcurrency([...Array(20).keys()], 3, async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
    })
    expect(maxInFlight).toBeLessThanOrEqual(3)
  })

  it('reports progress once per item with a monotonic done count', async () => {
    const progress: Array<{ done: number; total: number }> = []
    await mapWithConcurrency([...Array(5).keys()], 2, async () => {}, (done, total) =>
      progress.push({ done, total })
    )
    expect(progress).toEqual([
      { done: 1, total: 5 },
      { done: 2, total: 5 },
      { done: 3, total: 5 },
      { done: 4, total: 5 },
      { done: 5, total: 5 },
    ])
  })

  it('handles an empty input without calling fn or onProgress', async () => {
    let calls = 0
    const result = await mapWithConcurrency([], 4, async () => {
      calls++
    }, () => {
      calls++
    })
    expect(result).toEqual([])
    expect(calls).toBe(0)
  })
})
