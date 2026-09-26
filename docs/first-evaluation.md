# Your first Heval evaluation

For the upcoming automated installation, see [one-command setup](setup-command.md).
It installs Harbor and the worker runtime in Docker and opens a local pairing
and provider form. That feature is not in published CLI 0.2.0; the manual
walkthrough below remains usable with that release.

This walkthrough takes you from a fresh Linux worker to a saved evaluation in
Heval. It uses **Ubuntu 24.04**, **Heval CLI 0.2.0**, **Harbor 0.23.0**, one
model through Merge Gateway, and the Codex harness running one bundled task.
Other Linux distributions need different prerequisite installation commands;
the Heval commands are the same.

You need access to a deployed Heval website with working sign-in and connected
runner support. Installing this CLI does not deploy or upgrade that website.
The worker and hosted application must have compatible connected-runner code.

The npm installation needs Node.js 22 or newer. It does **not** require Bun,
a repository checkout, or building a package from source.

## What runs where

| Component | Purpose |
| --- | --- |
| Your browser | Configure runs, start them, and inspect results in Heval. It can run on any computer. |
| Linux worker | The computer or VM that executes evaluations. Run all terminal commands below here. |
| Heval runner | Connects the worker to your account and picks up queued evaluations. |
| Docker | Creates the task environments. |
| Harbor | Executes tasks and checks their results. |
| Codex harness | Operates the coding agent during a trial. |
| Model | Supplies responses to the coding agent through Merge Gateway. |

A **profile** is an approved harness, model, and task configuration saved on the
worker. A **trial** is one attempt at one task by one harness/model combination.
The first model evaluation below contains one trial.

## 1. Open a terminal on your worker

For a Linux desktop, open its Terminal application. For a remote Linux VM,
connect using the SSH command from its hosting provider, usually:

```sh
ssh YOUR_USERNAME@YOUR_SERVER_IP
```

Replace both placeholders with that machine's username and address. Once
connected, commands execute on the remote machine.

Use a regular user account with `sudo` access. Use that **same user account on
the same worker** for every step. Do not run Heval with `sudo`.

Check the operating system:

```sh
cat /etc/os-release
```

The installation steps below assume Ubuntu 24.04. Do not paste the `apt`
commands into an Arch/Omarchy, Fedora, or macOS terminal.

Paste each command, press Enter, and wait for the terminal prompt to return.
If a command fails, resolve its error before continuing. When `sudo` asks for
a password, enter your Linux account password; invisible typing is normal.

If Node, Docker, and Harbor already work, check their versions and skip the
corresponding installation sections.

## 2. Install basic tools and Node.js

```sh
sudo apt update
sudo apt install -y ca-certificates curl git build-essential
```

