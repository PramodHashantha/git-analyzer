/**
 * A git blob is treated as binary if it contains a NUL byte — the same
 * heuristic git itself uses to decide a file has no meaningful line diff.
 * Binary files (images, fonts, compiled assets) must not be counted as
 * lines in churn or ownership.
 */
export function isBinaryBlob(blob: Uint8Array): boolean {
  return blob.includes(0)
}
