# minimal-swe-agent

[English](./README.md) | **简体中文**

一个使用 TypeScript 编写、不依赖 Agent 框架的小型软件工程 Agent。项目专注于
Coding Agent 最核心的执行路径：调度任务、构建上下文、调用模型、执行工具，并将
执行结果反馈给模型，直到完成任务。

## 为什么开发这个项目

大型 Coding Agent 框架通常会同时包含模型供应商适配、流程编排、工具、持久化、
记忆、插件和 UI。`minimal-swe-agent` 则尽可能明确、直观地展示核心链路：

```text
用户目标
   │
   ▼
TaskScheduler
   │
   ▼
WorkflowController
   │
   ├── PromptBuilder
   │
   ▼
AgentLoop ◄─────────────────────┐
   │                            │
   ├── ModelClient              │
   │       │                    │
   │       ▼                    │
   │    工具调用                 │
   │       │                    │
   └── ToolExecutor ── 执行结果 ─┘
           │
           ├── 文件工具
           └── 终端工具
```

它足够精简，便于学习、理解和扩展，同时也能用于处理真实代码仓库中的任务。

## 功能

- 不依赖 Agent 框架的模型／工具调用循环
- 结构化任务调度和依赖解析
- `检查 → 规划 → 执行 → 验证 → 总结` 工作流
- 将相关改动放在同一个执行阶段
- 只读模式与由程序执行的最终检查
- 结构化 Prompt 构建和有界工作流历史
- 机器可读的计划输出解析
- OpenAI 兼容的 Chat Completions 适配器
- 集中的工具注册、参数校验和执行器
- Terminal 命令与文件写入审批
- 限制在工作区内的文件访问，并检查符号链接逃逸
- 支持增量输出的进程内 Terminal 会话
- 命令超时、进程组终止和输出大小限制
- 最大执行步数和重复失败保护

## 工作流

实现任务按以下流程运行：

```text
检查 → 规划 → 执行（如需要）→ 验证 → 总结
```

规划阶段返回机器可读的任务计划：

```json
{
  "plan": [
    {
      "id": "implement",
      "title": "实现修改",
      "instruction": "修改相关源代码文件。",
      "dependencies": []
    }
  ]
}
```

调度器验证依赖关系，并把相关计划项合并到一个执行阶段。空计划跳过执行。
检查阶段只使用只读文件工具；规划和总结复用已有证据。
`--read-only` 只运行检查和总结。

## 可用工具

| 工具 | 用途 |
| --- | --- |
| `read_file` | 按行号读取有大小限制的 UTF-8 文件片段 |
| `write_file` | 创建或完整覆盖有大小限制的 UTF-8 文件 |
| `search_text` | 使用 ripgrep 搜索仓库文本 |
| `list_files` | 按限定深度和结果数量遍历文件 |
| `terminal_exec` | 执行命令；命令未结束时返回进程内会话 ID |
| `terminal_read` | 仅读取 Terminal 会话从上次读取后产生的新输出 |
| `terminal_write` | 向正在运行的 Terminal 会话写入输入 |
| `terminal_kill` | 向 Terminal 进程组发送 `SIGTERM` 或 `SIGINT` |

长时间运行的命令不会无限阻塞 Agent：

```text
terminal_exec
   │
   ├── 命令已结束 → stdout、stderr、退出码
   │
   └── 仍在运行 → sessionId
                    │
                    ├── terminal_read
                    ├── terminal_write
                    └── terminal_kill
```

## 环境要求

