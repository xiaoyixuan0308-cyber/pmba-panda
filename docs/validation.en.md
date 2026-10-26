# Verification report

[中文](validation.md) | **English**

How PM/BA Panda was verified and improved. First it was compared with "Claude without the skill". Then the skill was used to take a complete project from requirements to acceptance, and every problem the project exposed was fed back into the skill.

Dates: 2026-10-25 to 2026-10-26. Worked example: [`examples/equipment-loan/`](../examples/equipment-loan/), a fictional college equipment-loan system.

---

## 1. Comparison with direct generation

### Method

- **Skill group:** Claude with the skill loaded completed stages 0–4 of the worked example (requirements, user stories, UML, build plan).
- **Control group:** a separate Claude instance without the skill got the same opening request and the same three documents (ledger, request form, loan policy). It could not ask questions and was told to state its assumptions.
- 8 scoring criteria were fixed before looking at the results.

### Results

| Criterion | Result | Notes |
|---|---|---|
| UML quality and cross-diagram consistency | **Skill clearly better** | In the control group's activity diagram, at least 5 actions sat in the wrong swimlane. In its sequence diagram, one lifeline did not exist in the class diagram, messages could not be mapped to class operations, and statuses were set directly ("status = …") instead of through state transitions. Under the mapping rules these would have become wrong permissions and a wrong data structure |
| Completeness of condition combinations | **Skill better** | The skill group checked every combination with decision tables; the control group described the rules in prose and left combinations out once a third condition appeared |
| Exception coverage | Skill more systematic | The skill group went through the exception checklist item by item; the control group covered about 17 exceptions scattered through its output, 3 of which were not on the skill's checklist |
| Hidden rules | Skill slightly better | 6/6 against 5/6, partly thanks to being able to ask the user questions |
| Separating inference from fact | Tie | One used source tags, the other a list of assumptions |
| Edge cases | Tie | The control group also covered month ends, year ends and leap years |
| Acceptance criteria | Each had strengths | Every skill-group criterion traced to a rule ID; the control group used real ledger data in many examples, which made them more concrete |
| **Finding contradictions in the material** | **Control group better** | The control group checked every ledger row against the policy and found more practice–policy mismatches than the skill group (including one misjudgement). At the time, the skill only extracted structure and did no row-by-row audit |

### What the comparison exposed in the skill

The most important finding: lacking a row-by-row audit, the skill group **rewrote two golden cases so they agreed with the policy, instead of bringing the contradiction between material and policy to the user**. Its due-date calculation also disagreed with the ledger's convention. "Mine requirements like a BA" cannot rest on principle alone; it needs concrete method.

### Improvements made as a result

| Improvement | Where |
|---|---|
| Material mining gains a **row-by-row audit**: every record is checked against known rules, and mismatches are classified as hidden rules, practice–policy mismatches, or things left undone | `references/artifact-mining.md` §3 |
| The contradiction log gains a "practice–policy mismatch" type, which the user must rule on | Same |
| Golden cases that cite people, records, dates or amounts from the material must match it; any mismatch is logged as a contradiction, and neither side may be rewritten | `SKILL.md` stage 1c; consistency check H7 |
| Acceptance criteria use real (de-identified) data from the material as examples where possible | `references/acceptance-criteria-guide.md` |
| 3 exceptions added (approved but never collected, damaged on return, approving your own request), 33 in total | `references/exception-checklist.md` |
| Data migration added to the question bank and non-functional checklist | `references/elicitation-questions.md`, `references/nfr-catalogue.md` |
| Stage 6 gains a demo script | `SKILL.md` stage 6, `references/plain-language-cards.md` |

The example's material mining was then redone with the improved skill: all 9 ledger records audited row by row, 1 new contradiction found, and every golden case and the due-date convention brought in line with the ledger.

---

## 2. Running a complete project

The improved skill was then used to finish the example through stage 5 (build) and stage 6 (verification and handover), up to the user's acceptance. Each problem that belonged to the skill itself, rather than to the project, was logged. All of them were then confirmed with the user and fixed in the skill: 23 in total.

### Problems found and improvements made

**Gaps in the check scripts and checklists (8):** errors in the specification or models that the checks missed and that only surfaced while writing code.

