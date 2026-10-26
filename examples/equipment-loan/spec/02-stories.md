# 用户故事与验收标准

每条 AC 末尾注明依据：BR 业务规则、DT 决策表、T 状态转换（见 `models/06-state-loan.puml`）、GC 黄金案例。

## 功能用户故事

### FUS1 — As a Borrower, I want to submit a loan request online, so that I no longer fill in paper forms and walk between offices.

- AC1: 身份、设备、用途、使用地点、借用日期、预计归还日期任一项为空时不能提交，并在对应栏位旁说明缺少什么。(BR-01)
- AC2: 一张申请可以选择多件设备，只能从可借设备列表中选择。(BR-01)
- AC3: 预计归还日期超出 DT-02 规定的最长期限时不能提交，并提示该借用人此次可借的最长天数。(BR-06, DT-02)
- AC4: 提交成功后显示借用单编号，借用单状态为"已申请"，设备管理员的待审核列表中出现这张单。(BR-01, GC-01)

### FUS2 — As a Borrower, I want to withdraw my request before it is approved, so that equipment I no longer need is freed for others.

- AC1: Given 一张"已申请"的借用单 When 借用人撤回 Then 状态变为"已撤回"。(BR-08, T5)
- AC2: Given 一张"等待设备"的借用单 When 借用人撤回 Then 状态变为"已撤回"，借用单离开等待名单。(BR-08, T6, GC-04)
- AC3: 借用单为"已批准"及之后的状态时，借用人的页面上没有"撤回"操作，直接请求撤回会被拒绝。(BR-08)
- AC4: 撤回后，这张单占用的设备可以被其他申请使用。(BR-03, GC-04)

### FUS3 — As a Manager, I want each request checked for overdue loans and equipment availability before I decide, so that I don't approve requests that break the rules.

- AC1: 审核页面同时显示两项检查结果：借用人名下是否有已逾期的借用单、申请的设备在借用期间是否足够。(BR-03, BR-12)
- AC2: Given 申请的设备在借用期间不足 When 管理员审核 Then 借用单变为"等待设备"，借用人收到通知。(BR-03, T1, GC-04)
- AC3: 借用人名下有已逾期借用单时，"批准"操作被拒绝，并提示原因。(BR-12, GC-03)
- AC4: 拒绝时必须填写原因；Given 填写了原因 When 拒绝 Then 借用单变为"已拒绝"，借用人收到含原因的通知。(BR-04, T4, GC-03)
- AC5: Given 借用单只需设备管理员审批（DT-01 R1）When 管理员批准 Then 借用单变为"已批准"，借用人收到通知。(BR-02, DT-01, T3, GC-01)
- AC6: Given 借用人以前有过逾期但都已归还（如台账中的 S-022）When 管理员审核 Then 检查结果显示"没有逾期未还的借用单"，可以批准。(BR-12, GC-05)

### FUS4 — As a DeptHead, I want to approve requests for valuable equipment or off-campus use in the system, so that borrowers no longer bring paper forms to my office.

- AC1: Given 借用单需要部门负责人审批（DT-01 R2 或 R3）When 设备管理员批准 Then 借用单仍为"已申请"，部门负责人的待审批列表中出现这张单。(BR-02, DT-01, GC-02)
- AC2: Given 设备管理员已批准 When 部门负责人批准 Then 借用单变为"已批准"，借用人收到通知。(BR-02, T3, GC-02)
- AC3: 部门负责人不同意时必须填写原因，借用单变为"已拒绝"。(BR-02, BR-04, T4)
- AC4: 部门负责人的待审批列表中只出现设备管理员已经同意的借用单。(BR-02)
- AC5: 设备单价正好 5000 元时不算贵重设备，不需要部门负责人审批。(DT-01)

### FUS5 — As a Clerk, I want to check out equipment only after the agreement is signed and every asset tag is verified, so that every loan is backed by a signed agreement and the right equipment.

- AC1: 借用协议未签署时，"办理借出"被拒绝，并提示"请先签署借用协议"。(BR-05, T7)
- AC2: 任何一件设备的资产标签核对不通过时，整张借用单不能借出，并提示是哪一件。(BR-11, T7)
- AC3: 资产登记系统连接不上时，提示"暂时无法核对资产标签，请稍后再试或联系设备管理员"，借用单保持"已批准"。(BR-11)
- AC4: Given 协议已签署且所有标签核对通过 When 办理借出 Then 借用单变为"借出中"，记录借出日期和经办人。(BR-05, BR-11, T7, GC-01)

### FUS6 — As a Manager, I want overdue loans flagged the day after they are due, so that I can chase them immediately instead of finding them a week later.

- AC1: Given 一张"借出中"的借用单，应还日期已过 When 系统执行到期检查 Then 借用单变为"已逾期"，借用人和设备管理员收到提醒。(BR-07, T8, GC-01)
- AC2: 应还日期当天执行到期检查时，借用单不变为"已逾期"。(BR-07)
- AC3: 设备管理员可以在页面上手动运行到期检查。(BR-07, T8)
- AC4: 借用人首页醒目显示自己已逾期的借用单。(BR-07)

### FUS7 — As a Staff, I want the late fee calculated by the system when equipment is returned, so that every borrower is charged by the same rule.

