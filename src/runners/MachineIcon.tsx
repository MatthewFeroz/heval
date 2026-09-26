import { Cloud, Laptop, Monitor, Server, SquareTerminal, type LucideProps } from 'lucide-react'
import type { FunctionComponent, SVGProps } from 'react'
import type { MachineKind } from './protocol'

// Lucide has no Apple desktops; these follow its 24-unit grid and 2-unit stroke (after T3 Code).
function Outline(props: SVGProps<SVGSVGElement> & { size?: number | string }) {
  const { size = 24, ...rest } = props
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...rest} />
}
const MacMini = (props: LucideProps) => <Outline {...props}><rect width="20" height="8" x="2" y="8" rx="2" /><path d="M6 12h.01" /></Outline>
const MacStudio = (props: LucideProps) => <Outline {...props}><rect width="18" height="14" x="3" y="5" rx="2" /><path d="M7 15h.01M11 15h.01M15 15h.01" /></Outline>

const ICONS: Record<MachineKind, FunctionComponent<LucideProps>> = { laptop: Laptop, desktop: Monitor, 'mac-mini': MacMini, 'mac-studio': MacStudio, server: Server, cloud: Cloud, linux: SquareTerminal }


export function MachineIcon({ kind, ...props }: LucideProps & { kind: MachineKind }) {
  const Icon = ICONS[kind]
  return <Icon aria-hidden="true" {...props} />
}
