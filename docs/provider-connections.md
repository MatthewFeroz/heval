# Provider connections

Open the evaluation workbench, sign in, and choose **Provider settings**.

1. **Connect provider.** Select Merge Gateway and paste a Gateway key into the masked field. Heval does not save the field in browser storage.
2. **Validate connection.** Choose **Validate and connect**. Heval checks the live model catalog without making model calls. An invalid key gets an authentication error. A working key is encrypted on the server and its tool-capable models appear in Settings.
3. **Configure and run.** Choose an available, server-approved model, Pi Agent, the async-cache task, and a time limit. The instance enforces its invitation, concurrency, daily-attempt and time limits. Open completed results in Studio.
4. **Manage connection.** Settings supports revalidation, replacement and deletion. Failed replacement preserves the previous connection. Successful replacement stops current runs; future runs use the new key. Deletion stops current runs and removes the stored connection, while keeping evaluation results. Revoking the key itself is a separate action in Merge Gateway.

Keys are scoped to the signed-in account. API responses expose connection status, model IDs and validation time. Server-side AES-256-GCM encryption binds ciphertext to the account ID. A temporary run token lets the worker call the inference proxy without receiving the provider key. Tokens are tied to one model and deadline, permit one request at a time and at most 40 requests, and cap each response at 8192 output tokens. Heval does not yet measure exact spending, so use provider-side spending limits too.

The current release supports Merge Gateway and Pi for browser BYOK. The task picker contains the pinned async-cache fixture. Model choices are the intersection of the validated catalog and `HEVAL_ALLOWED_MODELS`. The interface reports when this intersection is empty. Other harnesses remain available through the trusted CLI adapters.

## Local setup

Configure WorkOS for browser sign-in and set `HEVAL_ENABLE_RUNNER=1`. The existing `.env.local` Gateway key remains usable by `bun run demo:nvidia`; browser users connect their own key in Settings. Heval does not copy an operator key into a signed-in account.

Local startup creates `data/connection-encryption.key` with file mode 0600 unless `HEVAL_CONNECTION_ENCRYPTION_KEY` is supplied. The database is also mode 0600. Both live in the Git-ignored data directory. For production, use the explicit environment secret and separate backups described in [deployment](deployment.md).

For Docker Desktop, the worker calls `http://host.docker.internal:4173/api/inference` by default. The Bun server must listen on an interface reachable from Docker, such as `HOST=0.0.0.0` on a trusted local network. `HEVAL_INFERENCE_PROXY_URL` can override the local address. Hosted mode always uses the configured HTTPS public origin. Rebuild `bun run worker:build` after updating the worker adapter.

The two-model `bun run demo:nvidia --run` command starts a temporary proxy automatically, so it can run locally without WorkOS. Results remain private until explicitly staged for publication.
