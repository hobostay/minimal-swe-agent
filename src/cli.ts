#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { AgentLoop } from "./agent/AgentLoop.js";
import { WorkflowController } from "./agent/WorkflowController.js";
import { PermissionPolicy, type PermissionMode } from "./executor/PermissionPolicy.js";
import { ToolExecutor } from "./executor/ToolExecutor.js";
import { OpenAICompatibleClient } from "./model/OpenAICompatibleClient.js";
import { TerminalSessionManager } from "./runtime/TerminalSessionManager.js";
import { ListFilesTool, ReadFileTool, SearchTextTool, WriteFileTool } from "./tools/FileTools.js";
import {
  TerminalExecTool,
  TerminalKillTool,
  TerminalReadTool,
  TerminalWriteTool,
} from "./tools/TerminalTools.js";
import { ToolRegistry } from "./tools/ToolRegistry.js";

type CliOptions = {
  cwd: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  permissionMode: PermissionMode;
  maxSteps: number;
  goal: string;
};

function usage(): string {
  return `minimal-swe-agent [options] "task"

Options:
  --cwd <path>       Workspace directory (default: current directory)
  --model <id>       Model id (default: MINIMAL_SWE_MODEL or gpt-4.1-mini)
  --base-url <url>   OpenAI-compatible API base URL
  --max-steps <n>    Max model/tool rounds per workflow step (default: 40)
  --yes              Auto-approve terminal and file writes
  --help             Show this help

Environment:
  OPENAI_API_KEY     Required API key
  MINIMAL_SWE_MODEL  Optional model id
  OPENAI_BASE_URL    Optional compatible API URL`;
}

function take(args: string[], index: number, name: string): string {
  const value = args[index + 1];
  if (!value) throw new Error(`${name} requires a value.`);
  args.splice(index, 2);
  return value;
}

function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];
  let cwd = process.cwd();
  let model = process.env.MINIMAL_SWE_MODEL ?? "gpt-4.1-mini";
  let baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  let permissionMode: PermissionMode = "ask";
  let maxSteps = 40;

  for (let index = 0; index < args.length;) {
    const arg = args[index]!;
    if (arg === "--help") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (arg === "--yes") {
      permissionMode = "auto";
      args.splice(index, 1);
      continue;
    }
    if (arg === "--cwd") {
      cwd = path.resolve(take(args, index, arg));
      continue;
    }
    if (arg === "--model") {
      model = take(args, index, arg);
      continue;
    }
    if (arg === "--base-url") {
      baseUrl = take(args, index, arg);
      continue;
    }
    if (arg === "--max-steps") {
      maxSteps = Number.parseInt(take(args, index, arg), 10);
      if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new Error("--max-steps must be positive.");
      continue;
    }
    index += 1;
  }

  const goal = args.join(" ").trim();
  if (!goal) throw new Error(`A task is required.\n\n${usage()}`);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required.");
  return { cwd, model, baseUrl, apiKey, permissionMode, maxSteps, goal };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const sessions = new TerminalSessionManager();
  const registry = new ToolRegistry()
    .register(new ReadFileTool())
    .register(new WriteFileTool())
    .register(new SearchTextTool())
    .register(new ListFilesTool())
    .register(new TerminalExecTool(sessions))
    .register(new TerminalReadTool(sessions))
    .register(new TerminalWriteTool(sessions))
    .register(new TerminalKillTool(sessions));

  const abortController = new AbortController();
  const onSignal = () => abortController.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  const model = new OpenAICompatibleClient({
    apiKey: options.apiKey,
    model: options.model,
    baseUrl: options.baseUrl,
  });
  const executor = new ToolExecutor(
    registry,
    new PermissionPolicy(options.permissionMode),
    { cwd: options.cwd, signal: abortController.signal },
  );
  const loop = new AgentLoop(model, registry, executor, {
    maxSteps: options.maxSteps,
    onEvent(event) {
      if (event.type === "tool_start") process.stderr.write(`  → ${event.call.name}\n`);
      if (event.type === "tool_end" && !event.result.ok) {
        process.stderr.write(`  ! ${event.result.error?.message ?? "tool failed"}\n`);
      }
    },
  });

  try {
    const result = await new WorkflowController(loop, options.cwd).run(
      options.goal,
      abortController.signal,
    );
    process.stdout.write(`${result.output}\n`);
    if (result.status !== "completed") process.exitCode = 1;
  } finally {
    sessions.cleanup();
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}

main().catch(error => {
  process.stderr.write(`minimal-swe-agent: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
