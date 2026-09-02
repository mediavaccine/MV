"""Word frequency analysis for plain text.

Usable as a library or as a command line tool:

    $ python wordfreq.py sample.txt --top 5
    $ echo "the quick brown fox" | python wordfreq.py - --top 2
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from typing import Iterable, Iterator

WORD_RE = re.compile(r"[a-z0-9']+")

# A deliberately small stop list; enough to show the option off without
# pretending to be a real NLP resource.
DEFAULT_STOP_WORDS = frozenset(
    """
    a an and are as at be by for from has he in is it its of on that the
    to was were will with
    """.split()
)


def tokenize(text: str) -> Iterator[str]:
    """Yield lowercase word tokens from ``text``.

    Apostrophes are kept inside words ("don't") but stripped from the edges
    so that quoted text does not create distinct tokens.
    """
    for match in WORD_RE.finditer(text.lower()):
        token = match.group().strip("'")
        if token:
            yield token


def count_words(text: str, stop_words: Iterable[str] = ()) -> Counter[str]:
    """Return a :class:`Counter` of the words in ``text``."""
    ignored = frozenset(stop_words)
    return Counter(token for token in tokenize(text) if token not in ignored)


def top_words(
    text: str, limit: int = 10, stop_words: Iterable[str] = ()
) -> list[tuple[str, int]]:
    """Return the ``limit`` most common words, ties broken alphabetically."""
    counts = count_words(text, stop_words)
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    return ranked[:limit]


def format_report(results: list[tuple[str, int]]) -> str:
    """Render ``results`` as an aligned two column table."""
    if not results:
        return "(no words found)"
    width = max(len(word) for word, _ in results)
    return "\n".join(f"{word:<{width}}  {count}" for word, count in results)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "path",
        help="file to analyse, or '-' to read from standard input",
    )
    parser.add_argument(
        "--top",
        type=int,
        default=10,
        help="how many words to report (default: %(default)s)",
    )
    parser.add_argument(
        "--keep-stop-words",
        action="store_true",
        help="include common words such as 'the' and 'and'",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    if args.path == "-":
        text = sys.stdin.read()
    else:
        try:
            with open(args.path, encoding="utf-8") as handle:
                text = handle.read()
        except OSError as error:
            print(f"error: {error}", file=sys.stderr)
            return 1

    stop_words = () if args.keep_stop_words else DEFAULT_STOP_WORDS
    print(format_report(top_words(text, args.top, stop_words)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
