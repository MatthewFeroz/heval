# Merge Gateway evaluation proxy

Run the proxy with the repository's pinned Bun version. The harness sends its
existing provider credentials through the proxy to Merge Gateway; the proxy does
not store them in its request logs.

```sh
bun harbor/proxy/vendor-proxy.ts \
  --vendor VENDOR --only-model MODEL_SLUG \
  --reject-hosted-tools \
  --rates rates.json --budget-usd 10 \
  --log results/proxy/model.jsonl
```

Use `--pins FILE` for per-model vendors, optionally with a `--vendor` fallback.
Pins and rates match the bare model name because some harnesses remove the
provider prefix. A rates file contains USD prices per million tokens:

```json
{
  "MODEL_SLUG": { "input": 1, "cacheRead": 0.1, "cacheWrite": 1.25, "output": 2 }
}
```

With a model, tool, or budget restriction enabled, write requests are limited to
chat completions, completions, Responses, Messages, and embeddings. Other write
endpoints return 403; malformed model requests return 400. `--only-model`
requires both the selected model and its configured vendor. Hosted tool
declarations return 400 when `--reject-hosted-tools` is enabled.

Responses stream through unchanged. The JSONL record includes reported token
usage, reported cost when available, and an estimate from the rate card. Complete
usage received before a reset or cancellation is retained with `usageError`.
Unreadable or invalid spending records and unavailable accounting logs refuse
new budgeted requests with 503. After a log-write failure, restart the proxy
after restoring the log path.

The budget sums estimates across every `.jsonl` in `--spend-dir`, which defaults
to the log's directory. Each budgeted model needs a rate card. Once recorded
estimates reach the limit, subsequent requests return 402. This is an estimated
spend gate: concurrent requests already in flight can overshoot, and responses
without usage cannot be priced. Missing usage remains missing in the logs.

Run the local HTTP regression suite with `bun run test:proxy`. It exercises a
mock upstream and does not make paid model calls.
