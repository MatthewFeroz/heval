/**
 * Builds the homepage run database from owner-approved normalized reports.
 * The public checkout ships the approved snapshot, not these raw source inputs.
 * Supply the reports listed in STUDY_SOURCES separately before rebuilding.
 *
 * Only the fields listed in src/runs/build.ts reach the browser. Source paths,
 * vendor routes and proxy details stay in results/harbor/. Rerun after a study
 * report or STUDY_SOURCES changes:
 *
 *   bun run runs:build
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildFromSources } from '../src/runs/build'

const root = resolve(import.meta.dirname, '..')
const database = buildFromSources(path => JSON.parse(readFileSync(resolve(root, path), 'utf8')))
writeFileSync(resolve(root, 'src/runs/run-database.json'), `${JSON.stringify(database)}\n`)
console.log(database.studies.map(study => `${study.id}: ${study.trials.length} runs, ${study.tasks.length} tasks, ${study.stacks.length} stacks`).join('\n'))
