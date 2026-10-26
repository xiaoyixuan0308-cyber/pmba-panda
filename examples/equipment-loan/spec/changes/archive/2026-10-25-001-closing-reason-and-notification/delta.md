# 规格增量

## glossary.md

新增一行：

| 英文名 | 显示名 | 中文名 | 类型 | 定义 | 原始叫法 |
|---|---|---|---|---|---|
| Notification | | 通知 | 实体 | 系统发给某个用户的一条站内消息 | — |

## models/07-class-domain.puml

Loan 新增：

```
-closingReason: String
```

新增：

```
class Notification {
  -id: Integer
  +message: String
  +createdAt: DateTime
  +readAt: DateTime
  +markRead(): void
}

Person "1" -- "0..*" Notification : receives >
Notification "0..*" -- "0..1" Loan : about >
```

## 04-build-plan.md 第 1 节

新增两行：

| 类 | 表 | 要点 |
|---|---|---|
| Loan.closingReason | `loans.closing_reason` | 取消（T11）时必填 |
| Notification | `notifications` | 接收人外键非空；相关借用单外键可空；原型中只做系统内消息 |
