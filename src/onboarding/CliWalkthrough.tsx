import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Copy, Terminal } from 'lucide-react'
import { useAppAuth } from '../auth'
import { GUIDE_STEPS, type GuideStatus, type GuideStore } from './model'

const cli = 'npx @mattferoz/heval@0.1.0'
const steps = ['Try the demo', 'Check your setup', 'Run an evaluation', 'Keep your results']

function Command({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  async function copy() {
    try { await navigator.clipboard.writeText(command); setCopied(true); setFailed(false) }
    catch { setFailed(true) }
  }
  return <div className="cli-guide-command">
    <div className="cli-guide-command-label"><span>{label}</span><button onClick={() => void copy()} aria-label={`Copy ${label}`}>
      {copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy'}
    </button></div>
    <pre tabIndex={0}><code>{command}</code></pre>
    {failed && <p role="alert">Copy wasn’t available. Select the command above and copy it manually.</p>}
  </div>
}

export function CliWalkthrough({ initialStep, store, onClose }: { initialStep: number; store: GuideStore; onClose: (destination?: string) => void }) {
  const auth = useAppAuth()
  const [step, setStep] = useState(initialStep)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [step])
  async function save(nextStep: number, status: GuideStatus, destination?: string) {
    setBusy(true); setError('')
    try {
      await store.save({ step: nextStep, status })
      if (status === 'started') setStep(nextStep)
      else onClose(destination)
    } catch { setError('Your guide progress couldn’t be saved. Try again, or continue without saving.') }
    finally { setBusy(false) }
  }
  const continueLabel = location.pathname.startsWith('/studio') ? 'Open Studio' : 'Continue to workspace'
  return <div className="cli-guide">
    <header className="cli-guide-header"><a href="/" aria-label="Heval home">heval</a><span>GETTING STARTED</span>
      <button className="cli-guide-text-button" disabled={busy} onClick={() => void save(step, 'skipped')}>Skip for now<ArrowRight size={14} /></button>
    </header>
    <main className="cli-guide-layout">
      <aside className="cli-guide-sidebar">
        <div className="cli-guide-symbol"><Terminal size={24} /></div>
        <p className="cli-guide-eyebrow">YOUR FIRST HEVAL RUN</p>
        <h1>From your terminal<br />to your workspace.</h1>
        <p>A quick tour of running Heval locally and keeping the results that matter.</p>
        <ol aria-label="Getting started steps">{steps.map((title, index) => <li key={title} aria-current={index === step ? 'step' : undefined}>
          <span aria-hidden="true">{index < step ? <Check size={14} /> : index + 1}</span>{title}
        </li>)}</ol>
        <p className="cli-guide-account">Signed in as<br /><strong>{auth.user?.email}</strong></p>
      </aside>
      <section className="cli-guide-card" aria-labelledby="cli-guide-title">
        <p className="cli-guide-eyebrow" aria-live="polite">STEP {step + 1} OF {GUIDE_STEPS}</p>
        <h2 id="cli-guide-title" ref={heading} tabIndex={-1}>{steps[step]}</h2>
        <div className="cli-guide-content" key={step}>
          {step === 0 && <>
            <p>Open your terminal and try Heval with an included example. You’ll get a local browser workspace with six models across 20 tasks.</p>
            <p className="cli-guide-note">You need <a href="https://nodejs.org/en/download" target="_blank" rel="noreferrer">Node.js 22 or newer ↗</a>. No account or model key is needed for the local viewer.</p>
            <Command label="Open the example" command={`${cli} open`} />
            <div className="cli-guide-tip"><Check size={16} /><p>This opens recorded results. It doesn’t run an evaluation or use model credits.</p></div>
            <p>Keep the terminal running while you explore. If a browser doesn’t open, use the local URL printed in the terminal. Press <kbd>Ctrl</kbd> + <kbd>C</kbd> when you’re done.</p>
            <details><summary>Prefer to install the CLI?</summary><Command label="Install Heval" command="npm install -g @mattferoz/heval@0.1.0" /><p>Then use <code>heval open</code> or <code>heval doctor</code> directly.</p></details>
          </>}
          {step === 1 && <>
            <p>Ready to run your own evaluations? Check the tools on the machine where they’ll run.</p>
            <Command label="Check prerequisites" command={`${cli} doctor`} />
            <p>Doctor checks Node, Harbor, Docker, and known credential variable names. It doesn’t install anything or call a model. Missing evaluation tools won’t stop the local viewer.</p>
            <ul className="cli-guide-checklist"><li><strong>Node.js 22+</strong><span>Runs the Heval CLI.</span></li><li><strong>Harbor 0.22.0</strong><span>Runs the evaluation tasks.</span></li><li><strong>Docker running</strong><span>Provides the task environments.</span></li></ul>
            <details><summary>Install the evaluation tools</summary>
              <p>Install <a href="https://docs.astral.sh/uv/getting-started/installation/" target="_blank" rel="noreferrer">uv ↗</a> and <a href="https://docs.docker.com/get-started/get-docker/" target="_blank" rel="noreferrer">Docker ↗</a>, then install the supported Harbor version:</p>
              <Command label="Install Harbor" command="uv tool install harbor==0.22.0" />
              <p>Start Docker and run doctor again. On Windows, use a Linux environment such as WSL2 for evaluations.</p>
            </details>
          </>}
          {step === 2 && <>
            <p>Heval opens and compares results. Harbor runs the tasks using the agent, model, and environment in your job configuration.</p>
            <p>Start with a small job. Use your own Harbor config below; replace <code>./your-job.yaml</code> and <code>./jobs/YOUR_JOB</code> with your actual paths.</p>
            <Command label="Review the job configuration" command="harbor run -c ./your-job.yaml --print-config" />
            <Command label="Run the evaluation" command="harbor run -c ./your-job.yaml" />
            <p className="cli-guide-note">Configure the provider credentials required by your job on your machine. Model-backed runs use your provider credits; nothing runs from this guide.</p>
            <Command label="Open the completed results" command={`${cli} open ./jobs/YOUR_JOB`} />
            <a className="cli-guide-resource" href="https://www.harborframework.com/docs" target="_blank" rel="noreferrer">Create a job configuration with Harbor ↗</a>
          </>}
          {step === 3 && <>
            <p>Your local viewer and your online account have different ways to keep results.</p>
            <div className="cli-guide-destination"><span>ON YOUR MACHINE</span><h3>Download a workspace.</h3><p>In the local viewer, choose <strong>Bundle</strong> to keep the workspace and its data together. Use <strong>SVG</strong> or <strong>PNG</strong> for charts. Local results aren’t automatically uploaded.</p></div>
            <div className="cli-guide-destination"><span>IN YOUR ACCOUNT</span><h3>Save a private report.</h3><p>In <strong>Your reports</strong>, import a normalized Heval JSON export, review it, then choose <strong>Save private report</strong>. Open it in Studio and use <strong>Save draft</strong> for chart edits. Saved reports follow your account across devices.</p><p>Raw Harbor folders and workspace Bundles can be opened locally; the online importer needs a normalized export.</p></div>
            <details><summary>How do I create a normalized export?</summary><p>With repository access and Bun installed, run this from a Heval checkout:</p>
              <Command label="Normalize a Harbor job" command="bun run report /path/to/harbor-job" /><p>Import the generated <code>results/harbor/&lt;job&gt;.json</code> in Your reports. The published CLI currently views results; it doesn’t upload or normalize them for cloud storage.</p>
            </details>
            <details><summary>Can a connected machine save results automatically?</summary><p>The connected-runner preview can run approved jobs and save their results to your account. It currently requires a Linux machine and a source build; these commands aren’t in the published npm CLI.</p><a className="cli-guide-resource" href="https://github.com/MatthewFeroz/heval/blob/main/docs/connected-runners.md" target="_blank" rel="noreferrer">Runner setup guide (repository access required) ↗</a></details>
            <p>You can reopen this walkthrough from <strong>CLI guide</strong> in Studio.</p>
          </>}
        </div>
        {error && <div className="cli-guide-error" role="alert"><p>{error}</p><button className="cli-guide-text-button" onClick={() => onClose()}>Continue without saving progress</button></div>}
        <footer className="cli-guide-footer">
          <button className="cli-guide-back" disabled={busy || step === 0} onClick={() => { setStep(value => value - 1); setError('') }}><ArrowLeft size={15} />Back</button>
          <div>{step === GUIDE_STEPS - 1 && <button className="cli-guide-secondary" disabled={busy} onClick={() => void save(step, 'completed', '/reports')}>Import &amp; save a report</button>}
            <button className="cli-guide-primary" disabled={busy} onClick={() => void save(Math.min(step + 1, GUIDE_STEPS - 1), step === GUIDE_STEPS - 1 ? 'completed' : 'started')}>
              {busy ? 'Saving…' : step === GUIDE_STEPS - 1 ? continueLabel : 'Next'}<ArrowRight size={15} />
            </button></div>
        </footer>
      </section>
    </main>
    <p className="cli-guide-caption">Your place is saved to your account. Continue whenever you’re ready.</p>
  </div>
}
