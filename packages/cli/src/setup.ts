import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, lstatSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { startProviderSetup } from './provider-setup'
import { detectMachineKind } from './runner/machine'
import harnessCatalog from '../../../src/harness-catalog.json'
import { selectMergeHarnesses } from './merge'

export type Docker = { command: string; prefix: string[]; description: string }
type Options = { plan?: boolean; json?: boolean; yes?: boolean; noBrowser?: boolean; name?: string; distro?: string; harnesses?: string[] }
const label = 'dev.heval.setup'
export function workerName(name = 'heval-worker') {
  if (!/^heval-[a-z0-9][a-z0-9-]{0,40}$/.test(name)) throw new Error('Use --name heval- followed by up to 41 lowercase letters, numbers or hyphens.')
  return name
}

export function displayCommand(args: string[], windows = process.platform === 'win32') {
  const quote = (arg: string) => windows ? `'${arg.replaceAll("'", "''")}'` : `'${arg.replaceAll("'", "'\\''")}'`
  return `${windows ? '& ' : ''}${args.map(quote).join(' ')}`
}

/** Arguments are never evaluated by a shell. RPC secrets travel only on stdin. */
export function execute(command: string, args: string[], input?: string | Buffer, inherit = false, timeout = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: [input === undefined && inherit ? 'inherit' : 'pipe', inherit ? 'inherit' : 'pipe', inherit ? 'inherit' : 'pipe'] })
    const chunks: Buffer[] = []; let length = 0; let settled = false
    const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(Buffer.concat(chunks).toString('utf8').trim()) }
    const timer = setTimeout(() => { child.kill(); finish(new Error(`${command} timed out. Check Docker, then rerun setup.`)) }, timeout)
    child.stdout?.on('data', chunk => { length += chunk.length; if (length > 8_000_000) { child.kill(); finish(new Error('Command output exceeded its limit.')) } else chunks.push(chunk) })
    child.stderr?.resume() // Never attach credential-bearing subprocess output to errors.
    child.on('error', () => finish(new Error(`Could not start ${command}.`)))
    child.on('close', code => finish(code === 0 ? undefined : new Error(`${command} exited with status ${code}. Check Docker, then rerun setup.`)))
    child.stdin?.on('error', () => { /* Exit handling reports a closed input pipe. */ })
    child.stdin?.end(input)
  })
}
const dockerRun = (docker: Docker, args: string[], input?: string | Buffer, inherit = false, timeout?: number) => execute(docker.command, [...docker.prefix, ...args], input, inherit, timeout)

export async function findDocker(distro?: string): Promise<Docker | undefined> {
  const candidates: Docker[] = []
  const rejected: string[] = []
  if (distro && process.platform !== 'win32') throw new Error('--distro applies only to Windows WSL.')
  if (!distro) candidates.push({ command: 'docker', prefix: [], description: 'Local Docker engine' })
  if (process.platform === 'win32') {
    let distributions = distro ? [distro] : []
    if (!distro) try { distributions = (await execute('wsl.exe', ['--list', '--quiet'])).replace(/\0/g, '').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('docker-desktop')) } catch { /* WSL is optional with Docker Desktop. */ }
    for (const name of distributions) candidates.push({ command: 'wsl.exe', prefix: ['--distribution', name, '--exec', 'docker', '--host', 'unix:///var/run/docker.sock'], description: `WSL: ${name}` })
  }
  for (const candidate of candidates) {
    try {
      if (candidate.command === 'docker' && process.env.DOCKER_HOST && !/^(unix:\/\/|npipe:\/\/)/.test(process.env.DOCKER_HOST)) { rejected.push('Select a local Docker context; remote Docker hosts are not supported.'); continue }
      const contexts = JSON.parse(await dockerRun(candidate, ['context', 'inspect'])) as { Endpoints: { docker: { Host: string } } }[]
      if (!/^(unix:\/\/|npipe:\/\/)/.test(contexts[0]?.Endpoints?.docker?.Host ?? '')) { rejected.push('Select a local Docker context; remote Docker contexts are not supported.'); continue }
      const info = JSON.parse(await dockerRun(candidate, ['info', '--format', '{{json .}}']))
      if (info.OSType !== 'linux' || info.DockerRootDir !== '/var/lib/docker' || !['x86_64', 'aarch64', 'arm64'].includes(info.Architecture)) { rejected.push('Use a Linux x64/ARM64 Docker engine with its standard /var/lib/docker data root. Rootless engines and Windows containers are not supported.'); continue }
      if (info.MemTotal < 4 * 1024 ** 3) { rejected.push('Allocate at least 4 GiB to Docker before setting up evaluations.'); continue }
      return candidate
    } catch { /* Try another local engine; never silently select a remote daemon. */ }
  }
  if (rejected.length) throw new Error([...new Set(rejected)].join('\n'))
}

