#!/usr/bin/env python3
"""Render restore-drill JSON records as Markdown table rows.

Extracted from .github/workflows/restore-drill.yml rather than inlined as a
heredoc: a Python heredoc nested inside a YAML block scalar inside a shell loop
is three levels of quoting, and it silently breaks the moment someone reindents
the workflow. A real file can also be tested.

Usage:
    python3 scripts/drill-record-summary.py drill-records/*.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def row(path: Path) -> str:
    try:
        d = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        # A malformed record must not hide the other results, and must not be
        # mistaken for a passing drill.
        return f"| `{path.name}` | UNREADABLE | — | — | — | {type(exc).__name__} |"

    v = d.get("verified", {})
    secs = d.get("seconds", {})
    outcome = d.get("outcome", "UNKNOWN")
    problems = d.get("problems") or []
    note = v.get("newest_row", "—")
    if problems:
        note = "; ".join(str(p) for p in problems)[:120]

    return "| {db} | {outcome} | {restore}s | {rows} | {flyway} | {note} |".format(
        db=d.get("database", "?"),
        outcome=outcome,
        restore=secs.get("restore", "?"),
        rows=v.get("total_rows", "?"),
        flyway=v.get("flyway_version", "?"),
        note=note,
    )


def main(argv: list[str]) -> int:
    paths = [Path(a) for a in argv[1:]]
    if not paths:
        print("| — | NO RECORDS | — | — | — | drill produced no output |")
        return 0
    for p in sorted(paths):
        print(row(p))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
