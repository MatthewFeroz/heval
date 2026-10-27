/** Real Linux/Docker/Harbor Oracle check. No cloud account, key or model calls. */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

const image = process.env.HEVAL_MANAGED_TEST_IMAGE ?? 'heval-managed-worker:local'
const name = `heval-managed-smoke-${randomBytes(6).toString('hex')}`
async function docker(args: string[], input?: string, timeoutMs = 60_000) {
  const child = Bun.spawn(['docker', ...args], { stdin: input === undefined ? 'ignore' : new TextEncoder().encode(input), stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => child.kill(), timeoutMs)
  try {
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    if (code !== 0) throw new Error(`Managed worker smoke command failed: ${(err || out).slice(-2000)}`)
    return out.trim()
  } finally { clearTimeout(timer) }
}
const [resources, architecture] = await Promise.all([docker(['info', '--format', '{{json .}}']), docker(['image', 'inspect', image, '--format', '{{.Architecture}}'])])
const info = JSON.parse(resources)
assert.equal(info.OSType, 'linux')
assert.ok(info.NCPU >= 4 && info.MemTotal >= 10 * 1024 ** 3, 'Reserve 4 CPUs and 8 GiB for the isolated smoke worker plus daemon overhead.')
try {
  // This test gives its private inner daemon Docker privileges. It mounts no
  // host socket or files and publishes no ports. Anonymous Docker data volumes
  // give nested overlay mounts a filesystem like the production VM disk. Docker's
  // supplied dind wrapper prepares cgroup nesting for this container-only check.
  // The volumes are removed with the container; no existing volume is reused.
  assert.ok(['amd64', 'arm64'].includes(architecture), 'Use an AMD64 or ARM64 Linux worker image.')
  await docker(['run', '--detach', '--rm', `--platform=linux/${architecture}`, '--name', name, '--label', 'heval.managed-smoke=true', '--privileged', '--volume=/var/lib/docker', '--cpus=4', '--memory=8g', '--memory-swap=8g', '--entrypoint=/usr/local/bin/dind', image, 'sh', '/opt/heval/worker-entrypoint.sh'])
  console.log('Managed worker started; waiting for its private Docker engine.')
  await docker(['exec', name, 'sh', '-c', 'n=0; until docker info >/dev/null 2>&1; do n=$((n+1)); [ "$n" -lt 60 ] || { tail -40 /var/log/heval-docker.log; exit 1; }; sleep 1; done; install -d -m 700 -o heval -g heval /home/heval/managed-smoke'], undefined, 70_000)
  const versions = await docker(['exec', '--user=heval', name, 'sh', '-c', 'node --version && harbor --version && docker compose version'])
  console.log(versions)
  const config = { job_name: 'oracle-smoke', jobs_dir: '/home/heval/managed-smoke', n_attempts: 1, n_concurrent_trials: 1, agents: [{ name: 'oracle' }], tasks: [{ path: '/opt/heval/dist/runner-task' }], environment: { type: 'docker', delete: true } }
  await docker(['exec', '--interactive', '--user=heval', name, 'node', '-e', "require('fs').writeFileSync('/home/heval/managed-smoke/config.json',require('fs').readFileSync(0),{mode:0o600})"], JSON.stringify(config))
  console.log('Running the bundled reference solution through Harbor and Docker without a model.')
  await docker(['exec', '--user=heval', name, 'harbor', 'run', '--config', '/home/heval/managed-smoke/config.json'], undefined, 240_000)
  const result = JSON.parse(await docker(['exec', '--user=heval', name, 'node', '-e', "const f=require('fs'),p='/home/heval/managed-smoke/oracle-smoke';const rows=f.readdirSync(p,{withFileTypes:true}).filter(d=>d.isDirectory()&&f.existsSync(p+'/'+d.name+'/result.json')).map(d=>JSON.parse(f.readFileSync(p+'/'+d.name+'/result.json')));console.log(JSON.stringify({trials:rows.length,passed:rows.filter(r=>r.verifier_result?.rewards?.reward===1).length,errors:rows.filter(r=>r.exception_info).length,details:rows.flatMap(r=>r.exception_info?[{type:r.exception_info.exception_type,message:r.exception_info.exception_message}]:[])}))"]))
  assert.equal(result.errors, 0, JSON.stringify(result.details))
  assert.equal(result.trials, 1); assert.equal(result.passed, 1)
  console.log('PASS: managed Linux worker executes Oracle 1/1 with no model calls.')
} finally { await docker(['rm', '--force', '--volumes', name]) }