export function prerequisiteHelp(platform = process.platform) {
  if (platform === 'win32') return 'Start Docker Desktop with Linux containers, or start Docker inside a WSL2 distribution. If Docker is not installed, setup can launch winget. Windows may request administrator approval, WSL installation, a restart, and acceptance of Docker Desktop terms. After those steps, rerun this same setup command.'
  if (platform === 'darwin') return 'Start Docker Desktop. If it is not installed, setup can install it with Homebrew. Complete its first-run permissions, then rerun this same setup command.'
  return 'Start a local Docker Engine with access for your user. On Ubuntu 24.04, setup can install docker.io and docker-compose-v2 with sudo. Log out and back in after joining the docker group, then rerun this command. Other distributions: https://docs.docker.com/engine/install/'
}

async function confirm(message: string, yes?: boolean) {
  if (yes) return
  if (!process.stdin.isTTY) throw new Error('Setup needs confirmation. Inspect setup --plan --json, then use setup --yes to accept installation and Docker access. Login and secrets still belong in the local browser.')
  const input = createInterface({ input: process.stdin, output: process.stdout })
  try { if (!/^y(es)?$/i.test((await input.question(`${message} [y/N] `)).trim())) throw new Error('Setup cancelled. No credentials were changed.') } finally { input.close() }
}

async function installDocker(yes?: boolean) {
  await confirm('Install Docker using the platform package manager? This may request administrator approval.', yes)
  if (process.platform === 'win32') await execute('winget.exe', ['install', '--exact', '--id', 'Docker.DockerDesktop', '--source', 'winget'], undefined, true, 20 * 60_000)
  else if (process.platform === 'darwin') await execute('brew', ['install', '--cask', 'docker'], undefined, true, 20 * 60_000)
  else {
    const os = readFileSync('/etc/os-release', 'utf8')
    if (!/^ID=ubuntu$/m.test(os) || !/^VERSION_ID="24\.04"$/m.test(os)) throw new Error(prerequisiteHelp())
    await execute('sudo', ['apt-get', 'update'], undefined, true, 10 * 60_000)
    await execute('sudo', ['apt-get', 'install', '-y', 'docker.io', 'docker-compose-v2'], undefined, true, 15 * 60_000)
    await execute('sudo', ['systemctl', 'enable', '--now', 'docker'], undefined, true)
    const user = await execute('id', ['-un'])
    await execute('sudo', ['usermod', '-aG', 'docker', user], undefined, true)
  }
  throw new Error(prerequisiteHelp())
}

