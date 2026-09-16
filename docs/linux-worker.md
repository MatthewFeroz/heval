# Use a Linux PC as Heval's worker

This setup keeps the Heval website, credentials and results on your Mac. A dedicated Ubuntu PC builds and runs the evaluation containers. Merge Gateway runs the models, so the GTX 1080 Ti does not need NVIDIA drivers or NIM for this setup.

The Mac and PC must both be awake for evaluations. This is a private development setup, not a public deployment. Later, the web service can move to a cloud server using the same remote-worker arrangement.

## 1. Install Ubuntu on the PC

Use Ubuntu Server 24.04 LTS, or Ubuntu Desktop 24.04 LTS if you want a graphical desktop. The commands below are for Ubuntu, not Omarchy/Arch.

Download the ISO from [Ubuntu](https://ubuntu.com/download/server), write it to a USB installer, boot the PC from USB, and follow the installer. Installing alongside Windows requires partitioning; back up your files and Windows recovery key first. Use a separate SSD if available. Do not choose “erase disk” when keeping Windows. There is no partitioning command in this guide.

Give Ubuntu enough disk space for at least 100 GB free after installation. Prefer 16 GB RAM and a wired network connection. Start with one concurrent evaluation.

The remaining steps are terminal commands. Run each block in order and resolve any error before continuing.

## 2. On the PC: install SSH and Docker Engine

Run this from your normal Ubuntu administrator account. These commands follow Docker's official Ubuntu repository installation and assume a fresh Ubuntu installation without an existing Docker setup.

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl openssh-server rsync
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker ssh
sudo docker run --rm hello-world
```

Create the dedicated worker account. `adduser` prompts you to choose its password, which is used once to install your SSH public key.

```bash
sudo adduser heval-worker
sudo usermod -aG docker heval-worker
```

Docker group access gives this account control of the PC. Use it for this dedicated worker and protect its SSH key.

## 3. Connect both computers with Tailscale

Tailscale gives the computers private network addresses without router port forwarding.

On the Ubuntu PC, download and run Tailscale's official installer, then follow the login link from `tailscale up`:

```bash
curl -fsSL https://tailscale.com/install.sh -o /tmp/heval-tailscale-install.sh
sh /tmp/heval-tailscale-install.sh
sudo tailscale up
tailscale ip -4
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

Record the PC's Tailscale IP and SSH fingerprint. Install [Tailscale for macOS](https://tailscale.com/download/mac) on the Mac, sign into the same account, and record the Mac's Tailscale IPv4 address from the app. Keep access restricted to your devices through your tailnet's access policy.

Use these two addresses below:

- `PC_TAILSCALE_IP`: the PC's address, usually starting with `100.`.
- `MAC_TAILSCALE_IP`: the Mac's address, usually starting with `100.`.

Replace these placeholders before running commands. No public router ports or Docker TCP ports are needed. If an existing Ubuntu firewall blocks SSH, allow TCP 22 on `tailscale0` according to that firewall's configuration. Allow Bun's incoming connections through the Mac firewall when prompted; workers must reach its proxy over Tailscale.

## 4. On the Mac: install a dedicated SSH key

```bash
ssh-keygen -t ed25519 -f "$HOME/.ssh/heval_worker" -C "heval-worker"
ssh-add "$HOME/.ssh/heval_worker"
cat "$HOME/.ssh/heval_worker.pub" | ssh heval-worker@PC_TAILSCALE_IP 'umask 077; mkdir -p .ssh; cat >> .ssh/authorized_keys'
```

Choose a passphrase when generating the key. If that key file already exists, reuse it instead of overwriting it. On the first SSH connection, compare the displayed fingerprint with the one shown on the PC before accepting it. Enter the worker account password when asked. Only the public key is copied.

Open your SSH configuration:

```bash
nano "$HOME/.ssh/config"
```

Add this block, replacing the PC address. Preserve existing entries:

```sshconfig
Host heval-worker
    HostName PC_TAILSCALE_IP
    User heval-worker
    IdentityFile ~/.ssh/heval_worker
    IdentitiesOnly yes
    BatchMode yes
    ControlMaster auto
    ControlPath ~/.ssh/heval-%C
    ControlPersist 600
    ServerAliveInterval 30
```

Test the connection:

```bash
ssh heval-worker 'docker version'
```

It should show both Docker client and server versions without asking for a password. If authentication fails, load the key with `ssh-add` again. If Docker reports permission denied, verify the account belongs to the `docker` group and reconnect.

## 5. On the Mac: copy and build the current worker code

Copy the worker files from the same worktree as the running web app so both use matching code, including any local updates. This narrow copy keeps `.env.local`, private recordings and company comparison data on the Mac.

```bash
cd /Users/ahmadulaferoz/.t3/worktrees/heval/t3code-7eed29bf
ssh heval-worker 'mkdir -p ~/heval-worker'
rsync -azR server/worker server/types.ts fixtures/concurrent-cache heval-worker:heval-worker/
ssh heval-worker 'cd ~/heval-worker && docker build -f server/worker/Dockerfile -t heval-worker:pc .'
```

The build downloads the pinned coding tools and can take several minutes. It happens entirely on the PC. Bun is included in the worker image; it does not need a separate host installation on the PC.

The Mac still needs the Docker **CLI**, but Docker Desktop's local engine does not need to run. Its existing CLI should work. If `docker` is unavailable, install the CLI with `brew install docker` on a Mac that already has Homebrew.

```bash
export DOCKER_HOST=ssh://heval-worker
docker info --format '{{.Name}}'
docker image inspect heval-worker:pc --format '{{.Id}}'
```

The first command should name the Linux PC. These commands should not contact the Mac's Docker engine. Remove a pre-existing `DOCKER_CONTEXT` environment override if it causes the CLI to select a different endpoint.

## 6. On the Mac: point Heval at the PC

Open the existing environment file. Keep your current Gateway key and other settings:

```bash
open -e /Users/ahmadulaferoz/.t3/worktrees/heval/t3code-7eed29bf/.env.local
```

Add or update these entries, replacing the Mac address. Avoid duplicate entries:

```dotenv
DOCKER_HOST=ssh://heval-worker
HEVAL_WORKER_IMAGE=heval-worker:pc
HOST=0.0.0.0
PORT=4173
HEVAL_ENABLE_RUNNER=1
HEVAL_MAX_CONCURRENT_RUNS=1
HEVAL_MAX_RUNS_PER_USER=1
HEVAL_MAX_DAILY_RUNS_PER_USER=6
HEVAL_RUN_TIMEOUT_MS=300000
HEVAL_INFERENCE_PROXY_URL=http://MAC_TAILSCALE_IP:4173/api/inference
HEVAL_DEMO_PROXY_HOST=MAC_TAILSCALE_IP
```

Leave `HEVAL_HOSTED` unset for this private setup. The proxy URL uses the Mac's Tailscale address because the worker must call back to the Mac. `host.docker.internal` would point to the wrong computer, or fail to resolve, on the Linux PC. HTTP here travels inside the encrypted Tailscale connection; a public deployment must use HTTPS.

The CLI demo can run without WorkOS. For browser launches, also configure both `WORKOS_CLIENT_ID` and `VITE_WORKOS_CLIENT_ID` with the same client ID. In WorkOS, register `http://localhost:4173` as the allowed web origin and callback URI, and `http://localhost:4173/login` as the sign-in URL. These IDs are public, unlike your Gateway key.

Build and start the personal-project website on the Mac:

```bash
bun run build:public
bun run serve
```

Open `http://localhost:4173` on the Mac. Leave this terminal running. Sign in, open **Provider settings**, and connect your Gateway key. The key remains on the Mac; the worker gets a temporary inference token.

## 7. Verify the connection before using model credits

In a second Mac terminal:

```bash
export DOCKER_HOST=ssh://heval-worker
docker run --rm --entrypoint bun heval-worker:pc -e 'const r = await fetch("http://MAC_TAILSCALE_IP:4173/api/health", { signal: AbortSignal.timeout(10000) }); console.log(r.status); if (!r.ok) process.exit(1)'
```

Replace the Mac IP inside the quoted URL too. Expect `200`. This verifies connectivity from a real worker container to Heval, without sending a provider key or making model calls.

Then launch one evaluation from the browser. Confirm that it appears on the PC:

```bash
docker ps --filter label=heval.worker=true
```

Wait for the attempt, inspect its grade, and open it in Studio. If you see a cleanup failure from a previous Mac run, resolve that old worker on its original Docker engine first. Switching engines does not move existing containers or volumes. Keep old recordings; do not delete history to bypass recovery.

For the standalone NVIDIA comparison, the saved `.env.local` Gateway key and `HEVAL_DEMO_PROXY_HOST` are sufficient once SSH and the worker image work:

```bash
bun run demo:nvidia
bun run demo:nvidia --run
```

The first command only validates model availability. The second makes two paid-or-credit-consuming model-backed attempts, each limited to five minutes. It starts a separate temporary proxy on the Mac and uses the PC for execution. The Mac firewall must allow Bun's incoming Tailscale connections to that temporary port. Results are saved locally under `data/nvidia-demo` and are not automatically published.

## 8. Keep the PC available and watch disk usage

Disable automatic sleep in Ubuntu Desktop's power settings while serving as the worker. Docker and SSH start automatically after reboot; make sure Tailscale reconnects as well.

Inspect storage from the Mac:

```bash
ssh heval-worker 'df -h /var/lib/docker'
ssh heval-worker 'docker system df'
```

On this dedicated worker, these optional commands remove unused build cache and old dangling images. Docker asks for confirmation. They do not prune volumes or the tagged worker image:

```bash
ssh -t heval-worker 'docker builder prune --filter until=168h --keep-storage 10GB'
ssh -t heval-worker 'docker image prune --filter until=168h'
```

Avoid broad volume pruning. Heval normally removes a run's containers and workspace volume itself. Investigate cleanup errors before starting more runs.

Repeat the copy and build commands in step 5 whenever the worker adapter or fixture changes. Stop active evaluations first. The website and worker should run matching code.

Official references: [Docker on Ubuntu](https://docs.docker.com/engine/install/ubuntu/), [Docker over SSH](https://docs.docker.com/engine/security/protect-access/), [Tailscale on Linux](https://tailscale.com/download/linux).
