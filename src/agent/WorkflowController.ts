import type { AgentLoop } from "./AgentLoop.js";
import type { ToolAccess } from "../executor/ToolExecutor.js";
import { OutputParser, type Verification } from "../parser/OutputParser.js";
import { PromptBuilder } from "../prompt/PromptBuilder.js";
import { TaskScheduler } from "../scheduler/TaskScheduler.js";
import type { ToolResult, WorkflowTask } from "../types.js";

export type WorkflowOptions = {
  readOnly?: boolean;
  check?: {
    argv: readonly [string, ...string[]];
    run(signal?: AbortSignal): Promise<ToolResult>;
  };
};

export type WorkflowResult = {
  status: "completed" | "failed" | "aborted";
  output: string;
  tasks: WorkflowTask[];
  verification?: Verification;
};

export class WorkflowController {
  constructor(
    readonly loop: AgentLoop,
    readonly cwd: string,
    readonly promptBuilder = new PromptBuilder(),
    readonly parser = new OutputParser(),
  ) {}

  async run(goal: string, signal = this.loop.executor.context.signal, options: WorkflowOptions = {}): Promise<WorkflowResult> {
    if (options.readOnly && options.check) throw new Error("Read-only mode cannot run a check command.");
    const scheduler = new TaskScheduler(goal, options.readOnly);
    let verification: Verification | undefined = options.readOnly
      ? { status: "not_run", summary: "Read-only run; no terminal commands executed." }
      : undefined;
    const check = options.check;
    const executionPolicy = options.readOnly
      ? "Read-only run: gather file evidence. Do not modify files, run commands, or claim that checks were executed."
      : check ? "The runtime runs the configured check once after edits. Use file tools for implementation; do not add or run a separate test step. Report its result only when it appears in completed workflow history."
      : undefined;

    while (scheduler.hasPending()) {
      if (signal?.aborted) break;
      const current = scheduler.nextRunnable();
      if (!current) {
        scheduler.skipBlocked();
        break;
      }
      scheduler.start(current);
      process.stderr.write(`\n[${current.kind}] ${current.title}\n`);
      if (current.kind === "verify" && check) {
        const command = JSON.stringify(check.argv);
        process.stderr.write(`  → ${command}\n`);
        try {
          const result = await check.run(signal);
          if (signal?.aborted) {
            scheduler.fail(current, "Interrupted.", false);
            break;
          }
          const ok = result.ok && result.metadata?.exitCode === 0 && result.metadata?.running === false;
          verification = ok
            ? { status: "passed", summary: `${command} exited with code 0.` }
            : { status: "failed", summary: `${command}: ${result.error?.message ?? "Check did not finish successfully."}` };
          if (ok) scheduler.complete(current, `${verification.summary}\n${result.output}`);
          else scheduler.fail(current, `${verification.summary}\n${result.output}`.trimEnd(), false);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          verification = { status: "failed", summary: `${command}: ${message}` };
          scheduler.fail(current, verification.summary, false);
        }
        continue;
      }
      const access: ToolAccess = current.kind === "plan" || current.kind === "summarize" ? "none"
        : options.readOnly || current.kind === "inspect" ? "read-only"
        : check ? "no-terminal" : "all";

      const messages = this.promptBuilder.build({
        goal,
        cwd: this.cwd,
        task: current,
        completed: scheduler.tasks.filter(item => item.status === "completed"),
        tools: this.loop.availableTools(access).map(tool => tool.name),
        executionPolicy,
      });
      const result = await this.loop.run(messages, signal, access);

      if (result.status === "aborted" || signal?.aborted) {
        scheduler.fail(current, "Interrupted.", false);
        scheduler.skipBlocked("Interrupted.");
        return { status: "aborted", output: "Workflow interrupted.", tasks: scheduler.tasks, verification };
      }

      if (result.status !== "completed") {
        scheduler.fail(current, result.error ?? `Agent ended with status ${result.status}`, current.kind === "plan");
        continue;
      }

      try {
        if (current.kind === "plan") {
          const parsed = this.parser.parse(result.output);
          if (!parsed.hasPlan) throw new Error(parsed.errors[0] ?? 'Expected a JSON object with a "plan" array.');
          scheduler.insertPlan(parsed.plan, current.id);
        } else if (current.kind === "verify") {
          verification = this.parser.parseVerification(result.output);
          if (verification.status === "failed") throw new Error(verification.summary);
        }
        scheduler.complete(current, result.output);
      } catch (error) {
        scheduler.fail(current, error instanceof Error ? error.message : String(error), current.kind === "plan");
      }
    }

    if (signal?.aborted) {
      scheduler.skipBlocked("Interrupted.");
      return { status: "aborted", output: "Workflow interrupted.", tasks: scheduler.tasks, verification };
    }
    const failure = scheduler.tasks.find(item => item.status === "failed")
      ?? scheduler.tasks.find(item => item.status === "skipped");
    const summary = [...scheduler.tasks].reverse().find(item => item.kind === "summarize" && item.output);
    return {
      status: failure ? "failed" : "completed",
      output: failure
        ? `${failure.title}: ${failure.error}`
        : [summary?.output, verification && `${check || options.readOnly ? "Verification" : "Model verification"} (${verification.status}): ${verification.summary}`].filter(Boolean).join("\n\n"),
      tasks: scheduler.tasks,
      verification,
    };
  }
}
