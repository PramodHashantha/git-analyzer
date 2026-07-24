import { describe, expect, it } from 'vitest'
import { createFsAdapter, ReadOnlyFileSystemError } from '../../src/lib/fs-adapter'
import { makeFakeRoot } from '../fixtures/fakeFileSystemAccess'

describe('createFsAdapter', () => {
  const root = makeFakeRoot({
    '.git': { HEAD: 'ref: refs/heads/main\n' },
    src: { 'index.ts': "console.log('hi')\n" },
  })

  it('reads a nested file as utf8 text', async () => {
    const fs = createFsAdapter(root)
    const contents = await fs.promises.readFile('/src/index.ts', { encoding: 'utf8' })
    expect(contents).toBe("console.log('hi')\n")
  })

  it('lists directory entries', async () => {
    const fs = createFsAdapter(root)
    const names = await fs.promises.readdir('/')
    expect(names.sort()).toEqual(['.git', 'src'])
  })

  it('reports file vs directory via stat', async () => {
    const fs = createFsAdapter(root)
    const fileStat = await fs.promises.stat('/src/index.ts')
    expect(fileStat.isFile()).toBe(true)

    const dirStat = await fs.promises.stat('/src')
    expect(dirStat.isDirectory()).toBe(true)
  })

  it('rejects writes as read-only', async () => {
    const fs = createFsAdapter(root)
    await expect(fs.promises.writeFile('/src/index.ts', 'x')).rejects.toBeInstanceOf(
      ReadOnlyFileSystemError
    )
  })
})
