import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'

/** Keeps existing account completion preferences; Runner Setup owns the setup flow. */
export function useFirstSmokeGuide() {
  const saved = useQuery(api.onboarding.get), save = useMutation(api.onboarding.save)
  const [forced, setForced] = useState(() => new URLSearchParams(location.search).get('guide') === 'smoke')
  const [closed, setClosed] = useState(false)
  function close(status: 'skipped' | 'completed', step: number) {
    setClosed(true); setForced(false)
    const url = new URL(location.href)
    if (url.searchParams.has('guide')) { url.searchParams.delete('guide'); history.replaceState(null, '', url) }
    // Hiding is a preference; the checklist still works if it can't be saved.
    void save({ step, status }).catch(() => {})
  }
  const visible = !closed && (forced || (saved !== undefined && saved?.status !== 'skipped' && saved?.status !== 'completed'))
  return { visible, close }
}
