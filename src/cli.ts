#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs/promises";
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
  readOnly: boolean;
  check?: [string, ...string[]];
  goal: string;
};

function usage(): string {
  return `minimal-swe-agent [options] "task"

Options:
  --cwd <path>       Workspace directory (default: current directory)
  --model <id>       Model id (default: MINIMAL_SWE_MODEL or gpt-4.1-mini)
  --base-url <url>   OpenAI-compatible API base URL
  --max-steps <n>    Max model/tool rounds per workflow step (default: 40)
  --read-only        Inspect and answer without writes or shell tools
  --check <program> [args...] -- "task"
                     Run one final check directly; model uses file tools only
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
  let readOnly = false;
  let check: CliOptions["check"];
  const goalParts: string[] = [];

  for (let index = 0; index < args.length;) {
    const arg = args[index]!;
    if (arg === "--") {
      goalParts.push(...args.slice(index + 1));
      break;
    }
    if (arg === "--help") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (arg === "--yes") {
      permissionMode = "auto";
      args.splice(index, 1);
      continue;
    }
    if (arg === "--read-only") {
      readOnly = true;
      args.splice(index, 1);
      continue;
    }
    if (arg === "--check") {
      const separator = args.indexOf("--", index + 1);
      const program = args[index + 1];
      if (separator <= index + 1 || !program?.trim() || program.startsWith("-")) {
        throw new Error('--check requires a program, optional arguments, and -- before the task.');
      }
      check = [program, ...args.slice(index + 2, separator)];
      goalParts.push(...args.slice(separator + 1));
      break;
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
      const value = take(args, index, arg);
      maxSteps = Number(value);
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(maxSteps) || maxSteps < 1) {
        throw new Error("--max-steps must be a positive integer.");
      }
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}. See --help.`);
    goalParts.push(arg);
    index += 1;
  }

  const goal = goalParts.join(" ").trim();
  if (readOnly && check) throw new Error("--read-only cannot be combined with --check.");
  if (!goal) throw new Error(`A task is required.\n\n${usage()}`);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required.");
  return { cwd, model, baseUrl, apiKey, permissionMode, maxSteps, goal, readOnly, check };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const cwd = await fs.realpath(options.cwd);
  if (!(await fs.stat(cwd)).isDirectory()) throw new Error(`Workspace is not a directory: ${options.cwd}`);
  const sessions = new TerminalSessionManager();
  const registry = new ToolRegistry()
    .register(new ReadFileTool())
    .register(new SearchTextTool())
    .register(new ListFilesTool());
  if (!options.readOnly) registry.register(new WriteFileTool());
  if (!options.readOnly && !options.check) {
    registry.register(new TerminalExecTool(sessions))
      .register(new TerminalReadTool(sessions))
      .register(new TerminalWriteTool(sessions))
      .register(new TerminalKillTool(sessions));
  }

  const abortController = new AbortController();
  let interruptExitCode: number | undefined;
  const interrupt = (code: number) => {
    interruptExitCode ??= code;
    abortController.abort();
  };
  const onInterrupt = () => interrupt(130);
  const onTerminate = () => interrupt(143);
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);

  const model = new OpenAICompatibleClient({
    apiKey: options.apiKey,
    model: options.model,
    baseUrl: options.baseUrl,
  });
  const executor = new ToolExecutor(
    registry,
    new PermissionPolicy(options.permissionMode, onInterrupt),
    { cwd, signal: abortController.signal },
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
    const argv = options.check;
    const result = await new WorkflowController(loop, cwd).run(
      options.goal,
      abortController.signal,
      {
        readOnly: options.readOnly,
        check: argv && {
          argv,
          run: signal => sessions.runCommand({ cwd, program: argv[0], args: argv.slice(1), timeoutMs: 120_000 }, signal),
        },
      },
    );
    if (result.status === "completed") process.stdout.write(`${result.output}\n`);
    else {
      process.stderr.write(`${result.output}\n`);
      process.exitCode = interruptExitCode ?? 1;
    }
  } finally {
    await sessions.cleanup();
    if (interruptExitCode !== undefined) process.exitCode = interruptExitCode;
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onTerminate);
  }
}

main().catch(error => {
  process.stderr.write(`minimal-swe-agent: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
