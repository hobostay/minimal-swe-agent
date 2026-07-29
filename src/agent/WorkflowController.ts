import type { AgentLoop } from "./AgentLoop.js";
import { OutputParser } from "../parser/OutputParser.js";
import { PromptBuilder } from "../prompt/PromptBuilder.js";
import { TaskScheduler } from "../scheduler/TaskScheduler.js";
import type { WorkflowTask } from "../types.js";

export type WorkflowResult = {
  status: "completed" | "failed";
  output: string;
  tasks: WorkflowTask[];
};

export class WorkflowController {
  constructor(
    readonly loop: AgentLoop,
    readonly cwd: string,
    readonly promptBuilder = new PromptBuilder(),
    readonly parser = new OutputParser(),
  ) {}

  async run(goal: string, signal?: AbortSignal): Promise<WorkflowResult> {
    const scheduler = new TaskScheduler(goal);

    while (scheduler.hasPending()) {
      const current = scheduler.nextRunnable();
      if (!current) {
        scheduler.skipBlocked();
        break;
      }
      scheduler.start(current);
      process.stderr.write(`\n[${current.kind}] ${current.title}\n`);

      const messages = this.promptBuilder.build({
        goal,
        cwd: this.cwd,
        task: current,
        completed: scheduler.tasks.filter(item => item.status === "completed"),
        tools: this.loop.tools.names(),
      });
      const result = await this.loop.run(messages, signal);

      if (result.status !== "completed") {
        scheduler.fail(current, result.error ?? `Agent ended with status ${result.status}`);
        continue;
      }

      scheduler.complete(current, result.output);
      if (current.kind === "plan") {
        const parsed = this.parser.parse(result.output);
        scheduler.insertPlan(parsed.plan, current.id);
      }
    }

    const failed = scheduler.tasks.some(item => item.status === "failed" || item.status === "skipped");
    const summary = [...scheduler.tasks].reverse().find(item => item.kind === "summarize" && item.output);
    return {
      status: failed ? "failed" : "completed",
      output: summary?.output ?? scheduler.tasks.at(-1)?.output ?? "",
      tasks: scheduler.tasks,
    };
  }
}
