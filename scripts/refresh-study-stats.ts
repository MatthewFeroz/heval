/**
 * Refresh the X view and like counts shown on the homepage's study cards.
 *
 *   bun run studies:refresh
 *
 * Reads each post through fxtwitter's public API and rewrites src/landing/studies.json.
 * A post that fails to load keeps its previous counts; the run fails only when none load.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const file = resolve(import.meta.dir, '../src/landing/studies.json')

type Study = { id: string; xPostId?: string; views?: number; likes?: number }
const data = JSON.parse(readFileSync(file, 'utf8')) as { statsAsOf: string; studies: Study[] }

let refreshed = 0
for (const study of data.studies) {
  if (!study.xPostId) continue
  try {
    const response = await fetch(`https://api.fxtwitter.com/i/status/${study.xPostId}`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const { tweet } = await response.json() as { tweet?: { views?: number; likes?: number } }
    if (typeof tweet?.views !== 'number') throw new Error('response has no view count')
    console.log(`${study.id}: ${study.views ?? '-'} -> ${tweet.views} views, ${study.likes ?? '-'} -> ${tweet.likes} likes`)
    study.views = tweet.views
    study.likes = tweet.likes
    refreshed++
  } catch (error) {
    console.error(`${study.id}: kept previous counts (${(error as Error).message})`)
  }
}

if (!refreshed) {
  console.error('No post counts could be refreshed; studies.json is unchanged.')
  process.exit(1)
}
data.statsAsOf = new Date().toISOString().slice(0, 10)
writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
console.log(`Updated ${refreshed} of ${data.studies.filter(study => study.xPostId).length} posts, as of ${data.statsAsOf}.`)
