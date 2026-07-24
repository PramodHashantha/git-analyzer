type FakeTree = { [name: string]: string | FakeTree }

class FakeFileHandle {
  kind = 'file' as const
  constructor(private contents: string) {}
  async getFile() {
    const bytes = new TextEncoder().encode(this.contents)
    return {
      size: bytes.byteLength,
      lastModified: 0,
      async arrayBuffer() {
        return bytes.buffer
      },
    } as unknown as File
  }
}

class FakeDirectoryHandle {
  kind = 'directory' as const
  constructor(private tree: FakeTree) {}

  async getFileHandle(name: string): Promise<FakeFileHandle> {
    const entry = this.tree[name]
    if (typeof entry !== 'string') throw new DOMException('Not a file', 'NotFoundError')
    return new FakeFileHandle(entry)
  }

  async getDirectoryHandle(name: string): Promise<FakeDirectoryHandle> {
    const entry = this.tree[name]
    if (typeof entry !== 'object' || entry === null) {
      throw new DOMException('Not a directory', 'NotFoundError')
    }
    return new FakeDirectoryHandle(entry)
  }

  async *keys() {
    for (const name of Object.keys(this.tree)) yield name
  }
}

export function makeFakeRoot(tree: FakeTree): FileSystemDirectoryHandle {
  return new FakeDirectoryHandle(tree) as unknown as FileSystemDirectoryHandle
}