- AC1: Given 一张"借出中"的借用单 When 办理归还 Then 借用单变为"已归还"，不产生逾期费。(T9, GC-02)
- AC2: Given 一张"已逾期"的借用单 When 办理归还 Then 系统按每逾期 1 天 10 元计算逾期费，登记缴费后借用单变为"已归还"。(BR-10, T10, GC-01)
- AC3: 逾期费超过 200 元时按 200 元收取。例如台账 JY-0905 应还 9 月 12 日，10 月 10 日归还，逾期 28 天，收取 200 元。(BR-10, GC-03)
- AC4: 系统不提供减免或修改逾期费的操作。(BR-10)
- AC5: 办事员和设备管理员都可以办理归还。(T9)

### FUS8 — As a Manager, I want to be told when equipment on the waiting list becomes available, so that waiting requests are not forgotten.

- AC1: Given 一张"等待设备"的借用单 When 它等待的设备被归还或其他借用单被撤回 Then 设备管理员收到通知。(BR-03, T2, GC-04)
- AC2: 收到通知后，这张借用单回到"已申请"，重新进行审核检查。(BR-03, T2)
- AC3: 等待名单按提交时间排序显示。(BR-03)

### FUS9 — As a Manager, I want to cancel an approved loan before it is checked out, so that I can handle borrowers who no longer need the equipment.

- AC1: Given 一张"已批准"的借用单 When 设备管理员取消并填写原因 Then 借用单变为"已撤回"。(BR-08, T11)
- AC2: 借用单为"借出中"及之后的状态时不能取消。(BR-08)
- AC3: 取消后借用人收到含原因的通知。(BR-08, T11)

### FUS10 — As a DeptHead, I want to be reminded of requests waiting for my approval, so that borrowers are not kept waiting.

- AC1: 借用单提交 2 个工作日后仍未审批完时，系统提醒尚未审批的审批人。(BR-09)
- AC2: 计算工作日时不计周六和周日。(BR-09)
- AC3: 只提醒按 DT-01 需要审批、且尚未审批的人。(BR-09, DT-01)

### FUS11 — As a DeptHead, I want to see monthly loan statistics, so that I can judge how well the equipment is used.

- AC1: 统计页按月显示借用单数，并按状态分类。(BR-13)
- AC2: 显示当月借出次数最多的 10 件设备。(BR-13)
- AC3: 显示当月逾期率（当月产生逾期的借用单数 ÷ 当月借出的借用单数）。(BR-13)

## 非功能用户故事

### NFUS1 — As a Manager, I want each role limited to its own operations, so that nobody can approve, cancel or view what they shouldn't.

- AC1: 每个角色只能执行 CRUD 矩阵允许的操作，越权请求在服务端被拒绝。(访问控制) [原型测试]
- AC2: 借用人只能查看自己的借用单。(访问控制, C-03) [原型测试]
- AC3: 连续 5 次登录失败后账号锁定 15 分钟。(访问控制) [原型测试]

### NFUS2 — As a Manager, I want every key operation recorded, so that I can find out who did what when something goes wrong.

- AC1: 每次审批、取消、借出、归还、逾期和收费都记录操作人、时间、借用单编号、操作类型和变更前后的状态。(审计, C-04) [原型测试]
- AC2: 操作记录任何角色都不能修改或删除。(审计) [原型测试]
- AC3: 设备管理员可以在借用单详情页查看完整操作历史。(审计) [原型演示]

### NFUS3 — As a Borrower, I want my phone number visible only to equipment-room staff, so that my personal information is not exposed.

- AC1: 部门负责人和其他借用人看到的手机号为部分隐藏（如 138****1234），办事员和设备管理员可以看到完整号码。(隐私, C-01) [原型测试]
- AC2: 演示数据中的人员和联系方式全部为虚构。(隐私, C-06) [原型演示]

### NFUS4 — As a Clerk, I want pages to respond quickly during the busy start of term, so that the queue at the counter keeps moving.

- AC1: 在约 5000 张借用单、320 件设备的演示数据下，借用单列表和搜索在 2 秒内显示结果。(性能) [原型测试]
- AC2: 办理借出和归还的保存操作在 1 秒内完成。(性能) [原型测试]
- AC3: 高峰期每天 60 单、3 人同时操作时系统可用。(性能) [原型不验证]

### NFUS5 — As a Borrower, I want to submit and track requests from my phone, so that I don't need to come to the equipment room just to apply.

- AC1: 提交申请、查看我的借用单、撤回申请在手机屏幕宽度下可以完整操作。(兼容性) [原型演示]
- AC2: 每个角色最常做的三件事，从首页出发不超过 3 次点击可以开始。(易用性) [原型演示]
- AC3: 必填项有标记，提交失败时在对应栏位旁说明原因。(易用性) [原型测试]

### NFUS6 — As a Manager, I want records kept and rule settings adjustable, so that we meet the archive rule and can update fees or reminders without changing the system.

- AC1: 借用单不提供删除操作，只能撤回或取消。(数据保留, C-02) [原型测试]
- AC2: 逾期费单价、上限和审批提醒的工作日数由设备管理员在设置页修改，修改后对之后的计算生效。(可配置性, BR-09, BR-10) [原型测试]
- AC3: 借用记录 3 年后的归档和销毁。(数据保留, C-02) [原型不验证]
