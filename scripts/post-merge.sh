#!/bin/bash
set -e
npm install --legacy-peer-deps --prefer-offline --no-audit --no-fund 2>&1 || true
# IMPORTANT: do NOT clear node_modules/.vite here.
# Wiping the optimized-deps cache forces Vite to regenerate every ?v=hash on
# the next request, which invalidates any in-flight browser tab and causes
# "504 Outdated Optimize Dep" white-page bugs. Vite re-optimizes on its own
# only when the actual dependency content changes; let it decide.
echo "Post-merge setup complete"
