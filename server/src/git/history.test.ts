// server/src/git/history.test.ts
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { buildRealGitRepo } from '../../../tests/fixtures/realGitRepo'
import { readHistory } from './history'

function commit(run: (args: string[]) => void, dir: string, name: string, email: string, file: string, content: string, msg: string) {
  fs.writeFileSync(`${dir}/${file}`, content)
  run(['add', '-A'])
  run(['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', msg])
}

describe('readHistory', () => {
  it('parses commits newest-first with author/email/timestamp/message/parents', async () => {
    const dir = buildRealGitRepo((run, d) => {
      commit(run, d, 'Alice', 'alice@example.com', 'a.txt', 'one\n', 'first')
      commit(run, d, 'Bob', 'bob@example.com', 'a.txt', 'one\ntwo\n', 'second')
    })

    const commits = await readHistory(dir, 'main')

    expect(commits).toHaveLength(2)
    expect(commits[0].message).toBe('second')
    expect(commits[0].author).toBe('Bob')
    expect(commits[0].email).toBe('bob@example.com')
    expect(commits[0].isMerge).toBe(false)
    expect(commits[1].message).toBe('first')
    expect(commits[1].parentOids).toEqual([])
    expect(commits[0].parentOids).toEqual([commits[1].oid])
  })

  it('flags a merge commit (2+ parents) correctly', async () => {
    const dir = buildRealGitRepo((run, d) => {
      commit(run, d, 'Alice', 'alice@example.com', 'a.txt', 'base\n', 'base')
      run(['checkout', '-q', '-b', 'feature'])
      commit(run, d, 'Lahiru', 'lahiru@example.com', 'b.txt', 'feature\n', 'feature work')
      run(['checkout', '-q', 'main'])
      run(['-c', 'user.name=Dinil', '-c', 'user.email=dinil@example.com', 'merge', '-q', '--no-ff', 'feature', '-m', 'Merge feature'])
    })

    const commits = await readHistory(dir, 'main')
    const merge = commits.find((c) => c.message === 'Merge feature')

    expect(merge?.isMerge).toBe(true)
    expect(merge?.parentOids).toHaveLength(2)
  })
})
