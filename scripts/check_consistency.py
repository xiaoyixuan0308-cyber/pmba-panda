#!/usr/bin/env python3
"""Automatic consistency checks for pmba-panda projects.

Runs the checks marked "自动" in references/consistency-checklist.md and writes
spec/models/consistency-report.md. Checks marked "人工" are listed in the report
for Claude to complete by hand.

Usage:
    python3 scripts/check_consistency.py [project-dir]      # default: current dir

Expected layout (see SKILL.md):
    spec/glossary.md            markdown table with columns
                                英文名 | 显示名 | 中文名 | 类型 | 定义 | 原始叫法
                                类型 is one or more of: 角色 实体 状态 枚举 外部系统 系统 属性 (e.g. "角色、实体")
    spec/01-role-views.md       optional; used for C1
    spec/models/NN-<type>-<topic>.puml
                                <type> is usecase, activity, state, sequence or class.
                                A state machine file is named NN-state-<entity>.puml.

The parser understands the PlantUML style shown in references/plantuml-pitfalls.md.
Anything it cannot parse is reported rather than silently ignored.

Exit code: 0 if no blocking issue was found, 1 otherwise.
"""

from __future__ import annotations

import datetime as dt
import os
import re
import shutil
import subprocess
import sys
from collections import defaultdict
from dataclasses import dataclass, field

BLOCK = "阻断"
WARN = "警告"


@dataclass
class Issue:
    check: str
    level: str
    where: str
    problem: str
    fix: str = ""


@dataclass
class Model:
    glossary: dict = field(default_factory=dict)        # name -> type (english and display names)
    glossary_rows: list = field(default_factory=list)
    actors: dict = field(default_factory=dict)          # alias -> {display, system}
    actor_parents: list = field(default_factory=list)   # (child, parent)
    usecases: dict = field(default_factory=dict)        # alias -> name
    uc_links: list = field(default_factory=list)        # (a, b)
    uc_relations: list = field(default_factory=list)    # (src, dst, kind, condition)
    lanes: dict = field(default_factory=dict)           # file -> set
    states: dict = field(default_factory=dict)          # entity -> {states, transitions, file}
    participants: dict = field(default_factory=dict)    # file -> {alias: {display, kind, system}}
    messages: dict = field(default_factory=dict)        # file -> [(src, arrow, dst, text, line)]
    classes: dict = field(default_factory=dict)         # name -> {attrs, ops, abstract}
    enums: dict = field(default_factory=dict)           # name -> [values]
    generalisations: list = field(default_factory=list) # (child, parent)
    associations: list = field(default_factory=list)    # (a, mult_a, kind, mult_b, b, line)
    names_by_file: dict = field(default_factory=lambda: defaultdict(set))


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def code_lines(text):
    """Yield (line_no, stripped_line) without comments, @startuml/@enduml and skinparams."""
    for i, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("'") or line.startswith("@") or line.startswith("!"):
            continue
        if line.startswith(("skinparam", "hide ", "show ", "left to right", "top to bottom", "title ")):
            continue
        yield i, line


# --------------------------------------------------------------------------- glossary

def parse_markdown_tables(text):
    rows, header = [], None
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            header = None
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
            continue
        if header is None:
            header = cells
            continue
        rows.append(dict(zip(header, cells)))
    return rows


def load_glossary(spec, m, issues):
    path = os.path.join(spec, "glossary.md")
    if not os.path.exists(path):
        issues.append(Issue("B1", BLOCK, "spec/glossary.md", "找不到术语表，无法做命名检查", "先在阶段 1d 建立术语表"))
        return
    rows = [r for r in parse_markdown_tables(read(path)) if r.get("英文名")]
    if not rows:
        issues.append(Issue("B1", BLOCK, "spec/glossary.md", "术语表中没有找到含“英文名”列的表格",
                            "按 英文名 | 显示名 | 中文名 | 类型 | 定义 | 原始叫法 的格式整理"))
    for r in rows:
        kind = r.get("类型", "")
        m.glossary_rows.append(r)
        for key in ("英文名", "显示名"):
            name = r.get(key, "").strip("` ")
            if name:
                m.glossary[name] = kind


# --------------------------------------------------------------------------- parsers

