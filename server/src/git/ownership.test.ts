import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { buildRealGitRepo } from '../../../tests/fixtures/realGitRepo'
import { aggregateOwnership } from './ownership'

function headOidOf(dir: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
}

describe('aggregateOwnership', () => {
  it('credits merged-in code to its true author, not the merger', async () => {
    const dir = buildRealGitRepo((run, d) => {
      fs.writeFileSync(`${d}/f.txt`, 'a1\na2\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'base'])

      run(['checkout', '-q', '-b', 'feature'])
      fs.writeFileSync(`${d}/f.txt`, 'a1\na2\nL1\nL2\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Lahiru', '-c', 'user.email=lahiru@example.com', 'commit', '-q', '-m', 'feature work'])

      run(['checkout', '-q', 'main'])
      run(['-c', 'user.name=Dinil', '-c', 'user.email=dinil@example.com', 'merge', '-q', '--no-ff', 'feature', '-m', 'Merge feature'])
    })

    const { authors, files } = await aggregateOwnership(dir, headOidOf(dir))

    const f = files.find((file) => file.filepath === 'f.txt')!
    expect(f.ownerLineCounts).toEqual({ Alice: 2, Lahiru: 2 })
    expect(authors.find((a) => a.author === 'Dinil')).toBeUndefined()
    expect(authors.find((a) => a.author === 'Lahiru')?.linesOwned).toBe(2)
  })

  it('excludes binary files from ownership', async () => {
    const dir = buildRealGitRepo((run, d) => {
      fs.writeFileSync(`${d}/code.txt`, 'a\nb\n')
      fs.writeFileSync(`${d}/image.bin`, Buffer.from([0x89, 0x50, 0x00, 0x47]))
      run(['add', '-A'])
      run(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'mixed'])
    })

    const { files } = await aggregateOwnership(dir, headOidOf(dir))

    expect(files.some((f) => f.filepath === 'code.txt')).toBe(true)
    expect(files.some((f) => f.filepath === 'image.bin')).toBe(false)
  })

  it('computes percentages that sum to 100', async () => {
    const dir = buildRealGitRepo((run, d) => {
      fs.writeFileSync(`${d}/a.txt`, 'x\ny\ny\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-q', '-m', 'c1'])
      fs.writeFileSync(`${d}/a.txt`, 'x\ny\ny\nz\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Bob', '-c', 'user.email=bob@example.com', 'commit', '-q', '-m', 'c2'])
    })

    const { authors } = await aggregateOwnership(dir, headOidOf(dir))
    const total = authors.reduce((sum, a) => sum + a.percentage, 0)
    expect(total).toBeCloseTo(100)
  })
})
