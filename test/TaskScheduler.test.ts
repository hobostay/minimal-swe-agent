import assert from "node:assert/strict";
import test from "node:test";
import { TaskScheduler } from "../src/scheduler/TaskScheduler.js";

test("runs a multi-item plan in one execution phase in dependency order", () => {
  const scheduler = new TaskScheduler("goal");
  const plan = scheduler.tasks[1]!;
  scheduler.insertPlan([
    { id: "cli", title: "CLI", instruction: "Wire CLI", dependencies: ["code"] },
    { id: "code", title: "Library", instruction: "Implement", dependencies: [] },
  ], plan.id);
  const execution = scheduler.tasks.filter(item => item.kind === "execute");
  assert.equal(execution.length, 1);
  assert.match(execution[0]!.instruction, /1\. Library: Implement\n2\. CLI: Wire CLI/);
  assert.deepEqual(scheduler.tasks.find(item => item.kind === "verify")!.dependencies, [execution[0]!.id]);
});

test("rejects a cyclic plan before adding any tasks", () => {
  const scheduler = new TaskScheduler("goal");
  assert.throws(() => scheduler.insertPlan([
    { id: "a", title: "A", instruction: "A", dependencies: ["b"] },
    { id: "b", title: "B", instruction: "B", dependencies: ["a"] },
  ], scheduler.tasks[1]!.id), /cycle/);
  assert.equal(scheduler.tasks.length, 2);
});
