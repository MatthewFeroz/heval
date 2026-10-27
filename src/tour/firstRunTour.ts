/**
 * The workspace tour, in the order a new account needs it: a worker first,
 * then an evaluation. Targets are `data-tour` markers on the real pages.
 * `optional` steps are skipped when absent; the others explain in place
 * (centered) what appears once a worker is connected.
 */
export type TourStep = { page: '/settings' | '/library'; search?: string; target: string; title: string; body: string; optional?: boolean }

export const TOUR_ID = 'first-run'

export const FIRST_RUN_TOUR: TourStep[] = [
  { page: '/settings', target: 'setup', title: 'Execution settings', body: 'Connect a Linux worker and model provider here when you want to use your own computer. Managed cloud comparisons do not require connecting a worker.' },
  { page: '/library', search: 'new=1', target: 'comparison-question', title: 'Choose a comparison', body: 'Compare harnesses, compare models or configure a custom matrix. Choose managed cloud or a connected worker.' },
  { page: '/library', search: 'new=1', target: 'comparison-review', title: 'Review and run', body: 'Review the exact combinations, routes and trial count before authorizing compute and model use.', optional: true },
  { page: '/library', target: 'experiments', title: 'Your Library', body: 'Return here for running comparisons, imported results and baselines. Each result opens Results, Analyze, Export and Share in one workspace.' },
]
