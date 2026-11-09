import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentLoop } from "../src/agent/AgentLoop.js";
import { WorkflowController } from "../src/agent/WorkflowController.js";
import { PermissionPolicy } from "../src/executor/PermissionPolicy.js";
import { ToolExecutor } from "../src/executor/ToolExecutor.js";
import { TerminalSessionManager } from "../src/runtime/TerminalSessionManager.js";
import { ReadFileTool, WriteFileTool } from "../src/tools/FileTools.js";
import { TerminalExecTool } from "../src/tools/TerminalTools.js";
import { ToolRegistry } from "../src/tools/ToolRegistry.js";
import type { ModelClient, ModelResponse, ToolResult } from "../src/types.js";

function answer(content: string): ModelResponse {
  return { content, toolCalls: [], finishReason: "stop" };
}

function call(name: string, args: unknown): ModelResponse {
  return { content: "", toolCalls: [{ id: `call-${name}`, name, arguments: args }], finishReason: "tool_calls" };
}

for (const fix of [true, false]) {
  test(fix ? "reads, edits, and verifies a real workspace" : "reports an unresolved real check failure without summarizing success", async t => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "minimal-workflow-"));
    const sessions = new TerminalSessionManager();
    t.after(async () => {
      await sessions.cleanup();
      await fs.rm(cwd, { recursive: true, force: true });
    });
    await fs.writeFile(path.join(cwd, "sum.cjs"), "module.exports = (a, b) => a - b;\n");
    await fs.writeFile(path.join(cwd, "check.cjs"), 'require("node:assert/strict").equal(require("./sum.cjs")(2, 3), 5);\n');
    let planAttempts = 0;
    const model: ModelClient = {
      async generate({ messages, tools }) {
        const input = messages[1]!.content;
        const kind = input.match(/\nkind: (\w+)/)?.[1];
        const last = messages.at(-1)!;
        const observation = last.role === "tool" ? JSON.parse(last.content) as ToolResult : undefined;
        switch (kind) {
          case "inspect":
            assert.deepEqual(tools.map(tool => tool.name), ["read_file"]);
            if (!observation) return call("write_file", { path: "unauthorized.txt", content: "must not be written" });
            if (last.role === "tool" && last.name === "write_file") {
              assert.equal(observation.error?.code, "READ_ONLY");
              return call("read_file", { path: "sum.cjs" });
            }
            assert.match(observation.output, /a - b/);
            return answer("sum.cjs subtracts instead of adding.");
          case "plan":
            planAttempts += 1;
            if (planAttempts === 2) assert.match(input, /Unknown dependency missing/);
            return answer(JSON.stringify({ plan: [{
              id: "fix", title: "Fix addition", instruction: "Change sum.cjs", dependencies: planAttempts === 1 ? ["missing"] : [],
            }] }));
          case "execute":
            if (fix && !observation) return call("write_file", { path: "sum.cjs", content: "module.exports = (a, b) => a + b;\n" });
            if (fix) assert.equal(observation?.ok, true);
            return answer(fix ? "Updated sum.cjs." : "The bug remains.");
          case "verify":
            if (!observation) return call("terminal_exec", { command: "node check.cjs" });
            assert.equal(observation.metadata?.running, false);
            assert.equal(observation.ok, fix);
            assert.equal(observation.metadata?.exitCode, fix ? 0 : 1);
            return answer(JSON.stringify({ status: fix ? "passed" : "failed", summary: fix ? "node check.cjs exited 0" : "node check.cjs failed" }));
          case "summarize":
            assert.equal(fix, true);
            return answer("Fixed addition.");
          default:
            throw new Error(`Unexpected phase: ${kind}`);
        }
      },
    };
    const registry = new ToolRegistry().register(new ReadFileTool()).register(new WriteFileTool()).register(new TerminalExecTool(sessions));
    const executor = new ToolExecutor(registry, new PermissionPolicy("auto"), { cwd });
    const result = await new WorkflowController(new AgentLoop(model, registry, executor), cwd).run("Fix addition and test it");
    assert.equal(result.status, fix ? "completed" : "failed", result.output);
    assert.equal(result.verification?.status, fix ? "passed" : "failed");
    assert.match(result.output, fix ? /node check.cjs exited 0/ : /node check.cjs failed/);
    assert.equal(planAttempts, 2);
    await assert.rejects(fs.stat(path.join(cwd, "unauthorized.txt")), { code: "ENOENT" });
    assert.match(await fs.readFile(path.join(cwd, "sum.cjs"), "utf8"), fix ? /a \+ b/ : /a - b/);
  });
}
