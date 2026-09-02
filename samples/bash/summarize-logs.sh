#!/usr/bin/env bash
#
# Summarize a plain text log file: line counts by severity, the busiest
# hours, and the most frequent messages.
#
# Usage:
#   ./summarize-logs.sh app.log
#   ./summarize-logs.sh --top 5 app.log
#   cat app.log | ./summarize-logs.sh -
#
# The script only reads; it never modifies the file it is given.

set -euo pipefail

readonly PROGRAM_NAME=${0##*/}
readonly SEVERITIES=(TRACE DEBUG INFO WARN WARNING ERROR FATAL)

# Global so the EXIT trap can still see it after main() returns.
WORKFILE=""

cleanup() {
  # An EXIT trap's final status becomes the script's, so keep this a
  # construct that always succeeds.
  if [[ -n ${WORKFILE} ]]; then
    rm -f -- "${WORKFILE}"
  fi
}
trap cleanup EXIT

usage() {
  cat <<USAGE
Usage: ${PROGRAM_NAME} [--top N] <logfile|->

  --top N   how many frequent messages to list (default: 10)
  -h,--help show this help
USAGE
}

die() {
  printf '%s: %s\n' "${PROGRAM_NAME}" "$1" >&2
  exit 1
}

# Print "<count> <severity>" for every severity that appears in the log.
count_severities() {
  local file=$1 severity count
  for severity in "${SEVERITIES[@]}"; do
    count=$(grep -c -w -- "${severity}" "${file}" || true)
    if (( count > 0 )); then
      printf '%8d  %s\n' "${count}" "${severity}"
    fi
  done
}

# Group lines by the HH portion of any HH:MM:SS timestamp they contain.
count_by_hour() {
  local file=$1
  grep -oE '[0-2][0-9]:[0-5][0-9]:[0-5][0-9]' "${file}" \
    | cut -d: -f1 \
    | sort \
    | uniq -c \
    | sort -rn \
    | head -n 5 \
    | awk '{ printf "%8d  %s:00\n", $1, $2 }'
}

# Most repeated lines, with timestamps stripped so that identical events
# logged at different times group together.
frequent_messages() {
  local file=$1 limit=$2
  sed -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2}[T ]?//g; s/[0-2][0-9]:[0-5][0-9]:[0-5][0-9](\.[0-9]+)?//g' "${file}" \
    | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' \
    | grep -v '^$' \
    | sort \
    | uniq -c \
    | sort -rn \
    | head -n "${limit}" \
    | awk '{ count = $1; $1 = ""; sub(/^ /, ""); printf "%8d  %s\n", count, $0 }'
}

main() {
  local top=10 source=""

  while (( $# > 0 )); do
    case $1 in
      -h|--help) usage; return 0 ;;
      --top)
        [[ ${2-} =~ ^[0-9]+$ ]] || die "--top requires a number"
        top=$2
        shift 2
        ;;
      -)  source=$1; shift ;;
      -*) die "unknown option: $1" ;;
      *)  source=$1; shift ;;
    esac
  done

  [[ -n ${source} ]] || { usage >&2; return 2; }

  # Work from a temporary copy so stdin and files take the same code path
  # and so multi-pass analysis is possible on a stream.
  WORKFILE=$(mktemp)

  if [[ ${source} == "-" ]]; then
    cat > "${WORKFILE}"
  else
    [[ -r ${source} ]] || die "cannot read ${source}"
    cat -- "${source}" > "${WORKFILE}"
  fi

  printf 'Lines analysed: %d\n\n' "$(wc -l < "${WORKFILE}")"

  printf 'By severity:\n'
  local severity_report
  severity_report=$(count_severities "${WORKFILE}")
  printf '%s\n\n' "${severity_report:-  (none found)}"

  printf 'Busiest hours:\n'
  local hour_report
  hour_report=$(count_by_hour "${WORKFILE}")
  printf '%s\n\n' "${hour_report:-  (no timestamps found)}"

  printf 'Top %d messages:\n' "${top}"
  frequent_messages "${WORKFILE}" "${top}"
}

main "$@"
