# Connected Harbor runners

Build an outbound connection between hosted Heval and a user-operated Linux machine or cloud VM. The browser owns configuration/review; Convex persists machine ownership, a durable queue, status, and results; Harbor owns task execution in Docker. No inbound port or remote Docker socket is exposed.

## First release

- Pair a machine with a short-lived, single-use code created by a signed-in owner. Exchange it for a random runner credential, stored locally with restricted permissions; only its digest is stored in Convex.
- Advertise locally approved profiles, starting with one bundled Oracle setup task. Profiles describe the benchmark, agent/model, exact task and attempt count. Arbitrary browser-provided commands, paths and credentials are not accepted.
- Queue to a specific machine with one active run per runner. A claim is durable and idempotent. Losing a heartbeat never automatically reruns work or moves it to another machine.
- A separately supervised Harbor process writes results to a persistent local run directory. Restarting the polling daemon reconciles that directory instead of starting another attempt. Browser sessions can disconnect independently.
- Save sanitized results as an ordinary private report, linking execution to the existing Studio → publish → share workflow. Keep raw Harbor logs on the runner.
- Cancel cooperatively; report pending cancellation honestly until the runner acknowledges cleanup. Revoke machine access immediately in the control plane; disconnected physical processes cannot be guaranteed stopped remotely.
- Demonstrate two independently paired runner instances and two browser sessions. This simulates the network protocol on one physical Linux host; it does not claim live migration between physical machines.

## Validation

Test owner/runner authorization, code redemption, concurrent claims, idempotent enqueue/completion, cancellation, reconnect/restart, revoked credentials, stale profile rejection, and result import. Exercise real Harbor + Docker through an isolated Convex deployment and browser, with no paid model calls. Include CLI packaging and deployment route checks.

## Deferred

Provider VM provisioning, fleet scheduling, live container migration, shared provider credentials, team-wide execution permissions, and untrusted public multi-tenant workers. A cloud VM can run the same daemon; its owner provisions and funds it.