def parse_usecase(fname, text, m, issues):
    for no, line in code_lines(text):
        mt = re.match(r'actor\s+(?:"([^"]+)"|(\w+))(?:\s+as\s+(\w+))?(.*)$', line)
        if mt:
            display = mt.group(1) or mt.group(2)
            alias = mt.group(3) or display
            m.actors[alias] = {"display": display, "system": "<<system>>" in mt.group(4).replace(" ", "")}
            m.names_by_file[fname].update({alias, display})
            continue
        mt = re.match(r'usecase\s+(?:"([^"]+)"|\(([^)]+)\)|(\w+))(?:\s+as\s+(\w+))?', line)
        if mt:
            name = mt.group(1) or mt.group(2) or mt.group(3)
            m.usecases[mt.group(4) or name] = name
            continue
        mt = re.match(r'(\w+)\s+-+\|>\s+(\w+)$', line) or re.match(r'(\w+)\s+<\|-+\s+(\w+)$', line)
        if mt:
            if "<|" in line:
                m.actor_parents.append((mt.group(2), mt.group(1)))
            else:
                m.actor_parents.append((mt.group(1), mt.group(2)))
            continue
        mt = re.match(r'(\w+)\s+\.+>\s+(\w+)\s*:\s*<<\s*(include|extend)\s*>>(.*)$', line)
        if mt:
            m.uc_relations.append((mt.group(1), mt.group(2), mt.group(3), mt.group(4).strip()))
            continue
        mt = re.match(r'(\w+)\s+-+>?\s+(\w+)$', line)
        if mt:
            m.uc_links.append((mt.group(1), mt.group(2)))


def parse_activity(fname, text, m, issues):
    lanes = set()
    stack, starts, ends = [], 0, 0
    fork_stack = []
    has_else = []
    for no, line in code_lines(text):
        mt = re.match(r'^\|(?:#\w+\|)?([^|]+)\|$', line)
        if mt:
            lanes.add(mt.group(1).strip())
            continue
        low = line.lower()
        if low == "start":
            starts += 1
        elif low in ("stop", "end", "kill", "detach"):
            ends += 1
            if fork_stack:
                issues.append(Issue("A6", BLOCK, f"{fname}:{no}",
                                    f"并行分支在汇合前用 `{low}` 结束了流程，汇合点会一直等待（卡死）",
                                    "分支只做检查并记录结果，在 end fork 之后再用决策点判断"))
        if re.match(r'^if\s*\(', low):
            stack.append(("if", no)); has_else.append(False)
        elif re.match(r'^(else|elseif)\b', low):
            if has_else:
                has_else[-1] = True
        elif low.startswith("endif") or low.startswith("end if"):
            if stack and stack[-1][0] == "if":
                opened = stack.pop()
                if not has_else.pop():
                    issues.append(Issue("A5", WARN, f"{fname}:{opened[1]}",
                                        "决策点只有一个分支，没有 else",
                                        "确认条件不满足时怎么走，补上 else 分支"))
            else:
                issues.append(Issue("A1", BLOCK, f"{fname}:{no}", "多余的 endif", ""))
        elif low == "fork":
            stack.append(("fork", no)); fork_stack.append(no)
        elif low.startswith("end fork") or low.startswith("end merge"):
            if stack and stack[-1][0] == "fork":
                stack.pop(); fork_stack.pop()
            else:
                issues.append(Issue("A1", BLOCK, f"{fname}:{no}", "多余的 end fork", ""))
        elif low == "repeat":
            stack.append(("repeat", no))
        elif low.startswith("repeat while"):
            if stack and stack[-1][0] == "repeat":
                stack.pop()
        elif re.match(r'^while\s*\(', low):
            stack.append(("while", no))
        elif low.startswith("endwhile") or low.startswith("end while"):
            if stack and stack[-1][0] == "while":
                stack.pop()
    for kind, no in stack:
        issues.append(Issue("A1", BLOCK, f"{fname}:{no}", f"`{kind}` 没有对应的结束语句", ""))
    if starts != 1:
        issues.append(Issue("A4", BLOCK, fname, f"起点数量为 {starts}，应当恰好 1 个", ""))
    if ends == 0:
        issues.append(Issue("A4", BLOCK, fname, "没有结束节点（stop / end）", ""))
    m.lanes[fname] = lanes
    m.names_by_file[fname].update(lanes)


STATE_ARROW = re.compile(r'^(\[\*\]|\w+)\s*-+(?:\[[^\]]*\])?(?:up|down|left|right)?-*>\s*(\[\*\]|\w+)\s*(?::\s*(.*))?$')
LABEL = re.compile(r'^(?:(T\d+)\s+)?([^\[/]*?)\s*(\[[^\]]*\])?\s*(?:/\s*(.*))?$')


