import { describe, expect, it } from 'vitest'
import { Buffer } from 'buffer'
import { installBufferPolyfill } from '../src/polyfills'

// isomorphic-git's browser build relies on a global `Buffer`. Node and jsdom
// provide one, so this whole class of bug was invisible until the app ran in a
// real browser. installBufferPolyfill takes an explicit host so we can verify
// the real logic against a browser-like object (no Buffer) without deleting the
// test environment's own Buffer (which vitest itself depends on).

describe('installBufferPolyfill', () => {
  it('installs a working Buffer on a host that lacks one (the browser case)', () => {
    const host: { Buffer?: typeof Buffer } = {}
    expect(host.Buffer).toBeUndefined()

    installBufferPolyfill(host)

    expect(host.Buffer).toBeDefined()
    expect(typeof host.Buffer!.from).toBe('function')
    // Mirrors how isomorphic-git's FileSystem.read wraps a Uint8Array from our
    // fs adapter: Buffer.from(bytes). This is the exact call that throws in a
    // real browser without the polyfill.
    const bytes = new Uint8Array([104, 105])
    expect(host.Buffer!.from(bytes).toString('utf8')).toBe('hi')
  })

  it('does not overwrite a Buffer the host already has', () => {
    const sentinel = Buffer
    const host: { Buffer?: typeof Buffer } = { Buffer: sentinel }

    installBufferPolyfill(host)

    expect(host.Buffer).toBe(sentinel)
  })
})
