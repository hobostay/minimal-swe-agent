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
    let next = manager.read(sessionId);
    let output = `${started.output}\n${next.output}`;
    for (let attempt = 0; next.metadata?.running && attempt < 10; attempt += 1) {
      next = await manager.readAfterWait(sessionId, 500);
      output += `\n${next.output}`;
    }
    assert.equal(next.ok, true);
    assert.equal(output.match(/\bfirst\b/g)?.length, 1);
    assert.equal(output.match(/\bsecond\b/g)?.length, 1);
    assert.equal(next.metadata?.running, false);
  } finally {
    await manager.cleanup();
  }
});

test("cancels a yielded command and escalates if it ignores TERM", async t => {
  const manager = new TerminalSessionManager();
  t.after(() => manager.cleanup());
  const controller = new AbortController();
  const started = await manager.start({
    command: "trap '' TERM; printf 'ready\\n'; sleep 20",
    cwd: process.cwd(), yieldMs: 10, timeoutMs: 10_000,
  }, controller.signal);
  assert.equal(started.metadata?.running, true);
  const id = String(started.metadata?.sessionId);
  let next = started;
  for (let i = 0; !next.output.includes("ready") && i < 10; i += 1) next = await manager.readAfterWait(id, 200);
  assert.match(next.output, /ready/);
  controller.abort();
  next = await manager.readAfterWait(id, 2_000);
  assert.equal(next.error?.code, "ABORTED");
  assert.equal(next.metadata?.running, false);
  assert.equal(next.metadata?.signal, "SIGKILL");
});
