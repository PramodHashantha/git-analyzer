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

/**
 * Runs a File System Access API operation, converting a 'NotFoundError'
 * DOMException (thrown by getFileHandle/getDirectoryHandle when a path
 * doesn't exist) into a Node-style Error with `.code = 'ENOENT'`, since
 * isomorphic-git's internals check `err.code === 'ENOENT'` to distinguish
 * benign "not found" cases from real failures. Other errors (e.g.
 * permission errors) propagate unchanged.
 */
async function withEnoent<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotFoundError') {
      throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
    }
    throw err
  }
}

export function createFsAdapter(root: FileSystemDirectoryHandle): PromiseFsClient {
  // Cache resolved directory handles by path so reads don't re-navigate from
  // root (root -> .git -> objects -> XX -> ...) on every single read — a huge
  // cost when blame issues tens of thousands of reads. The filesystem is
  // read-only for the lifetime of an adapter (one analysis run), so handles
  // never go stale. Promises are cached (not just handles) so concurrent
  // requests for the same directory share one navigation; a rejected lookup
  // is evicted so a later, legitimately-different call can retry.
  const dirHandleCache = new Map<string, Promise<FileSystemDirectoryHandle>>()

  function resolveDir(segments: string[]): Promise<FileSystemDirectoryHandle> {
    const key = segments.join('/')
    let cached = dirHandleCache.get(key)
    if (!cached) {
      cached = (async () => {
        if (segments.length === 0) return root
        const parent = await resolveDir(segments.slice(0, -1))
        return withEnoent(() => parent.getDirectoryHandle(segments[segments.length - 1]))
      })()
      dirHandleCache.set(key, cached)
      cached.catch(() => dirHandleCache.delete(key))
    }
    return cached
  }

  async function getFileHandle(filepath: string): Promise<FileSystemFileHandle> {
    const segments = splitPath(filepath)
    const parent = await resolveDir(segments.slice(0, -1))
    return withEnoent(() => parent.getFileHandle(segments[segments.length - 1]))
  }

  async function readFile(filepath: string, opts?: { encoding?: string } | string) {
    try {
      const handle = await getFileHandle(filepath)
      const file = await handle.getFile()
      const buffer = new Uint8Array(await file.arrayBuffer())
      const encoding = typeof opts === 'string' ? opts : opts?.encoding
      if (encoding === 'utf8') return new TextDecoder().decode(buffer)
      return buffer
    } catch (err) {
      // isomorphic-git probes fs capability via a bare `readFile()` call with
      // no arguments (see isPromiseFs in its source) purely to check whether
      // the result is a Promise — it always rejects here by design and is
      // caught internally, so it's not a real failure and not worth logging.
      const isCapabilityProbe = filepath === undefined
      const isExpectedMissingFile = err instanceof Error && err.message.startsWith('ENOENT')
      if (!isCapabilityProbe && !isExpectedMissingFile) {
        console.error(`[fs-adapter] readFile failed for "${filepath}":`, err)
      }
      throw err
    }
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
      await withEnoent(() => parent.getDirectoryHandle(name))
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
