#!/usr/bin/env bash
#
# Apply the migrations and seed to a throwaway Postgres cluster, then run
# supabase/tests/verify.sql against it. Nothing here touches a hosted project.
#
# Usage:
#   supabase/tests/run-local.sh
#
# Requires the Postgres server binaries (initdb, pg_ctl) and psql. On Debian or
# Ubuntu: apt-get install postgresql postgresql-client

set -euo pipefail

readonly PROGRAM_NAME=${0##*/}
readonly SQL_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
readonly PORT=${MV_TEST_PGPORT:-55432}

CLUSTER=""

cleanup() {
  if [[ -n ${CLUSTER} ]]; then
    pg_ctl -D "${CLUSTER}/pgdata" -m immediate stop >/dev/null 2>&1 || true
    rm -rf "${CLUSTER}"
  fi
}
trap cleanup EXIT

die() {
  printf '%s: %s\n' "${PROGRAM_NAME}" "$1" >&2
  exit 1
}

# initdb and pg_ctl are not on PATH in the Debian/Ubuntu packaging.
locate_binaries() {
  if command -v initdb >/dev/null 2>&1 && command -v pg_ctl >/dev/null 2>&1; then
    return
  fi
  local candidate
  candidate=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -n 1 || true)
  [[ -n ${candidate} ]] || die "could not find initdb/pg_ctl; install the postgresql server package"
  PATH="${candidate}:${PATH}"
  export PATH
}

main() {
  locate_binaries
  command -v psql >/dev/null 2>&1 || die "psql not found"

  # Postgres refuses to run as root, so hand the cluster to an unprivileged
  # user when that is who we are.
  if [[ $(id -u) -eq 0 ]]; then
    die "run as a non-root user (Postgres refuses to start as root)"
  fi

  CLUSTER=$(mktemp -d)
  mkdir -p "${CLUSTER}/pgdata" "${CLUSTER}/run"

  printf 'Initialising a throwaway cluster...\n'
  initdb -D "${CLUSTER}/pgdata" -U postgres --auth=trust >"${CLUSTER}/initdb.log" 2>&1 \
    || { cat "${CLUSTER}/initdb.log"; die "initdb failed"; }

  pg_ctl -D "${CLUSTER}/pgdata" \
         -o "-p ${PORT} -k ${CLUSTER}/run -h ''" \
         -l "${CLUSTER}/postgres.log" start >/dev/null \
    || { cat "${CLUSTER}/postgres.log"; die "could not start Postgres"; }

  export PGHOST="${CLUSTER}/run" PGPORT="${PORT}" PGUSER=postgres

  printf 'Applying the local Supabase stub...\n'
  psql -q -v ON_ERROR_STOP=1 -f "${SQL_DIR}/tests/local_supabase_stub.sql"

  printf 'Applying migrations...\n'
  for migration in "${SQL_DIR}"/migrations/*.sql; do
    printf '  %s\n' "$(basename "${migration}")"
    psql -q -v ON_ERROR_STOP=1 -f "${migration}"
  done

  printf 'Applying seed...\n'
  psql -q -v ON_ERROR_STOP=1 -f "${SQL_DIR}/seed.sql"

  printf 'Running checks...\n'
  psql -q -v ON_ERROR_STOP=1 -f "${SQL_DIR}/tests/verify.sql"
}

main "$@"