/** Small dependency-free ustar writer. Only this package's allowlisted build files enter Docker. */
export function buildContext(packageRoot: string): Buffer {
  const entries: [string, Buffer][] = [['Dockerfile', readFileSync(join(packageRoot, 'dist/worker/Dockerfile'))], ['package.json', readFileSync(join(packageRoot, 'package.json'))]]
  function walk(relative: string) {
    for (const entry of readdirSync(join(packageRoot, relative)).sort()) {
      const path = `${relative}/${entry}`, stat = lstatSync(join(packageRoot, path))
      if (stat.isDirectory()) walk(path)
      else if (stat.isFile()) entries.push([path, readFileSync(join(packageRoot, path))])
      else throw new Error('The installed package contains a non-regular build file.')
    }
  }
  walk('dist')
  const blocks: Buffer[] = []
  for (const [path, content] of entries) {
    const header = Buffer.alloc(512)
    const split = path.length > 100 ? path.lastIndexOf('/') : -1
    const name = split < 0 ? path : path.slice(split + 1), prefix = split < 0 ? '' : path.slice(0, split)
    if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) throw new Error('Package filename is too long for the build context.')
    header.write(name); header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116)
    header.write(content.length.toString(8).padStart(11, '0') + '\0', 124); header.write('00000000000\0', 136)
    header.fill(32, 148, 156); header.write('0', 156); header.write('ustar\0', 257); header.write('00', 263); header.write(prefix, 345)
    header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148)
    blocks.push(header, content, Buffer.alloc((512 - content.length % 512) % 512))
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)])
}

async function inspect(docker: Docker, type: string, name: string) {
  // A list distinguishes absence from a daemon/permission failure. Never create
  // replacement state merely because an inspection request failed.
  const names = (await dockerRun(docker, type === 'container' ? ['ps', '-a', '--format', '{{.Names}}'] : ['volume', 'ls', '--format', '{{.Name}}'])).split('\n')
  if (!names.includes(name)) return undefined
  return JSON.parse(await dockerRun(docker, [type, 'inspect', name]))[0]
}

