import { lazy, Suspense, useState } from 'react'
import { ArrowLeft, LockKeyhole, LogIn } from 'lucide-react'
import { useAppAuth } from '../auth'
import { SiteHeader } from '../components/SiteHeader'
import './studio-access.css'

const StudioWorkspace = lazy(() => import('./StudioWorkspace'))

export function StudioRoute() {
  const auth = useAppAuth()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  if (!auth.isLoading && auth.configured && auth.user) {
    return <Suspense fallback={<main className="studio-access" role="status">Opening Studio…</main>}>
      <StudioWorkspace key={auth.user.email} />
    </Suspense>
  }

  async function signIn() {
    setError('')
    setPending(true)
    try { await auth.signIn() }
    catch { setError('Couldn’t open sign-in. Please try again.') }
    finally { setPending(false) }
  }

  return (
    <div className="studio-access-page">
      <SiteHeader auth={auth} active="studio" />
      <main className="studio-access">
        <section className="studio-access-card" aria-labelledby="studio-access-title">
          <span className="studio-access-icon" aria-hidden="true"><LockKeyhole size={24} /></span>
          <p className="studio-access-kicker">YOUR WORKSPACE</p>
          <h1 id="studio-access-title">{auth.isLoading ? 'Checking your session…' : 'Sign in to Studio'}</h1>
          {auth.isLoading
            ? <p role="status">Confirming your sign-in before opening the editor.</p>
            : <>
              <p>Open your evaluations, build charts, and work on your reports.</p>
              {auth.configured
                ? <button className="studio-access-signin" onClick={() => void signIn()} disabled={pending}>
                  <LogIn size={17} />{pending ? 'Opening sign-in…' : 'Sign in to Studio'}
                </button>
                : <p role="status">Sign-in isn’t available on this deployment yet. Please try again later.</p>}
              {error && <p className="studio-access-error" role="alert">{error}</p>}
            </>}
          <a className="studio-access-back" href="/"><ArrowLeft size={15} />Back to Heval</a>
        </section>
      </main>
    </div>
  )
}
