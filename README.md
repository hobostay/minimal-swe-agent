# minimal-swe-agent

**English** | [简体中文](./README_zh-CN.md)

A small software-engineering agent written in TypeScript without an agent
framework. The project focuses on the essential execution path of a coding
agent: scheduling work, constructing context, calling a model, executing tools,
and feeding observations back into the model until the task is complete.

## Why this project exists

Large coding-agent frameworks often combine model providers, orchestration,
tools, persistence, memory, plugins, and UI concerns. `minimal-swe-agent` keeps
the core path explicit and readable:

```text
User goal
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
   │    tool calls              │
   │       │                    │
   └── ToolExecutor ── results ─┘
           │
           ├── file tools
           └── terminal tools
```

The implementation is intended to be compact enough to study and extend while
still being practical for real repository tasks.

## Features

- Framework-free model/tool agent loop
- Structured task scheduling and dependency resolution
- `inspect → plan → execute → verify → summarize` workflow
- One execution phase for related changes
- Read-only mode and an optional runtime-managed final check
- Structured prompt construction with bounded workflow history
- Machine-readable plan output parsing
- OpenAI-compatible Chat Completions adapter
- Central tool registry, argument validation, and executor
- Approval gate for terminal commands and file mutations
- Workspace-constrained file access with symlink escape checks
- In-process terminal sessions with incremental output
- Command timeout, process-group termination, and output limits
- Maximum-step and repeated-failure protection

## Workflow

Implementation tasks follow this workflow:

```text
inspect → plan → execute (if needed) → verify → summarize
```

The planning phase returns a machine-readable plan:

```json
{
  "plan": [
    {
      "id": "implement",
      "title": "Implement the change",
      "instruction": "Update the relevant source files.",
      "dependencies": []
    }
  ]
}
```

The scheduler validates dependencies and runs related plan items in one
execution phase. An empty plan skips execution. Inspection uses read-only file
tools; planning and summarization reuse the evidence from earlier phases.
`--read-only` runs just inspection and summarization.

## Available tools

| Tool | Purpose |
| --- | --- |
| `read_file` | Read a bounded, line-numbered range from a UTF-8 file |
| `write_file` | Create or completely overwrite a bounded UTF-8 file |
| `search_text` | Search repository text with ripgrep |
| `list_files` | Traverse files with bounded depth and result count |
| `terminal_exec` | Run a command and return output or an in-process session ID |
| `terminal_read` | Read only output produced since the previous session read |
| `terminal_write` | Write input to a running terminal session |
| `terminal_kill` | Send `SIGTERM` or `SIGINT` to a terminal process group |

Long-running commands do not block the agent indefinitely:

```text
terminal_exec
   │
   ├── command finished → stdout, stderr, exit code
   │
   └── still running → sessionId
                         │
                         ├── terminal_read
                         ├── terminal_write
                         └── terminal_kill
```

## Requirements

- Node.js 20 or later on macOS or Linux
- [ripgrep](https://github.com/BurntSushi/ripgrep) for `search_text`
- An OpenAI-compatible Chat Completions endpoint

## Installation

```bash
npm ci
npm run build
```

## Configuration

Set the API key:

```bash
export OPENAI_API_KEY="your-api-key"
```

Optional configuration:

```bash
export MINIMAL_SWE_MODEL="gpt-4.1-mini"
export OPENAI_BASE_URL="https://api.openai.com/v1"
```

Any provider implementing a compatible `/chat/completions` endpoint can be used
by changing `OPENAI_BASE_URL` and the model name.

## Usage

Run against a repository:

```bash
npm run dev -- \
  --cwd /path/to/project \
  "Find the first failing test, fix the cause, and verify the change."
```

To have the runtime execute one final check and use its actual exit status:

```bash
npm run dev -- --cwd /path/to/project --check node --test project.test.cjs -- "Fix the failing test."
```

Put agent options before `--check`. The runtime starts the supplied program
directly with the given arguments after the edits, with a two-minute timeout.
The model only has file tools in this mode. A failed check skips the success
summary and exits nonzero. Without `--check`, the verification is explicitly
labeled as the model's assessment.

For an audit without writes or terminal commands:

```bash
npm run dev -- --cwd /path/to/project --read-only "Explain how CI runs tests."
```

`--read-only` cannot be combined with `--check`.

By default, terminal execution and file writes require interactive approval.
For a trusted local workspace, use `--yes`:

```bash
npm run dev -- \
  --yes \
  --cwd /path/to/project \
  "Implement the requested feature and run the relevant tests."
```

CLI options:

```text
--cwd <path>       Workspace directory
--model <id>       Model identifier
--base-url <url>   OpenAI-compatible API base URL
--max-steps <n>    Maximum model/tool rounds per workflow step
--read-only        Inspect and answer without writes or terminal tools
--check <program> [args...] -- "task"
                   Run one final check directly after implementation
--yes              Auto-approve terminal commands and file writes
--help             Show command help
```

## Project structure

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

## Safety model

The agent applies several runtime limits:

- Built-in file tools check the workspace boundary. Writes reject symlinks
  as the final target.
- Text reads, writes, searches, directory listings, and terminal output are
  bounded.
- Mutating tools require approval unless `--yes` is explicitly provided.
- Terminal commands have hard timeouts.
- Long-running child process groups are terminated when the CLI exits.
- Repeated identical failing tool calls are stopped.
- Every workflow step has a maximum number of model/tool rounds.

Shell commands and the program supplied to `--check` run with the current
user's permissions and are not sandboxed. Use `--yes` only for trusted
repositories and tasks. It does not grant access to tools disabled by a mode.

## Development

Build the project:

```bash
npm run build
```

Run the tests:

```bash
npm test
```

The tests cover the agent loop, plan validation, workspace path safety,
terminal sessions, final-check failure, and read-only enforcement. See the
[real-model acceptance tasks](examples/acceptance/README.md) for reproducible
bug-fix, cross-file feature, and read-only investigation scenarios.

## Current scope

The project deliberately does not include:

- multi-agent orchestration
- long-term memory
- skills or plugins
- MCP tool loading
- HTTP or SSE services
- conversation persistence and resume
- automatic context compaction

These can be added around the existing interfaces without changing the core
model → tool call → observation loop.

## License

MIT