def parse_state(fname, text, m, issues):
    mt = re.match(r'\d+-state-(.+)\.puml$', fname)
    entity = mt.group(1) if mt else fname
    states, transitions = set(), []
    actions = []  # (state, kind, action, line) for entry / do / exit
    for no, line in code_lines(text):
        a = STATE_ARROW.match(line)
        if a:
            src, dst, label = a.group(1), a.group(2), (a.group(3) or "").strip()
            for s in (src, dst):
                if s != "[*]":
                    states.add(s)
            lm = LABEL.match(label) if label else None
            transitions.append({
                "src": src, "dst": dst, "line": no, "label": label,
                "id": lm.group(1) if lm else None,
                "trigger": (lm.group(2) or "").strip() if lm else "",
                "guard": (lm.group(3) or "").strip("[] ") if lm else "",
                "effect": (lm.group(4) or "").strip() if lm else "",
            })
            continue
        mt = re.match(r'state\s+(?:"[^"]+"\s+as\s+)?(\w+)', line)
        if mt:
            states.add(mt.group(1)); continue
        mt = re.match(r'(\w+)\s*:\s*(entry|exit|do)\b\s*(?:/\s*(\w+))?', line)
        if mt:
            states.add(mt.group(1))
            if mt.group(3):
                actions.append((mt.group(1), mt.group(2), mt.group(3), no))
    m.states[entity] = {"states": states, "transitions": transitions, "file": fname, "actions": actions, "text": text}
    m.names_by_file[fname].update(states)


def parse_sequence(fname, text, m, issues):
    parts, msgs, stack = {}, [], []
    for no, line in code_lines(text):
        mt = re.match(r'(actor|participant|boundary|control|entity|database|collections|queue)\s+'
                      r'(?:"([^"]+)"\s+as\s+(\w+)|(\w+)(?:\s+as\s+"([^"]+)")?)(.*)$', line)
        if mt:
            kind = mt.group(1)
            if mt.group(2):
                display, alias = mt.group(2), mt.group(3)
            else:
                alias, display = mt.group(4), mt.group(5) or mt.group(4)
            parts[alias] = {"display": display, "kind": kind,
                            "system": "<<system>>" in (mt.group(6) or "").replace(" ", "")}
            m.names_by_file[fname].add(display)
            continue
        first = line.split()[0].lower()
        if first in ("alt", "opt", "loop", "par", "group", "critical", "break"):
            stack.append((first, no)); continue
        if first == "else":
            if not stack or stack[-1][0] not in ("alt", "par"):
                issues.append(Issue("A11", WARN, f"{fname}:{no}", "else 不在 alt 或 par 片段里", ""))
            continue
        if first == "end" and not line.lower().startswith(("end note", "end ref")):
            if stack:
                stack.pop()
            else:
                issues.append(Issue("A11", WARN, f"{fname}:{no}", "多余的 end", ""))
            continue
        mt = re.match(r'(\w+)\s*(-+>>?|-+\\\\?|<-+)\s*(\w+)\s*(?:\+\+|--)?\s*:\s*(.*)$', line)
        if mt:
            src, arrow, dst, txt = mt.groups()
            if arrow.startswith("<"):
                src, dst = dst, src
            msgs.append((src, arrow, dst, txt.strip(), no))
    for kind, no in stack:
        issues.append(Issue("A11", WARN, f"{fname}:{no}", f"`{kind}` 片段没有 end", "补上 end"))
    m.participants[fname] = parts
    m.messages[fname] = msgs


REL = re.compile(r'^(\w+)\s*(?:"([^"]*)")?\s*(<\|--|--\|>|\*--|--\*|o--|--o|\.\.>|<\.\.|-->|<--|--|\.\.)\s*(?:"([^"]*)")?\s*(\w+)\s*(?::.*)?$')