export async function setup(packageRoot: string, options: Options, openBrowser: (url: string) => void) {
  const selected = selectMergeHarnesses(options.harnesses ?? ['codex'])
  const name = workerName(options.name), volume = `${name}-data`
  const docker = await findDocker(options.distro)
  const plan = { schemaVersion: 1, platform: process.platform, engine: docker?.description ?? null, name, volume, needsDocker: !docker, steps: ['Install the bundled Linux worker (Node, Harbor 0.23.0, Docker CLI and Compose)', 'Keep credentials and jobs in a persistent Docker volume', 'Pair your Heval account in the local browser', 'Verify a Merge key locally and prepare model profiles', 'Keep the worker running with Docker restart policy unless-stopped'], requirements: ['Node.js 22+', 'Local Linux Docker engine (4 GiB minimum; 8 GiB and 15 GiB free disk recommended)', 'Docker socket access lets the worker create sibling task containers'], recovery: 'Rerun the same command. Existing pairing, keys, profiles and jobs are preserved.', ...(docker ? {} : { next: prerequisiteHelp() }) }
  const selection = { ...plan, harnesses: harnessCatalog, selectedHarnesses: selected, harnessInstallation: 'Harbor installs selected harnesses inside task containers when evaluations start. Setup only prepares profiles and makes no model calls.' }
  if (options.plan) { console.log(options.json ? JSON.stringify(selection, null, 2) : `${JSON.stringify(selection, null, 2)}\nNo changes made.`); return }
  if (!docker) { console.log(prerequisiteHelp()); await installDocker(options.yes); return }
  await confirm(`Set up ${name} using ${docker.description}? Downloads several GB, stores data in ${volume}, and grants the worker Docker socket access. No paid model calls.`, options.yes)
  const context = buildContext(packageRoot), digest = createHash('sha256').update(context).digest('hex'), image = `heval-worker:${digest.slice(0, 24)}`
  let container = await inspect(docker, 'container', name)
  if (container && (container.Config?.Labels?.[label] !== '1' || container.Config?.Labels?.['dev.heval.artifact'] !== digest)) throw new Error(`${name} belongs to another installation or artifact. Finish its evaluations, stop and remove that container (keep ${volume}), then rerun setup; or use --name heval-another. Setup never interrupts a worker to upgrade it.`)
  const existingVolume = await inspect(docker, 'volume', volume)
  if (existingVolume && existingVolume.Labels?.[label] !== '1') throw new Error(`${volume} is not a managed Heval volume. Choose another --name.`)
  if (!container) {
    console.log('Preparing the bundled Linux runtime. Docker caches completed layers for retries.')
    await dockerRun(docker, ['build', '--label', `${label}=1`, '--tag', image, '-'], context, true, 30 * 60_000)
    if (!existingVolume) await dockerRun(docker, ['volume', 'create', '--label', `${label}=1`, volume])
    const stored = await inspect(docker, 'volume', volume)
    const root = stored?.Mountpoint as string
    if (root !== `/var/lib/docker/volumes/${volume}/_data`) throw new Error('Unsupported Docker volume layout. Use a standard local Docker engine.')
    const mount = `type=volume,source=${volume},target=${root},volume-nocopy`
    const socket = 'type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock'
    // Ownership is established only on the volume root; never recursively
    // chown existing user jobs or follow user-controlled paths.
    const group = await dockerRun(docker, ['run', '--rm', '--user', '0:0', '--mount', mount, '--mount', socket, '--entrypoint', 'python', image, '-c', 'import os,sys; p=sys.argv[1]; os.chown(p,1000,1000); os.chmod(p,0o700); print(os.stat("/var/run/docker.sock").st_gid)', root])
    if (!/^\d+$/.test(group)) throw new Error('Could not determine Docker socket permissions.')
    await dockerRun(docker, ['create', '--name', name, '--label', `${label}=1`, '--label', `dev.heval.artifact=${digest}`, '--restart', 'unless-stopped', '--init', '--group-add', group, '--mount', mount, '--mount', socket, '--env', `HEVAL_WORKER_STATE=${root}/runner`, '--workdir', root, image])
    container = await inspect(docker, 'container', name)
  }
  if (!container.State.Running) await dockerRun(docker, ['start', name])
  if (docker.command === 'wsl.exe') {
    if (!process.env.LOCALAPPDATA) throw new Error('LOCALAPPDATA is required to keep the WSL worker running.')
    const folder = join(process.env.LOCALAPPDATA, 'Heval', 'workers', name)
    mkdirSync(folder, { recursive: true })
    copyFileSync(join(packageRoot, 'dist/worker/wsl-keepalive.ps1'), join(folder, 'wsl-keepalive.ps1'))
    writeFileSync(join(folder, 'wsl.json'), JSON.stringify({ name, distro: docker.prefix[1] }))
    await execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(folder, 'wsl-keepalive.ps1'), '-Install'])
    console.log(`WSL stays awake while signed in. Login shortcut: ${name}. Disable it in Windows Startup Apps when no longer needed.`)
  }
  const rpc = async (action: string, body: Record<string, unknown> = {}) => JSON.parse(await dockerRun(docker, ['exec', '-i', name, 'node', '/opt/heval/dist/setup-worker.js', 'rpc'], JSON.stringify({ ...body, action }), false, 90_000))
  const health = await rpc('status')
  if (!health.worker.ready) throw new Error(`Worker is not ready: ${health.worker.health}. Inspect Docker logs for ${name}.`)
  const kind = await detectMachineKind()
  if (kind) await rpc('machine', { kind }).catch(() => { /* The icon falls back to a generic server. */ })
  const { server, url } = await startProviderSetup('', join(packageRoot, 'dist/runner-task'), 0, undefined, {
    status: () => rpc('status'), connect: key => rpc('connect', { key }), profiles: (model, harnesses) => rpc('profiles', { model, harnesses }), pair: (url, code) => rpc('pair', { url, code }),
  }, selected)
  console.log(`Worker ready: ${name} (${docker.description}).\nComplete account and provider setup:\n${url}\nThe setup page expires after 15 minutes without an open setup page. Rerun setup to reopen it.\nThe worker continues after this terminal closes while Docker is running.\nIn Heval, run “Check this machine” to save a no-model evaluation to your account.\nStop: ${displayCommand([docker.command, ...docker.prefix, 'stop', name])}\nData remains in Docker volume ${volume}.`)
  if (!options.noBrowser) openBrowser(url)
  const close = () => { server.closeAllConnections(); server.close() }
  process.once('SIGINT', close); process.once('SIGTERM', close)
  server.once('close', () => { process.removeListener('SIGINT', close); process.removeListener('SIGTERM', close) })
}
