#!/bin/sh
set -eu

if [ "${ZLB_PROCESS:-}" = "attachment-scan" ]; then
  if [ "${FILE_SCAN_PROVIDER:-}" != "clamav" ] \
    || [ "${CLAMAV_HOST:-}" != "127.0.0.1" ] \
    || [ "${CLAMAV_PORT:-}" != "3310" ]; then
    echo "Attachment scan runtime requires its private ClamAV sidecar." >&2
    exit 78
  fi

  mkdir -p /run/clamav
  chown clamav:clamav /run/clamav /var/lib/clamav
  clamd --config-file=/etc/clamav/clamd.conf &
  clamd_pid=$!
  ready=0
  for _attempt in $(seq 1 60); do
    if nc -z 127.0.0.1 3310; then
      ready=1
      break
    fi
    if ! kill -0 "$clamd_pid" 2>/dev/null; then
      echo "ClamAV exited before becoming ready." >&2
      exit 1
    fi
    sleep 1
  done
  if [ "$ready" -ne 1 ]; then
    echo "ClamAV did not become ready on private TCP 3310." >&2
    exit 1
  fi
fi

exec su-exec nextjs node worker-dist/runtime-entrypoint.js
