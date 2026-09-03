#!/usr/bin/env bash
#
# Assemble both apps into dist/ for Netlify.
#
#   dist/                 the kiosk, served at /
#   dist/shared/          shared modules, imported by the kiosk
#   dist/admin/           the control center, served at /admin/
#   dist/admin/shared/    the same modules, imported by the admin app
#
# The shared package is copied rather than referenced, because a publish
# directory cannot import from outside itself. Copying twice keeps both apps
# self-contained with no bundler and no import-map juggling.

set -euo pipefail

readonly ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
readonly OUT="${ROOT}/dist"

printf 'Building into %s\n' "${OUT}"

rm -rf "${OUT}"
mkdir -p "${OUT}/shared" "${OUT}/admin/shared"

# Kiosk at the root.
cp "${ROOT}"/apps/kiosk/*.html "${ROOT}"/apps/kiosk/*.css "${ROOT}"/apps/kiosk/*.js "${OUT}/"
cp "${ROOT}"/apps/kiosk/manifest.webmanifest "${OUT}/"
rm -f "${OUT}/README.md"

# Admin under /admin, preserving its views/ subdirectory.
cp -R "${ROOT}"/apps/admin/. "${OUT}/admin/"
rm -f "${OUT}/admin/README.md"

# Shared modules, once per app.
cp "${ROOT}"/packages/shared/*.js "${OUT}/shared/"
cp "${ROOT}"/packages/shared/*.js "${OUT}/admin/shared/"

# A stray test directory would be published verbatim.
rm -rf "${OUT}/shared/test" "${OUT}/admin/shared/test"

printf 'Built:\n'
find "${OUT}" -type f | sed "s|${OUT}|  dist|" | sort