- macOS 或 Linux 上的 Node.js 20 或更高版本
- `search_text` 需要安装 [ripgrep](https://github.com/BurntSushi/ripgrep)
- 一个兼容 OpenAI Chat Completions 的 API

## 安装

```bash
npm ci
npm run build
```

## 配置

设置 API Key：

```bash
export OPENAI_API_KEY="your-api-key"
```

可选配置：

```bash
export MINIMAL_SWE_MODEL="gpt-4.1-mini"
export OPENAI_BASE_URL="https://api.openai.com/v1"
```

任何实现兼容 `/chat/completions` 接口的供应商，都可以通过修改
`OPENAI_BASE_URL` 和模型名称接入。

## 使用方法

针对一个代码仓库运行：

```bash
npm run dev -- \
  --cwd /path/to/project \
  "找到第一个失败的测试，修复原因并验证修改。"
```

如果需要让程序执行一次最终检查，并根据实际退出码判断结果：

```bash
npm run dev -- --cwd /path/to/project --check node --test project.test.cjs -- "修复失败的测试。"
```

Agent 的其他参数放在 `--check` 前面。这个模式下模型只使用文件工具，
程序在修改后按给定参数直接启动检查，超时为两分钟。检查失败会跳过成功总结，
CLI 以非零状态退出。未使用 `--check` 时，验证会标明是模型的判断。

只读排查不会写文件或执行终端命令：

```bash
npm run dev -- --cwd /path/to/project --read-only "说明 CI 如何运行测试。"
```

`--read-only` 不能和 `--check` 同用。

默认情况下，执行 Terminal 命令和写入文件需要交互式批准。对于可信的本地工作区，
可以使用 `--yes` 自动批准：

```bash
npm run dev -- \
  --yes \
  --cwd /path/to/project \
  "实现需要的功能并运行相关测试。"
```

CLI 参数：

```text
--cwd <path>       工作区目录
--model <id>       模型 ID
--base-url <url>   OpenAI 兼容 API 的基础 URL
--max-steps <n>    每个工作流步骤允许的最大模型／工具循环次数
--read-only        只读排查，不写文件或调用终端
--check <程序> [参数...] -- "任务"
                   修改后直接执行一次最终检查
--yes              自动批准 Terminal 命令和文件写入
--help             显示命令帮助
```

## 项目结构

```text
src/
├── agent/
│   ├── AgentLoop.ts
│   └── WorkflowController.ts
├── executor/
│   ├── PermissionPolicy.ts
│   └── ToolExecutor.ts
├── model/
│   └── OpenAICompatibleClient.ts
├── parser/
│   └── OutputParser.ts
├── prompt/
│   └── PromptBuilder.ts
├── runtime/
│   ├── PathSafety.ts
│   └── TerminalSessionManager.ts
├── scheduler/
│   └── TaskScheduler.ts
├── tools/
│   ├── FileTools.ts
│   ├── TerminalTools.ts
│   ├── Tool.ts
│   └── ToolRegistry.ts
├── cli.ts
├── index.ts
└── types.ts
```

## 安全模型

Agent 在运行时应用了以下限制：

- 内置文件工具检查工作区边界，写入拒绝将符号链接作为最终目标。
- 文本读取、写入、搜索、目录枚举和 Terminal 输出都有大小限制。
- 除非明确使用 `--yes`，否则修改型工具需要用户批准。
- Terminal 命令有硬超时。
- CLI 退出时会终止仍在运行的子进程组。
- 阻止重复执行完全相同且持续失败的工具调用。
- 每个工作流步骤都有最大模型／工具循环次数。

Shell 命令和 `--check` 指定的程序使用当前用户权限执行，没有系统沙箱。
`--yes` 只应当用于可信的仓库和任务，不能启用当前模式禁用的工具。

## 开发

构建项目：

```bash
npm run build
```

运行测试：

```bash
npm test
```

测试覆盖 Agent 循环、计划校验、工作区路径安全、终端会话、最终检查失败和
只读约束。[真实模型验收任务](examples/acceptance/README.md)记录了可复跑的单文件修复、
跨文件修改和只读排查。

## 当前范围

本项目有意不包含以下功能：

- 多 Agent 编排
- 长期记忆
- Skills 或插件
- MCP 工具加载
- HTTP 或 SSE 服务
- 对话持久化与恢复
- 自动上下文压缩

这些能力可以围绕现有接口继续扩展，而不需要修改核心的
“模型 → 工具调用 → 执行结果”循环。

## 许可证

MIT
