# Deploy Heval on DigitalOcean

Use two Linux VMs on the same private network: a web VM for Bun, Chromium exports, Caddy and persistent data, and a dedicated worker VM for disposable evaluation containers. Model inference uses the configured API, so these VMs do not need GPUs. Start with 4 GB RAM on the web VM and enough worker memory for the configured two 2 GB containers plus Docker overhead.

This deployment supports invited evaluators and public result viewing. It is not an unrestricted public compute service. Keep one web process; the file-backed runner does not coordinate multiple schedulers.

## Prepare the worker

1. Install Docker Engine on the worker VM and clone this repository at the same revision used for the web service.
2. Build `bun run worker:build`, or `docker build -f server/worker/Dockerfile -t heval-worker:local .` if Bun is not installed on the host.
3. Create a dedicated `heval-worker` SSH user with access to Docker. Docker access grants control of this VM. Keep other workloads and credentials off it.
4. Allow SSH from the web VM's private IP. Do not publish the Docker TCP port.
5. Add a dedicated web-to-worker SSH public key to that user's authorized keys. Record and verify the worker's SSH host key.

The worker image pins the harness installers. Rebuild it when the fixture or launch adapter changes. Agent workspaces never receive a host directory mount, SSH key, Docker socket, or WorkOS credential.

## Prepare the web VM

Install Docker Engine and the Compose plugin. Point your domain's DNS at this VM and allow inbound TCP 80/443 and UDP 443. Keep the app's port 4173 private; only Caddy publishes ports.

From the checkout:

```sh
cp deploy/production.env.example deploy/production.env
mkdir -p deploy/ssh
```

Edit `deploy/production.env` with your domain, exact HTTPS origin, WorkOS client ID, invited WorkOS **user IDs**, approved models, connection encryption key and the worker's private SSH address. Store the dedicated private key at `deploy/ssh/id_ed25519` and verified host keys at `deploy/ssh/known_hosts`. The web container runs as UID 1000; give that UID ownership of the SSH directory, use mode 700 for the directory and 600 for the private key. These files and `production.env` are ignored by Git and excluded from the build context.

In WorkOS, register the exact HTTPS origin as the allowed web origin and root callback URI, and `<origin>/login` as the sign-in URL. The client ID goes into the browser build; the connection encryption key stays in the running server's environment. Each evaluator connects their own Gateway account in Provider settings. Sign-in returns to the selected private Studio comparison.

```sh
docker compose --env-file deploy/production.env -f deploy/compose.yaml build
docker compose --env-file deploy/production.env -f deploy/compose.yaml up -d
docker compose --env-file deploy/production.env -f deploy/compose.yaml exec web docker info
```

The last command checks the SSH connection to the worker without launching an evaluation. Visit `/api/health`, sign in with an invited account, and launch a single attempt. Confirm its grade, open it in Studio, restart the web container, and confirm the attempt and transcript remain accessible.

The hosted server refuses to start with a local Docker endpoint, missing persistence, missing invitations for an enabled runner, or a build made without `bun run build:public`. Export APIs also require an invited account. Caddy overwrites the client-IP header used by signup limits; never expose the Bun port beside this proxy.

## Public results

`bun run build:public` builds a separate personal-project landing page and copies only `results/public/` into the published result catalog. It excludes the existing company comparisons, reports and social assets from the public results directory. The initial public catalog is empty. Nothing is labeled as a fresh result until an evaluation actually runs.

After reviewing a personally owned result:

```sh
bun run publish:result results/harbor/<job>.json
bun run build:public
```

Rebuild/redeploy the web image to publish the new catalog. The public catalog is opt-in, not an automatic copy of private run history. Keep private transcripts out of this directory. The browser-test entry points are not included in either production build.

## Persistence and operations

The named `app_data` volume stores `recordings/<id>.json` summaries, append-only `.jsonl` transcripts, and `signups.sqlite`. A run's initial summary is written before its API launch response. Startup restores summaries and cleans interrupted workers before accepting requests. Interrupted runs become failed with an explicit restart reason. Cleanup failures block new evaluations and remain pending across subsequent restarts.

Snapshots are atomically replaced. Output flushes every second; a hard crash can lose the last unflushed output. This is restart recovery, not automatic continuation of an agent. Do not run `docker compose down -v` unless you intend to delete persistent application data. Back up the volume with the web service stopped, or use SQLite's backup API for the signup database and a consistent copy of recordings. Test restoration on a separate instance.

Signups require explicit consent, normalize and deduplicate emails, and enforce per-client and global daily limits. There is no public endpoint listing email addresses. Collection is implemented; sending newsletters is a separate operator action. Only send the updates people consented to receive and include an unsubscribe method when doing so.

The runner enforces approved models, invited users, per-user/global concurrency, daily attempt limits, timeouts, output limits and container cleanup. These limits constrain use; they are not an exact dollar budget. Set provider-side spending limits as appropriate. Unknown token counts and prices remain unavailable in the UI and exports.

Agent containers have outbound network access. Browser evaluations receive a temporary, model-restricted token for the Heval inference proxy. Saved Gateway keys stay on the web server. Use a dedicated credential and worker VM. The grader runs in a separate networkless container with immutable tests. Hosted deployment still requires validation on your actual accounts, DNS and worker host; the repository's local tests cannot establish those external connections.

## Provider connections

The workbench includes Provider settings for connecting, validating, replacing and deleting a personal Merge Gateway key. Browser evaluations require a connection and currently support Pi Agent. The instance-wide `HEVAL_GATEWAY_API_KEY` is for local CLI use; it is never silently assigned to an evaluator. See [the provider flow](provider-connections.md).

Set `HEVAL_CONNECTION_ENCRYPTION_KEY` to 32 cryptographically random bytes encoded as 64 hexadecimal characters before starting hosted Heval. Store this secret separately from database backups, preserve it across restarts, and never put it in a `VITE_` variable. Hosted startup fails if it is missing or malformed. Changing it without migrating saved credentials makes those connections unreadable.

The worker must reach `https://<HEVAL_DOMAIN>/api/inference/chat/completions`. Caddy passes streaming responses through the same authenticated-by-run-token endpoint. Each token permits only the selected model, one concurrent request, 40 requests total, and up to 8192 output tokens per request. It expires at the run deadline and is revoked on completion, cancellation, replacement or deletion. These are request and token ceilings, not an exact dollar budget.

The persistent data directory also contains `connections.sqlite`, with AES-256-GCM encrypted credentials bound to the owning account. Connection metadata contains available model IDs and validation time, never the key. Deleting a connection removes the active database record and stops active runs. Encrypted backups may retain previous records until their retention period ends; revoke the key in Merge Gateway to invalidate it everywhere.
