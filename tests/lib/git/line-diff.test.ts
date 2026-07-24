import { describe, expect, it } from 'vitest'
import { buildFixtureRepo } from '../../fixtures/gitFixture'
import { makeRepoContext } from '../../../src/lib/git/repo'
import { walkHistory } from '../../../src/lib/git/history'
import { listChangedFiles, countLineChanges } from '../../../src/lib/git/line-diff'

describe('listChangedFiles', () => {
  it('detects the added file in the root commit and the modified file after', async () => {
    const { fs, dir } = await buildFixtureRepo('line-diff-test-1', [
      {
        message: 'first',
        author: { name: 'Alice', email: 'alice@example.com' },
        files: { 'a.txt': 'one\n', 'b.txt': 'x\n' },
      },
      {
        message: 'second',
        author: { name: 'Alice', email: 'alice@example.com' },
        files: { 'a.txt': 'one\ntwo\n' },
      },
    ])

    const ctx = makeRepoContext(fs, dir)
    const commits = await walkHistory(ctx, 'main')

    const rootChanges = await listChangedFiles(ctx, commits[1].oid, null)
    expect(rootChanges.map((c) => c.filepath).sort()).toEqual(['a.txt', 'b.txt'])

    const secondChanges = await listChangedFiles(ctx, commits[0].oid, commits[1].oid)
    expect(secondChanges.map((c) => c.filepath)).toEqual(['a.txt'])
  })
})

describe('countLineChanges', () => {
  it('counts added and deleted lines', () => {
    const result = countLineChanges('one\n', 'one\ntwo\n')
    expect(result).toEqual({ added: 1, deleted: 0 })
  })

  it('counts a full replacement as delete + add', () => {
    const result = countLineChanges('one\n', 'two\n')
    expect(result).toEqual({ added: 1, deleted: 1 })
  })
})
