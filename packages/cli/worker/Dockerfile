# The same Linux runtime on Linux, Docker Desktop, and WSL. Release digests
# are multi-platform indexes; npm's installed artifact supplies the application.
FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS node
FROM docker:29-cli@sha256:9f36dfce2d1fd053d700a4eca00c358df79bf7d8cb69d4a9e8d9981af18834ea AS docker
FROM python:3.12-bookworm@sha256:581429e3df12d76e6af4be5ab7d0e7fc2013eb57dc23d2de691411c8efdbb970
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
COPY dist/worker/requirements.txt /opt/heval-requirements.txt
RUN pip install --no-cache-dir -r /opt/heval-requirements.txt && pip check && useradd --create-home --uid 1000 heval
COPY package.json /opt/heval/package.json
COPY dist /opt/heval/dist
ENV HARBOR_TELEMETRY=0 HOME=/home/heval
# Setup supplies the socket's group and a pre-owned volume. No privileged
# container, host network, published ports, or root evaluation process.
USER 1000:1000
ENTRYPOINT ["node", "/opt/heval/dist/setup-worker.js"]
