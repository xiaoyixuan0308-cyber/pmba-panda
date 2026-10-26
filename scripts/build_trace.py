#!/usr/bin/env python3
"""Build the traceability matrix (spec/trace.csv) and list the gaps.

Usage:
    python3 scripts/build_trace.py [project-dir] --plan    # stage 4: spec and models only
    python3 scripts/build_trace.py [project-dir]           # stage 6: also code and tests
    python3 scripts/build_trace.py [project-dir] --test-report results.json [--test-report e2e.json]
            # recommended in stage 6: read test names from a real test run
            # (Vitest/Jest --reporter=json, or JUnit XML from pytest --junitxml and
            # most other runners). Names built in loops (`DT-02 ${rule}`) are then
            # recognised, and a test that exists but fails does not count.

What it reads (see SKILL.md for the layout):
    spec/01-rules.md            BR-xx definitions
    spec/01-decision-tables.md  DT-xx tables and their R1, R2 ... rows
    spec/golden-cases.md        GC-xx cases
    spec/02-stories.md          FUSn / NFUSn stories; acceptance criteria as "AC1:" lines
                                ending with references in brackets, e.g. "(BR-05, T3, DT-01, GC-02)".
                                Use "Loan/T3" when there is more than one state machine.
                                NFUS criteria may cite an NFR category instead, e.g. "(审计) [原型测试]".
    spec/models/*.puml          transition ids T1, T2 ... in NN-state-<entity>.puml;
                                BR-xx mentioned anywhere in a diagram (comments included)
    app/src/**                  "// BR-xx" comments, transition tables (id: "T3"), DT-xx
    app/tests/**                test names containing FUS3-AC2, DT-01 R2, GC-02, ...

Writes:
    spec/trace.csv              one row per acceptance criterion
    spec/trace-gaps.md          everything that is missing a link

Exit code: 0 if there are no gaps, 1 otherwise.
"""

from __future__ import annotations

import csv
import datetime as dt
import os
import re
import sys
from collections import defaultdict

