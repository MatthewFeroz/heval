#!/bin/sh
set -eu
# Give the browser enough time to show and cancel the setup check.
sleep 8
printf 'hello from heval\n' > /app/hello.txt
