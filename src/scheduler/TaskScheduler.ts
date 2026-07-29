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

  constructor(readonly goal: string) {
    const inspect = task(
      "inspect",
      "Inspect repository",
      "Inspect the project structure and relevant files. Do not edit yet. Report concrete implementation locations and constraints.",
    );
    const plan = task(
      "plan",
      "Plan implementation",
      [
        "Create the smallest actionable implementation plan.",
        "Return exactly one JSON object in a ```json fence:",
        '{"plan":[{"id":"local-id","title":"...","instruction":"...","dependencies":[]}]}',
        "Dependencies refer to local ids in this same plan.",
      ].join("\n"),
      [inspect.id],
    );
    this.tasks = [inspect, plan];
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

  fail(item: WorkflowTask, error: string): void {
    item.error = error;
    item.status = item.attempts < item.maxAttempts ? "pending" : "failed";
  }

  skipBlocked(): void {
    for (const item of this.tasks) {
      if (item.status === "pending") {
        item.status = "skipped";
        item.error = "A dependency did not complete.";
      }
    }
  }

  insertPlan(items: ParsedPlanItem[], planTaskId: string): void {
    if (this.tasks.some(item => item.kind === "execute")) return;
    const localToReal = new Map<string, WorkflowTask>();
    const unique = items.slice(0, 12).filter((item, index, all) =>
      all.findIndex(other => other.id === item.id) === index,
    );

    for (const item of unique) {
      localToReal.set(item.id, task("execute", item.title, item.instruction));
    }
    for (const item of unique) {
      const created = localToReal.get(item.id)!;
      created.dependencies = item.dependencies.length
        ? item.dependencies.map(id => localToReal.get(id)?.id).filter((id): id is string => Boolean(id))
        : [planTaskId];
      if (created.dependencies.length === 0) created.dependencies = [planTaskId];
    }

    const executeTasks = [...localToReal.values()];
    if (executeTasks.length === 0) {
      executeTasks.push(task(
        "execute",
        "Implement requested change",
        "Implement the requested change using the available tools. Keep edits focused.",
        [planTaskId],
      ));
    }

    const verify = task(
      "verify",
      "Verify implementation",
      "Inspect the changes and run the most relevant tests, type checks, or builds. Fix issues found.",
      executeTasks.map(item => item.id),
    );
    const summarize = task(
      "summarize",
      "Summarize result",
      "Summarize what changed, verification performed, and any remaining limitations. Do not make additional edits unless necessary to correct the summary.",
      [verify.id],
    );
    this.tasks.push(...executeTasks, verify, summarize);
  }
}
