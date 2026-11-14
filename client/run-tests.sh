#!/usr/bin/env bash
# Run the React-Native component tests (jest-expo) for the mobile client.
# These verify rendering behavior that the tsx-based logic tests can't cover
# (they cannot import react-native). Usage: bash client/run-tests.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# Stabile API-Basis fuer getApiUrl() im Test (sonst Manifest-Fallback).
export EXPO_PUBLIC_DOMAIN="${EXPO_PUBLIC_DOMAIN:-https://example.replit.app}"

npx jest --silent "$@"