def parse_class(fname, text, m, issues):
    current, kind = None, None
    for no, line in code_lines(text):
        if current:
            if line.startswith("}"):
                current = None; continue
            if kind == "enum":
                m.enums[current].append(line.split()[0].rstrip(","))
                continue
            mt = re.match(r'([+\-#~])?\s*(\{\w+\}\s*)?(/)?(\w+)\s*(\([^)]*\))?\s*(?::\s*(.+))?$', line)
            if mt:
                name, is_op, typ = mt.group(4), mt.group(5), (mt.group(6) or "").strip()
                target = m.classes[current]["ops" if is_op else "attrs"]
                target[name] = {"type": typ, "vis": mt.group(1), "line": no}
                if not mt.group(1):
                    issues.append(Issue("A12", WARN, f"{fname}:{no}", f"`{current}.{name}` 没有写可见性（+ - # ~）", ""))
                if not is_op and not typ:
                    issues.append(Issue("A12", WARN, f"{fname}:{no}", f"属性 `{current}.{name}` 没有写类型", ""))
            else:
                issues.append(Issue("A12", WARN, f"{fname}:{no}", f"无法解析的类成员：`{line}`",
                                    "按 `可见性 名称: 类型` 或 `可见性 名称(参数): 返回类型` 书写"))
            continue
        mt = re.match(r'(abstract\s+class|abstract|class|interface|enum)\s+(\w+)(?:\s*<<[^>]*>>)?\s*(\{)?', line)
        if mt:
            name = mt.group(2)
            if mt.group(1) == "enum":
                m.enums.setdefault(name, [])
                kind = "enum"
            else:
                m.classes.setdefault(name, {"attrs": {}, "ops": {}, "abstract": "abstract" in mt.group(1)})
                kind = "class"
            m.names_by_file[fname].add(name)
            if mt.group(3):
                current = name
            continue
        rel = REL.match(line)
        if rel:
            a, ma, arrow, mb, b = rel.groups()
            if arrow == "<|--":
                m.generalisations.append((b, a))
            elif arrow == "--|>":
                m.generalisations.append((a, b))
            else:
                m.associations.append((a, ma, arrow, mb, b, f"{fname}:{no}"))


# --------------------------------------------------------------------------- checks

def norm(s):
    return re.sub(r"[\s_\-]", "", s).lower()


def check_names(m, issues):
    if not m.glossary:
        return
    known_norm = {norm(k): k for k in m.glossary}
    ui_like = re.compile(r"(Page|Service|Controller|UI|Screen|Form|Api|API|Handler|Repository)$")
    seen = set()
    for fname, names in m.names_by_file.items():
        for n in sorted(names):
            if n in m.glossary:
                continue
            if ui_like.search(n):
                continue      # interface/service objects; F1 reports them separately
            key = (fname, n)
            if key in seen:
                continue
            seen.add(key)
            if norm(n) in known_norm:
                issues.append(Issue("B4", BLOCK, fname, f"`{n}` 与术语表中的 `{known_norm[norm(n)]}` 大小写或拼写不一致",
                                    f"统一改为 `{known_norm[norm(n)]}`"))
            else:
                issues.append(Issue("B1", BLOCK, fname, f"`{n}` 不在术语表中",
                                    "加入术语表，或改成术语表中已有的名字"))
    # B2: the same concept spelled differently across diagrams
    spellings = defaultdict(set)
    for names in m.names_by_file.values():
        for n in names:
            spellings[norm(n)].add(n)
    for variants in spellings.values():
        if len(variants) > 1:
            issues.append(Issue("B2", BLOCK, "多张图", f"同一名称有多种写法：{', '.join(sorted(variants))}",
                                "统一为术语表中的写法"))
    # B3: glossary entries never used
    used = {norm(n) for names in m.names_by_file.values() for n in names}
    for r in m.glossary_rows:
        if any(k in r.get("类型", "") for k in ("角色", "实体", "状态", "外部系统")):
            names = [r.get("英文名", ""), r.get("显示名", "")]
            if not any(norm(x) in used for x in names if x):
                issues.append(Issue("B3", WARN, "spec/glossary.md", f"术语 `{r.get('英文名')}` 没有出现在任何图中",
                                    "删除该术语，或说明它为什么不需要出现在图中"))


