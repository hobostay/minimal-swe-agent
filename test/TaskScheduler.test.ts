import assert from "node:assert/strict";
import test from "node:test";
import { TaskScheduler } from "../src/scheduler/TaskScheduler.js";

test("maps local plan dependencies to internal ids", () => {
  const scheduler = new TaskScheduler("goal");
  const plan = scheduler.tasks[1]!;
  scheduler.insertPlan([
    { id: "code", title: "Code", instruction: "Implement", dependencies: [] },
    { id: "test", title: "Test", instruction: "Test", dependencies: ["code"] },
  ], plan.id);
  const code = scheduler.tasks.find(item => item.title === "Code")!;
  const verify = scheduler.tasks.find(item => item.title === "Test")!;
  assert.deepEqual(verify.dependencies, [code.id]);
});
