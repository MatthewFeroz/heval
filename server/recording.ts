import { appendFile, mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** A single ordered writer: append events once; snapshots never include the transcript. */
export class Recording {
  private pending: string[] = []
  private writing: Promise<void> = Promise.resolve()
  private failure: unknown
  private timer: ReturnType<typeof setInterval>
  private ready: Promise<void>
  constructor(private directory: string, private id: string, private summary: () => object,
    private onError: (error: unknown) => void, intervalMs = 1000) {
    this.ready = mkdir(directory, { recursive: true }).then(() => {}).catch((error) => {
      this.failure = error; this.onError(error)
    })
    this.timer = setInterval(() => { void this.flush() }, intervalMs)
    this.timer.unref()
  }
  append(event: object) { this.pending.push(JSON.stringify(event) + '\n') }
  flush() {
    const batch = this.pending.splice(0).join('')
    const snapshot = JSON.stringify(this.summary())
    this.writing = this.writing.then(async () => {
      if (this.failure) return
      await this.ready
      if (batch) await appendFile(join(this.directory, `${this.id}.jsonl`), batch)
      const path = join(this.directory, `${this.id}.json`)
      await writeFile(`${path}.tmp`, snapshot)
      await rename(`${path}.tmp`, path)
    }).catch((error) => { this.failure = error; this.onError(error) })
    return this.writing
  }
  async close() {
    clearInterval(this.timer)
    await this.flush()
    if (this.failure) throw this.failure
  }
}