def check_usecase(m, spec, issues):
    if not m.actors:
        issues.append(Issue("C1", BLOCK, "spec/models", "没有找到用例图（文件名应为 NN-usecase-*.puml）", ""))
        return
    linked = {a for link in m.uc_links for a in link}
    children = {c for c, _ in m.actor_parents}
    for parent in {p for _, p in m.actor_parents}:
        if parent not in linked:
            issues.append(Issue("A3", WARN, "用例图", f"父角色 `{parent}` 没有连接任何用例，泛化关系没有意义",
                                "把子角色共有的用例连到父角色上"))
    for alias, a in m.actors.items():
        if alias not in linked and alias not in children:
            issues.append(Issue("A3", WARN, "用例图", f"参与者 `{alias}` 没有连接任何用例", ""))
    for src, dst, kind, cond in m.uc_relations:
        if kind == "extend" and "[" not in cond:
            issues.append(Issue("A2", BLOCK, "用例图", f"extend `{src} → {dst}` 没有写扩展条件",
                                "在标签上写出 [条件]，并对应一条 BR"))
        for u in (src, dst):
            if u not in m.usecases:
                issues.append(Issue("A2", WARN, "用例图", f"include/extend 引用了未定义的用例 `{u}`", ""))
    # C1: human actors vs glossary roles vs role views
    roles = {r.get("英文名") for r in m.glossary_rows if "角色" in r.get("类型", "")}
    roles |= {r.get("显示名") for r in m.glossary_rows if "角色" in r.get("类型", "") and r.get("显示名")}
    human = {alias: a for alias, a in m.actors.items() if not a["system"]}
    for alias, a in human.items():
        if roles and alias not in roles and a["display"] not in roles:
            issues.append(Issue("C1", BLOCK, "用例图", f"参与者 `{alias}` 在术语表中不是“角色”类型", ""))
    for r in m.glossary_rows:
        if "角色" in r.get("类型", ""):
            names = {r.get("英文名"), r.get("显示名")}
            if not any(alias in names or a["display"] in names for alias, a in human.items()):
                issues.append(Issue("C1", BLOCK, "用例图", f"术语表中的角色 `{r.get('英文名')}` 没有出现在用例图中", ""))
    rv = os.path.join(spec, "01-role-views.md")
    if os.path.exists(rv):
        text = read(rv)
        for r in m.glossary_rows:
            if "角色" in r.get("类型", ""):
                names = [x for x in (r.get("英文名"), r.get("显示名"), r.get("中文名")) if x]
                if not any(n in text for n in names):
                    issues.append(Issue("C1", BLOCK, "spec/01-role-views.md", f"角色 `{r.get('英文名')}` 不在角色视角表中", ""))
    else:
        issues.append(Issue("C1", WARN, "spec/01-role-views.md", "找不到角色视角表，跳过与它的对照", ""))


def check_states(m, issues):
    for entity, sm in m.states.items():
        f = sm["file"]
        out = defaultdict(list)
        for t in sm["transitions"]:
            out[t["src"]].append(t)
        initial = [t["dst"] for t in sm["transitions"] if t["src"] == "[*]"]
        if len(initial) != 1:
            issues.append(Issue("A8", BLOCK, f, f"初始状态数量为 {len(initial)}，应当恰好 1 个", ""))
        reach, todo = set(initial), list(initial)
        while todo:
            s = todo.pop()
            for t in out.get(s, []):
                if t["dst"] != "[*]" and t["dst"] not in reach:
                    reach.add(t["dst"]); todo.append(t["dst"])
        for s in sorted(sm["states"] - reach):
            issues.append(Issue("A8", BLOCK, f, f"状态 `{s}` 从初始状态无法到达", "补上进入它的转换，或删除该状态"))
        for s in sorted(sm["states"]):
            if not out.get(s):
                issues.append(Issue("A9", BLOCK, f, f"状态 `{s}` 没有任何出去的转换，实体会卡在这里",
                                    "补上转换；如果它是终止状态，加 `" + s + " --> [*]`"))
        ids = defaultdict(list)
        for t in sm["transitions"]:
            if t["src"] == "[*]" or t["dst"] == "[*]":
                continue
            where = f"{f}:{t['line']}"
            if not t["id"]:
                issues.append(Issue("A10", BLOCK, where, f"转换 `{t['src']} → {t['dst']}` 没有编号（T1、T2……）", ""))
            else:
                ids[t["id"]].append(where)
            if not t["trigger"]:
                issues.append(Issue("A10", BLOCK, where, f"转换 `{t['src']} → {t['dst']}` 没有写触发",
                                    "写明由什么操作、时间或条件引起"))
        for tid, wheres in ids.items():
            if len(wheres) > 1:
                issues.append(Issue("A10", BLOCK, ", ".join(wheres), f"转换编号 `{tid}` 重复", ""))
        by_src_trigger = defaultdict(list)
        for t in sm["transitions"]:
            if t["trigger"]:
                by_src_trigger[(t["src"], t["trigger"])].append(t)
        for (src, trig), ts in by_src_trigger.items():
            if len(ts) > 1:
                guards = [t["guard"] for t in ts]
                if "" in guards or len(set(guards)) < len(guards):
                    issues.append(Issue("A10", BLOCK, f, f"`{src}` 上的 `{trig}` 有多条出边，但守卫缺失或重复",
                                        "为每条出边写互斥的守卫"))
                else:
                    issues.append(Issue("A10", WARN, f, f"`{src}` 上的 `{trig}` 有多条出边，请人工确认守卫 "
                                        f"{', '.join('[' + g + ']' for g in guards)} 互斥", ""))


