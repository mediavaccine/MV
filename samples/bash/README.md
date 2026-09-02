# Bash sample — log summarizer

`summarize-logs.sh` reads a plain text log and reports severity counts, the
busiest hours, and the most repeated messages. It only reads: the input file
is never modified.

## Usage

```bash
./summarize-logs.sh example.log
./summarize-logs.sh --top 5 example.log
cat example.log | ./summarize-logs.sh -
./summarize-logs.sh --help
```

```
$ ./summarize-logs.sh --top 3 example.log
Lines analysed: 12

By severity:
       1  DEBUG
       5  INFO
       2  WARN
       4  ERROR

Busiest hours:
       4  10:00
       3  11:00
       3  09:00
       2  12:00

Top 3 messages:
       4  ERROR Upstream timeout
       2  WARN Slow query detected
       2  INFO Health check ok
```

Timestamps are stripped before grouping, so the same event logged at different
times counts as one message.

Exit codes: `0` on success, `1` on an unreadable file or bad option, `2` when
no input is given.

## Points of interest

- `set -euo pipefail` up front, with every expansion quoted.
- Input is copied to a `mktemp` file so that a file argument and piped stdin
  take exactly the same code path, and so the data can be scanned more than
  once.
- The `EXIT` trap uses a script-level variable rather than a `local` one — a
  `local` would be out of scope by the time the trap fires. The trap also ends
  on a construct that always succeeds, because an `EXIT` trap's final status
  becomes the script's exit status.
- `--top` validates its argument with a regex before use.
