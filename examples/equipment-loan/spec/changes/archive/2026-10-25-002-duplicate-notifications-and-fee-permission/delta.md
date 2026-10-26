# 规格增量

## models/06-state-loan.puml

```
- Requested --> Waitlisted : T1 review [not equipmentAvailable] / notifyBorrower
+ Requested --> Waitlisted : T1 review [not equipmentAvailable]
- Waitlisted --> Requested : T2 equipmentReleased / notifyManager
+ Waitlisted --> Requested : T2 equipmentReleased
```

## 01-crud-matrix.md

| 实体 | 设备管理员 |
|---|---|
| LateFee 逾期费 | ~~R~~ → R、U(登记已缴) |

## 04-build-plan.md 第 2 节

| 编号 | 效果（改后） | 守卫（改后） |
|---|---|---|
| T1 | —（由进入"等待设备"时通知借用人） | 不变 |
| T2 | —（由进入"已申请"时通知待审批人） | 不变 |
| T10 | 不变 | —（更正笔误） |
