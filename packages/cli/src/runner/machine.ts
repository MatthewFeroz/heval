import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { isMachineKind, type MachineKind } from '../../../../src/runners/protocol'

/**
 * Best-effort host detection for a worker's icon; any probe may fail and null
 * means "no signal". A containerized worker cannot see its host (Docker
 * Desktop reads as a VM), so `heval setup` detects on the host and stores the
 * result in the worker state as machine.json; the daemon prefers that file.
 * Adapted from T3 Code's environment icon detection.
 */
const exec = promisify(execFile)

// SMBIOS System Enclosure types; shared by Linux DMI and Windows Win32_SystemEnclosure.
const CHASSIS: Record<string, MachineKind> = {
  3: 'desktop', 4: 'desktop', 5: 'desktop', 6: 'desktop', 7: 'desktop', 13: 'desktop', 15: 'desktop', 16: 'desktop', 35: 'desktop',
  8: 'laptop', 9: 'laptop', 10: 'laptop', 14: 'laptop', 31: 'laptop', 32: 'laptop',
  17: 'server', 18: 'server', 19: 'server', 20: 'server', 21: 'server', 22: 'server', 23: 'server', 24: 'server', 28: 'server',
}
// Hypervisors and clouds name themselves in the vendor/product strings; a VM reads as cloud whatever chassis it fakes.
const VIRTUAL = ['qemu', 'kvm', 'bochs', 'vmware', 'virtualbox', 'innotek', 'xen', 'parallels', 'amazon ec2', 'google compute engine', 'digitalocean', 'hetzner', 'linode', 'vultr', 'scaleway', 'openstack', 'cloud', 'virtual machine']

export function kindFromAppleModel(name: string): MachineKind | null {
  const model = name.toLowerCase().replace(/\s+/g, '')
  if (model.startsWith('macmini')) return 'mac-mini'
  if (model.startsWith('macstudio')) return 'mac-studio'
  if (model.startsWith('macbook')) return 'laptop'
  if (model.startsWith('imac') || model.startsWith('macpro')) return 'desktop'
  return null
}

export function kindFromHardware({ chassis, vendor, product }: { chassis?: string | null; vendor?: string | null; product?: string | null }): MachineKind | null {
  if (VIRTUAL.some(marker => `${vendor ?? ''} ${product ?? ''}`.toLowerCase().includes(marker))) return 'cloud'
  return kindFromAppleModel(product ?? '') ?? (chassis ? CHASSIS[chassis.trim()] ?? null : null)
}

const read = (path: string) => { try { return readFileSync(path, 'utf8').trim() || null } catch { return null } }
async function probe(command: string, args: string[]) {
  try { return (await exec(command, args, { timeout: 5_000, windowsHide: true })).stdout.trim() || null } catch { return null }
}

export async function detectMachineKind(platform = process.platform): Promise<MachineKind | null> {
  if (platform === 'darwin') {
    const product = (await probe('ioreg', ['-rd1', '-n', 'product']))?.match(/"product-name"\s*=\s*<"([^"]+)">/)?.[1]
    return (product && kindFromAppleModel(product)) || kindFromAppleModel(await probe('sysctl', ['-n', 'hw.model']) ?? '')
  }
  if (platform === 'linux') {
    // WSL reports Microsoft in its kernel release; check before DMI, which shows a Hyper-V VM.
    if (read('/proc/sys/kernel/osrelease')?.toLowerCase().includes('microsoft')) return 'linux'
    const dmi = '/sys/class/dmi/id'
    return kindFromHardware({ chassis: read(`${dmi}/chassis_type`), vendor: read(`${dmi}/sys_vendor`), product: read(`${dmi}/product_name`) })
  }
  if (platform === 'win32') {
    const out = await probe('powershell.exe', ['-NoProfile', '-Command', '$c=Get-CimInstance Win32_ComputerSystem; $e=Get-CimInstance Win32_SystemEnclosure; "$($e.ChassisTypes[0])|$($c.Manufacturer)|$($c.Model)"'])
    const [chassis, vendor, product] = out?.split('|') ?? []
    return out ? kindFromHardware({ chassis, vendor, product }) : null
  }
  return null
}

/** Precedence: an explicit HEVAL_MACHINE_KIND (manual Docker recipes), setup's host-reported kind, then native self-detection. */
export async function workerMachineKind(directory: string): Promise<MachineKind | undefined> {
  if (isMachineKind(process.env.HEVAL_MACHINE_KIND)) return process.env.HEVAL_MACHINE_KIND
  const file = join(directory, 'machine.json')
  if (existsSync(file)) {
    try { const kind = JSON.parse(readFileSync(file, 'utf8')).kind; if (isMachineKind(kind)) return kind } catch { /* Fall through to detection. */ }
  }
  // Inside any container (managed or a manual Docker recipe), detection would describe Docker's VM.
  if (process.env.HEVAL_WORKER_STATE || existsSync('/.dockerenv') || existsSync('/run/.containerenv')) return undefined
  return await detectMachineKind() ?? undefined
}
