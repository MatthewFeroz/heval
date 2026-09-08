FROM oven/bun:1.4.0 AS bun
FROM node:22-bookworm-slim
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates ripgrep \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @openai/codex@0.151.0 @anthropic-ai/claude-code@2.1.251 opencode-ai@1.18.25 @earendil-works/pi-coding-agent@0.84.4
COPY server/worker /opt/heval/worker
COPY server/types.ts /opt/heval/types.ts
COPY fixtures/concurrent-cache /opt/heval/fixture
RUN mkdir /workspace && chown node:node /workspace
USER node
WORKDIR /workspace
ENTRYPOINT ["bun", "/opt/heval/worker/main.ts"]
