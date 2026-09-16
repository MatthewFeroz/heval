export const GUIDE_STEPS = 4
export type GuideStatus = 'started' | 'completed' | 'skipped'
export type GuideProgress = { step: number; status: GuideStatus }
export type GuideStore = {
  load: () => Promise<GuideProgress | null>
  save: (progress: GuideProgress) => Promise<GuideProgress>
}

export function guideHref(href: string) {
  const url = new URL(href)
  url.searchParams.set('guide', 'cli')
  return url.href
}
