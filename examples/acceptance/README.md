# Minimal SWE Agent 实跑验收

每个用例的 `TASK.md` 是用户给 Agent 的任务。`workspace/` 是待处理的原始样本；前两个样本包含预期失败的测试，第三个样本仅用于阅读。每次复制到新的临时目录，保留原始样本供验收器比较。

| 用例 | 重点 | 独立验收 |
| --- | --- | --- |
| [01-labels](01-labels/TASK.md) | 定位单文件 bug，保留兼容性 | 原始测试、额外边界输入、改动范围 |
| [02-inventory](02-inventory/TASK.md) | 修改库接口和 CLI，保留默认行为 | 原始测试、额外库调用、CLI 输出与退出码、改动范围 |
| [03-ci-audit](03-ci-audit/TASK.md) | 跨文件定位配置问题，不写文件 | 字节比较、回答中的证据位置、人工核对因果解释和工具日志 |

从仓库根目录执行。先在环境中配置 `OPENAI_API_KEY`、`OPENAI_BASE_URL` 和 `MINIMAL_SWE_MODEL`，然后选择用例：

```sh
npm ci
npm run build
case_id=01-labels # 也可以选 02-inventory 或 03-ci-audit
case_dir="examples/acceptance/$case_id"
work="$(mktemp -d)"
cp -R "$case_dir/workspace/." "$work/"
answer="$(mktemp)"
case "$case_id" in
  01-labels) set -- --check node --test labels.test.cjs ;;
  02-inventory) set -- --check node --test inventory.test.cjs ;;
  03-ci-audit) set -- --read-only ;;
esac
node dist/src/cli.js --cwd "$work" "$@" -- "$(cat "$case_dir/TASK.md")" > "$answer"
agent_status=$?
cat "$answer"
test "$agent_status" -eq 0 && node examples/acceptance/judge.mjs "$case_id" "$work" "$answer"
```

保持默认审批模式，核对模型提出的写入后再批准。01 和 02 的 `--check` 由运行时执行一次；03 的 `--read-only` 不应出现审批请求或终端工具调用。判定通过需要 Agent 成功退出、独立验收通过；03 还要核对回答解释了为什么 glob 漏掉 smoke 文件，且没有把建议命令写成已执行。验收器对文件内容做比较，不依赖 Agent 声称测试通过。

2026-11-09 基线实跑（改动前，不使用新选项）：`deepseek-v4.1-flash-1017`，默认审批，每阶段最多 10 轮。三次 CLI 均退出 `0`。

| 用例 | 独立验收结果 | 模型请求 / 终端调用 |
| --- | --- | --- |
| 01 | 基线 2 过、1 失败；修复后 3 过，另有 2 个边界断言通过；只改 `labels.cjs` | 20 / 5 |
| 02 | 基线 1 过、1 失败；新增功能后 2 过，另有 3 个库断言、4 个 CLI 场景通过；只改 `inventory.cjs` 和 `cli.cjs` | 30 / 14 |
| 03 | 正确解释测试 glob 漏掉 smoke 文件的原因；文件逐字节一致，未调用终端 | 12 / 0 |

两项写代码用例分别有 3 次和 5 次终端调用包含原始测试命令。还观察到 `测试命令; echo $?` 一类写法：终端工具拿到的是整段 shell 的退出码，最后的 `echo` 可以掩盖前面的失败。独立验收直接执行测试及 CLI 子进程并检查各自的退出码。

2026-11-09 改动后复跑：同一模型、审批模式、轮数上限和任务文档。三个 CLI 均退出 `0`，原有独立验收全部通过。

| 用例 | 模型请求（前 → 后） | 原始测试执行（前 → 后，不含独立验收） |
| --- | --- | --- |
| 01 | 20 → 8 | 3 → 1 |
| 02 | 30 → 9 | 5 → 1 |
| 03 | 12 → 4 | 0 → 0 |

复跑中模型没有调用终端；01、02 的测试由运行时启动，03 的文件逐字节不变。`npm test` 还包含反向验收：真实测试失败时 CLI 非零退出并跳过成功总结；即使启用 `--yes`，只读模式也拒绝模型请求的写文件和 shell 调用。
