import { describe, expect, it } from 'vitest'
import { applyChangeToOwners } from '../../../src/lib/git/ownership-walk'
import { linesToText } from '../../../src/lib/git/line-text'

const owners = (before: string[], beforeOwners: string[], after: string[], oid: string) =>
  applyChangeToOwners(beforeOwners, linesToText(before), linesToText(after), oid)

describe('applyChangeToOwners', () => {
  it('attributes appended lines to the new commit, keeping context owners', () => {
    expect(owners(['one', 'two'], ['c1', 'c1'], ['one', 'two', 'three'], 'c2')).toEqual([
      'c1', 'c1', 'c2',
    ])
  })

  it('keeps surviving owners when a line is deleted', () => {
    expect(owners(['a', 'b', 'c'], ['c1', 'c1', 'c1'], ['a', 'c'], 'c2')).toEqual(['c1', 'c1'])
  })

  it('attributes only the changed line on an in-place edit', () => {
    expect(owners(['a', 'b', 'c'], ['c1', 'c1', 'c1'], ['a', 'B', 'c'], 'c2')).toEqual([
      'c1', 'c2', 'c1',
    ])
  })

  it('attributes a full replacement to the new commit', () => {
    expect(owners(['x'], ['c1'], ['y'], 'c2')).toEqual(['c2'])
  })

  it('returns [] when the file becomes empty', () => {
    expect(owners(['a'], ['c1'], [], 'c2')).toEqual([])
  })

  it('attributes every line to the commit when adding to an empty file', () => {
    expect(owners([], [], ['a', 'b'], 'c2')).toEqual(['c2', 'c2'])
  })
})
