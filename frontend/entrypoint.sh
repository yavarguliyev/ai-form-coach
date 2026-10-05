#!/bin/sh
# node_modules lives in an anonymous volume that docker compose keeps across rebuilds,
# so reinstall when package-lock.json no longer matches what was installed.
set -e
if ! sha256sum -c node_modules/.lock-hash >/dev/null 2>&1; then
  echo "package-lock.json changed — running npm ci"
  npm ci
  sha256sum package-lock.json > node_modules/.lock-hash
fi
exec npx vite --host 0.0.0.0 --port 5180 --strictPort
