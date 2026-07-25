import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import * as git from 'isomorphic-git'
import { buildRealGitRepo, gitBlameEmails } from '../../fixtures/realGitRepo'
import { makeRepoContext } from '../../../src/lib/git/repo'
import { blameFile } from '../../../src/lib/git/blame'

// isomorphic-git accepts Node's fs directly.
const nodeCtx = (dir: string) => makeRepoContext(fs as never, dir)

async function ourBlameEmails(dir: string, filepath: string): Promise<string[]> {
  const ctx = nodeCtx(dir)
  const headOid = await git.resolveRef({ fs: fs as never, dir, gitdir: `${dir}/.git`, ref: 'HEAD' })
  const owners = await blameFile(ctx, headOid, filepath)
  const emailByOid = new Map<string, string>()
  const out: string[] = []
  for (const oid of owners) {
    let email = emailByOid.get(oid)
    if (!email) {
      const { commit } = await git.readCommit({ fs: fs as never, dir, gitdir: `${dir}/.git`, oid })
      email = commit.author.email
      emailByOid.set(oid, email)
    }
    out.push(email)
  }
  return out
}

async function expectBlameMatchesGit(dir: string, filepath: string) {
  const ours = await ourBlameEmails(dir, filepath)
  const theirs = gitBlameEmails(dir, filepath)
  expect(ours).toEqual(theirs)
}

describe('blameFile parity with git blame', () => {
  it('credits merged-in lines to their true author, not the merger', async () => {
    const dir = buildRealGitRepo((run, dir) => {
      const commit = (name: string, email: string, msg: string) =>
        run(['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', msg])
      const write = (rel: string, content: string) => fs.writeFileSync(`${dir}/${rel}`, content)

      // main: base file by Alice
      write('f.txt', 'a1\na2\n')
      run(['add', '-A']); commit('Alice', 'alice@example.com', 'base')

      // feature branch: Lahiru appends lines
      run(['checkout', '-q', '-b', 'feature'])
      write('f.txt', 'a1\na2\nL1\nL2\n')
      run(['add', '-A']); commit('Lahiru', 'lahiru@example.com', 'feature work')

      // back to main, an unrelated edit by Alice
      run(['checkout', '-q', 'main'])
      write('other.txt', 'x\n')
      run(['add', '-A']); commit('Alice', 'alice@example.com', 'other')

      // Dinil merges the feature branch (merger != author)
      run(['-c', 'user.name=Dinil', '-c', 'user.email=dinil@example.com', 'merge', '-q', '--no-ff', 'feature', '-m', 'Merge feature'])
    })

    // f.txt lines: a1,a2 -> Alice; L1,L2 -> Lahiru (NOT Dinil the merger)
    await expectBlameMatchesGit(dir, 'f.txt')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('matches git blame on a linear edit history', async () => {
    const dir = buildRealGitRepo((run, dir) => {
      const commit = (name: string, email: string, msg: string) =>
        run(['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', msg])
      fs.writeFileSync(`${dir}/g.txt`, 'one\ntwo\n')
      run(['add', '-A']); commit('Alice', 'alice@example.com', 'c1')
      fs.writeFileSync(`${dir}/g.txt`, 'one\ntwo\nthree\n')
      run(['add', '-A']); commit('Bob', 'bob@example.com', 'c2')
    })
    await expectBlameMatchesGit(dir, 'g.txt')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('blames a merge-conflict resolution on the merge author', async () => {
    const dir = buildRealGitRepo((run, dir) => {
      const commit = (name: string, email: string, msg: string) =>
        run(['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', msg])
      fs.writeFileSync(`${dir}/c.txt`, 'base\n')
      run(['add', '-A']); commit('Alice', 'alice@example.com', 'base')

      run(['checkout', '-q', '-b', 'feat'])
      fs.writeFileSync(`${dir}/c.txt`, 'feat-change\n')
      run(['add', '-A']); commit('Lahiru', 'lahiru@example.com', 'feat')

      run(['checkout', '-q', 'main'])
      fs.writeFileSync(`${dir}/c.txt`, 'main-change\n')
      run(['add', '-A']); commit('Alice', 'alice@example.com', 'main edit')

      // conflicting merge; Dinil resolves by writing a new line
      try {
        run(['-c', 'user.name=Dinil', '-c', 'user.email=dinil@example.com', 'merge', '--no-ff', 'feat', '-m', 'merge'])
      } catch {
        // conflict expected
      }
      fs.writeFileSync(`${dir}/c.txt`, 'resolved-by-dinil\n')
      run(['add', '-A'])
      run(['-c', 'user.name=Dinil', '-c', 'user.email=dinil@example.com', 'commit', '-q', '--no-edit'])
    })
    await expectBlameMatchesGit(dir, 'c.txt')
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
