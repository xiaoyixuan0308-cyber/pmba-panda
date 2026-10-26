# 反向检查结果

埋入 21 个错误，测试发现 21 个。

| 埋入的错误 | 结果 |
|---|---|
| DT-01 threshold 5000 counted as valuable | caught — × has 320 items of equipment, 40 of them valuable 7ms |
| late fee cap removed | caught — × FUS7-AC3 capped at 200 yuan: JY-0905 returned Oct 10 → 28 days, 200 yuan 16ms |
| overdue on the due date itself | caught — × T8 [after dueDate]: not on the due date itself 24ms |
| BR-12 guard disabled | caught — × T3 [noOverdueLoans]: S-014 has JY-0905 overdue (BR-12) 28ms |
| Overdue entry forgets the Manager | caught — × FUS6-AC1 the check after the due date flags it and notifies borrower and Manager 99ms |
| blank reason accepted | caught — × FUS3-AC4 rejection needs a reason; the borrower is told the reason 15ms |
| DT-02 R2 student valuable 7 → 14 | caught — × FUS1-AC3 a due date beyond DT-02 is refused with the maximum for this borrower 13ms |
| borrower can act on others' loans | caught — × T5/T6 fired directly by another borrower are refused inside the transition itself 19ms |
| waiting list never released | caught — × T2 equipmentReleased: cancelling the holder sends the waiting loan back to Requested, Manager noti |
| weekends counted as working days | caught — × FUS10-AC2 weekends do not count 87ms |
| Approved loans do not reserve equipment | caught — × FUS2-AC2 Waitlisted → Withdrawn and off the waiting list 24ms |
| DeptHead sees full phone numbers | caught — × NFUS3-AC1 DeptHead sees a masked phone, Clerk and Manager the full number 17ms |
| lockout after 6 failures | caught — × NFUS1-AC3 five failed logins lock the account for 15 minutes 128ms |
| registry down treated as passed | caught — × FUS5-AC3 registry down: the agreed message, loan stays Approved 17ms |
| DeptHead may approve before Manager | caught — × FUS4-AC4 the DeptHead's list only holds loans the Manager has approved, and cannot jump the queue  |
| reminders sent twice a day | caught — × FUS10-AC1 reminded once 2 working days have passed, not before, and not twice a day 114ms |
| Clerk may cancel | caught — × roles allowed to fire a transition are the roles allowed the matching operation 5ms |
| returned-on-due-date counted overdue in stats | caught — × FUS11-AC3 a return on the due date is not overdue; a later one is (BR-07) 80ms |
| a database delete slips in (static check, C-02) | caught — × nothing in the app deletes rows (C-02) 7ms |
| UI: fee checkbox wired to the wrong field (GC-01) | caught — × GC-01 S-060 borrows AV-0103 Nov 2–9, flagged overdue Nov 10, returns Nov 12 and pays 30 yuan 13930 |
| UI: request form loses typed purpose after a failed submit (S19) | caught — × NFUS5-AC3 a refused request keeps every field; fixing the due date alone is enough 2923ms |
