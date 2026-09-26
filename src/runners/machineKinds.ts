import type { MachineKind } from './protocol'

export const MACHINE_LABELS: Record<MachineKind, string> = { laptop: 'Laptop', desktop: 'Desktop', 'mac-mini': 'Mac mini', 'mac-studio': 'Mac Studio', server: 'Server', cloud: 'Cloud VM', linux: 'Linux/WSL' }

/** Override, then detection, then a generic server, so the glyph never flickers while a worker reconnects. */
export const machineKindOf = (worker: { icon: MachineKind | null; machine: MachineKind | null }): MachineKind => worker.icon ?? worker.machine ?? 'server'
