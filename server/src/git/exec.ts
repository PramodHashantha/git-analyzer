import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// Generous buffer for large repos' log/blame output.
const MAX_BUFFER = 1024 * 1024 * 200

function withSafeDefaults(args: string[]): string[] {
  // Force color off regardless of the user's global gitconfig, so ANSI
  // escape codes can never contaminate output we parse.
  return ['-c', 'color.ui=false', ...args]
}

export async function runGit(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = (await execFileAsync('git', withSafeDefaults(args), {
    cwd: repoPath,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  })) as { stdout: string; stderr: string }
  return stdout
}

export async function runGitBuffer(repoPath: string, args: string[]): Promise<Buffer> {
  const { stdout } = (await execFileAsync('git', withSafeDefaults(args), {
    cwd: repoPath,
    encoding: 'buffer',
    maxBuffer: MAX_BUFFER,
  })) as { stdout: Buffer; stderr: Buffer }
  return stdout
}