REF = re.compile(r"\b(?:(\w+)/)?(T\d+)\b|\b(BR-\d+|DT-\d+|GC-\d+)\b")
STORY = re.compile(r"^\s*(?:#+\s*)?\**\s*(N?FUS\d+)\b")
AC = re.compile(r"^\s*(?:[-*]\s*)?\**(AC\d+)\**\s*[:：]\s*(.*)$")
TAG = re.compile(r"\[(原型测试|原型演示|原型不验证)\]")
CODE_EXT = (".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".kt", ".cs", ".go", ".rb", ".php")


def read(path):
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return None


def walk(folder, exts=CODE_EXT):
    skip = {"node_modules", ".next", "dist", "build", ".git"}
    for root, dirs, files in os.walk(folder):
        dirs[:] = [d for d in dirs if d not in skip]
        for f in files:
            if f.endswith(exts):
                yield os.path.join(root, f)


def defined_ids(text, prefix):
    """IDs that are *defined* (start a heading, a table row or a list item)."""
    pat = re.compile(rf"^\s*(?:#+\s*|\|\s*|[-*]\s*)?\**\s*({prefix}-\d+)\b", re.M)
    return set(pat.findall(text or ""))


def decision_tables(text):
    tables, current = {}, None
    for line in (text or "").splitlines():
        mt = re.match(r"^\s*#+.*?\b(DT-\d+)\b", line)
        if mt:
            current = mt.group(1)
            tables[current] = []
            continue
        mt = re.match(r"^\s*\|\s*(R\d+)\s*\|", line)
        if mt and current:
            tables[current].append(mt.group(1))
    return tables


def parse_stories(text):
    rows, story = [], None
    for no, line in enumerate((text or "").splitlines(), 1):
        mt = STORY.match(line)
        if mt:
            story = mt.group(1)
            continue
        mt = AC.match(line)
        if mt and story:
            body = mt.group(2)
            refs = {"BR": set(), "DT": set(), "GC": set(), "T": set()}
            for sm, t, other in REF.findall(body):
                if t:
                    refs["T"].add(f"{sm}/{t}" if sm else t)
                else:
                    refs[other[:2]].add(other)
            tag = TAG.search(body)
            rows.append({"story": story, "ac": f"{story}-{mt.group(1)}", "line": no, "refs": refs,
                         "verify": tag.group(1) if tag else ""})
    return rows


def parse_models(models_dir):
    transitions = defaultdict(set)      # entity -> {T1, ...}
    br_in_models = defaultdict(set)     # BR -> {file}
    if not os.path.isdir(models_dir):
        return transitions, br_in_models
    for f in sorted(os.listdir(models_dir)):
        if not f.endswith(".puml"):
            continue
        text = read(os.path.join(models_dir, f))
        for br in re.findall(r"\bBR-\d+\b", text):
            br_in_models[br].add(f)
        mt = re.match(r"\d+-state-(.+)\.puml$", f)
        if mt:
            for t in re.findall(r"-+>\s*\w+\s*:\s*(T\d+)\b", text):
                transitions[mt.group(1).lower()].add(t)
    return transitions, br_in_models


def scan_code(src_dir):
    hits = defaultdict(set)   # key (BR-05, DT-01, loan/T3) -> {"file:line"}
    if not os.path.isdir(src_dir):
        return hits
    for path in walk(src_dir):
        rel = os.path.relpath(path, os.path.dirname(src_dir))
        parts = [p.lower() for p in rel.replace("\\", "/").split("/")]
        for no, line in enumerate(read(path).splitlines(), 1):
            for key in re.findall(r"\b(?:BR|DT)-\d+\b", line):
                hits[key].add(f"{rel}:{no}")
            for t in re.findall(r"""\bid\s*:\s*["'](T\d+)["']""", line):
                entity = parts[parts.index("domain") + 1] if "domain" in parts[:-1] else ""
                hits[f"{entity}/{t}"].add(f"{rel}:{no}")
    return hits


def scan_tests(test_dir):
    names = []
    if not os.path.isdir(test_dir):
        return names
    pat = re.compile(r"""\b(?:it|test|describe)(?:\.\w+)?\(\s*(["'`])(.*?)\1""")
    for path in walk(test_dir):
        for _, name in pat.findall(read(path)):
            names.append(name)
    return names


def scan_test_report(path):
    """Return (passed names, failed names) from a Vitest/Jest JSON or JUnit XML report."""
    passed, failed = [], []
    if path.endswith(".xml"):
        import xml.etree.ElementTree as ET
        for case in ET.parse(path).getroot().iter("testcase"):
            name = " ".join(x for x in (case.get("classname"), case.get("name")) if x)
            bad = any(child.tag in ("failure", "error") for child in case)
            skipped = any(child.tag == "skipped" for child in case)
            (failed if bad else passed if not skipped else []).append(name)
        return passed, failed
    import json
    data = json.loads(read(path))
    for f in data.get("testResults", []):
        for a in f.get("assertionResults", []):
            name = a.get("fullName") or " ".join(a.get("ancestorTitles", []) + [a.get("title", "")])
            if a.get("status") == "passed":
                passed.append(name)
            elif a.get("status") == "failed":
                failed.append(name)
    return passed, failed


def resolve_t(ref, transitions):
    """Return (entity, T) or None. Plain T3 is allowed only with one state machine."""
    if "/" in ref:
        entity, t = ref.split("/")
        return (entity.lower(), t) if t in transitions.get(entity.lower(), set()) else None
    owners = [e for e, ts in transitions.items() if ref in ts]
    return (owners[0], ref) if len(owners) == 1 else None


def main():
    argv = sys.argv[1:]
    args = [a for i, a in enumerate(argv) if not a.startswith("--") and (i == 0 or argv[i - 1] != "--test-report")]
    plan = "--plan" in sys.argv
    root = args[0] if args else "."
    spec = os.path.join(root, "spec")
    if not os.path.isdir(spec):
        print(f"Folder not found: {spec}", file=sys.stderr)
        return 1

    brs = defined_ids(read(os.path.join(spec, "01-rules.md")), "BR")
    dts = decision_tables(read(os.path.join(spec, "01-decision-tables.md")))
    gcs = defined_ids(read(os.path.join(spec, "golden-cases.md")), "GC")
    stories_text = read(os.path.join(spec, "02-stories.md"))
    acs = parse_stories(stories_text)
    transitions, br_in_models = parse_models(os.path.join(spec, "models"))
    code = {} if plan else scan_code(os.path.join(root, "app", "src"))
    reports = [sys.argv[i + 1] for i, a in enumerate(sys.argv[:-1]) if a == "--test-report"]
    failed_tests = []
    if plan:
        tests = []
    elif reports:  # may be given more than once, e.g. unit/integration and end-to-end runs
        tests = []
        for rp in reports:
            ok, bad = scan_test_report(rp)
            tests += ok
            failed_tests += bad
            print(f"Test report: {len(ok)} passed, {len(bad)} failed ({rp})")
    else:
        tests = scan_tests(os.path.join(root, "app", "tests"))
        dynamic = [n for n in tests if "${" in n]
        if dynamic:
            print(f"Warning: {len(dynamic)} test name(s) are built with variables (e.g. {dynamic[0]!r}) and cannot be "
                  "matched by reading the source. Pass --test-report, or write the ids out in each test name.")

    gaps = defaultdict(list)
    if stories_text is None:
        gaps["输入缺失"].append("找不到 spec/02-stories.md")
    if not acs and stories_text is not None:
        gaps["输入缺失"].append("02-stories.md 中没有解析到任何 AC（格式：故事标题以 FUS1 / NFUS1 开头，AC 行以 AC1: 开头）")

    rows, stories_with_model = [], defaultdict(bool)
    referenced = defaultdict(set)
    for a in acs:
        refs = a["refs"]
        model_el, code_loc = [], set()
        for kind in ("BR", "DT", "GC"):
            referenced[kind] |= refs[kind]
        for br in sorted(refs["BR"]):
            if br not in brs:
                gaps["引用了未定义的编号"].append(f"{a['ac']} 引用的 {br} 不在 01-rules.md 中")
            for f in sorted(br_in_models.get(br, ())):
                model_el.append(f"Model:{f}")
            code_loc |= code.get(br, set())
        for d in sorted(refs["DT"]):
            if d not in dts:
                gaps["引用了未定义的编号"].append(f"{a['ac']} 引用的 {d} 不在 01-decision-tables.md 中")
            model_el.append(f"DecisionTable:{d}")
            code_loc |= code.get(d, set())
        for g in sorted(refs["GC"]):
            if g not in gcs:
                gaps["引用了未定义的编号"].append(f"{a['ac']} 引用的 {g} 不在 golden-cases.md 中")
        for t in sorted(refs["T"]):
            hit = resolve_t(t, transitions)
            if not hit:
                gaps["引用了未定义的编号"].append(
                    f"{a['ac']} 引用的 {t} 在状态机中找不到（或有多个状态机，需写成 实体/{t.split('/')[-1]}）")
                continue
            entity, tid = hit
            model_el.append(f"StateMachine:{entity}/{tid}")
            code_loc |= code.get(f"{entity}/{tid}", set())
        if not any(refs.values()) and not a["story"].startswith("NFUS"):
            gaps["AC 没有依据"].append(f"{a['ac']}（02-stories.md 第 {a['line']} 行）没有注明 BR / DT / T / GC")
        if model_el:
            stories_with_model[a["story"]] = True
        else:
            stories_with_model.setdefault(a["story"], False)
        if a["story"].startswith("NFUS") and not a["verify"]:
            gaps["NFUS 未标注验证方式"].append(a["ac"])
        test_names = sorted(n for n in tests if re.search(rf"\b{re.escape(a['ac'])}\b", n))
        if not plan:
            needs_test = a["verify"] in ("", "原型测试")
            if needs_test and not test_names:
                gaps["AC 没有测试"].append(a["ac"])
            if not code_loc and (refs["BR"] or refs["DT"] or refs["T"]) and a["verify"] != "原型不验证":
                gaps["AC 在代码中找不到实现位置"].append(a["ac"])
        rows.append([a["story"], a["ac"],
                     " ".join(sorted(refs["BR"] | refs["DT"] | refs["GC"] | refs["T"])),
                     " ".join(dict.fromkeys(model_el)), " ".join(sorted(code_loc)), " | ".join(test_names), a["verify"]])

    for s, ok in stories_with_model.items():
        if not ok and not s.startswith("NFUS"):
            gaps["故事没有对应的模型元素"].append(
                f"{s}：它的 AC 没有引用任何状态转换、决策表，也没有引用在图中出现过的 BR")
    for br in sorted(brs - referenced["BR"]):
        gaps["BR 没有被任何 AC 引用"].append(br)
    for d in sorted(set(dts) - referenced["DT"]):
        gaps["决策表没有被任何 AC 引用"].append(d)

    if not plan:
        for br in sorted(brs):
            if not code.get(br):
                gaps["BR 在代码中没有 // BR-xx 标注"].append(br)
        for d, rws in sorted(dts.items()):
            for r in rws:
                if not any(re.search(rf"\b{d}\b.*\b(?:{r}|row\s*{r[1:]})\b", n, re.I) for n in tests):
                    gaps["决策表的行没有测试"].append(f"{d} {r}")
        for g in sorted(gcs):
            if not any(re.search(rf"\b{g}\b", n) for n in tests):
                gaps["黄金案例没有端到端测试"].append(g)
        for entity, ts in sorted(transitions.items()):
            for t in sorted(ts, key=lambda x: int(x[1:])):
                if not code.get(f"{entity}/{t}"):
                    gaps["状态转换在转换表中找不到"].append(f"{entity}/{t}")
    else:
        for g in sorted(gcs):
            gaps["阶段 5 需要为黄金案例写端到端测试（提醒）"].append(g)

    for n in failed_tests:
        gaps["测试没有通过"].append(n)

    out_csv = os.path.join(spec, "trace.csv")
    with open(out_csv, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["故事编号", "AC编号", "依据编号", "模型元素", "代码位置", "测试名", "验证方式"])
        w.writerows(rows)

    real_gaps = {k: v for k, v in gaps.items() if not k.endswith("（提醒）")}
    lines = ["# 追溯缺口", "", f"生成时间：{dt.date.today().isoformat()}　模式：{'构建计划（--plan）' if plan else '构建完成后'}",
             f"AC 总数：{len(acs)}　BR：{len(brs)}　决策表：{len(dts)}　黄金案例：{len(gcs)}　"
             f"状态转换：{sum(len(v) for v in transitions.values())}", ""]
    if not gaps:
        lines.append("没有发现缺口。")
    for k, items in gaps.items():
        lines += [f"## {k}（{len(items)}）", ""] + [f"- {i}" for i in items] + [""]
    out_gaps = os.path.join(spec, "trace-gaps.md")
    with open(out_gaps, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"Acceptance criteria: {len(acs)}   Gaps: {sum(len(v) for v in real_gaps.values())}")
    for k, items in gaps.items():
        print(f"- {k}: {len(items)}")
        for i in items[:5]:
            print(f"    {i}")
        if len(items) > 5:
            print(f"    ... and {len(items) - 5} more (see trace-gaps.md)")
    print(f"\nWrote {out_csv}\nWrote {out_gaps}")
    return 1 if real_gaps else 0


if __name__ == "__main__":
    sys.exit(main())
