/**
 * Default number of git object operations to run concurrently. The analysis
 * is I/O-bound on the File System Access API, which handles many concurrent
 * reads well, so overlapping them hides per-read latency. Kept modest because
 * the CPU-bound decode/diff work is single-threaded and more in-flight work
 * only adds memory pressure past this point.
 */
export const GIT_READ_CONCURRENCY = 12

/**
 * Map over `items` running at most `limit` calls of `fn` at once. Results are
 * returned in input order regardless of completion order. `onProgress` fires
 * once per completed item with a monotonically increasing `done` count, so it
 * behaves identically to a sequential loop's progress reporting.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void
): Promise<R[]> {
  const total = items.length
  const results = new Array<R>(total)
  let nextIndex = 0
  let done = 0

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex++
      if (i >= total) return
      results[i] = await fn(items[i], i)
      done++
      onProgress?.(done, total)
    }
  }

  const workerCount = Math.min(Math.max(1, limit), total)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}
