import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
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
  child: ChildProcessWithoutNullStreams;
  stdout: StreamBuffer;
  stderr: StreamBuffer;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  running: boolean;
  closed: Promise<void>;
  spawnError?: string;
  stopReason?: "timeout" | "aborted" | "killed";
  timeout?: NodeJS.Timeout;
  escalation?: NodeJS.Timeout;
};

export type TerminalStartInput = {
  command: string;
  cwd: string;
  yieldMs: number;
  timeoutMs: number;
};

type ProcessInput = Pick<TerminalStartInput, "cwd" | "timeoutMs"> & {
  program: string;
  args: readonly string[];
};

const MAX_STREAM_CHARS = 8_000;

function append(buffer: StreamBuffer, chunk: string): void {
  buffer.text += chunk;
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
    if (signal?.aborted) return toolFailure("ABORTED", "Terminal execution was aborted.");
    const session = this.spawnProcess({ ...input, program: "/bin/sh", args: ["-c", input.command] }, signal);
    await this.wait(session, input.yieldMs);
    return this.readResult(session);
  }

  async runCommand(input: ProcessInput, signal?: AbortSignal): Promise<ToolResult> {
    if (signal?.aborted) return toolFailure("ABORTED", "Check was interrupted.");
    const session = this.spawnProcess(input, signal);
    session.child.stdin.end();
    await session.closed;
    this.sessions.delete(session.id);
    return this.readResult(session);
  }

  private spawnProcess(input: ProcessInput, signal?: AbortSignal): TerminalSession {
    const id = randomUUID();
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;
    const child = spawn(input.program, input.args, {
      cwd: input.cwd,
      env,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const session: TerminalSession = {
      id,
      child,
      stdout: { text: "", cursor: 0, truncated: false },
      stderr: { text: "", cursor: 0, truncated: false },
      exitCode: null,
      signal: null,
      running: true,
      closed: new Promise(resolve => child.once("close", () => resolve())),
    };
    this.sessions.set(id, session);

    const abort = () => this.stop(session, "aborted");
    child.stdout.setEncoding("utf8").on("data", chunk => append(session.stdout, chunk));
    child.stderr.setEncoding("utf8").on("data", chunk => append(session.stderr, chunk));
    child.on("error", error => { session.spawnError = error.message; });
    // write() reports EPIPE through its callback; keep the stream event handled too.
    child.stdin.on("error", () => {});
    child.on("close", (code, closeSignal) => {
      session.running = false;
      session.exitCode = code;
      session.signal = closeSignal;
      if (session.timeout) clearTimeout(session.timeout);
      if (session.escalation) clearTimeout(session.escalation);
      signal?.removeEventListener("abort", abort);
    });

    session.timeout = setTimeout(() => {
      this.stop(session, "timeout");
    }, input.timeoutMs);

    signal?.addEventListener("abort", abort, { once: true });

    return session;
  }

  read(id: string): ToolResult {
    const session = this.sessions.get(id);
    if (!session) return toolFailure("SESSION_NOT_FOUND", `Unknown terminal session: ${id}`);
    return this.readResult(session);
  }

  async readAfterWait(id: string, waitMs: number): Promise<ToolResult> {
    const session = this.sessions.get(id);
    if (session?.running && waitMs > 0
      && session.stdout.cursor === session.stdout.text.length && session.stderr.cursor === session.stderr.text.length) {
      await this.wait(session, waitMs);
    }
    return this.read(id);
  }

  async write(id: string, input: string): Promise<ToolResult> {
    const session = this.sessions.get(id);
    if (!session) return toolFailure("SESSION_NOT_FOUND", `Unknown terminal session: ${id}`);
    if (!session.running) return toolFailure("SESSION_FINISHED", `Terminal session ${id} has finished.`);
    return new Promise(resolve => session.child.stdin.write(input, error => {
      resolve(error
        ? toolFailure("TERMINAL_WRITE_FAILED", error.message)
        : toolSuccess(`Wrote ${Buffer.byteLength(input)} bytes to terminal session ${id}.`));
    }));
  }

  kill(id: string, signal: NodeJS.Signals = "SIGTERM"): ToolResult {
    const session = this.sessions.get(id);
    if (!session) return toolFailure("SESSION_NOT_FOUND", `Unknown terminal session: ${id}`);
    if (!session.running) return this.readResult(session);
    this.stop(session, "killed", signal);
    return toolSuccess(`Sent ${signal} to terminal session ${id}.`, { sessionId: id });
  }

  async cleanup(): Promise<void> {
    const active = [...this.sessions.values()].filter(session => session.running);
    for (const session of active) this.stop(session, "killed");
    await Promise.all(active.map(session => session.closed));
    this.sessions.clear();
  }

  private async wait(session: TerminalSession, ms: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([session.closed, new Promise<void>(resolve => { timer = setTimeout(resolve, ms); })]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private stop(session: TerminalSession, reason: NonNullable<TerminalSession["stopReason"]>, signal: NodeJS.Signals = "SIGTERM"): void {
    if (!session.running || session.stopReason) return;
    session.stopReason = reason;
    this.killProcessGroup(session, signal);
    session.escalation = setTimeout(() => this.killProcessGroup(session, "SIGKILL"), 500);
  }

  private killProcessGroup(session: TerminalSession, signal: NodeJS.Signals): void {
    if (session.child.pid === undefined) return;
    try {
      process.kill(-session.child.pid, signal);
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
    const metadata = {
      sessionId: session.id,
      running: session.running,
      exitCode: session.exitCode,
      signal: session.signal,
      truncated: session.stdout.truncated || session.stderr.truncated,
    };
    const fail = (code: string, message: string) => ({ ...toolFailure(code, message, output), metadata });
    if (session.spawnError) return fail("TERMINAL_SPAWN_FAILED", session.spawnError);
    if (session.stopReason === "timeout") return fail("TERMINAL_TIMEOUT", "Command exceeded its timeout.");
    if (session.stopReason === "aborted") return fail("ABORTED", "Command was interrupted.");
    if (session.stopReason === "killed") return fail("TERMINAL_KILLED", "Command was stopped.");
    if (!session.running && session.exitCode !== 0) {
      return fail("TERMINAL_EXIT_FAILED", session.signal
        ? `Command terminated with ${session.signal}.`
        : `Command exited with code ${session.exitCode}.`);
    }
    return toolSuccess(output, metadata);
  }
}
