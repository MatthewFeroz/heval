/**
 * Benchmarks Heval knows how to install on a worker. The worker still approves and runs them;
 * the browser matches a worker's advertised task set to an entry by content hash (`taskSet`).
 */
export type Benchmark = {
  id: string; title: string; publisher: string; summary: string; tasks: number
  /** `available`: installable and tested with Heval. `preview`: installable, not yet validated on Heval workers. `unsupported`: listed for reference only. */
  status: 'available' | 'preview' | 'unsupported'
  note: string
  source?: { url: string; commit: string; license: string }
  /** Task directory names in run order, each with its expected content hash. Absent for listing-only entries. */
  taskHashes?: [string, string][]
  /** sha256 of the JSON array of task hashes, matching RunnerProfile.taskSet. */
  taskSet?: string
  timeoutSeconds?: number
  install?: string[]
}

const TBLITE = 'https://github.com/open-thoughts/OpenThoughts-TBLite'
const TBLITE_COMMIT = '5c37b41f00ce04719a4453061076ae9f46b74b7d'

export const BENCHMARKS: Benchmark[] = [
  {
    id: 'heval-smoke', title: 'Heval connection smoke', publisher: 'Heval', tasks: 1, status: 'available',
    summary: 'One bundled file-writing task. Confirms each harness reaches its model through Merge Gateway.',
    note: 'Checks the connection. It isn’t a capability score.',
    taskHashes: [['heval-setup', 'c7747e4e3c38e5bc8c5b0e3b785dbe9d339044d7c9fa3cfe09ebbb3e709f6c57']],
    taskSet: 'b7e45df73db73ded1a5c82a50909b01d5744474131f556ccce4e9d5b8e4f48a0',
    install: ['heval provider connect merge', 'heval provider status merge', 'heval runner setup --model MODEL_ID --harnesses codex,claude-code,pi'],
  },
  {
    id: 'tblite-smoke', title: 'OpenThoughts-TBLite smoke', publisher: 'OpenThoughts', tasks: 5, status: 'preview',
    summary: 'Five easy TBLite tasks across data processing, data science, debugging, system administration and security.',
    note: 'A quick smoke run on real Terminal-Bench-style tasks. Not a TBLite score, and not yet validated on Heval workers.',
    source: { url: TBLITE, commit: TBLITE_COMMIT, license: 'Apache-2.0' },
    taskHashes: [
      ['jq-data-processing', '4f899ad98d251b519aa73915c7d9f27787eb5ed1c8c93726660f771b4a94ac6b'],
      ['pandas-etl', 'd3e66cc8bd86f1f96608e3eea0565730ce639edfb9428e4ff5d69cceabb7b8eb'],
      ['broken-python', 'deb43f744f1b902d19f7e06edeb3b730dcf22936ce0e387c7d661c97dd4f61fa'],
      ['log-summary', 'fd5ef072b7c97fbb8314f6232ced9db37c267ee123b3e6f2495d31e3ce14338e'],
      ['cryptographic-protocol-verifier', '3e92cf149a57f408689b5ff6e06f5e6533654c9256be0a4070e95072a09d1e35'],
    ],
    taskSet: '2683c14c21a9f9b797e0a576efd7993c5d5d15f54660a761c860c750a30bc762',
    timeoutSeconds: 7200,
    install: [
      'heval provider connect merge',
      `git clone ${TBLITE} ~/.heval/benchmarks/openthoughts-tblite`,
      `git -C ~/.heval/benchmarks/openthoughts-tblite checkout ${TBLITE_COMMIT}`,
      'heval runner setup --benchmark tblite-smoke --source ~/.heval/benchmarks/openthoughts-tblite --model MODEL_ID --harnesses codex,claude-code,pi',
    ],
  },
  {
    id: 'tblite', title: 'OpenThoughts-TBLite', publisher: 'OpenThoughts', tasks: 100, status: 'unsupported',
    summary: '100 Terminal-Bench tasks with difficulty calibrated against Claude Haiku 4.5. Tracks Terminal-Bench 2.0 rankings and runs faster.',
    note: 'The full set exceeds this release’s 20-task, 60-trial limit per evaluation.',
    source: { url: TBLITE, commit: TBLITE_COMMIT, license: 'Apache-2.0' },
  },
]

export const benchmarkFor = (taskSet: string | undefined) => BENCHMARKS.find(b => b.taskSet && b.taskSet === taskSet)
