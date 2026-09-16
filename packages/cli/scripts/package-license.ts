import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type PackageManifest = { name: string; version: string; license?: string }

export function packageForModule(id: string): { folder: string; manifest: PackageManifest } | null {
  let folder = dirname(id.split('?')[0].replace(/^\0/, ''))

  while (folder.includes('node_modules')) {
    const manifestFile = join(folder, 'package.json')
    if (existsSync(manifestFile)) {
      const candidate = JSON.parse(readFileSync(manifestFile, 'utf8')) as Partial<PackageManifest>
      if (typeof candidate.name === 'string' && typeof candidate.version === 'string') {
        return { folder, manifest: candidate as PackageManifest }
      }
    }
    const parent = dirname(folder)
    if (parent === folder) break
    folder = parent
  }

  return null
}
