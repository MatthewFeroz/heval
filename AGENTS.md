# Heval working instructions

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
