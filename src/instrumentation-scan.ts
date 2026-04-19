import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  'target',
  '.idea',
  '.vscode',
  'coverage',
])

const MAX_FILE_BYTES = 4 * 1024 * 1024

export type Hit = { file: string; line: number; text: string }

export type RemovalResult = {
  removed: Hit[]
  filesChanged: number
  dryRun: boolean
}

export async function findMarkerHits(root: string, marker: string): Promise<Hit[]> {
  const absRoot = resolve(root)
  const hits: Hit[] = []
  await walk(absRoot, async (filePath) => {
    const content = await readFileOrNull(filePath)
    if (content === null) return
    if (!content.includes(marker)) return
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.includes(marker)) {
        hits.push({ file: filePath, line: i + 1, text: lines[i]! })
      }
    }
  })
  return hits
}

export async function removeMarkerHits(
  root: string,
  marker: string,
  dryRun: boolean,
): Promise<RemovalResult> {
  const absRoot = resolve(root)
  const removed: Hit[] = []
  let filesChanged = 0

  await walk(absRoot, async (filePath) => {
    const content = await readFileOrNull(filePath)
    if (content === null) return
    if (!content.includes(marker)) return
    const lines = content.split('\n')
    const kept: string[] = []
    const fileRemovals: Hit[] = []
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (line.includes(marker)) {
        fileRemovals.push({ file: filePath, line: i + 1, text: line })
      } else {
        kept.push(line)
      }
    }
    if (fileRemovals.length === 0) return
    removed.push(...fileRemovals)
    if (!dryRun) {
      await writeFile(filePath, kept.join('\n'), 'utf8')
      filesChanged++
    } else {
      filesChanged++
    }
  })

  return { removed, filesChanged, dryRun }
}

async function walk(
  dir: string,
  onFile: (filePath: string) => Promise<void>,
): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      await walk(full, onFile)
    } else if (entry.isFile()) {
      await onFile(full)
    }
  }
}

async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    const buf = await readFile(filePath)
    if (buf.length > MAX_FILE_BYTES) return null
    if (looksBinary(buf)) return null
    return buf.toString('utf8')
  } catch {
    return null
  }
}

function looksBinary(buf: Buffer): boolean {
  const sampleLen = Math.min(buf.length, 8000)
  for (let i = 0; i < sampleLen; i++) {
    if (buf[i] === 0) return true
  }
  return false
}
