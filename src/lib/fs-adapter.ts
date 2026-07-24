import type { PromiseFsClient } from 'isomorphic-git'

export interface Stat {
  type: 'file' | 'dir'
  mode: number
  size: number
  ino: number
  mtimeMs: number
  ctimeMs: number
  uid: number
  gid: number
  dev: number
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

function makeStat(partial: Omit<Stat, 'isFile' | 'isDirectory' | 'isSymbolicLink'>): Stat {
  return {
    ...partial,
    isFile: () => partial.type === 'file',
    isDirectory: () => partial.type === 'dir',
    isSymbolicLink: () => false,
  }
}

export class ReadOnlyFileSystemError extends Error {}

function splitPath(filepath: string): string[] {
  return filepath.split('/').filter(Boolean)
}

export function createFsAdapter(root: FileSystemDirectoryHandle): PromiseFsClient {
  async function resolveDir(segments: string[]): Promise<FileSystemDirectoryHandle> {
    let dir = root
    for (const segment of segments) {
      dir = await dir.getDirectoryHandle(segment)
    }
    return dir
  }

  async function getFileHandle(filepath: string): Promise<FileSystemFileHandle> {
    const segments = splitPath(filepath)
    const parent = await resolveDir(segments.slice(0, -1))
    return parent.getFileHandle(segments[segments.length - 1])
  }

  async function readFile(filepath: string, opts?: { encoding?: string } | string) {
    const handle = await getFileHandle(filepath)
    const file = await handle.getFile()
    const buffer = new Uint8Array(await file.arrayBuffer())
    const encoding = typeof opts === 'string' ? opts : opts?.encoding
    if (encoding === 'utf8') return new TextDecoder().decode(buffer)
    return buffer
  }

  async function readdir(filepath: string): Promise<string[]> {
    const segments = splitPath(filepath)
    const dir = segments.length ? await resolveDir(segments) : root
    const names: string[] = []
    for await (const name of dir.keys()) names.push(name)
    return names
  }

  async function stat(filepath: string): Promise<Stat> {
    const segments = splitPath(filepath)
    if (segments.length === 0) {
      return makeStat({
        type: 'dir', mode: 0o040000, size: 0, ino: 0, mtimeMs: 0, ctimeMs: 0, uid: 1, gid: 1, dev: 1,
      })
    }
    const parent = await resolveDir(segments.slice(0, -1))
    const name = segments[segments.length - 1]
    try {
      const fileHandle = await parent.getFileHandle(name)
      const file = await fileHandle.getFile()
      return makeStat({
        type: 'file', mode: 0o100644, size: file.size, ino: 0,
        mtimeMs: file.lastModified, ctimeMs: file.lastModified, uid: 1, gid: 1, dev: 1,
      })
    } catch {
      await parent.getDirectoryHandle(name)
      return makeStat({
        type: 'dir', mode: 0o040000, size: 0, ino: 0, mtimeMs: 0, ctimeMs: 0, uid: 1, gid: 1, dev: 1,
      })
    }
  }

  function readOnly(op: string) {
    return async () => {
      throw new ReadOnlyFileSystemError(`Read-only filesystem: ${op} is not supported`)
    }
  }

  return {
    promises: {
      readFile,
      readdir,
      stat,
      lstat: stat,
      writeFile: readOnly('writeFile'),
      unlink: readOnly('unlink'),
      mkdir: readOnly('mkdir'),
      rmdir: readOnly('rmdir'),
      readlink: readOnly('readlink'),
      symlink: readOnly('symlink'),
    },
  }
}
