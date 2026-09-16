import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

export function createSignupStore(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const db = new Database(join(directory, 'signups.sqlite'), { create: true })
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS signups (email TEXT PRIMARY KEY, created_at TEXT NOT NULL, consent_version TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS signup_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL);`)
  const submit = db.transaction((email: string, client: string, now: Date) => {
    const day = now.toISOString().slice(0, 10)
    db.query('DELETE FROM signup_limits WHERE substr(key, 1, 10) < ?').run(day)
    const key = `${day}:${createHash('sha256').update(client).digest('hex')}`
    const count = db.query<{ count: number }, [string]>('SELECT count FROM signup_limits WHERE key = ?').get(key)?.count ?? 0
    const total = db.query<{ count: number }, [string]>('SELECT count FROM signup_limits WHERE key = ?').get(`${day}:global`)?.count ?? 0
    if (count >= 10 || total >= 500) return false
    for (const value of [key, `${day}:global`]) db.query('INSERT INTO signup_limits (key, count) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET count = count + 1').run(value)
    db.query('INSERT OR IGNORE INTO signups VALUES (?, ?, ?)').run(email, now.toISOString(), 'project-updates-v1')
    return true
  })
  return {
    async handle(req: Request, client: string) {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
      const body = await req.json().catch(() => null)
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
      if (body?.consent !== true || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: 'Enter a valid email and agree to receive project updates.' }, { status: 400 })
      if (!submit(email, client, new Date())) return Response.json({ error: 'Signup limit reached. Please try tomorrow.' }, { status: 429 })
      return Response.json({ ok: true }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
    },
    close: () => db.close(),
  }
}
