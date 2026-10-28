#!/bin/sh
set -eu
if ! docker info >/dev/null 2>&1; then
  dockerd --host=unix:///var/run/docker.sock --group=heval >/var/log/heval-docker.log 2>&1 &
fi
attempt=0
until docker info >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 60 ] || exit 1
  sleep 1
done
exec sleep infinity
