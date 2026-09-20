# Docker Desktop evaluation worker (smoke validation)

This runs the existing Linux-only connected runner inside a Linux container on
macOS Docker Desktop. Harbor creates sibling task containers through the mounted
Docker socket. This is a trusted personal worker with control over that Docker
engine, not an isolation boundary for untrusted users.

The Mac workspace must be bind-mounted at **the same absolute path** in the
worker container. Harbor submits absolute bind paths to Docker Desktop; mounting
it as /workspace would make task logs disappear into the wrong host path.

Current validation workspace: `/Users/mattferoz/heval-smoke-worker`.
The source-built `packages/cli/dist` plus pilot/proxy scripts are copied there;
Vercel deployment credentials are not copied. Runtime state and logs live in that
Mac workspace. Pair with the user's actual signed-in Machines page, never a
synthetic test identity, for reports to appear in that account.

The worker image pins Harbor 0.23.0. Base images and transitive Python dependencies
must be recorded from the resulting image before interpreting benchmark results.
The initial tiny task only checks connectivity, tool execution and grading.

Stopping/removing the worker container kills its supervisor processes. Finish or
cancel trials before stopping it. Keeping the container and bind-mounted state
allows normal daemon recovery, but does not make active runs survive container
recreation. A Mac sleep also suspends execution.

A worker container's Docker CLI uses an empty registry configuration for public
images, avoiding macOS Keychain integration. Private task images would require a
separately configured registry login.

## Verified 2026-09-17

Image `sha256:efc4c9f2be2d18b2f4fc7c2b0c4f0376ea1d65aabea1f4a6a2b6c7b9ffe91a0b`
ran Harbor 0.23.0 on Docker Desktop 29.7.2 / ARM64. The one-trial Oracle setup
check passed (reward 1.0, zero exceptions, 17 seconds). Absolute-path log mounts
worked. The running container is `heval-smoke-worker`; it uses a host bind at the
workspace path and `/var/run/docker.sock`. Port 18787 is bound to Mac loopback
and reserved for the vendor proxy (container port 8787).

The worker was subsequently paired through a code from the user’s signed-in
account. The queued Oracle check and all three DeepSeek harness trials passed
and saved private reports. One earlier Codex attempt failed before inference
because the generator supplied its config as a string; the generator now uses
an object. All 11 generation requests confirmed the particle vendor. See
[the evidence](../../docs/evidence/macbook-three-agent-smoke.json) and
[the blog draft](../../docs/blog/three-harnesses-one-model-macbook-worker.md).
The image's Python dependency freeze is saved in the Mac workspace as
`python.freeze.txt`. Its Dockerfile base digests were recorded after resolution.
The prepared model task is `tasks/protocol-smoke`, identical to the setup task
except for a 2 CPU / 2 GiB allocation and a 180-second task agent timeout. Any
profile override must be recorded separately.


## Reproduce the container layout

Build the CLI from the working checkout with `bun run cli:build`. Copy
`packages/cli/dist`, **`packages/cli/package.json`**, the study preparation scripts,
and `harbor/proxy/vendor-proxy.ts` into a new Mac workspace, preserving relative
paths. Copy this Dockerfile and .dockerignore there too. The .dockerignore ensures
future builds do not send worker credentials or raw job logs as build context.

In macOS Terminal, with Docker Desktop running:

```bash
cd /Users/YOUR_USER/heval-smoke-worker
docker build -t heval-smoke-worker:harbor-0.23.0 .
HEVAL_WORKSPACE="$PWD"
docker run -d --name heval-smoke-worker \
  --mount "type=bind,source=$HEVAL_WORKSPACE,target=$HEVAL_WORKSPACE" \
  --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
  -w "$HEVAL_WORKSPACE" -e "HOME=$HEVAL_WORKSPACE/home" \
  -e "DOCKER_CONFIG=$HEVAL_WORKSPACE/docker-public" \
  -p 127.0.0.1:18787:8787 heval-smoke-worker:harbor-0.23.0
```

This recipe requires a new container name and workspace; do not overwrite a live
worker. Create home/docker-public directories in the workspace. Commands from
[the three-agent guide](../../docs/three-agent-worker.md) then run inside this
container via `docker exec`, with an explicit `--state` path in the workspace.
Pairing is interactive (`docker exec -it ... runner connect ...`). Keep the same
state path when starting the daemon, checking status, or recovering runs.

For Docker Desktop, the task-facing proxy origin used here is
`http://host.docker.internal:18787`; the proxy listens on container port 8787.
The authenticated catalog was verified before choosing particle. A successful
response must confirm the served vendor as well as the requested model.

The three model profiles used a copy of the setup task with 2 CPUs and 2048 MB,
and `override_timeout_sec: 180`. The default generator's 900-second override must
be changed explicitly to reproduce this particular smoke. Keep the Oracle setup
profile in the registry alongside the three model profiles. Profiles refresh
without a daemon restart; changed configurations get a new digest.

For this one-off operator-assisted run, the operator queued jobs with existing
deployment credentials under the owner established by the user's pairing code.
Normal users enqueue directly from the signed-in website. The worker still used
the ordinary poll, claim, execute and report-upload path; deployment credentials
were never copied to it.

The source setup-profile initializer now uses explicit recursive traversal to
avoid the Node 22 native copy error observed on the Docker Desktop bind mount.
The 15 CLI tests passed after this change; the Mac workspace was refreshed with
the rebuilt CLI and corrected pilot generator after all runs finished.
