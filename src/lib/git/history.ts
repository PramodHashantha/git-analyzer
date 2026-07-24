import * as git from 'isomorphic-git'
import type { CommitInfo } from '../types'
import type { RepoContext } from './repo'

export async function walkHistory(ctx: RepoContext, branch: string): Promise<CommitInfo[]> {
  const oid = await git.resolveRef({ fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, ref: branch })
  const log = await git.log({ fs: ctx.fs, dir: ctx.dir, gitdir: ctx.gitdir, ref: oid })

  return log.map((entry) => ({
    oid: entry.oid,
    parentOids: entry.commit.parent,
    author: entry.commit.author.name,
    email: entry.commit.author.email,
    timestamp: entry.commit.author.timestamp,
    message: entry.commit.message.trim(),
    isMerge: entry.commit.parent.length > 1,
  }))
}
