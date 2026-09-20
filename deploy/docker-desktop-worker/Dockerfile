# Harbor/runner run on Linux; task containers are siblings on Docker Desktop.
FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS node
FROM docker:29-cli@sha256:9f36dfce2d1fd053d700a4eca00c358df79bf7d8cb69d4a9e8d9981af18834ea AS docker
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS bun
FROM python:3.12-bookworm@sha256:581429e3df12d76e6af4be5ab7d0e7fc2013eb57dc23d2de691411c8efdbb970
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN pip install --no-cache-dir 'harbor==0.23.0'
ENV HARBOR_TELEMETRY=0
CMD ["sleep", "infinity"]
