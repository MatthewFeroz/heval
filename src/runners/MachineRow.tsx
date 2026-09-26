import { useEffect, useRef, type ReactNode } from 'react'
import { useMutation } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { Ellipsis } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import { MACHINE_KINDS, isMachineKind } from './protocol'
import { MachineIcon } from './MachineIcon'
import { MACHINE_LABELS, machineKindOf } from './machineKinds'

type Worker = FunctionReturnType<typeof api.runners.list>[number]

/**
 * One connected worker: icon, name, and a status line; the switch decides
 * whether it takes new runs, and the menu holds the icon override and
 * disconnect. Modeled on T3 Code's Environments list.
 */
export function MachineRow({ worker, online, options, onDisconnect, onError, children }: {
  worker: Worker; online: boolean; options: number
  onDisconnect: () => void; onError: (error: unknown) => void; children?: ReactNode
}) {
  const setEnabled = useMutation(api.runners.setEnabled), setIcon = useMutation(api.runners.setIcon)
  const menu = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const close = (event: PointerEvent) => { if (menu.current?.open && !menu.current.contains(event.target as Node)) menu.current.open = false }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])
  const status = !worker.enabled ? 'Off' : !online ? 'Offline, waiting to reconnect' : worker.ready ? 'Connected' : `Needs setup: ${worker.health}`
  const subtitle = [status, worker.enabled && online && worker.ready ? worker.health : null, `${options} evaluation ${options === 1 ? 'option' : 'options'}`, worker.activeRun ? 'One active evaluation' : null]
    .filter(Boolean).join(' · ')
  // A connected worker that can't run is the one state that needs the owner's attention.
  const tone = worker.enabled && online && !worker.ready ? 'error' : undefined
  const detected = worker.machine ?? 'server'
  return <li data-enabled={worker.enabled} data-tour="machine-row">
    <MachineIcon kind={machineKindOf(worker)} size={18} className="runner-machine-icon" />
    <div className="runner-machine-text">
      <strong>{worker.name}</strong>
      <span className="runner-machine-status" data-tone={tone} title={subtitle}>{subtitle}</span>
    </div>
    <button type="button" role="switch" className="runner-switch" aria-checked={worker.enabled} aria-label={`Run evaluations on ${worker.name}`}
      title={worker.enabled ? 'On: receives new runs' : 'Off: finishes its current run, receives no new ones'}
      onClick={() => void setEnabled({ id: worker.id, enabled: !worker.enabled }).catch(onError)}><span aria-hidden="true" /></button>
    <details className="runner-menu" ref={menu} onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus() } }}>
      <summary aria-label={`Options for ${worker.name}`}><Ellipsis size={16} aria-hidden="true" /></summary>
      <div className="runner-menu-panel">
        <label>Icon<select value={worker.icon ?? ''} onChange={event => { const icon = event.target.value; void setIcon({ id: worker.id, icon: isMachineKind(icon) ? icon : null }).catch(onError) }}>
          <option value="">{MACHINE_LABELS[detected]} ({worker.machine ? 'detected' : 'default'})</option>
          {MACHINE_KINDS.filter(kind => kind !== detected).map(kind => <option key={kind} value={kind}>{MACHINE_LABELS[kind]}</option>)}
        </select></label>
        <button type="button" className="secondary" onClick={() => { if (menu.current) menu.current.open = false; onDisconnect() }}>Disconnect…</button>
      </div>
    </details>
    {children}
  </li>
}
