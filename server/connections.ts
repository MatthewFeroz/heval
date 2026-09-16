import { Database } from 'bun:sqlite'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fetchCatalog, type Catalog } from '../harbor/gateway/catalog'
import { RunnerError } from './types'

export type ConnectionStatus = { connected: boolean; provider: 'merge-gateway'; models: string[]; validatedAt?: string }
type Row = { sealed: string; models: string; validated_at: string }

export function connectionEncryptionKey(directory: string, configured?: string, hosted = false) {
  if (configured) {
    if (!/^[a-fA-F0-9]{64}$/.test(configured)) throw new Error('HEVAL_CONNECTION_ENCRYPTION_KEY must be 64 hexadecimal characters')
    return Buffer.from(configured, 'hex')
  }
  if (hosted) throw new Error('Hosted provider connections require HEVAL_CONNECTION_ENCRYPTION_KEY')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, 'connection-encryption.key')
  try { writeFileSync(path, randomBytes(32), { flag: 'wx', mode: 0o600 }) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  chmodSync(path, 0o600)
  const key = readFileSync(path)
  if (key.length !== 32) throw new Error('Invalid local connection encryption key')
  return key
}

export function createConnectionStore(directory: string, encryptionKey: Buffer, catalog: (key: string) => Promise<Catalog> = fetchCatalog) {
  if (encryptionKey.length !== 32) throw new Error('Connection encryption requires a 32-byte key')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, 'connections.sqlite')
  const db = new Database(path, { create: true })
  chmodSync(path, 0o600)
  db.exec('PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS connections (owner TEXT PRIMARY KEY, sealed TEXT NOT NULL, models TEXT NOT NULL, validated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS connection_limits (owner TEXT PRIMARY KEY, window INTEGER NOT NULL, attempts INTEGER NOT NULL)')
  const busy = new Set<string>()
  function row(owner: string) { return db.query('SELECT sealed, models, validated_at FROM connections WHERE owner=?').get(owner) as Row | null }
  function seal(owner: string, key: string) {
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce)
    cipher.setAAD(Buffer.from(owner))
    return Buffer.concat([nonce, cipher.update(key, 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64')
  }
  function secret(owner: string) {
    const saved = row(owner)
    if (!saved) throw new RunnerError('Connect Merge Gateway in Provider settings first.', 409)
    const bytes = Buffer.from(saved.sealed, 'base64')
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, bytes.subarray(0, 12))
    decipher.setAAD(Buffer.from(owner)); decipher.setAuthTag(bytes.subarray(-16))
    return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString('utf8')
  }
  function status(owner: string): ConnectionStatus {
    const saved = row(owner)
    return { connected: !!saved, provider: 'merge-gateway', models: saved ? JSON.parse(saved.models) : [], ...(saved ? { validatedAt: saved.validated_at } : {}) }
  }
  return {
    status, secret,
    async validate(owner: string, replacement?: unknown) {
      if (busy.has(owner)) throw new RunnerError('A connection update is already in progress.', 409)
      if (replacement !== undefined && (typeof replacement !== 'string' || !replacement.trim() || replacement.length > 4096 || /[\r\n]/.test(replacement))) throw new RunnerError('Enter a valid Gateway API key.', 400)
      const window = Math.floor(Date.now() / 60000)
      const limit = db.query('SELECT window, attempts FROM connection_limits WHERE owner=?').get(owner) as { window: number; attempts: number } | null
      if (limit?.window === window && limit.attempts >= 10) throw new RunnerError('Too many validation attempts. Retry in a minute.', 429)
      db.query('INSERT OR REPLACE INTO connection_limits VALUES (?, ?, ?)').run(owner, window, limit?.window === window ? limit.attempts + 1 : 1)
      busy.add(owner)
      try {
        const key = replacement === undefined ? secret(owner) : (replacement as string).trim()
        let result: Catalog
        try { result = await catalog(key) } catch (error) {
          if (error instanceof Error && /catalog fetch failed: (401|403)\b/.test(error.message)) throw new RunnerError('Merge Gateway rejected this key. Check that it is an active Gateway key.', 401)
          throw new RunnerError('Could not reach the Gateway catalog. Your saved connection has not changed. Retry shortly.', 502)
        }
        const models = result.models.filter(model => model.vendors.some(route => route.supportsToolCalling && route.status === 'available')).map(model => model.model)
        if (!models.length) throw new RunnerError('This key has no available models with tool-calling support.', 422)
        db.query('INSERT OR REPLACE INTO connections VALUES (?, ?, ?, ?)').run(owner, seal(owner, key), JSON.stringify(models), new Date().toISOString())
        return status(owner)
      } finally { busy.delete(owner) }
    },
    remove(owner: string) {
      if (busy.has(owner)) throw new RunnerError('Wait for connection validation to finish before deleting.', 409)
      db.query('DELETE FROM connections WHERE owner=?').run(owner)
      return status(owner)
    },
    close() { db.close() },
  }
}
export type ConnectionStore = ReturnType<typeof createConnectionStore>