| Problem | Improvement |
|---|---|
| A notification was drawn twice on the state machine (once on the transition, again on entering the state); implementing the diagram literally sends it twice | New automatic blocking check A13. Re-run on the pre-fix model, A13 catches it directly |
| The state machine's "due-soon reminder" and "close overdue alert" had no basis in any rule | New check H8: every action must name its basis on the diagram, checked automatically. It found 7 such actions in the example; each was given a source or confirmed with the user |
| Effects missing from the state machine (equipment must be released on return; the borrower must be notified on cancellation) | New check H9: effects are cross-checked backwards from the rules and acceptance criteria |
| The class diagram had nowhere to store a cancellation reason or notifications | G4 extended: any data an effect has to keep must have a home in the class diagram |
| The permission matrix contradicted an acceptance criterion | C3 extended to a three-way match: use case diagram, permission matrix, acceptance criteria |
| The build plan's transition table did not match the state machine | The readiness check now compares them line by line |
| Re-running the consistency check overwrote the manual check results | The script now updates only the automatic part and keeps manual results |
| The traceability check could not recognise test names built in loops and reported false gaps | The trace script can read test-run reports; failing tests do not count as coverage |

**Gaps between stages (3):** 3 ledger records had no dates and could not be imported. Stage 1's audit noted "no date" but never asked whether the record could be imported. The build plan's number of demo accounts did not match the specification. Improvements: the row-by-row audit gains a "can it be imported?" column, and unimportable records go to the user in stage 1; the readiness check compares the numbers in the plan with the specification.

**Default stack and environment (6):** date-only fields stored as timestamps shift by a day across time zones. React 19 clears what the user typed after a failed form submission. Fonts and the component library fail to download on restricted networks. A test-tool version that does not match the pre-installed browser breaks the end-to-end tests. Framework defaults add needless complexity. Improvements: matching conventions in `references/default-stack.md`, plus a new section on restricted or offline networks.

**Testing and verification method (6):**

| Problem | Improvement |
|---|---|
| The tests all passed on the first run, yet 2 of 18 deliberately planted bugs went uncaught | New mutation-check tool `scripts/mutation_check.py`, required from stage 5b |
| A static check can itself be wrong: it first flagged "delete the cookie on sign-out" as deleting data; narrowed, it then missed a real delete | Every static check must have a violation planted once to confirm it fires |
| 3 problems existed only in the UI and could not be caught by unit tests: an error message that never showed, no confirmation after approving, and a form that lost its contents | Every step of a role walkthrough must assert that a confirmation or error appears, and the walkthrough must include "make a mistake → fix it → resubmit" |
| A piece of equipment chosen at random in the demo script was held by an overdue loan, so the live demo would have failed | The demo script must be rehearsed automatically, word for word |
| UI tests located elements by internal field names, so a planted bug made a test fail with "element not found": it looked caught, but nothing had actually been verified | UI tests locate elements by the text and labels the user sees |
| The seed data had 2 errors on its first run (an approval order reversed, one state missing) | Seed-data validation tests, confirmed effective against deliberately corrupted data |

These methods are collected in [`references/verification-playbook.md`](../references/verification-playbook.md) (Chinese).

### Problems caught after the improvements

The example was re-checked with the new scripts:

- The mutation check found that the fix for "the form loses what you typed" was not protected by any automated test, so undoing it would go unnoticed. A UI test was added and confirmed to catch it.
- The new source check found 7 actions with no stated basis. One had genuinely never been specified by anyone and was confirmed with the user.

---

## 3. Final results

| Check | Result |
|---|---|
| Unit and integration tests | All 150 pass |
| End-to-end tests driven through the UI | All 8 pass (5 golden cases, the demo-script rehearsal, "fix a mistake and resubmit") |
| Mutation check | 21 typical bugs planted (rules, permissions, calculations, notifications, static checks, UI); all caught |
| Traceability check (from test-run reports) | All 61 acceptance criteria, every decision-table row, all 11 state transitions and all 5 golden cases have passing tests; 0 gaps |
| Consistency check | 0 blocking; the 4 remaining warnings were each reviewed and accepted in the manual check |
| Role walkthrough | Main and exception flows pass for all 4 roles; accessibility scan (WCAG 2 A/AA) found no issues |
| Pre-release de-identification | No personal information, local paths or real secrets in any file; demo phone numbers use a 10-prefix range that cannot belong to anyone |

---

## 4. Limitations

- **Only one domain verified:** equipment loans (item lending + approval workflow). Other kinds of business have not been run end to end.
- **Each side of the comparison ran once,** so chance cannot be ruled out.
- **The user was played by Claude:** in the example, the user's answers and the skill group came from the same Claude, which risks self-agreement. The comparison exposed this once (the rewritten golden cases); the row-by-row audit and check H7 were added in response, but the risk is not fully removed.
- **The mutation list was written by hand:** it shows the tests catch these 21 kinds of bug, not that they catch every bug.

## 5. Next steps

- Repeat in another domain (e.g. meeting-room booking or expense approval), 3 runs per group.
- Have a third Claude instance play the user from a pre-written "ground truth", so the skill group cannot answer its own questions.
- Build up the pattern library (approval workflow, ticket handling, appointment scheduling, item lending, case management) to make stage 1 questions more targeted.
