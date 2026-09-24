import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import type { JobExport } from '../src/charts/trial'
import { socialSettings } from '../src/charts/social-presets'
import { renderPosters } from '../server/social-posters'

type Profile = {
  schemaVersion: 1
  id: string
  baseline: { file: string; sha256Json: string }
  runTemplate: string
  chartSettings: string
  allChartSettings: string
  benchmark: { name: string; version: string }
  attemptsPerTask: number
  models: { id: string; short: string; harness: string; harnessVersion: string; vendor: string }[]
  tasks: { name: string; checksum: string }[]
}
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
export function verifyExperiment(input: JobExport, profile: Profile): string[] {
  const errors: string[] = []
  if (!Array.isArray(input.rows)) return ['Input must be a normalized Heval job export']
  const expected = profile.models.length * profile.tasks.length * profile.attemptsPerTask
  if (input.rows.length !== expected)
    errors.push('Expected ' + expected + ' trials; received ' + input.rows.length)
  for (const row of input.rows) {
    const model = profile.models.find((m) => m.id === row.model),
      task = profile.tasks.find((t) => t.name === row.task)
    if (!model) {
      errors.push('Unexpected model: ' + row.model)
      continue
    }
    if (!task) {
      errors.push('Unexpected task: ' + row.task)
      continue
    }
    for (const [label, actual, wanted] of [
      ['model label', row.modelShort, model.short],
      ['harness', row.agent, model.harness],
      ['harness version', row.agentVersion, model.harnessVersion],
      ['vendor', row.vendor, model.vendor],
      ['task checksum', row.taskChecksum, task.checksum],
    ]) {
      if (actual !== wanted)
        errors.push(
          row.model + ' / ' + row.task + ': ' + label + ' mismatch (' + actual + ' vs ' + wanted + ')',
        )
    }
  }
  for (const model of profile.models)
    for (const task of profile.tasks) {
      if (
        input.rows.filter((r) => r.model === model.id && r.task === task.name).length !==
        profile.attemptsPerTask
      )
        errors.push('Missing or repeated attempt: ' + model.id + ' / ' + task.name)
    }
  return [...new Set(errors)]
}

if (import.meta.main) {
  const [
    action,
    inputPath,
    profilePath = 'experiments/demo-comparison.json',
    outDir = 'results/harbor/threads/recreated',
  ] = process.argv.slice(2)
  const profile = read(profilePath) as Profile
  if (profile.schemaVersion !== 1 || !profile.models?.length || !profile.tasks?.length)
    throw new Error('Invalid experiment profile')
  if (!['prepare', 'verify', 'charts', 'charts-all', 'baseline'].includes(action))
    throw new Error(
      'Usage: bun run experiment <prepare|verify|charts|charts-all|baseline> <input-or-output-path> [profile.json] [chart-output-directory]',
    )
  if (action === 'prepare') {
    if (!profile.runTemplate) throw new Error('This synthetic example has no executable tasks. Supply a profile with a reviewed Harbor run template.')
    const output = inputPath ?? '.scratch/evaluation-run.yaml'
    if (existsSync(output))
      throw new Error('Refusing to overwrite ' + output + '; choose a new run config path')
    const config = Bun.YAML.parse(readFileSync(profile.runTemplate, 'utf8')) as {
      job_name: string
      n_attempts: number
      agents: { model_name: string; name: string; env: Record<string, string>; [key: string]: unknown }[]
      datasets: { name: string; version: string; task_names: string[] }[]
    }
    config.job_name = profile.id + '-' + new Date().toISOString().replace(/[:.]/g, '-')
    config.n_attempts = profile.attemptsPerTask
    config.agents = profile.models.map((model) => {
      const agent = config.agents.find(
        (a: { model_name: string; name: string }) => a.model_name === model.id && a.name === model.harness,
      )
      if (!agent)
        throw new Error('No harness template for ' + model.id + '; add it to ' + profile.runTemplate)
      return { ...agent, env: { ...agent.env, HEVAL_VENDOR: model.vendor } }
    })
    config.datasets = [
      {
        name: profile.benchmark.name,
        version: profile.benchmark.version,
        task_names: profile.tasks.map((t) => t.name),
      },
    ]
    mkdirSync(dirname(output), { recursive: true })
    writeFileSync(output, JSON.stringify(config, null, 2) + '\n')
    const pins = output + '.pins.json'
    writeFileSync(
      pins,
      JSON.stringify(Object.fromEntries(profile.models.map((m) => [m.id, m.vendor])), null, 2) + '\n',
    )
    console.log(
      'Prepared ' +
        profile.models.length +
        ' models x ' +
        profile.tasks.length +
        ' tasks. No evaluation started.',
    )
    console.log('Run config: ' + output + ' | Vendor pins: ' + pins)
    console.log(
      'Before running, provision the recorded harness version and validate task/image versions. This config does not freeze upstream models or installation dependencies.',
    )
  } else {
    const file = action === 'baseline' ? profile.baseline.file : inputPath
    if (!file) throw new Error('Provide a normalized results JSON file')
    const bytes = readFileSync(file)
    if (action === 'baseline' && createHash('sha256').update(JSON.stringify(JSON.parse(bytes.toString()))).digest('hex') !== profile.baseline.sha256Json)
      throw new Error('Archived baseline hash mismatch')
    const input = JSON.parse(bytes.toString()) as JobExport,
      errors = verifyExperiment(input, profile)
    if (errors.length) throw new Error(errors.slice(0, 20).join('\n'))
    console.log(
      'Matched ' +
        profile.models.length +
        ' model/harness/vendor selections, ' +
        profile.tasks.length +
        ' task checksums, and ' +
        input.rows.length +
        ' trials.',
    )
    console.log(
      'This checks recorded configuration, not outcome equality or unrecorded provider/image revisions.',
    )
    if (action !== 'verify') {
      const settings = socialSettings(
        read(action === 'charts-all' ? profile.allChartSettings : profile.chartSettings),
      )
      settings.models = profile.models.map((m) => m.short)
      const result = await renderPosters(input, settings, true)
      mkdirSync(outDir, { recursive: true })
      writeFileSync(join(outDir, result.filename), result.bytes)
      console.log(join(outDir, result.filename))
    }
  }
}
