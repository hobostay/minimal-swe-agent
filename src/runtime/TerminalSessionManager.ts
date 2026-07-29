import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import process from "node:process";
import type { ToolResult } from "../types.js";
import { toolFailure, toolSuccess } from "../types.js";

type StreamBuffer = {
  text: string;
  cursor: number;
  truncated: boolean;
};

type TerminalSession = {
  id: string;
  command: string;
  child: ChildProcessWithoutNullStreams;
  stdout: StreamBuffer;
  stderr: StreamBuffer;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  running: boolean;
  timeout?: NodeJS.Timeout;
};

export type TerminalStartInput = {
  command: string;
  cwd: string;
  yieldMs: number;
  timeoutMs: number;
};

const MAX_STREAM_CHARS = 1_000_000;

function append(buffer: StreamBuffer, chunk: Buffer): void {
  buffer.text += chunk.toString("utf8");
  if (buffer.text.length > MAX_STREAM_CHARS) {
    const removed = buffer.text.length - MAX_STREAM_CHARS;
    buffer.text = buffer.text.slice(removed);
    buffer.cursor = Math.max(0, buffer.cursor - removed);
    buffer.truncated = true;
  }
}

function delta(buffer: StreamBuffer): string {
  const value = buffer.text.slice(buffer.cursor);
  buffer.cursor = buffer.text.length;
  return value;
}

export class TerminalSessionManager {
  private readonly sessions = new Map<string, TerminalSession>();

  async start(input: TerminalStartInput, signal?: AbortSignal): Promise<ToolResult> {
    const id = randomUUID();
    const child = spawn("/bin/zsh", ["-lc", input.command], {
      cwd: input.cwd,
      env: process.env,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const session: TerminalSession = {
      id,
      command: input.command,
      child,
      stdout: { text: "", cursor: 0, truncated: false },
      stderr: { text: "", cursor: 0, truncated: false },
      exitCode: null,
      signal: null,
      running: true,
    };
    this.sessions.set(id, session);

    child.stdout.on("data", chunk => append(session.stdout, chunk as Buffer));
    child.stderr.on("data", chunk => append(session.stderr, chunk as Buffer));
    child.on("close", (code, closeSignal) => {
      session.running = false;
      session.exitCode = code;
      session.signal = closeSignal;
      if (session.timeout) clearTimeout(session.timeout);
    });

    session.timeout = setTimeout(() => {
      this.killProcessGroup(session, "SIGTERM");
    }, input.timeoutMs);

    const abort = () => this.killProcessGroup(session, "SIGTERM");
    signal?.addEventListener("abort", abort, { once: true });

    await Promise.race([
      once(child, "close"),
      new Promise(resolve => setTimeout(resolve, input.yieldMs)),
    ]);
    signal?.removeEventListener("abort", abort);
    return this.readResult(session);
  }

  read(id: string): ToolResult {
    const session = this.sessions.get(id);
    if (!session) return toolFailure("SESSION_NOT_FOUND", `Unknown terminal session: ${id}`);
    return this.readResult(session);
  }

  write(id: string, input: string): ToolResult {
    const session = this.sessions.get(id);
    if (!session) return toolFailure("SESSION_NOT_FOUND", `Unknown terminal session: ${id}`);
    if (!session.running) return toolFailure("SESSION_FINISHED", `Terminal session ${id} has finished.`);
    session.child.stdin.write(input);
    return toolSuccess(`Wrote ${Buffer.byteLength(input)} bytes to terminal session ${id}.`);
  }

  kill(id: string, signal: NodeJS.Signals = "SIGTERM"): ToolResult {
    const session = this.sessions.get(id);
    if (!session) return toolFailure("SESSION_NOT_FOUND", `Unknown terminal session: ${id}`);
    if (!session.running) return this.readResult(session);
    this.killProcessGroup(session, signal);
    return toolSuccess(`Sent ${signal} to terminal session ${id}.`, { sessionId: id });
  }

  cleanup(): void {
    for (const session of this.sessions.values()) {
      if (session.running) this.killProcessGroup(session, "SIGTERM");
    }
  }

  private killProcessGroup(session: TerminalSession, signal: NodeJS.Signals): void {
    try {
      process.kill(-session.child.pid!, signal);
    } catch {
      session.child.kill(signal);
    }
  }

  private readResult(session: TerminalSession): ToolResult {
    const stdout = delta(session.stdout);
    const stderr = delta(session.stderr);
    const output = [
      stdout ? `stdout:\n${stdout}` : "stdout: <no new output>",
      stderr ? `stderr:\n${stderr}` : "stderr: <no new output>",
      `running: ${session.running}`,
      `exit_code: ${session.exitCode ?? "null"}`,
    ].join("\n");
    return toolSuccess(output, {
      sessionId: session.id,
      running: session.running,
      exitCode: session.exitCode,
      signal: session.signal,
      truncated: session.stdout.truncated || session.stderr.truncated,
    });
  }
}
