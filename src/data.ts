import { HARNESS } from './harnesses'
export type RunEvent = {
  at: number
  kind: 'system' | 'inspect' | 'edit' | 'test' | 'think' | 'finish'
  text: string
  detail?: string
}

export type Runner = {
  id: string
  name: string
  shortName: string
  logo: string
  command: string
  version: string
  model: string
  provider: string
  color: string
  outcome: 'passed' | 'failed'
  score: number
  cost: number | null
  duration: number
  tokens: number | null
  toolCalls: number
  tests: string
  events: RunEvent[]
}

export type Experiment = {
  id: string
  type: 'Stack race' | 'Harness isolation' | 'Model sweep'
  title: string
  prompt: string
  task: string
  language: string
  difficulty: string
  completedAt: string
  runners: Runner[]
}

export const featuredExperiment: Experiment = {
  id: 'race-condition-cache-0042',
  type: 'Harness isolation',
  title: 'The cache stampede race',
  prompt: 'Fix the race condition in the async cache and make the full test suite pass. Preserve the public API.',
  task: 'concurrent-cache',
  language: 'TypeScript',
  difficulty: 'Medium',
  completedAt: 'ILLUSTRATIVE DATA',
  runners: [
    {
      id: 'claude-code',
      ...HARNESS['claude-code'],
      shortName: 'CC',
      command: 'claude --model anthropic/claude-sonnet-4-5-20250929',
      version: 'v2.1.251',
      model: 'Claude Sonnet 4.5',
      provider: 'Example provider',
      outcome: 'passed',
      score: 100,
      cost: null,
      duration: 40,
      tokens: null,
      toolCalls: 27,
      tests: '1 / 1',
      events: [
        { at: 0, kind: 'system', text: 'Sandbox ready', detail: 'node 24 · 2 vCPU · 4 GB' },
        { at: 4, kind: 'inspect', text: 'Reading repository structure', detail: 'src/cache.ts · test/cache.test.ts' },
        { at: 11, kind: 'think', text: 'Tracing concurrent get() calls', detail: 'Found duplicate loader invocation window' },
        { at: 23, kind: 'test', text: 'Running targeted cache tests', detail: '14 passed · 4 failed' },
        { at: 38, kind: 'edit', text: 'Adding in-flight promise map', detail: 'src/cache.ts  +18 −6' },
        { at: 56, kind: 'test', text: 'Retrying targeted tests', detail: '18 passed · 0 failed' },
        { at: 69, kind: 'inspect', text: 'Reviewing cleanup behavior', detail: 'Checking rejected loader path' },
        { at: 78, kind: 'edit', text: 'Guarding rejected promise cleanup', detail: 'src/cache.ts  +4 −1' },
        { at: 86, kind: 'test', text: 'Running full test suite', detail: '94 passed · 0 failed' },
        { at: 92, kind: 'finish', text: 'Task completed', detail: 'Public API preserved' },
      ],
    },
    {
      id: 'codex',
      ...HARNESS['codex'],
      shortName: 'CX',
      command: 'codex --model anthropic/claude-sonnet-4-5-20250929',
      version: 'v0.151.0',
      model: 'Claude Sonnet 4.5',
      provider: 'Example provider',
      outcome: 'passed',
      score: 100,
      cost: null,
      duration: 32,
      tokens: null,
      toolCalls: 18,
      tests: '1 / 1',
      events: [
        { at: 0, kind: 'system', text: 'Workspace initialized', detail: 'node 24 · 2 vCPU · 4 GB' },
        { at: 3, kind: 'inspect', text: 'Scanning cache implementation', detail: 'rg "get|loader|cache" src test' },
        { at: 9, kind: 'test', text: 'Reproducing the failure', detail: 'Race test failed consistently' },
        { at: 17, kind: 'think', text: 'Comparing synchronization options', detail: 'Selecting per-key promise coalescing' },
        { at: 29, kind: 'edit', text: 'Coalescing concurrent misses', detail: 'src/cache.ts  +16 −4' },
        { at: 41, kind: 'test', text: 'Running cache test suite', detail: '18 passed · 0 failed' },
        { at: 49, kind: 'inspect', text: 'Checking type and lint output', detail: 'tsc clean · eslint clean' },
        { at: 58, kind: 'test', text: 'Running full repository suite', detail: '94 passed · 0 failed' },
        { at: 68, kind: 'finish', text: 'Task completed', detail: 'Minimal patch · no API changes' },
      ],
    },
    {
      id: 'opencode',
      ...HARNESS['opencode'],
      shortName: 'OC',
      command: 'opencode --model merge-gateway/anthropic/claude-sonnet-4-5-20250929',
      version: 'v1.18.25',
      model: 'Claude Sonnet 4.5',
      provider: 'Example provider',
      outcome: 'passed',
      score: 100,
      cost: null,
      duration: 44,
      tokens: null,
      toolCalls: 33,
      tests: '1 / 1',
      events: [
        { at: 0, kind: 'system', text: 'Container attached', detail: 'node 24 · 2 vCPU · 4 GB' },
        { at: 5, kind: 'inspect', text: 'Listing source and test files', detail: '12 files discovered' },
        { at: 14, kind: 'test', text: 'Running all tests', detail: '90 passed · 4 failed' },
        { at: 27, kind: 'inspect', text: 'Reading failure traces', detail: 'Duplicate loader calls detected' },
        { at: 39, kind: 'edit', text: 'Implementing lock map', detail: 'src/cache.ts  +24 −5' },
        { at: 55, kind: 'test', text: 'Running full test suite', detail: '93 passed · 1 failed' },
        { at: 67, kind: 'think', text: 'Investigating rejected loader case', detail: 'Stale lock survives rejection' },
        { at: 81, kind: 'edit', text: 'Cleaning locks in finally block', detail: 'src/cache.ts  +7 −2' },
        { at: 95, kind: 'test', text: 'Verifying final patch', detail: '94 passed · 0 failed' },
        { at: 104, kind: 'finish', text: 'Task completed', detail: 'All deterministic graders passed' },
      ],
    },
    {
      id: 'pi-agent',
      ...HARNESS['pi-agent'],
      shortName: 'PI',
      command: 'pi --model merge-gateway/anthropic/claude-sonnet-4-5-20250929',
      version: 'v0.84.4',
      model: 'Claude Sonnet 4.5',
      provider: 'Example provider',
      outcome: 'passed',
      score: 100,
      cost: null,
      duration: 39,
      tokens: null,
      toolCalls: 14,
      tests: '1 / 1',
      events: [
        { at: 0, kind: 'system', text: 'Environment started', detail: 'node 24 · 2 vCPU · 4 GB' },
        { at: 4, kind: 'inspect', text: 'Opening failing test file', detail: 'test/cache.test.ts' },
        { at: 13, kind: 'inspect', text: 'Reading cache implementation', detail: 'src/cache.ts' },
        { at: 24, kind: 'edit', text: 'Serializing loader calls globally', detail: 'src/cache.ts  +21 −3' },
        { at: 39, kind: 'test', text: 'Running targeted tests', detail: '16 passed · 2 failed' },
        { at: 50, kind: 'think', text: 'Retrying with delayed cleanup', detail: 'Token budget 21% remaining' },
        { at: 62, kind: 'edit', text: 'Adjusting lock cleanup', detail: 'src/cache.ts  +6 −2' },
        { at: 72, kind: 'test', text: 'Final verification', detail: '16 passed · 2 failed' },
        { at: 76, kind: 'finish', text: 'Budget exhausted', detail: 'Timeout behavior still regressed' },
      ],
    },
  ],
}

export const reports = [
  {
    tag: 'Planned analysis',
    date: 'Coming soon',
    title: 'GPT-5.6 is faster in Codex—but OpenCode recovers better',
    summary: 'Across 12 TypeScript maintenance tasks, the harness changed total cost by 31% and altered which failures were recoverable.',
    readTime: 'First benchmark',
  },
  {
    tag: 'Planned analysis',
    date: 'Coming soon',
    title: 'What changed between Codex 0.120 and 0.121?',
    summary: 'The newer release used fewer tool calls and finished faster, with one meaningful regression in long-context navigation.',
    readTime: 'Version study',
  },
  {
    tag: 'Planned analysis',
    date: 'Coming soon',
    title: 'The hidden cost of retry loops in coding agents',
    summary: 'Success rate hides expensive recovery behavior. We inspected 184 failed tests to see which harnesses learn from them.',
    readTime: 'Failure analysis',
  },
]
