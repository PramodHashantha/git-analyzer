// server/src/analyzer.test.ts
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { buildRealGitRepo } from '../../tests/fixtures/realGitRepo'
import { resolveRepoHead, computeAnalysis } from './analyzer'

describe('analyzer', () => {
  it('composes a full RepoAnalysis matching the expected shape', async () => {
    const dir = buildRealGitRepo((run, d) => {
      fs.writeFileSync(`${d}/a.txt`, 'one\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'first'])
      fs.writeFileSync(`${d}/a.txt`, 'one\ntwo\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Bob', '-c', 'user.email=bob@example.com', 'commit', '-q', '-m', 'second'])
    })

    const head = await resolveRepoHead(dir)
    expect(head.branch).toBe('main')
    expect(head.branches).toContain('main')

    const analysis = await computeAnalysis(dir, head)

    expect(analysis.branch).toBe('main')
    expect(analysis.headOid).toBe(head.headOid)
    expect(analysis.commits).toHaveLength(2)
    expect(analysis.authorTotals.find((a) => a.author === 'Alice')?.added).toBe(1)
    expect(analysis.authorTotals.find((a) => a.author === 'Bob')?.added).toBe(1)
    expect(analysis.authorOwnership.find((a) => a.author === 'Bob')?.linesOwned).toBe(1)
    expect(analysis.fileOwnership.find((f) => f.filepath === 'a.txt')?.totalLines).toBe(2)
    expect(analysis.mergeInsights).toEqual([])
  })

  it('respects an explicit branch override', async () => {
    const dir = buildRealGitRepo((run, d) => {
      fs.writeFileSync(`${d}/a.txt`, 'base\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'base'])
      run(['checkout', '-q', '-b', 'other'])
      fs.writeFileSync(`${d}/b.txt`, 'other\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Bob', '-c', 'user.email=bob@example.com', 'commit', '-q', '-m', 'on other'])
    })

    const head = await resolveRepoHead(dir, 'other')
    expect(head.branch).toBe('other')
    const analysis = await computeAnalysis(dir, head)
    expect(analysis.commits.some((c) => c.message === 'on other')).toBe(true)
  })

  it('rejects a branch override that is not a real branch (argument injection guard)', async () => {
    const dir = buildRealGitRepo((run, d) => {
      fs.writeFileSync(`${d}/a.txt`, 'base\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'base'])
    })

    const suspiciousPath = `${dir}/should-not-exist.txt`
    const injectionLikeBranch = `--output=${suspiciousPath}`

    await expect(resolveRepoHead(dir, injectionLikeBranch)).rejects.toThrow()
    expect(fs.existsSync(suspiciousPath)).toBe(false)
  })
})
