import { describe, expect, it } from 'vitest'
import type { CommitInfo } from '../../shared/types'
import { aggregateMergeInsights } from '../../shared/aggregate-merges'

function makeCommit(overrides: Partial<CommitInfo>): CommitInfo {
  return {
    oid: 'oid',
    parentOids: [],
    author: 'Alice',
    email: 'alice@example.com',
    timestamp: 0,
    message: 'msg',
    isMerge: false,
    ...overrides,
  }
}

describe('aggregateMergeInsights', () => {
  it('counts merge commits per author, ignoring non-merge commits', () => {
    const commits = [
      makeCommit({ author: 'Alice', isMerge: true }),
      makeCommit({ author: 'Alice', isMerge: false }),
      makeCommit({ author: 'Bob', isMerge: true }),
      makeCommit({ author: 'Bob', isMerge: true }),
    ]

    const insights = aggregateMergeInsights(commits)

    expect(insights).toEqual([
      { author: 'Bob', mergeCommits: 2 },
      { author: 'Alice', mergeCommits: 1 },
    ])
  })
})
