/**
 * The workspace tour, in the order a new account needs it: a worker first,
 * then an evaluation. Targets are `data-tour` markers on the real pages.
 * `optional` steps are skipped when absent; the others explain in place
 * (centered) what appears once a worker is connected.
 */
export type TourStep = { page: '/machines' | '/evaluations'; target: string; title: string; body: string; optional?: boolean }

export const TOUR_ID = 'first-run'

export const FIRST_RUN_TOUR: TourStep[] = [
  { page: '/machines', target: 'machines', title: 'Your computers', body: 'Connect a computer here. Setup walks you through installation, account connection, a model provider, and your first evaluation.' },
  { page: '/evaluations', target: 'benchmark', title: 'Configure an evaluation', body: 'Choose an installed benchmark, then the harnesses and models you want to compare.' },
  { page: '/evaluations', target: 'summary', title: 'Review and run', body: 'Review the combinations and trial count, name your evaluation, and start it. Model tasks use your provider credits.' },
  { page: '/evaluations', target: 'experiments', title: 'Your results', body: 'Return here for live progress and saved results. Open a report to inspect trials or edit its charts in Studio.' },
]