SOURCE_REF = re.compile(r"BR-\d+|N?FUS\d+|GC-\d+|\bE\d{2}\b|\bX\d+\b|\[用户\]|\[材料")


def effect_names(effect):
    return [e.strip() for e in re.split(r"[;,]", effect) if e.strip()]


def check_state_actions(m, issues):
    """A13: an effect repeated by the target state's entry action runs twice.
    H8: every effect and entry/do/exit action names where it comes from, in a
    comment on the line(s) directly above it (e.g. ' BR-03 or ' [用户])."""
    for entity, sm in m.states.items():
        f = sm["file"]
        entry = defaultdict(set)
        for state, kind, action, _ in sm["actions"]:
            if kind == "entry":
                entry[state].add(action)
        for t in sm["transitions"]:
            for e in effect_names(t["effect"]):
                if e in entry.get(t["dst"], ()):
                    issues.append(Issue("A13", BLOCK, f"{f}:{t['line']}",
                                        f"{t['id'] or t['src'] + '→' + t['dst']} 的效果 `{e}` 与 `{t['dst']}` 的 entry 动作重复，照图实现会执行两次",
                                        f"删掉转换上的 `{e}`，由 `{t['dst']}` 的 entry 统一负责"))
        raw = sm["text"].splitlines()

        def has_source(line_no):
            i = line_no - 1
            if SOURCE_REF.search(raw[i]):
                return True
            i -= 1
            while i >= 0 and raw[i].strip().startswith("'"):
                if SOURCE_REF.search(raw[i]):
                    return True
                i -= 1
            return False

        for t in sm["transitions"]:
            if t["effect"] and not has_source(t["line"]):
                issues.append(Issue("H8", WARN, f"{f}:{t['line']}", f"{t['id']} 的效果 `{t['effect']}` 没有注明出处",
                                    "在上一行加注释写明依据，如 `' BR-04` 或 `' [用户]`；找不到依据的，回到规格向用户确认"))
        for state, kind, action, no in sm["actions"]:
            if not has_source(no):
                issues.append(Issue("H8", WARN, f"{f}:{no}", f"`{state}` 的 {kind} 动作 `{action}` 没有注明出处",
                                    "在上一行加注释写明依据，如 `' BR-07`；说不清何时做、对谁做的，回到规格向用户确认"))


def class_by_name(m, name):
    for c in m.classes:
        if norm(c) == norm(name):
            return c
    return None


def all_ops(m, cls):
    ops, seen, todo = set(), set(), [cls]
    while todo:
        c = todo.pop()
        if c in seen or c not in m.classes:
            continue
        seen.add(c)
        ops |= set(m.classes[c]["ops"])
        todo += [p for ch, p in m.generalisations if ch == c]
    return ops


def check_state_vs_class(m, issues):
    for entity, sm in m.states.items():
        cls = class_by_name(m, entity)
        if not cls:
            issues.append(Issue("G1", BLOCK, sm["file"], f"类图中没有与状态机对应的类 `{entity}`",
                                "状态机文件名应为 NN-state-<类名>.puml，且类图中有这个类"))
            continue
        status = m.classes[cls]["attrs"].get("status")
        if not status:
            issues.append(Issue("G1", BLOCK, "类图", f"`{cls}` 没有 status 属性", ""))
            continue
        enum = status["type"]
        if enum not in m.enums:
            issues.append(Issue("G2", BLOCK, "类图", f"`{cls}.status` 的类型 `{enum}` 不是枚举",
                                "定义一个枚举，值与状态机的状态完全一致"))
            continue
        values, states = set(m.enums[enum]), sm["states"]
        if values != states:
            missing = sorted(states - values)
            extra = sorted(values - states)
            detail = []
            if missing:
                detail.append("枚举缺少：" + ", ".join(missing))
            if extra:
                detail.append("枚举多出：" + ", ".join(extra))
            issues.append(Issue("G2", BLOCK, "类图 / " + sm["file"], f"`{enum}` 与状态机不一致（{'；'.join(detail)}）", ""))


