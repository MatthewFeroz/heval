# Heval

Explore coding-agent evaluation results locally, without cloning the repository.
Heval includes a browser workbench and checks prerequisites for Harbor evaluations.

Requires **Node.js 22 or newer**. Viewing existing results needs no account, API
key, Bun, Docker, Python, or Harbor installation. There are no runtime npm
dependencies or install scripts.

## Start here

After the first npm release is published:

```sh
npx @mattferoz/heval@latest open
```

This opens an archived example: six models evaluated on 20 tasks. It does not
start an evaluation or spend model credits. The example is exploratory data,
not a general model leaderboard.

For a permanent installation:

```sh
npm install -g @mattferoz/heval
heval open
```

## Open your results

```sh
# A normalized Heval export
heval open ./my-run.json

# A raw Harbor job directory containing per-trial config.json/result.json
heval open ./jobs/my-run

# Choose a port, or print the URL without launching a browser
heval open ./jobs/my-run --port 4173 --no-browser
```

By default Heval chooses an available port and listens on `127.0.0.1` only.
The terminal stays open while you use the viewer; press Ctrl+C to stop it.
Open the printed URL manually on systems without a browser launcher.

The viewer reads a snapshot of the selected results. To include trials that
finish later, stop and reopen it. Your input files are not modified. Raw Harbor
imports retain provider-reported costs; unavailable prices remain unknown.
Heval does not apply an unrelated pricing catalog from your current directory.

In the workbench you can:

1. Compare completion, cost, and duration with charts and tables.
2. Inspect individual trial results and recorded metadata.
3. Filter the comparison and download the chart as SVG or PNG.
4. Download a **Bundle** to share the workspace and its data.

Use **Open export** inside the viewer to open saved project/bundle files. A
referenced project may require its original sources; a bundle includes them.
Local links only work while the same viewer session is running. Imported files
stay in the browser unless you explicitly download or share them.

## Check evaluation setup

```sh
heval doctor
heval doctor --json
heval doctor --strict
```

Doctor checks Node, Harbor **0.22.0**, Docker daemon availability, optional Bun,
and known provider credential variable names. It never prints credential
values, installs software, or calls a model. Presence of an environment variable
does not verify account access, provider routing, or whether a particular job
has the right credentials. `--strict` returns a nonzero exit code when required
evaluation tools are missing or unsupported; otherwise missing tools are
informational because the viewer remains usable.

## Running evaluations

This first release supports **setup checks and viewing existing results**.
It does not yet include `heval run`, a job scheduler, live terminal replay, or
social/video rendering. SVG/PNG chart downloads run in your browser.

Use Harbor for execution, then open its output:

```sh
uv tool install harbor==0.22.0
harbor run -c ./your-job.yaml --print-config
# After configuring credentials and reviewing the job:
harbor run -c ./your-job.yaml
heval open ./jobs/your-job-name
```

Running Harbor requires the environment and credentials specified by your
job, and can consume model credits. See the
[Heval reproduction guide](https://github.com/MatthewFeroz/heval/blob/main/docs/reproducing-evaluations.md)
for existing comparisons and [Harbor documentation](https://www.harborframework.com/docs)
for execution concepts. Newer Harbor docs may describe features beyond the
version supported here.

## Build or install before npm publication

From the repository root:

```sh
bun install --frozen-lockfile
bun run cli:pack
npm install -g ./.scratch/mattferoz-heval-0.1.0.tgz
heval open
```

The tarball includes the compiled Node CLI, prebuilt browser UI, one archived
example, and bundled dependency notices. It excludes credentials, raw jobs,
Merge's licensed fonts, and generated social media assets.

Until a project license is selected, Heval's own code is marked `UNLICENSED`;
bundled third-party components retain their licenses in
`dist/THIRD_PARTY_NOTICES.txt`. Harbor is a separately installed Apache-2.0 tool
and is not bundled.
