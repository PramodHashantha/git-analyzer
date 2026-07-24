import * as git from 'isomorphic-git'
import LightningFS from '@isomorphic-git/lightning-fs'

export interface FixtureCommit {
  message: string
  author: { name: string; email: string }
  files: Record<string, string | null>
  timestampSeconds?: number
}

export async function buildFixtureRepo(name: string, commits: FixtureCommit[]) {
  const fsInstance = new LightningFS(name)
  const fs = fsInstance
  const dir = '/repo'
  const gitdir = '/repo/.git'

  await fs.promises.mkdir(dir)
  await git.init({ fs, dir, gitdir, defaultBranch: 'main' })

  let headOid = ''
  for (const commit of commits) {
    for (const [filepath, contents] of Object.entries(commit.files)) {
      const fullPath = `${dir}/${filepath}`
      if (contents === null) {
        await fs.promises.unlink(fullPath)
        await git.remove({ fs, dir, gitdir, filepath })
        continue
      }

      const segments = filepath.split('/')
      let current = dir
      for (const segment of segments.slice(0, -1)) {
        current = `${current}/${segment}`
        try {
          await fs.promises.mkdir(current)
        } catch {
          // already exists
        }
      }
      await fs.promises.writeFile(fullPath, contents, 'utf8')
      await git.add({ fs, dir, gitdir, filepath })
    }

    headOid = await git.commit({
      fs,
      dir,
      gitdir,
      message: commit.message,
      author: {
        name: commit.author.name,
        email: commit.author.email,
        timestamp: commit.timestampSeconds ?? Math.floor(Date.now() / 1000),
      },
    })
  }

  return { fs, dir, gitdir, headOid }
}
