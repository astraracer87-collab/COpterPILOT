#!/usr/bin/env bash
# Run automated tests for the web app's flight execution flow.
# Usage: bash web/run-tests.sh
set -euo pipefail
cd "$(dirname "$0")/.."

FAILED=0
for f in web/src/lib/__tests__/*.test.ts; do
  echo "▶ $f"
  if ! npx tsx "$f"; then
    FAILED=1
  fi
done

exit "$FAILED"
