# Heval working instructions

## Public release boundary

- Publish Heval functionality without importing private development history,
  personal setup notes, private evaluation results, or unpublished research.
- Keep the public Studio's neutral design. Do not import Merge-specific logos,
  themes, palettes, licensed presentation fonts, or private Studio design changes.
  Merge Gateway provider integration and factual model/pricing data are allowed.
- Keep public synthetic examples labeled as demonstrations. Review selected
  source changes in a separate public checkout and validate that artifact before
  merging; do not merge a private repository branch directly into public history.
- Default CI checks observable functionality and the real connected-worker path.
  Do not add font, spacing, logo-count, or animation-timing assertions.

## Starting new work

- Before starting a new project, task, or worktree, ask the user whether it is
  worth refreshing remote references and fast-forwarding from `main`. Do not
  let a newly created worktree silently start from an older local base.

## Architecture and documentation

- The connected Heval runner requires Linux. Describe its requirements from the
  implementation and connected-runner documentation.
- Keep product architecture independent of a developer's personal machine,
  virtualization setup, filesystem paths, and administration credentials.
- Treat historical deployment checks as dated evidence, not current runtime
  state. Recheck available resources before installations or evaluations.
