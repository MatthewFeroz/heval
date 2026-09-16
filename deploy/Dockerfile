FROM oven/bun:1.4.0 AS bun
FROM docker:28-cli AS dockercli
FROM node:22-bookworm-slim
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssh-client ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
RUN bun x playwright install --with-deps chromium
COPY . .
ARG VITE_WORKOS_CLIENT_ID
ARG VITE_WORKOS_API_HOSTNAME
ENV VITE_WORKOS_CLIENT_ID=$VITE_WORKOS_CLIENT_ID VITE_WORKOS_API_HOSTNAME=$VITE_WORKOS_API_HOSTNAME
RUN bun run build:public
ENV HOST=0.0.0.0 PORT=4173 HEVAL_DATA_DIR=/data
RUN mkdir /data && chown node:node /data && cp -a /root/.cache /home/node/.cache && chown -R node:node /home/node/.cache
USER node
EXPOSE 4173
CMD ["bun", "server/index.ts"]
