import assert from "node:assert/strict";
import test from "node:test";
import { TerminalSessionManager } from "../src/runtime/TerminalSessionManager.js";

test("returns incremental output from a persistent terminal session", async () => {
  const manager = new TerminalSessionManager();
  try {
    const started = await manager.start({
      command: "echo first; sleep 0.1; echo second",
      cwd: process.cwd(),
      yieldMs: 10,
      timeoutMs: 2_000,
    });
    assert.equal(started.ok, true);
    const sessionId = String(started.metadata?.sessionId);
    await new Promise(resolve => setTimeout(resolve, 200));
    const next = manager.read(sessionId);
    assert.equal(next.ok, true);
    assert.match(`${started.output}\n${next.output}`, /first/);
    assert.match(`${started.output}\n${next.output}`, /second/);
    assert.equal(next.metadata?.running, false);
  } finally {
    manager.cleanup();
  }
});
