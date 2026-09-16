import { readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isHarness, type Run, type Chunk } from './types'

export async function restoreRuns(directory: string): Promise<Run[]> {
  const files = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const runs: Run[] = []
  for (const file of files.sort()) {
    if (!/^[a-f0-9-]{36}\.json$/.test(file)) continue
    // Fail closed on corrupt metadata: silently dropping an owner or active run
    // could lose history or admit work while an abandoned worker is still alive.
    const value = JSON.parse(await readFile(join(directory, file), 'utf8')) as Run
    if (value.id !== file.slice(0, -5) || !value.ownerId || !isHarness(value.harness) ||
        !Number.isFinite(Date.parse(value.startedAt)) || !['running', 'grading', 'complete', 'failed', 'cancelled', 'timed-out'].includes(value.status)) {
      throw new Error(`Invalid run summary: ${file}`)
    }
    runs.push({ ...value, chunks: [] })
  }
  return runs.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

export async function saveSummary(directory: string, run: Run) {
  const path = join(directory, `${run.id}.json`)
  await writeFile(`${path}.tmp`, JSON.stringify({ ...run, chunks: undefined }))
  await rename(`${path}.tmp`, path)
}

export async function readTranscript(directory: string, id: string): Promise<Chunk[]> {
  const text = await readFile(join(directory, `${id}.jsonl`), 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return ''
    throw error
  })
  const chunks: Chunk[] = []
  for (const line of text.split('\n')) {
    try {
      const event = JSON.parse(line)
      if (event.type === 'data' && typeof event.data === 'string' && Number.isFinite(event.at)) chunks.push({ at: event.at, data: event.data })
    } catch { /* A crash can leave an incomplete final event. */ }
  }
  return chunks
}
