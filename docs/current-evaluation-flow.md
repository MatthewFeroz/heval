# Current evaluation flow

OpenEval coordinates evaluations from the browser. A connected Linux runner executes
Harbor and Docker on a worker controlled by the user. Provider credentials stay
on the worker; profile metadata and normalized reports are stored online.

1. Install the CLI, Harbor 0.24.0, and Docker
   Engine with Compose on Linux.
2. Sign in to OpenEval with Clerk, open Settings, and connect the worker.
3. Keep `openeval runner start` running and execute the no-model setup check.
4. Connect a provider on the worker. Merge Gateway remains supported through
   `openeval provider connect merge` and `openeval provider status merge`.
5. Create approved profiles with `openeval runner setup`, or configure explicit
   local Harbor tasks as described in the connected-runner guide.
6. Open Library and choose New comparison. Compare harnesses or models on a
   fixed task snapshot, or choose Custom experiment for a larger matrix,
   attempts and resource controls. Starting uses the selected worker's compute
   and model credentials.
7. Follow progress from the comparison's Library entry. Open Results to inspect
   trials and evidence, Analyze to edit charts, Export for files and
   presentations, and Share for team access or public links. Chart drafts stay
   available when switching sections. Save before publishing; evidence needs
   its own explicit review and publication.

Import existing normalized Harbor results from Library to use the same result
workspace. Baselines attach to completed guided comparisons; choose Compare
against baseline to start a repeat. Explore contains the approved published run
database and is accessible without sign-in.

Read [Connected runners](connected-runners.md) for commands, requirements,
profile constraints, recovery, and Linux service setup. Read
[Provider connections](provider-connections.md) for the separate local Bun
workbench's provider flow. See [Clerk sign-in setup and account migration](clerk-auth.md)
for the canonical workspace origin, JWT template and preserved ownership during cutover.

Connected onboarding, reconnect and cancellation were rechecked locally on
2026-10-03 with Harbor 0.23.0. That describes implemented code, not a guarantee
that a hosted deployment runs this revision.

The public example exports contain synthetic data, not benchmark evidence.
The connected path does not provision a worker automatically or run Harbor in
the browser. The optional managed beta provisions isolated Linux VMs through a
coordinator; see [managed comparisons](managed-comparisons.md) for configuration
and required cloud acceptance. It stays disabled until configured.
The connected runner requires Linux; a browser may run on another OS.
