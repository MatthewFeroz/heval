# Current evaluation flow

Heval coordinates evaluations from the browser. A connected Linux runner executes
Harbor and Docker on a worker controlled by the user. Provider credentials stay
on the worker; profile metadata and normalized reports are stored online.

1. Install the CLI, Harbor 0.23.0, and Docker Engine with Compose on Linux.
2. Sign in to Heval, create a pairing code in Machines, and connect the worker.
3. Keep `heval runner start` running and execute the no-model setup check.
4. Connect a provider on the worker. Merge Gateway remains supported through
   `heval provider connect merge` and `heval provider status merge`.
5. Create approved profiles with `heval runner setup`, or configure explicit
   local Harbor tasks as described in the connected-runner guide.
6. Select the worker, task set, harnesses, models, vendor, and attempts in
   Evaluations. Starting uses the worker's compute and model credentials.
7. Follow progress and inspect the saved report. Publish a report only when ready.

Read [Connected runners](connected-runners.md) for commands, requirements,
profile constraints, recovery, and Linux service setup. Read
[Provider connections](provider-connections.md) for the separate local Bun
workbench's provider flow.

The public example exports contain synthetic data, not benchmark evidence.
The browser does not provision a worker automatically or run Harbor itself.
The connected runner requires Linux; a browser may run on another OS.
