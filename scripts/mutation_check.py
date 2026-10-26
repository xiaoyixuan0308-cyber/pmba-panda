#!/usr/bin/env python3
"""Reverse check: prove the tests can fail.

Plants one deliberate bug at a time (from a list you write), runs the tests,
records whether they caught it, and always puts the code back. "All tests
pass" only means something if every planted bug makes them fail.

Usage:
    python3 scripts/mutation_check.py <mutations.json> [--root app] [--cmd "npm test"]
                                      [--only NAME] [--out report.md] [--after "npx next build"]

mutations.json is a list of planted bugs:
    [
      {"name": "5000.00 counted as valuable (DT-01 boundary)",
       "file": "src/rules/decision-tables.ts",
       "find": "unitPriceCents > VALUABLE_THRESHOLD_CENTS",
       "replace": "unitPriceCents >= VALUABLE_THRESHOLD_CENTS"},
      {"name": "a database delete slips in (static check C-02)",
       "file": "src/domain/admin.ts",
       "append": "export const x = (d: any) => d.delete(loans);"},
      {"name": "UI: fee checkbox not sent (needs a build)",
       "file": "src/app/(app)/loans/[id]/page.tsx",
       "find": "name=\\"feePaid\\"", "replace": "name=\\"paid\\"",
       "cmd": "npx next build && npx vitest run -c vitest.e2e.config.ts tests/e2e/golden-cases/gc-01.e2e.test.ts"}
    ]

Each "find" must occur exactly once in its file, so a stale list is noticed
instead of silently testing nothing. "cmd" overrides --cmd for that entry.
Paths are relative to --root. Exit code: 0 if every bug was caught.
--after runs once at the end, after every file is restored: use it to rebuild
when some entries build the app, so no build with a planted bug is left behind.

Write one entry per kind of rule (decision-table boundary, guard, permission,
state transition, calculation, notification, static code check, UI wiring).
When one is missed, add the missing test, then run this again.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys


def arg(name, default=None):
    return next((sys.argv[i + 1] for i, a in enumerate(sys.argv[:-1]) if a == name), default)


def run(cmd, cwd):
    p = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True)
    out = (p.stdout + p.stderr).splitlines()
    first_fail = next((l.strip() for l in out if l.strip().startswith(("×", "✗", "FAIL", "FAILED", "not ok"))), "")
    return p.returncode, first_fail


def main():
    pos = [a for i, a in enumerate(sys.argv[1:], 1) if not a.startswith("--") and not sys.argv[i - 1].startswith("--")]
    if not pos:
        print(__doc__)
        return 2
    mutations = json.load(open(pos[0], encoding="utf-8"))
    root = arg("--root", ".")
    cmd = arg("--cmd", "npm test")
    only = arg("--only")
    if only:
        mutations = [m for m in mutations if only in m["name"]]

    print(f"Baseline: {cmd}")
    code, first = run(cmd, root)
    if code != 0:
        print(f"The tests already fail before any bug is planted ({first}). Fix that first.")
        return 2

    rows = []
    for m in mutations:
        path = os.path.join(root, m["file"])
        original = open(path, encoding="utf-8").read()
        if "append" in m:
            mutated = original.rstrip("\n") + "\n" + m["append"] + "\n"
        else:
            n = original.count(m["find"])
            if n != 1:
                rows.append((m["name"], f"NOT PLANTED: text found {n} times in {m['file']}"))
                print(f"- {m['name']}: not planted (found {n} times)")
                continue
            mutated = original.replace(m["find"], m["replace"])
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(mutated)
            code, first = run(m.get("cmd", cmd), root)
        finally:
            with open(path, "w", encoding="utf-8") as f:
                f.write(original)
        result = f"caught — {first[:100]}" if code != 0 else "MISSED"
        rows.append((m["name"], result))
        print(f"- {m['name']}: {result}", flush=True)

    after = arg("--after")
    if after:
        print(f"After: {after}")
        code, first = run(after, root)
        if code != 0:
            print(f"Warning: the --after command failed ({first})")

    caught = sum(1 for _, r in rows if r.startswith("caught"))
    lines = ["# 反向检查结果", "", f"埋入 {len(rows)} 个错误，测试发现 {caught} 个。", "",
             "| 埋入的错误 | 结果 |", "|---|---|"] + [f"| {n} | {r} |" for n, r in rows]
    if caught < len(rows):
        lines += ["", "没有发现的错误：补上对应的测试，再运行一次。"]
    out = arg("--out")
    if out:
        with open(out, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
    print(f"\n{caught}/{len(rows)} caught")
    return 0 if caught == len(rows) else 1


if __name__ == "__main__":
    sys.exit(main())
