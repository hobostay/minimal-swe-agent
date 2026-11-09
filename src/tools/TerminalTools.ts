import type { TerminalSessionManager } from "../runtime/TerminalSessionManager.js";
import type { ToolResult } from "../types.js";
import {
  objectInput,
  optionalNumber,
  requiredString,
  type Tool,
  type ToolContext,
} from "./Tool.js";

type ExecInput = { command: string; yieldMs: number; timeoutMs: number };
type ReadInput = { sessionId: string; waitMs: number };
type WriteInput = { sessionId: string; input: string };
type KillInput = { sessionId: string; signal: NodeJS.Signals };

export class TerminalExecTool implements Tool<ExecInput> {
  readonly terminal = true;
  readonly mutates = true;
  readonly definition = {
    name: "terminal_exec",
    description: "Run a POSIX shell command. A running command is not yet verified; poll with terminal_read. Nonzero exit is a failure.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        yieldMs: { type: "number", description: "Wait before yielding a running session; default 10000." },
        timeoutMs: { type: "number", description: "Hard process timeout; default 120000." },
      },
      required: ["command"],
      additionalProperties: false,
    },
  };

  constructor(private readonly sessions: TerminalSessionManager) {}

  validate(input: unknown): ExecInput {
    const value = objectInput(input);
    return {
      command: requiredString(value, "command"),
      yieldMs: Math.min(30_000, Math.max(0, optionalNumber(value, "yieldMs", 10_000))),
      timeoutMs: Math.min(30 * 60_000, Math.max(1_000, optionalNumber(value, "timeoutMs", 120_000))),
    };
  }

  execute(input: ExecInput, context: ToolContext): Promise<ToolResult> {
    return this.sessions.start({ ...input, cwd: context.cwd }, context.signal);
  }
}

export class TerminalReadTool implements Tool<ReadInput> {
  readonly terminal = true;
  readonly mutates = false;
  readonly definition = {
    name: "terminal_read",
    description: "Read only the new output produced by a terminal session since the previous read.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        waitMs: { type: "number", description: "Wait briefly when there is no new output; defaults to 1000." },
      },
      required: ["sessionId"],
      additionalProperties: false,
    },
  };

  constructor(private readonly sessions: TerminalSessionManager) {}
  validate(input: unknown): ReadInput {
    const value = objectInput(input);
    return { sessionId: requiredString(value, "sessionId"), waitMs: Math.min(5_000, optionalNumber(value, "waitMs", 1_000)) };
  }
  async execute(input: ReadInput): Promise<ToolResult> {
    return this.sessions.readAfterWait(input.sessionId, input.waitMs);
  }
}

export class TerminalWriteTool implements Tool<WriteInput> {
  readonly terminal = true;
  readonly mutates = true;
  readonly definition = {
    name: "terminal_write",
    description: "Write text to the stdin of a running terminal session.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, input: { type: "string" } },
      required: ["sessionId", "input"],
      additionalProperties: false,
    },
  };

  constructor(private readonly sessions: TerminalSessionManager) {}
  validate(input: unknown): WriteInput {
    const value = objectInput(input);
    if (typeof value.input !== "string") throw new Error("input must be a string.");
    return { sessionId: requiredString(value, "sessionId"), input: value.input };
  }
  async execute(input: WriteInput): Promise<ToolResult> {
    return this.sessions.write(input.sessionId, input.input);
  }
}

export class TerminalKillTool implements Tool<KillInput> {
  readonly terminal = true;
  readonly mutates = true;
  readonly definition = {
    name: "terminal_kill",
    description: "Send SIGTERM or SIGINT to a running terminal session.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        signal: { type: "string", enum: ["SIGTERM", "SIGINT"] },
      },
      required: ["sessionId"],
      additionalProperties: false,
    },
  };

  constructor(private readonly sessions: TerminalSessionManager) {}
  validate(input: unknown): KillInput {
    const value = objectInput(input);
    const signal = value.signal ?? "SIGTERM";
    if (signal !== "SIGTERM" && signal !== "SIGINT") throw new Error("signal must be SIGTERM or SIGINT.");
    return { sessionId: requiredString(value, "sessionId"), signal };
  }
  async execute(input: KillInput): Promise<ToolResult> {
    return this.sessions.kill(input.sessionId, input.signal);
  }
}
