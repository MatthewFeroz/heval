import { HARNESS } from '../harnesses'
import type { RunDatabase, RunStack, RunStudy, RunTask, RunTrial } from './database'

type ReportRow = Record<string, unknown> & { trial: string; task: string; stack: string; agent: string; modelShort: string }
type Report = {
  job: string
  generatedAt: string
  rows: ReportRow[]
  exclusions?: { trial: string; agent: string }[]
  pricingAdjustments?: { model: string; basis: string; multiplierFromRecordedParticleRate?: number }[]
}

export type StudyInput = Pick<RunStudy, 'id' | 'name' | 'summary' | 'varies' | 'featured' | 'published'> & { report: Report }
export type StudySource = Omit<StudyInput, 'report'> & { report: string }

/** The published studies shown on the homepage, each backed by one normalized report. */
export const STUDY_SOURCES: StudySource[] = [
  {
    id: 'terminal-bench',
    name: 'Terminal-Bench',
    summary: '6 models in Codex',
    varies: 'model',
    featured: ['codex / glm-5.3', 'codex / claude-sonnet-5'],
    published: { label: 'GLM 5.3 beat Claude Sonnet 5 for a tenth of the cost', url: 'https://x.com/merge_api/status/2099853277600895375' },
    report: 'results/harbor/terminal-bench-comparison.json',
  },
  {
    id: 'swe-bench-lite',
    name: 'SWE-bench Lite',
    summary: '5 harnesses on DeepSeek V4.1 Flash',
    varies: 'harness',
    featured: ['deepseek-harness / deepseek-v4.1-flash', 'pi / deepseek-v4.1-flash'],
    published: { label: 'The harness alone lifted accuracy from 61% to 75%', url: 'https://x.com/merge_api/status/2105296717432135759' },
    report: 'results/harbor/swe-lite-5harness-paired.json',
  },
]


const MODELS: Record<string, string> = {
  'glm-5.3': 'GLM 5.3',
  'glm-5.3-flash': 'GLM 5.3 Flash',
  'kimi-k3': 'Kimi K3',
  'claude-sonnet-5': 'Claude Sonnet 5',
  'deepseek-v4-flash': 'DeepSeek V4 Flash',
  'deepseek-v4-pro-0813': 'DeepSeek V4 Pro 0813',
  'deepseek-v4.1-flash': 'DeepSeek V4.1 Flash',
}

const modelName = (model: string) => MODELS[model] ?? model
const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']
const count = (n: number, noun: string) => `${WORDS[n] ?? n} ${noun}${n === 1 ? '' : 's'}`
const text = (value: unknown) => typeof value === 'string' && value ? value : null
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null

/** SWE-bench instance ids name the upstream pull request: owner__repo-123. */
export function describeTask(id: string): RunTask {
  const instance = id.replace(/^swebench-[a-z]+__/, '')
  const match = /^([^_]+(?:_[^_]+)*)__(.+)-(\d+)$/.exec(instance)
  if (!match || instance === id) return { id, name: id, repository: null, url: null }
  const [, owner, repo, pull] = match
  return { id, name: `${repo}-${pull}`, repository: `${owner}/${repo}`, url: `https://github.com/${owner}/${repo}/pull/${pull}` }
}

function notes(input: StudyInput, stacks: RunStack[], tasks: number) {
  const { report } = input
  const attempts = report.rows.length / (stacks.length * tasks)
  const lines = [`${count(attempts, 'attempt')} per task for each ${input.varies}. The task's own tests decide pass or fail.`]
  if (input.varies === 'model') lines.push(`Every run used ${stacks[0].harnessName} ${stacks[0].harnessVersion}.`)
  else lines.push(`Every run used ${stacks[0].modelName}.`)
  const excluded = report.exclusions?.length ?? 0
  if (excluded) lines.push(`${count(excluded, 'attempt')} used the harness API key to consult other models. Those tasks were removed for every ${input.varies}, leaving ${tasks}.`)
  for (const adjustment of report.pricingAdjustments ?? []) {
    const times = adjustment.multiplierFromRecordedParticleRate
    lines.push(`${modelName(adjustment.model.split('/').pop()!)} costs use ${adjustment.basis}${times ? `, ${times}× the recorded rate` : ''}.`)
  }
  return lines
}

function buildStudy(input: StudyInput): RunStudy {
  const rows = input.report.rows
  const stacks = new Map<string, RunStack>()
  const tasks = new Map<string, RunTask>()
  const trials: RunTrial[] = []
  for (const row of rows) {
    if (!stacks.has(row.stack)) {
      stacks.set(row.stack, {
        id: row.stack,
        harness: row.agent,
        harnessName: HARNESS[row.agent]?.name ?? row.agent,
        harnessVersion: text(row.agentVersion),
        model: row.modelShort,
        modelName: modelName(row.modelShort),
        provider: text(row.provider) ?? 'unknown',
        reasoningEffort: text(row.reasoningEffort),
        thinking: text(row.thinking),
      })
    }
    if (!tasks.has(row.task)) tasks.set(row.task, describeTask(row.task))
    const gatewayTokens = number(row.proxyInputTokens) !== null || number(row.proxyOutputTokens) !== null
    trials.push({
      id: row.trial,
      task: row.task,
      stack: row.stack,
      passed: row.passed === 1,
      reward: number(row.reward),
      error: text(row.error),
      agentSeconds: number(row.agentSeconds),
      totalSeconds: number(row.totalSeconds),
      inputTokens: number(gatewayTokens ? row.proxyInputTokens : row.inputTokens),
      cacheTokens: number(gatewayTokens ? row.proxyCachedTokens : row.cacheTokens),
      outputTokens: number(gatewayTokens ? row.proxyOutputTokens : row.outputTokens),
      tokenSource: gatewayTokens ? 'gateway' : number(row.inputTokens) !== null || number(row.outputTokens) !== null ? 'harness' : null,
      costUsd: number(row.costUsd),
      costSource: number(row.proxyCostUsd) === number(row.costUsd) && text(row.proxyCostSource)
        ? `gateway ${text(row.proxyCostSource)}` : text(row.costSource),
      turns: number(row.turns),
      turnSource: text(row.turnSource),
      turnCap: number(row.turnCap),
      modelRequests: number(row.modelRequests),
      startedAt: text(row.startedAt),
    })
  }
  const stackList = [...stacks.values()]
  for (const id of input.featured) if (!stacks.has(id)) throw new Error(`${input.id}: featured stack ${id} has no runs`)
  if (new Set(trials.map(trial => trial.id)).size !== trials.length) throw new Error(`${input.id}: duplicate trial ids`)
  return {
    id: input.id,
    name: input.name,
    summary: input.summary,
    varies: input.varies,
    featured: input.featured,
    published: input.published,
    report: { job: input.report.job, generatedAt: input.report.generatedAt },
    notes: notes(input, stackList, tasks.size),
    stacks: stackList,
    tasks: [...tasks.values()],
    trials,
  }
}

export function buildRunDatabase(studies: StudyInput[]): RunDatabase {
  return { schemaVersion: 1, studies: studies.map(buildStudy) }
}

export const buildFromSources = (read: (path: string) => Report) =>
  buildRunDatabase(STUDY_SOURCES.map(source => ({ ...source, report: read(source.report) })))
