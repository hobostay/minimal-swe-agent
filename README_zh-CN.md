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
- 由规划阶段动态生成执行任务
- 结构化 Prompt 构建和有界工作流历史
- 机器可读的计划输出解析
- OpenAI 兼容的 Chat Completions 适配器
- 集中的工具注册、参数校验和执行器
- Terminal 命令与文件写入审批
- 限制在工作区内的文件访问，并检查符号链接逃逸
- 支持增量输出的持久 Terminal 会话
- 命令超时、进程组终止和输出大小限制
- 最大执行步数和重复失败保护

## 工作流

每个任务都会从两个固定阶段开始：

```text
检查 → 规划
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
    },
    {
      "id": "test",
      "title": "运行针对性测试",
      "instruction": "运行相关测试并修复失败项。",
      "dependencies": ["implement"]
    }
  ]
}
```

执行之前，本地计划 ID 会被映射为内部任务 ID，最终形成如下工作流：

```text
检查
  ↓
规划
  ↓
动态执行任务
  ↓
验证
  ↓
总结
```

## 可用工具

| 工具 | 用途 |
| --- | --- |
| `read_file` | 按行号读取有大小限制的 UTF-8 文件片段 |
| `write_file` | 创建或完整覆盖有大小限制的 UTF-8 文件 |
| `search_text` | 使用 ripgrep 搜索仓库文本 |
| `list_files` | 按限定深度和结果数量遍历文件 |
| `terminal_exec` | 执行命令；命令未结束时返回持久会话 ID |
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

- Node.js 20 或更高版本
- `search_text` 需要安装 [ripgrep](https://github.com/BurntSushi/ripgrep)
- 一个兼容 OpenAI Chat Completions 的 API

## 安装

```bash
npm install
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

- 读取和写入路径必须位于所选工作区内。
- 对已有符号链接解析真实路径，并检查是否逃逸工作区。
- 文本读取、写入、搜索、目录枚举和 Terminal 输出都有大小限制。
- 除非明确使用 `--yes`，否则修改型工具需要用户批准。
- Terminal 命令有硬超时。
- CLI 退出时会终止仍在运行的子进程组。
- 阻止重复执行完全相同且持续失败的工具调用。
- 每个工作流步骤都有最大模型／工具循环次数。

`--yes` 只应当用于你信任的代码仓库和任务。使用该参数后，模型可以在不逐次询问的
情况下执行 Shell 命令和修改文件。

## 开发

构建项目：

```bash
npm run build
```

运行测试：

```bash
npm test
```

测试覆盖 Agent loop、计划解析、任务依赖映射、工作区路径安全和 Terminal 增量输出。

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
