# 示例：设备借用系统

一个虚构的完整示例，展示 PM/BA Panda 从阶段 0 到阶段 6 的全部产出：从一份 Excel 台账和几份规定出发，到一个可运行、经过验证、可以拿去演示的原型。机构、人物和数据均为虚构。

## 背景

星河学院传媒中心的设备室用 Excel 台账和纸质申请单管理设备借用，存在重复登记、审批签字耽误时间、逾期发现太晚等问题。产品负责人希望做一个原型向学院领导演示，争取正式立项。

## 从哪里开始看

| 想看什么 | 文件 |
|---|---|
| 每个阶段给用户看了什么、用户决定了什么 | `spec/reviews/` 下的 9 份评审摘要（0–4、5a、5b、5c、6） |
| 从现有材料中挖出了什么 | `spec/00-materials/` → `spec/01-mining.md` |
| 规则与决策表 | `spec/01-rules.md`、`spec/01-decision-tables.md` |
| 真实案例 | `spec/golden-cases.md` |
| 用户故事 | `spec/02-stories.md` |
| 设计图 | `spec/models/*.png`，每张图配一份 `.card.md` 说明卡 |
| 一致性检查 | `spec/models/consistency-report.md` |
| 构建计划与追溯矩阵 | `spec/04-build-plan.md`、`spec/trace.csv` |
| 搭建中发现的规格问题怎么处理 | `spec/changes/archive/`（两次变更提案） |
| 原型 | `app/`，运行方法见 `app/README.md` |
| 界面截图 | `spec/reviews/5c/`（角色走查）、`spec/reviews/6/`（黄金案例） |
| 演示和交接 | `spec/06-demo-script.md`、`spec/06-handover.md` |

## 数字一览

- 13 条业务规则、2 张决策表、5 个黄金案例、33 项例外逐项确认；台账 9 条记录逐行核对，发现 3 处矛盾
- 11 个功能故事、6 个非功能故事、61 条验收标准
- 8 张 UML 图（含 1 张现状图），状态机 8 个状态、11 条转换
- 搭建中发现 2 处需要改规格的问题，按变更流程处理；5 处规格没写清的地方请用户确认
- 150 项单元和集成测试、8 项从界面操作的端到端测试（5 个黄金案例、演示脚本排练、表单改错重交）
- 反向检查：故意埋入 21 个典型错误（规则、权限、计算、静态检查、界面），测试全部发现
- 追溯矩阵：61 条验收标准、每行决策表、每条状态转换、每个黄金案例都有通过的测试，缺口 0

## 自己重新运行检查

在 skill 根目录下：

```bash
scripts/render_uml.sh examples/equipment-loan/spec/models
python3 scripts/check_consistency.py examples/equipment-loan     # 只更新报告的自动部分，人工检查结果保留
python3 scripts/build_trace.py examples/equipment-loan
```

在 `app/` 目录下：

```bash
npm install
npm run setup && npm test          # 单元和集成测试
npm run test:e2e                   # 构建后从界面跑黄金案例和演示脚本
python3 ../../../scripts/mutation_check.py tests/mutations.json --after "npx next build"   # 反向检查
```
