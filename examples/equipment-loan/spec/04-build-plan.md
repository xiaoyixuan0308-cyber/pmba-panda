# 构建计划

技术栈：默认方案（`references/default-stack.md`）。映射规则：`references/uml-to-code-mapping.md`。

## 1. 数据（类图 → 表结构）

| 类 | 表 | 要点 |
|---|---|---|
| Person / Borrower / StaffMember | `people` | 泛化采用单表 + 类型字段（`kind`: borrower / staff）；Borrower、StaffMember 的专有字段可空，按类型在服务端校验必填 |
| Loan | `loans` | `status` 为 LoanStatus 枚举，默认 Requested；`loanNo` 唯一，格式 JY-NNNN；`/isOverdue`、`/hasValuableItem` 不存储，读取时计算 |
| Loan–Equipment（聚合，0..* 对 1..*） | `loan_items` | 关联表；创建借用单时校验至少 1 件（下限 1）；删除借用单不删除设备（实际上借用单不可删除，C-02） |
| Equipment | `equipment` | `unitPrice` 以分为单位；`/valuable` = 单价 > 500000 分 |
| Approval（组合） | `approvals` | 外键非空、级联删除；`approverRole + loanId` 唯一 |
| Agreement（组合，0..1） | `agreements` | `loanId` 唯一、非空、级联删除 |
| LateFee（组合，0..1） | `late_fees` | `loanId` 唯一、非空、级联删除；`amount` 以分为单位 |
| AuditEntry | `audit_entries` | 只允许插入（NFUS2） |
| Loan.closingReason | `loans.closing_reason` | 取消（T11）时必填（变更 001） |
| Notification | `notifications` | 接收人外键非空；相关借用单外键可空；原型中只做系统内消息（变更 001） |
| 设置项 | `settings` | 逾期费单价、上限、提醒工作日数（NFUS6 AC2） |

不持久化的类型：LoanForm、DateRange 仅作为服务函数的输入（zod 校验）。

## 2. 规则与状态（状态机、决策表、守卫）

转换表 `src/domain/loan/transitions.ts`：

| 编号 | 从 → 到 | 触发 | 执行角色 | 守卫 | 效果 | BR |
|---|---|---|---|---|---|---|
| T1 | Requested → Waitlisted | review | Manager | not equipmentAvailable | —（进入等待设备时通知借用人） | BR-03 |
| T2 | Waitlisted → Requested | equipmentReleased | 系统 | — | —（进入已申请时通知待审批人） | BR-03 |
| T3 | Requested → Approved | approve | Manager、DeptHead | allApprovalsGiven && equipmentAvailable && noOverdueLoans | 通知借用人 | BR-02、BR-03、BR-12 |
| T4 | Requested → Rejected | reject | Manager、DeptHead | 已填写原因 | 记录原因、通知借用人 | BR-04 |
| T5 | Requested → Withdrawn | withdraw | Borrower（本人） | — | 释放设备 | BR-08 |
| T6 | Waitlisted → Withdrawn | withdraw | Borrower（本人） | — | — | BR-08 |
| T7 | Approved → OnLoan | checkOut | Clerk | agreementSigned && assetTagsVerified | 记录借出日期、经办人 | BR-05、BR-11 |
| T8 | OnLoan → Overdue | expire | 系统 | 今天 > dueDate | 通知借用人和设备管理员 | BR-07 |
| T9 | OnLoan → Returned | return | Clerk、Manager | — | 记录归还日期 | — |
| T10 | Overdue → Returned | return | Clerk、Manager | — | 计算逾期费，借用人当场缴纳后登记（变更 002 更正） | BR-10 |
| T11 | Approved → Withdrawn | cancel | Manager | 已填写原因 | 记录原因、通知借用人 | BR-08 |

- 状态内部动作：Requested 中审批人同意但仍有审批未完成时，只新增审批记录，不改变状态（BR-02）。
- 守卫函数：`src/domain/loan/guards.ts`，每个函数带 `// BR-xx`。
- 决策表：`src/rules/decision-tables.ts` 中 DT-01（审批人）、DT-02（最长期限）写成数据 + 查找函数。
- 事务边界：每次转换在同一事务中完成"检查守卫 → 改状态 → 执行效果 → 写操作记录"。借出时多件设备的标签核对在事务之前完成，全部通过后再进入事务。

## 3. 权限（CRUD 矩阵、角色视角表）

- `src/auth/permissions.ts` 按 `01-crud-matrix.md` 生成；"本人"类权限在查询中按 `borrowerId` 过滤。
- 手机号：员工账号之外，返回部分隐藏的号码（C-01、NFUS3）。
- 每个角色的首页按 `01-role-views.md` 中"登录后首先看到"一栏实现。

## 4. 外部系统与时间规则

| 对象 | 原型实现 | 交接说明 |
|---|---|---|
| 资产登记系统 | `src/adapters/asset-registry/`：接口 + 模拟实现；模拟数据中有 1 个无效标签，并可在设置页切换"资产系统不可用"以演示 FUS5 AC3 | 正式开发需对接学院资产系统接口 |
| 通知 | 系统内消息；页面标注"模拟通知" | 正式开发接入邮件或企业微信 |
| 每日到期检查、审批提醒 | 设备管理员页面上的"运行到期检查"按钮；可在设置页指定"模拟今天的日期" | 正式开发改为每日定时任务 |

## 5. 构建顺序

| 阶段 | 内容 | 完成标志 |
|---|---|---|
| 5a 数据 | 表结构、演示数据：320 件设备（40 件贵重）、约 5000 张历史借用单、每种状态至少 3 张、5 个黄金案例的起始数据（GC-02、GC-03、GC-05 按台账记录预置；GC-01、GC-04 只预置人员并保证相关设备空闲，借用过程由测试在模拟日期下通过系统操作完成）、5 个演示账号（学生、教师各 1 个借用人账号，办事员、设备管理员、部门负责人各 1 个；Staff 是父角色，无独立账号） | `npm run setup` 成功，数据量符合 NFUS4 |
| 5b 规则和权限 | 转换表与转换函数、守卫、决策表、权限配置、操作记录、逾期费计算、模拟适配器 | 第 6 节的单元和集成测试全部通过 |
| 5c 界面 | 各角色首页、申请表单（手机宽度可用）、审核页（并列显示两项检查）、柜台页、统计页、设置页 | 角色走查截图交用户确认 |

## 6. 测试计划

| 类型 | 范围 | 数量 |
|---|---|---|
| 单元测试 | DT-01 R1–R3、DT-02 R1–R6，每行 1 个；边界：单价正好 5000 元、应还日期当天、逾期费 200 元上限 | 9 + 3 |
| 集成测试 | T1–T11 每条成功 1 个；每个守卫不通过 1 个；终止状态下操作被拒绝；每次转换产生操作记录 | 约 25 |
| 集成测试 | 每条 FUS 和 NFUS 的 AC（标为原型演示、原型不验证的除外），测试名带 AC 编号 | 约 50 |
| 端到端测试 | GC-01 至 GC-05 | 5 |
| 角色走查 | 5 个角色的主流程和例外流程 | 5 |
| 无障碍扫描 | 申请表单、审核页、柜台页 | 3 |

## 7. 不做或留给正式开发的部分

- E20 负责人不在时代理审批、E21 人员离职交接（已和用户确认）
- NFUS4 AC3 高峰期压力测试、NFUS6 AC3 三年后归档销毁（原型不验证）
- 账号管理（演示账号预置）
- 节假日日历（工作日只排除周末）