def check_sequence_vs_class(m, issues):
    system_actors = {a["display"] for a in m.actors.values() if a["system"]} | \
                    {k for k, a in m.actors.items() if a["system"]}
    for fname, parts in m.participants.items():
        for alias, p in parts.items():
            if p["kind"] == "actor":
                continue
            if p["system"]:
                if alias not in system_actors and p["display"] not in system_actors:
                    issues.append(Issue("F4", WARN, fname, f"外部系统 `{p['display']}` 没有作为外部参与者出现在用例图中", ""))
                continue
            if not class_by_name(m, p["display"]) and not class_by_name(m, alias):
                if "实体" in m.glossary.get(p["display"], "") or "实体" in m.glossary.get(alias, ""):
                    issues.append(Issue("F1", BLOCK, fname, f"生命线 `{p['display']}` 是术语表中的实体，但类图中没有这个类", ""))
                else:
                    issues.append(Issue("F1", WARN, fname, f"生命线 `{p['display']}` 不是类图中的类",
                                        "如果它是界面或服务对象，在说明卡中注明"))
        for src, arrow, dst, txt, no in m.messages.get(fname, []):
            if "--" in arrow:
                continue    # return message
            p = parts.get(dst)
            if not p or p["kind"] == "actor" or p["system"]:
                continue
            cls = class_by_name(m, p["display"]) or class_by_name(m, dst)
            if not cls:
                continue
            mt = re.match(r'(\w+)\s*\(', txt)
            if not mt:
                continue
            op = mt.group(1)
            if op in ("transition", "findById", "create", "save"):
                continue    # conventional persistence / state-change calls
            if op not in all_ops(m, cls):
                issues.append(Issue("F2", BLOCK, f"{fname}:{no}", f"消息 `{op}()` 不是类 `{cls}` 的操作",
                                    f"在类图的 `{cls}` 中加上该操作，或修改消息名"))


def check_class_structure(m, issues):
    for a, ma, arrow, mb, b, where in m.associations:
        if arrow in ("..>", "<.."):
            continue
        if not ma or not mb:
            issues.append(Issue("A12", BLOCK, where, f"关联 `{a} {arrow} {b}` 缺少多重性",
                                f'写成 `{a} "1" {arrow} "0..*" {b}` 这样的形式'))
        for c in (a, b):
            if c not in m.classes and c not in m.enums:
                issues.append(Issue("A12", WARN, where, f"关联中的 `{c}` 未在类图中定义", ""))


def check_syntax(models_dir, files, issues):
    jar = os.environ.get("PLANTUML_JAR")
    cache = os.path.expanduser("~/.cache/pmba-panda/plantuml.jar")
    if jar and os.path.exists(jar):
        cmd = ["java", "-jar", jar]
    elif shutil.which("plantuml"):
        cmd = ["plantuml"]
    elif os.path.exists(cache) and shutil.which("java"):
        cmd = ["java", "-jar", cache]
    else:
        return False
    extra = [] if shutil.which("dot") else ["-Playout=smetana"]
    for f in files:
        r = subprocess.run(cmd + extra + ["-checkonly", os.path.join(models_dir, f)],
                           capture_output=True, text=True)
        if r.returncode != 0:
            issues.append(Issue("A1", BLOCK, f, "PlantUML 语法错误", "运行 scripts/render_uml.sh 查看出错行号"))
    return True


# --------------------------------------------------------------------------- report

MANUAL = ["A2（方向）", "A4（死路）", "A5（条件互斥）", "A7", "A12（菱形与三角方向）",
          "C2", "C3", "C4", "C5", "C6", "D1–D6", "E1–E5", "F3", "G3", "G4", "H1–H7", "H9"]


AUTO_START = "<!-- 自动检查开始：本段由 check_consistency.py 生成，重跑会覆盖 -->"
AUTO_END = "<!-- 自动检查结束：以下内容（人工检查结果等）重跑时保留 -->"
MANUAL_HEADING = "## 人工检查结果"


