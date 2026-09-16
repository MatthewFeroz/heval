import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync, readdirSync, lstatSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const randomSecret = () => randomBytes(32).toString('hex')
export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
export function readJson<T>(path: string): T { return JSON.parse(readFileSync(path, 'utf8')) as T }
export function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.${randomSecret().slice(0, 8)}.tmp`
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  renameSync(temp, path)
}
/** Task directories are copied to a run before execution; hash contents, not machine paths. */
export function hashDirectory(path: string) {
  const hash = createHash('sha256')
  let bytes = 0, count = 0
  function walk(relative: string) {
    for (const name of readdirSync(join(path, relative)).sort()) {
      if (name === '.git' || name === '__pycache__') continue
      const next = join(relative, name), stat = lstatSync(join(path, next))
      if (stat.isSymbolicLink()) throw new Error('Approved tasks must not contain symlinks.')
      if (stat.isDirectory()) walk(next)
      else if (stat.isFile()) {
        bytes += stat.size; count++
        if (bytes > 20_000_000 || count > 2000) throw new Error('A runner task must contain at most 20 MB and 2000 files.')
        hash.update(next).update('\0').update(readFileSync(join(path, next))).update('\0')
      } else throw new Error('Approved tasks must contain only regular files.')
    }
  }
  walk('')
  return hash.digest('hex')
}
