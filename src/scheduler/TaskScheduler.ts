import { randomUUID } from "node:crypto";
import type { ParsedPlanItem, WorkflowTask, WorkflowTaskKind } from "../types.js";

function task(
  kind: WorkflowTaskKind,
  title: string,
  instruction: string,
  dependencies: string[] = [],
): WorkflowTask {
  return {
    id: randomUUID(),
    kind,
    title,
    instruction,
    dependencies,
    status: "pending",
    attempts: 0,
    maxAttempts: 2,
  };
}

export class TaskScheduler {
  readonly tasks: WorkflowTask[];

  constructor(readonly goal: string, readOnly = false) {
    const inspect = task(
      "inspect",
      "Inspect repository",
      "Inspect the project structure and relevant files. Do not edit yet. Report concrete implementation locations and constraints.",
    );
    if (readOnly) {
      this.tasks = [inspect, this.summarize(inspect.id)];
      return;
    }
    const plan = task(
      "plan",
      "Plan implementation",
      [
        "Use the completed inspection to plan concrete code changes. Return one implementation item covering all related edits.",
        "Do not add steps for inspection, repeated reading, running tests, or summarizing. The workflow handles those separately.",
        "Return exactly one JSON object in a ```json fence:",
        '{"plan":[{"id":"local-id","title":"...","instruction":"...","dependencies":[]}]}',
        "The single implementation item should have no dependencies.",
        'Use {"plan":[]} when inspection is sufficient and no execution steps are needed.',
      ].join("\n"),
      [inspect.id],
    );
    this.tasks = [inspect, plan];
  }

  private summarize(dependency: string): WorkflowTask {
    return task(
      "summarize",
      "Summarize result",
      "Answer the user goal using the completed workflow evidence. Report only changes and checks that the evidence confirms.",
      [dependency],
    );
  }

  nextRunnable(): WorkflowTask | undefined {
    return this.tasks.find(candidate =>
      candidate.status === "pending"
      && candidate.dependencies.every(id => this.tasks.find(item => item.id === id)?.status === "completed"),
    );
  }

  hasPending(): boolean {
    return this.tasks.some(item => item.status === "pending" || item.status === "running");
  }

  start(item: WorkflowTask): void {
    item.status = "running";
    item.attempts += 1;
  }

  complete(item: WorkflowTask, output: string): void {
    item.status = "completed";
    item.output = output;
    item.error = undefined;
  }

  fail(item: WorkflowTask, error: string, retry = true): void {
    item.error = error;
    item.status = retry && item.attempts < item.maxAttempts ? "pending" : "failed";
  }

  skipBlocked(reason = "A dependency did not complete."): void {
    for (const item of this.tasks) {
      if (item.status === "pending") {
        item.status = "skipped";
        item.error = reason;
      }
    }
  }

  insertPlan(items: ParsedPlanItem[], planTaskId: string): void {
    if (this.tasks.some(item => item.kind === "verify")) return;
    if (items.length > 12) throw new Error("A plan may contain at most 12 steps.");
    const pending = new Map(items.map(item => [item.id, item]));
    if (pending.size !== items.length) throw new Error("Plan ids must be unique.");
    for (const item of items) {
      for (const dependency of item.dependencies) {
        if (!pending.has(dependency)) throw new Error(`Unknown dependency ${dependency} in ${item.id}.`);
      }
    }
    const checked = new Set<string>();
    const ordered: ParsedPlanItem[] = [];
    while (pending.size) {
      const next = [...pending.values()].find(item => item.dependencies.every(id => checked.has(id)));
      if (!next) throw new Error("Plan dependencies contain a cycle.");
      pending.delete(next.id);
      checked.add(next.id);
      ordered.push(next);
    }

    // Keep one execution context even when a model splits related edits into a DAG.
    const first = ordered[0];
    const execute = first && task(
      "execute",
      ordered.length === 1 ? first.title : "Implement the plan",
      ordered.length === 1 ? first.instruction : ordered.map((item, i) => `${i + 1}. ${item.title}: ${item.instruction}`).join("\n"),
      [planTaskId],
    );
    if (execute) this.tasks.push(execute);
    const verify = task(
      "verify",
      "Verify implementation",
      [
        "Verify the result against the user goal. Reuse evidence from completed steps instead of repeating checks that still apply.",
        'Return one JSON object: {"status":"passed|failed|not_run","summary":"checks run, results, and any limitations"}.',
        "A check that is still running has not passed. Use failed for unresolved failures and not_run when no check could be run or applies.",
      ].join("\n"),
      [execute?.id ?? planTaskId],
    );
    this.tasks.push(verify, this.summarize(verify.id));
  }
}