def write_report(path, issues, counts, syntax_checked):
    """Rewrite only the block between AUTO_START and AUTO_END. Anything after it
    (manual results, re-check notes after a change) is kept as it is."""
    blocking = [i for i in issues if i.level == BLOCK]
    warnings = [i for i in issues if i.level == WARN]
    auto = [
        AUTO_START,
        f"检查时间：{dt.date.today().isoformat()}",
        f"自动检查：发现阻断 {len(blocking)} 项，警告 {len(warnings)} 项",
        "解析到的模型：" + "，".join(f"{k} {v}" for k, v in counts.items()),
        "A1 语法检查：" + ("已执行" if syntax_checked else "未执行（找不到 PlantUML，请先运行 scripts/render_uml.sh）"),
        "",
        "## 阻断项",
        "",
        "| 编号 | 位置 | 问题 | 建议修改 |",
        "|---|---|---|---|",
    ]
    auto += [f"| {i.check} | {i.where} | {i.problem} | {i.fix} |" for i in blocking] or ["| — | — | 无 | — |"]
    auto += ["", "## 警告（由用户决定是否修改）", "", "| 编号 | 位置 | 问题 | 建议 |", "|---|---|---|---|"]
    auto += [f"| {i.check} | {i.where} | {i.problem} | {i.fix} |" for i in warnings] or ["| — | — | 无 | — |"]
    auto += ["", "## 待人工检查", "",
             "以下项目脚本无法判断，需按 references/consistency-checklist.md 逐条检查，并把结果写在本报告的“人工检查结果”一节：",
             "", "、".join(MANUAL), "", AUTO_END]

    kept = f"\n{MANUAL_HEADING}\n\n（尚未填写）\n"
    if os.path.exists(path):
        old = read(path)
        if AUTO_END in old:
            kept = old.split(AUTO_END, 1)[1]
        elif MANUAL_HEADING in old:  # report written by an older version of this script
            kept = "\n" + old[old.index(MANUAL_HEADING):]
    with open(path, "w", encoding="utf-8") as f:
        f.write("# 一致性检查报告\n\n" + "\n".join(auto) + kept.rstrip("\n") + "\n")


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    spec = os.path.join(root, "spec")
    models_dir = os.path.join(spec, "models")
    if not os.path.isdir(models_dir):
        print(f"Folder not found: {models_dir}", file=sys.stderr)
        return 1

    m, issues = Model(), []
    load_glossary(spec, m, issues)

    parsers = {"usecase": parse_usecase, "activity": parse_activity, "state": parse_state,
               "sequence": parse_sequence, "class": parse_class}
    counts = defaultdict(int)
    files = sorted(f for f in os.listdir(models_dir) if f.endswith(".puml"))
    for f in files:
        mt = re.match(r'\d+-(usecase|activity|state|sequence|class)-', f)
        if not mt:
            issues.append(Issue("A1", WARN, f, "文件名不符合 NN-<图类型>-<主题>.puml，未检查", ""))
            continue
        kind = mt.group(1)
        text = read(os.path.join(models_dir, f))
        start = re.search(r"^@startuml\s*(\S*)", text, re.M)
        if start and start.group(1) != f[:-5]:
            issues.append(Issue("A1", WARN, f, f"`@startuml {start.group(1)}` 与文件名不一致，图片会被命名为 "
                                f"{start.group(1) or '默认名'}.png，说明卡引用不到", f"改为 `@startuml {f[:-5]}`"))
        parsers[kind](f, text, m, issues)
        counts[kind] += 1

    for kind in ("usecase", "activity", "state", "sequence", "class"):
        if counts[kind] == 0:
            issues.append(Issue("A1", BLOCK, "spec/models", f"缺少 {kind} 图", "五种核心模型都必须有"))

    syntax_checked = check_syntax(models_dir, files, issues)
    check_names(m, issues)
    check_usecase(m, spec, issues)
    check_states(m, issues)
    check_state_actions(m, issues)
    check_class_structure(m, issues)
    check_state_vs_class(m, issues)
    check_sequence_vs_class(m, issues)

    report = os.path.join(models_dir, "consistency-report.md")
    write_report(report, issues, dict(counts), syntax_checked)

    blocking = sum(1 for i in issues if i.level == BLOCK)
    warnings = sum(1 for i in issues if i.level == WARN)
    print(f"Blocking: {blocking}   Warnings: {warnings}")
    for i in issues:
        print(f"[{i.level}] {i.check}  {i.where}  {i.problem}")
    print(f"\nReport written to {report}")
    return 1 if blocking else 0


if __name__ == "__main__":
    sys.exit(main())
