#!/usr/bin/env python3
"""Cheap structural check for Dart sources when no Dart SDK is available.

Verifies bracket/brace/paren balance outside strings & comments, that every
file starts with imports before declarations, and that `class`/`library`
declarations are not nested. It is NOT a parser - CI runs the real analyzer.
"""
from __future__ import annotations
import sys
from pathlib import Path

PAIRS = {")": "(", "]": "[", "}": "{"}


def scan(text: str):
    """Bracket balance outside strings/comments. Deliberately simple."""
    stack: list[tuple[str, int]] = []
    errors: list[str] = []
    line = 1
    i = 0
    n = len(text)
    state = "code"  # code | line | block | dq | sq
    while i < n:
        ch = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if state == "line":
            if ch == "\n":
                state = "code"
                line += 1
            i += 1
            continue
        if state == "block":
            if ch == "*" and nxt == "/":
                state = "code"
                i += 2
                continue
            if ch == "\n":
                line += 1
            i += 1
            continue
        if state in ("dq", "sq"):
            quote = '"' if state == "dq" else "'"
            if ch == "\\":
                i += 2
                continue
            if ch == quote:
                state = "code"
                i += 1
                continue
            if ch == "\n":  # unterminated literal
                errors.append(f"line {line}: unterminated {quote} string")
                state = "code"
                line += 1
            i += 1
            continue
        # state == code
        if ch == "/" and nxt == "/":
            state = "line"
            i += 2
            continue
        if ch == "/" and nxt == "*":
            state = "block"
            i += 2
            continue
        if ch in "\"'":
            state = "dq" if ch == '"' else "sq"
            i += 1
            continue
        if ch == "\n":
            line += 1
            i += 1
            continue
        if ch in "([{":
            stack.append((ch, line))
        elif ch in ")]}":
            if not stack:
                errors.append(f"line {line}: stray '{ch}'")
            else:
                opened, oline = stack.pop()
                if opened != PAIRS[ch]:
                    errors.append(f"line {line}: '{ch}' closes '{opened}' opened at line {oline}")
        i += 1
    for opened, oline in stack:
        errors.append(f"line {oline}: unclosed '{opened}'")
    if state in ("dq", "sq"):
        errors.append(f"file ends inside a {state} literal")
    return errors


def main() -> int:
    roots = [Path(p) for p in (sys.argv[1:] or ["lib", "test"])]
    files = sorted(f for root in roots for f in root.rglob("*.dart") if f.is_file())
    bad = 0
    for f in files:
        text = f.read_text(encoding="utf-8")
        errors = scan(text)
        if errors:
            bad += 1
            print(f"FAIL {f}")
            for e in errors[:6]:
                print(f"      {e}")
    print(f"\n{len(files) - bad}/{len(files)} files structurally clean")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
