# MV

Sample code for this repository — small, self-contained programs that run as
they are, each with tests or a worked example.

Nothing here depends on a network service or on a package registry beyond the
test runners themselves, so every sample can be run immediately after cloning.

## What's here

| Sample | Language | What it shows |
| --- | --- | --- |
| [`samples/python/wordfreq.py`](samples/python/wordfreq.py) | Python 3.9+ | Text tokenizing and word counting, exposed both as a library and as an `argparse` CLI, with a pytest suite. |
| [`samples/javascript/task-queue.js`](samples/javascript/task-queue.js) | Node 18+ | A promise queue with a concurrency limit, written with private class fields and covered by `node --test`. |
| [`samples/bash/summarize-logs.sh`](samples/bash/summarize-logs.sh) | Bash 4+ | A defensive shell script: strict mode, option parsing, temp-file cleanup via an `EXIT` trap, and text processing with the standard toolchain. |

## Running everything

```bash
# Python
cd samples/python && python3 -m pytest tests

# JavaScript
cd samples/javascript && npm test

# Bash
bash samples/bash/summarize-logs.sh samples/bash/example.log
```

Each sample directory has its own README with usage details.

## Layout

```
samples/
├── python/
│   ├── wordfreq.py
│   └── tests/test_wordfreq.py
├── javascript/
│   ├── task-queue.js
│   ├── package.json
│   └── test/task-queue.test.js
└── bash/
    ├── summarize-logs.sh
    └── example.log
```

## Adding a sample

Keep new samples in the spirit of the existing ones:

1. One idea per sample, small enough to read in a sitting.
2. No runtime dependencies where the standard library will do.
3. Tests, or a runnable example with expected output.
4. A short README entry explaining what the sample demonstrates.
