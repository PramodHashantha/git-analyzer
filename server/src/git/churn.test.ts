import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { buildRealGitRepo } from '../../../tests/fixtures/realGitRepo'
import { readHistory } from './history'
import { readChurnByCommit } from './churn'

describe('readChurnByCommit', () => {
  it('maps each non-merge commit to its per-file added/deleted lines', async () => {
    const dir = buildRealGitRepo((run, d) => {
      fs.writeFileSync(`${d}/a.txt`, 'one\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'first'])

      fs.writeFileSync(`${d}/a.txt`, 'one\ntwo\nthree\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Bob', '-c', 'user.email=bob@example.com', 'commit', '-q', '-m', 'second'])
    })

    const commits = await readHistory(dir, 'main')
    const churn = await readChurnByCommit(dir, 'main')

    const second = commits.find((c) => c.message === 'second')!
    expect(churn.get(second.oid)).toEqual([{ filepath: 'a.txt', added: 2, deleted: 0 }])

    const first = commits.find((c) => c.message === 'first')!
    expect(churn.get(first.oid)).toEqual([{ filepath: 'a.txt', added: 1, deleted: 0 }])
  })

  it('excludes binary files (numstat reports them as "-")', async () => {
    const dir = buildRealGitRepo((run, d) => {
      fs.writeFileSync(`${d}/code.txt`, 'a\nb\n')
      fs.writeFileSync(`${d}/image.bin`, Buffer.from([0x89, 0x50, 0x00, 0x47]))
      run(['add', '-A'])
      run(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'mixed'])
    })

    const commits = await readHistory(dir, 'main')
    const churn = await readChurnByCommit(dir, 'main')
    const files = churn.get(commits[0].oid) ?? []

    expect(files.some((f) => f.filepath === 'code.txt')).toBe(true)
    expect(files.some((f) => f.filepath === 'image.bin')).toBe(false)
  })

  it('excludes merge commits entirely from the map', async () => {
    const dir = buildRealGitRepo((run, d) => {
      fs.writeFileSync(`${d}/a.txt`, 'base\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'base'])
      run(['checkout', '-q', '-b', 'feature'])
      fs.writeFileSync(`${d}/b.txt`, 'feature\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Lahiru', '-c', 'user.email=lahiru@example.com', 'commit', '-q', '-m', 'feature work'])
      run(['checkout', '-q', 'main'])
      run(['-c', 'user.name=Dinil', '-c', 'user.email=dinil@example.com', 'merge', '-q', '--no-ff', 'feature', '-m', 'Merge feature'])
    })

    const commits = await readHistory(dir, 'main')
    const merge = commits.find((c) => c.isMerge)!
    const churn = await readChurnByCommit(dir, 'main')

    expect(churn.has(merge.oid)).toBe(false)
  })
})
