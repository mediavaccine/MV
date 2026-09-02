# Python sample — word frequency

`wordfreq.py` counts words in plain text. It is written to be useful in two
ways: import it as a module, or run it as a command line tool.

## Library use

```python
from wordfreq import DEFAULT_STOP_WORDS, count_words, top_words

count_words("the cat and the hat")           # Counter({'the': 2, 'cat': 1, 'and': 1, 'hat': 1})
top_words("the cat and the hat", limit=2, stop_words=DEFAULT_STOP_WORDS)
# [('cat', 1), ('hat', 1)]
```

Ties are broken alphabetically, so results are stable across runs.

## Command line use

```bash
python3 wordfreq.py essay.txt --top 5
python3 wordfreq.py essay.txt --top 5 --keep-stop-words
cat essay.txt | python3 wordfreq.py - --top 5
```

```
$ printf 'the quick brown fox jumps over the lazy dog\nthe dog barks\n' | python3 wordfreq.py - --top 3
dog    2
barks  1
brown  1
```

Exit codes: `0` on success, `1` if the input file cannot be read.

## Tests

```bash
python3 -m pytest tests
```

Requires `pytest` (`python3 -m pip install pytest`); the sample itself uses
only the standard library.

## Points of interest

- `tokenize` is a generator, so large files stream instead of building an
  intermediate word list.
- `main` takes an optional `argv`, which is what lets the tests drive the CLI
  in-process rather than spawning subprocesses.
- Formatting is separated from counting (`format_report` vs `top_words`), so
  the analysis functions stay usable from other code.
