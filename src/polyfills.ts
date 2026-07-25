import { Buffer } from 'buffer'

// Buffer's global type comes from @types/node; the host is typed loosely so the
// `buffer` package's Buffer assigns cleanly regardless of minor type drift
// between the two.
type BufferHost = { Buffer?: unknown }

/**
 * isomorphic-git's browser build calls `Buffer.from()` on every *binary* read
 * (see its FileSystem.read wrapper) but never imports Buffer — it relies on a
 * global that exists in Node and in the jsdom test environment, but NOT in
 * real browsers. Without this polyfill, every git object/pack read silently
 * fails: FileSystem.read catches the `ReferenceError: Buffer is not defined`
 * and returns null, so loose objects report "Could not find <oid>" and packed
 * objects crash with "Cannot read properties of null (reading 'slice')" when
 * the pack index comes back null. (Text reads — refs, HEAD, config — are
 * unaffected because they return a string and skip the Buffer.from branch.)
 *
 * Imported for its side effect from main.tsx before any git operation runs.
 * Takes an explicit host (defaulting to globalThis) so the behavior is
 * testable without mutating the real environment's Buffer.
 */
export function installBufferPolyfill(host: BufferHost = globalThis): void {
  if (typeof host.Buffer === 'undefined') {
    host.Buffer = Buffer
  }
}

installBufferPolyfill()
