import { describe, expect, it } from 'vitest'
import { aggregateBusFactor } from '../../shared/aggregate-bus-factor'
import type { FileOwnership } from '../../shared/types'

describe('aggregateBusFactor', () => {
  it('flags files where one author owns at least the threshold share', () => {
    const fileOwnership: FileOwnership[] = [
      { filepath: 'risky.txt', totalLines: 10, ownerLineCounts: { Alice: 9, Bob: 1 } },
      { filepath: 'shared.txt', totalLines: 10, ownerLineCounts: { Alice: 5, Bob: 5 } },
    ]

    const result = aggregateBusFactor(fileOwnership)

    expect(result.some((f) => f.filepath === 'risky.txt')).toBe(true)
    expect(result.some((f) => f.filepath === 'shared.txt')).toBe(false)

    const risky = result.find((f) => f.filepath === 'risky.txt')!
    expect(risky.topAuthor).toBe('Alice')
    expect(risky.topAuthorPercentage).toBeCloseTo(90)
  })

  it('excludes files below the minimum line count', () => {
    const fileOwnership: FileOwnership[] = [
      { filepath: 'tiny.txt', totalLines: 2, ownerLineCounts: { Alice: 2 } },
    ]
    expect(aggregateBusFactor(fileOwnership)).toHaveLength(0)
  })

  it('respects a custom threshold and minLines', () => {
    const fileOwnership: FileOwnership[] = [
      { filepath: 'tiny.txt', totalLines: 2, ownerLineCounts: { Alice: 2 } },
    ]
    const result = aggregateBusFactor(fileOwnership, 100, 1)
    expect(result).toHaveLength(1)
    expect(result[0].topAuthorPercentage).toBe(100)
  })

  it('caps results to the given limit, defaulting to 20', () => {
    const fileOwnership: FileOwnership[] = Array.from({ length: 25 }, (_, i) => ({
      filepath: `file${i}.txt`,
      totalLines: 10,
      ownerLineCounts: { Alice: 10 },
    }))
    expect(aggregateBusFactor(fileOwnership, 80, 5, 5)).toHaveLength(5)
    expect(aggregateBusFactor(fileOwnership)).toHaveLength(20)
  })
})
