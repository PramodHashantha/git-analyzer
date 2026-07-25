const decoder = new TextDecoder('utf-8', { fatal: false })

/**
 * Decode a git blob to lines using the normalization the blame and ownership
 * walks share: split on '\n' and drop a single trailing empty element left by
 * a final newline. Both paths MUST use this so their diff inputs are identical
 * — exact per-line ownership parity depends on it.
 */
export function decodeLines(blob: Uint8Array): string[] {
  const text = decoder.decode(blob)
  if (!text.length) return []
  const lines = text.split('\n')
  return lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines
}

/**
 * Rebuild diff-input text from lines: join with '\n' and re-add the trailing
 * newline (empty string for an empty file). Mirrors decodeLines so the text
 * fed to diffLines matches what blame.ts has always produced.
 */
export function linesToText(lines: string[]): string {
  return lines.length ? lines.join('\n') + '\n' : ''
}
