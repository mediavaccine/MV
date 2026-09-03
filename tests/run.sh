#!/usr/bin/env bash
#
# Build the apps and run both browser suites against local mocks of Supabase.
#
#   tests/run.sh            both suites
#   tests/run.sh kiosk      just the kiosk
#   tests/run.sh admin      just the control center
#
# Needs Node 18+, Python 3 and Playwright's Chromium. Set MV_CHROMIUM if the
# browser is not at /opt/pw-browsers/chromium.

set -euo pipefail

readonly ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
readonly KIOSK_PORT=${MV_KIOSK_PORT:-8898}
readonly ADMIN_PORT=${MV_ADMIN_PORT:-8897}
readonly WHICH=${1:-all}

PIDS=()

cleanup() {
  for pid in "${PIDS[@]:-}"; do
    [[ -n ${pid} ]] && kill "${pid}" 2>/dev/null || true
  done
}
trap cleanup EXIT

wait_for() {
  local url=$1
  for _ in $(seq 1 50); do
    if curl -sS --max-time 2 "${url}" >/dev/null 2>&1; then return 0; fi
    sleep 0.2
  done
  printf 'timed out waiting for %s\n' "${url}" >&2
  return 1
}

printf 'Building…\n'
bash "${ROOT}/scripts/build.sh" >/dev/null

if [[ ! -d ${ROOT}/node_modules/playwright ]]; then
  printf 'Installing Playwright…\n'
  (cd "${ROOT}" && npm install --no-audit --no-fund --silent playwright)
fi

status=0

if [[ ${WHICH} == all || ${WHICH} == kiosk ]]; then
  printf '\n== Kiosk ==\n'
  python3 "${ROOT}/tests/fixtures/kiosk_mock.py" "${KIOSK_PORT}" "${ROOT}/tests/fixtures/payload.json" &
  PIDS+=($!)
  wait_for "http://127.0.0.1:${KIOSK_PORT}/__reset"
  MV_TEST_BASE="http://127.0.0.1:${KIOSK_PORT}" node "${ROOT}/tests/browser/kiosk.test.js" || status=1
fi

if [[ ${WHICH} == all || ${WHICH} == admin ]]; then
  printf '\n== Control Center ==\n'
  python3 "${ROOT}/tests/fixtures/admin_mock.py" "${ADMIN_PORT}" &
  PIDS+=($!)
  wait_for "http://127.0.0.1:${ADMIN_PORT}/__reset"
  MV_TEST_BASE="http://127.0.0.1:${ADMIN_PORT}" node "${ROOT}/tests/browser/admin.test.js" || status=1
fi

exit "${status}"
