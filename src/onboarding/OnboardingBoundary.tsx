import { useMemo, type ReactNode } from 'react'
import { useAppAuth } from '../auth'
import { GuideGate } from './GuideGate'
import { guideStore } from './store'

export default function OnboardingBoundary({ children }: { children: ReactNode }) {
  const auth = useAppAuth()
  const url = import.meta.env.VITE_CONVEX_URL
  const store = useMemo(() => url ? guideStore(url, auth) : null, [url, auth])
  // The local CLI and deployments without account storage remain usable.
  return store ? <GuideGate store={store}>{children}</GuideGate> : children
}
