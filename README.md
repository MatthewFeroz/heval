<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/openeval-lockup-white.png">
    <img src="public/openeval-lockup-black.png" alt="OpenEval" height="48">
  </picture>
</h1>

OpenEval runs coding-agent evaluations on connected Linux workers and helps users
inspect, chart, and share results. The website manages configuration and reports;
Harbor and Docker execute tasks on a worker controlled by the user.

## Run an evaluation

A connected worker needs Linux, Node.js 22+, Python 3.12+, Harbor 0.24.0, Docker
Engine and Compose. The browser can run on a different computer or OS.

Follow [Connected runners](docs/connected-runners.md) to install the runner,
pair a machine, run the no-model setup check, and configure a model-backed
profile. Merge Gateway support is included:

```sh
openeval provider connect merge
openeval provider status merge
openeval runner setup --model YOUR_MODEL_ID --harnesses codex,claude-code,pi
```

Choose **New comparison** in your Library, then select a connected worker.
Use the custom matrix for additional combinations and execution settings.
Starting a model-backed evaluation
uses that worker's compute and provider credits. Credentials remain on the worker.
A setup check verifies execution; it is not a capability score.

This checkout also includes guided first-run setup, per-run resource and
parallelism controls, live trial monitoring, and public Merge Gateway model
pricing. The upcoming `openeval setup` command prepares a persistent Linux worker
in Docker; see [one-command setup](docs/setup-command.md) for source-build
instructions and release status. The [first-evaluation guide](docs/first-evaluation.md)
covers the manual setup supported by the published CLI.

The source also includes guided harness/model comparisons, immutable baselines,
and reviewed trial evidence. An invite-only managed execution path uses a
Railway coordinator and disposable Daytona Linux VMs. It stays disabled until
the operator configures and validates the worker artifact and provider accounts.
See [managed comparison setup](docs/managed-comparisons.md). This source change
does not publish a CLI release or deploy the hosted application.

The hosted workspace uses **Library**, **Explore** and **Settings**. Library
combines running comparisons, imported results and saved baselines. Each report
opens **Results**, **Analyze**, **Export** and **Share**; chart drafts stay intact
when moving between these sections. Import a normalized Harbor JSON from the
Library, or open the file editor for an existing project or bundle. Settings
manages connected workers and their provider setup. Explore shows the approved
published comparisons without requiring sign-in.

## Explore results locally

```sh
npx @mattferoz/openeval@latest open
```

The npm viewer needs Node.js 22+, with no Bun, Docker, or account required for
viewing existing data. See [the CLI guide](packages/cli/README.md).

The homepage includes an approved snapshot of 260 measured trials from two
published studies. Browse the task-by-stack grid, compare two runs, or inspect
cost and agent time on the interactive chart. These small studies describe
their recorded attempts, not a general ranking. See the
[run database notes](docs/landing-design.md) for sources and limits.

The CLI's bundled examples and the separate public workbench demo use invented
models, tasks, and measurements. They demonstrate the interface and are **not
benchmark evidence**. Existing npm versions are separate release artifacts and
may contain earlier example data.

Open your own normalized JSON export or raw Harbor job:

```sh
openeval open ./results.json
openeval open ./jobs/my-run
```

Studio supports chart recipes, editable presentation settings, trial inspection,
project/bundle import and export, and neutral White and Black presentation themes.
The public source includes no corporate branding or licensed presentation fonts.

## Develop locally

Install Bun 1.4 or newer, then:

```sh
bun install --frozen-lockfile
bun run dev
```

Use `bun run studio:local` for the Bun-backed local workbench. Real evaluations
require the worker prerequisites above and provider configuration. See
[Deployment](docs/deployment.md) for hosted application configuration and
[Architecture](docs/architecture.md) for component boundaries.

Useful checks:

```sh
bun run lint
bun run build
bun run test:unit
bun run test:backend
bun run cli:test
bun run test:server
bun run test:e2e
```

Default CI checks the build, functional browser flows, installed CLI, and a real
local Convex-to-worker evaluation without model calls. The manual
[Release checks workflow](.github/workflows/release-checks.yml) covers the
installer platform matrix and deployment variants.

## Export reports and presentations

```sh
bun run report /path/to/harbor-job
bun run report results/harbor/demo-evaluation.json
bun run poster results/harbor/demo-evaluation.json
bun run thread results/harbor/demo-evaluation.json harbor/report/thread-demo.json
```

Exporting existing results makes no model calls. The JSON in these example
commands is synthetic. See [the exporter guide](harbor/report/README.md) and
[hosted presentation exports](docs/hosted-presentation-exports.md).

## Documentation

- [Connected runners](docs/connected-runners.md)
- [Current evaluation flow](docs/current-evaluation-flow.md)
- [Provider connections](docs/provider-connections.md)
- [Reports and sharing](docs/hosted-reports.md)
- [Task comparisons, recorded timelines and visual evidence](docs/run-inspection.md)
- [Reproducing evaluations](docs/reproducing-evaluations.md)
- [Publishing the CLI](docs/publishing-cli.md)
- [Design system](docs/design-system.md)

OpenEval is licensed under the [Apache License 2.0](LICENSE). Third-party
dependencies and assets, including the harness marks listed in
`public/harnesses/SOURCES.md`, keep their own licenses and trademarks. Harbor is
installed separately.
