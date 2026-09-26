/** Steps in the first-evaluation setup flow (see firstSmoke.ts); account storage validates against it. */
export const GUIDE_STEPS = 4
export type GuideStatus = 'started' | 'completed' | 'skipped'
export type GuideProgress = { step: number; status: GuideStatus }
