import assert from "node:assert/strict";
import test from "node:test";
import { AgentLoop } from "../src/agent/AgentLoop.js";
import { PermissionPolicy } from "../src/executor/PermissionPolicy.js";
import { ToolExecutor } from "../src/executor/ToolExecutor.js";
import type { ModelClient } from "../src/types.js";
import { toolSuccess } from "../src/types.js";
import type { Tool } from "../src/tools/Tool.js";
import { ToolRegistry } from "../src/tools/ToolRegistry.js";

test("runs a tool call and returns the final model response", async () => {
  let turn = 0;
  const model: ModelClient = {
    async generate() {
      turn += 1;
      return turn === 1
        ? {
            content: "",
            toolCalls: [{ id: "1", name: "echo", arguments: { text: "hello" } }],
            finishReason: "tool_calls",
          }
        : { content: "done", toolCalls: [], finishReason: "stop" };
    },
  };
  const echo: Tool<{ text: string }> = {
    mutates: false,
    definition: {
      name: "echo",
      description: "echo",
      inputSchema: { type: "object" },
    },
    validate(input) {
      return input as { text: string };
    },
    async execute(input) {
      return toolSuccess(input.text);
    },
  };
  const registry = new ToolRegistry().register(echo);
  const executor = new ToolExecutor(registry, new PermissionPolicy("auto"), { cwd: process.cwd() });
  const result = await new AgentLoop(model, registry, executor).run([
    { role: "user", content: "go" },
  ]);
  assert.equal(result.status, "completed");
  assert.equal(result.output, "done");
  assert.equal(result.messages.filter(message => message.role === "tool").length, 1);
});

for (const finishReason of ["tool_calls", "length"] as const) {
  test(finishReason === "length" ? "does not execute a tool call from a truncated response" : "cancels the remaining calls in a batch", async () => {
    const controller = new AbortController();
    let executions = 0;
    const registry = new ToolRegistry().register({
      mutates: true,
      definition: { name: "edit", description: "edit", inputSchema: {} },
      validate: input => input,
      async execute(_, context) {
        assert.equal(context.signal, controller.signal);
        executions += 1;
        controller.abort();
        return toolSuccess("edited");
      },
    });
    const model: ModelClient = {
      async generate() {
        return {
          content: "",
          toolCalls: ["1", "2"].map(id => ({ id, name: "edit", arguments: {} })),
          finishReason,
        };
      },
    };
    const executor = new ToolExecutor(registry, new PermissionPolicy("auto"), { cwd: process.cwd() });
    const result = await new AgentLoop(model, registry, executor).run([], controller.signal);
    assert.equal(result.status, finishReason === "length" ? "failed" : "aborted");
    assert.equal(result.steps, 1);
    assert.equal(executions, finishReason === "length" ? 0 : 1);
  });
}
