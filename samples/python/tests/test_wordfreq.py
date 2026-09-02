import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from wordfreq import (  # noqa: E402
    DEFAULT_STOP_WORDS,
    count_words,
    format_report,
    main,
    tokenize,
    top_words,
)


def test_tokenize_lowercases_and_splits_on_punctuation():
    assert list(tokenize("Hello, world! Hello?")) == ["hello", "world", "hello"]


def test_tokenize_keeps_internal_apostrophes():
    assert list(tokenize("don't 'quoted'")) == ["don't", "quoted"]


def test_count_words_counts_repeats():
    assert count_words("a b a c a")["a"] == 3


def test_count_words_honours_stop_words():
    counts = count_words("the cat and the hat", DEFAULT_STOP_WORDS)
    assert "the" not in counts
    assert counts == {"cat": 1, "hat": 1}


def test_top_words_breaks_ties_alphabetically():
    assert top_words("pear apple apple fig") == [("apple", 2), ("fig", 1), ("pear", 1)]


def test_top_words_respects_limit():
    assert top_words("one two three four", limit=2) == [("four", 1), ("one", 1)]


def test_format_report_aligns_columns():
    assert format_report([("apple", 2), ("fig", 1)]) == "apple  2\nfig    1"


def test_format_report_handles_empty_input():
    assert format_report([]) == "(no words found)"


def test_main_reads_a_file(tmp_path, capsys):
    source = tmp_path / "input.txt"
    source.write_text("beta beta alpha", encoding="utf-8")

    assert main([str(source), "--top", "1"]) == 0
    assert capsys.readouterr().out.strip() == "beta  2"


def test_main_reports_missing_files(capsys):
    assert main(["does-not-exist.txt"]) == 1
    assert "error:" in capsys.readouterr().err


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__]))