Install Node through nvm, following its [official instructions](https://github.com/nvm-sh/nvm#installing-and-updating):

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash
source ~/.bashrc
nvm install 22
nvm alias default 22
nvm use 22
```

Check both executables:

```sh
node --version
npm --version
```

Node should print a version beginning with `v22.`. npm should print its version.
Node runs the installed Heval CLI; npm installs it.

## 3. Install Docker Engine and Compose

These commands follow [Docker's Ubuntu repository installation](https://docs.docker.com/engine/install/ubuntu/)
on a fresh machine. If Docker is already installed, check it before replacing anything.

```sh
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
```

Paste this entire block:

```sh
sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF_DOCKER
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF_DOCKER
```

Install and start Docker:

```sh
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

The Docker group gives your user substantial control of this worker. See
[Docker's post-installation instructions](https://docs.docker.com/engine/install/linux-postinstall/).

**Log out and log back in** so the group membership takes effect. For SSH,
run `exit` and reconnect with the original SSH command. For a desktop, log
out of the desktop session and sign back in.

Then check Docker without `sudo`:

```sh
docker info
docker compose version
docker run --rm hello-world
```

The last command should print `Hello from Docker!`. A permission-denied error
usually means the current login session does not have the new group membership.

## 4. Install Python and Harbor

Install uv using its [official installer](https://docs.astral.sh/uv/getting-started/installation/):

```sh
curl -LsSf https://astral.sh/uv/install.sh | sh
source "$HOME/.local/bin/env"
uv --version
```

Install Python and the Harbor version Heval expects:

```sh
uv python install 3.12
uv tool install --python 3.12 'harbor==0.23.0'
harbor --version
```

Harbor must report `0.23.0`. The runner checks that version explicitly.

## 5. Install Heval from npm

```sh
npm install -g @mattferoz/heval@0.2.0
heval --version
heval --help
```

Expect version `0.2.0`. The help must list `runner connect`, `runner start`,
`runner setup`, and `provider connect merge`.

The same npm command upgrades an older installation. Finish active evaluations
before replacing their CLI installation.

If `heval` still reports `0.1.0`, run `command -v heval` to identify which
installation your terminal is using. The old local viewer cannot connect a worker.

Do not use `heval open` to launch the first evaluation: that command opens
existing results or the bundled archived example.

## 6. Create a pairing code in the browser

Open your deployed Heval website and sign in. Navigate to **Runner setup**,
whose route is `/machines` on that website.

In **Connect a machine**, enter a name such as `My first Linux worker` and
click **Create pairing code**.

The page displays a command resembling:

```sh
heval runner connect --url https://YOUR-DEPLOYMENT.convex.cloud
```

Copy the **actual command from your website**. The Convex URL identifies its
backend; it is not the same as the website's browser address.

## 7. Pair the worker

Paste that command into the worker's terminal. When prompted:

```text
Paste the one-time pairing code from Heval:
```

Copy the pairing code from the browser, paste it, and press Enter.
A successful response says that the machine is paired.

Codes expire after ten minutes. If needed, create a new code in the browser
and repeat this step. Pairing does not require your model-provider key.

## 8. Start the runner

```sh
heval runner start
```

This process stays running and normally does not return to the command prompt.
Leave this terminal open; call it **Terminal A**.

Return to Runner setup in the browser. After a check-in, the worker should
show **Online**. If it shows **Needs setup**, read its health message: the
runner checks Harbor's version and access to Docker Engine and Compose.

## 9. Run the setup check without model calls

On Runner setup, find **Check your worker**, select the worker, and click
**Run setup check**.

Find the run under **Your evaluations** on that page. Wait for it to finish,
then open its saved report. Confirm that the task passed.

This runs a task's reference solution through Harbor and Docker. It makes no
model calls, although it uses worker compute and may download container images.
It verifies the path from browser to worker and back to a saved report.
Resolve any failure here before adding model credentials.

## 10. Get a Merge Gateway API key

Open [Merge Gateway](https://gateway.merge.dev/) in your browser and sign in
or create an account. Open its API keys page and create a model-calling Gateway
API key. Copy it when displayed. A management key is a different credential
and cannot make model calls. See [Merge's key concepts](https://docs.merge.dev/merge-gateway/key-concepts).

Ensure your account has available credit or billing for the model you intend
to use. See [Merge's getting-started guide](https://docs.merge.dev/merge-gateway/get-started).

## 11. Save the provider connection on the worker

With a CLI build that lists `provider setup merge` in `heval --help`, use the
browser setup page:

```sh
heval provider setup merge
```

Keep the terminal open. On the local page, paste the model-calling key into the
masked field and choose **Verify and save**. A successful connection displays
the available models. Choose a model and Codex, then select **Prepare connection
check**. This also completes step 12 without model calls; continue at step 13.

The hosted Runner setup page includes **Connect Merge Gateway** after the worker
check. If the local browser does not open, paste the complete setup link printed
by the CLI into that step and click **Open local provider setup**. Never paste a
provider key into that link field. The key is sent directly from the local page
to the worker and verified against Merge; the hosted backend does not receive it.

For WSL, open the printed link in your Windows browser. For a remote worker,
use `--no-browser --port 4174`, forward the port with
`ssh -L 4174:127.0.0.1:4174 USER@WORKER`, and open the printed link locally.
Choose another free port if needed. Use the same `--state` directory as your
runner. The page listens only on loopback, requires its session token, and
expires after 15 minutes without an open setup page. Stop it with Ctrl+C when finished.

This browser flow requires the updated CLI and hosted UI; npm 0.2.0 installations
without this command can use the terminal flow below.

Keep Terminal A running. Open **Terminal B**, a second terminal or SSH session
on the same worker, logged in as the same user.

```sh
heval provider connect merge
```

At `Merge Gateway key (hidden):`, paste your key and press Enter. Invisible
input is normal. Heval validates it by reading the model catalog and stores
it under this user's runner state. Do not paste the key into Heval's website.

Check the connection:

```sh
heval provider status merge
```

Expect `"connected": true` and a `models` array. Copy one exact model ID from
that array, including its provider prefix and any slashes.

## 12. Prepare one model-backed profile

In Terminal B, replace `MODEL_ID` with the exact ID you copied:

```sh
heval runner setup --model MODEL_ID --harnesses codex
```

Expect a message containing:

```text
Created profiles: merge-codex. No model calls made.
```

This creates one approved configuration: Codex, your selected model, the bundled
file-writing task, and one attempt. The configured harness uses your Merge
connection; a separate Codex account login is not needed for this path.

The running daemon picks up the profile on a subsequent check-in. You do not
need to restart it. Do not repeat setup for the same profile: existing profiles
are intentionally not overwritten.

`heval runner test` is an optional separate local execution that uses model
credits. Skip it here: the next step starts your model run from the website.

## 13. Configure the evaluation in Heval

Open **Evaluations**, at `/evaluations` on your Heval website.

1. Select `My first Linux worker` in **Worker**.
2. Select **Heval connection smoke** under **Benchmark**. It should be installed.
3. Select **Codex CLI** under **Harnesses**.
4. Select your configured model under **Models**.
5. Retain the serving-vendor option offered for this profile.
6. Open **Advanced settings** and leave **Attempts per task** at `1`.
7. Enter `My first evaluation` in **Experiment name**.
8. Check that the summary shows one combination and one total trial.

If no evaluation options appear, confirm Terminal A is running and the setup
command used the same worker account. The browser lists the worker's advertised
profiles; connecting an API key alone does not create one.

## 14. Start and follow the run

Click **Start experiment**. **This step makes model calls and uses credits.**

The experiment is queued. The worker picks it up, snapshots the task, starts
Harbor and Docker, runs the Codex harness against your selected model, grades
the task, and uploads the normalized result.

Watch the experiment page for queued, running, and final status. Keep the
worker awake and Terminal A connected. You may close the browser and return
to the experiment later.

Expand the harness/model result and click **Inspect this run**. When available,
Heval also displays the combined experiment report. For this first task, look
for **one trial and one pass**.

Execution completion and task success are separate: a completed run can contain
a failed task. A failed execution has a diagnostic message; inspect it before
retrying. Passing this connection smoke test confirms the path works, not the
model's general coding ability.

## 15. Add a small benchmark

After the connection smoke succeeds, install the five-task TBLite smoke set
in Terminal B:

```sh
mkdir -p ~/.heval/benchmarks
git clone https://github.com/open-thoughts/OpenThoughts-TBLite ~/.heval/benchmarks/openthoughts-tblite
git -C ~/.heval/benchmarks/openthoughts-tblite checkout 5c37b41f00ce04719a4453061076ae9f46b74b7d
```

Replace `MODEL_ID` with your chosen model:

```sh
heval runner setup \
  --benchmark tblite-smoke \
  --source ~/.heval/benchmarks/openthoughts-tblite \
  --model MODEL_ID \
  --harnesses codex
```

The worker checks the source content against pinned hashes before installing
it. Back in Evaluations, select **OpenThoughts-TBLite smoke**, Codex, and your
model. With one attempt, the summary should show five trials. Starting it
uses model credits. The five-task subset is not a full TBLite score.

CLI 0.2.0 also supports `--benchmark tblite` for the full 100-task set using the
same source checkout. The hosted frontend and backend must include the updated
catalog and removal of the old task/trial limits. Updating the CLI alone does
not update those deployed services. The full set remains a preview benchmark;
its installation was checked, but a full model evaluation has not been validated
by this release. Account storage and report-size limits still apply.

## What to do next time

Installation, pairing, and provider connection are normally one-time setup.
For another run of an existing profile, use Evaluations in the browser.

After a worker reboot, start `heval runner start` again unless you have installed
the [documented Linux service](connected-runners.md). The service lets the runner
stay connected without an interactive terminal. A reboot interrupts an executing
run; interrupted evaluations are not automatically repeated.

## If something goes wrong

| Symptom | First check |
| --- | --- |
| `heval` is missing or reports `0.1.0` | Install 0.2.0 under the same Node/user account; check `command -v heval`. |
| Worker says **Needs setup** | Read its health message; check `harbor --version`, `docker info`, and `docker compose version`. |
| Worker says **Offline** | Check Terminal A, worker power/network access, and `heval runner status`. |
| Provider catalog validation fails | Check the Gateway key and outbound network access; reconnect with `heval provider connect merge`. |
| Connected worker has no model options | Run `runner setup` after connecting the provider, under the same Linux user. |
| Setup says the profile already exists | Use the existing profile; do not rerun setup for it. |
| Model execution fails | Expand its run message; inspect provider access/credit and worker logs before retrying. |
| Run completes but has zero passes | Inspect the task result; execution can succeed while the agent fails the task. |

By default, connection state, provider connection, and profiles live in
`~/.heval/runner` on the worker. If you use `--state`, use the exact same directory
for all Heval commands. Provider status never prints the saved key.
