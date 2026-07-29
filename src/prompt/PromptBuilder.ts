import type { AgentMessage, WorkflowTask } from "../types.js";

export type PromptContext = {
  goal: string;
  cwd: string;
  task: WorkflowTask;
  completed: WorkflowTask[];
  tools: string[];
};

const SYSTEM_PROMPT = `You are a small autonomous software engineering agent.
Use tools to inspect the repository before changing it.
Keep changes scoped to the user's goal.
Never claim a command or test succeeded unless its tool result confirms that.
For a long-running terminal command, use terminal_read with the returned sessionId.
Do not repeatedly call an unchanged failing action.
Finish each workflow step with concise output for the next step.`;

function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const side = Math.floor((max - 40) / 2);
  return `${text.slice(0, side)}\n...[truncated]...\n${text.slice(-side)}`;
}

export class PromptBuilder {
  constructor(readonly maxPromptChars = 30_000) {}

  build(context: PromptContext): AgentMessage[] {
    const history = context.completed.length === 0
      ? "No workflow step has completed."
      : context.completed.map(item =>
          `### ${item.kind}: ${item.title}\n${truncateMiddle(item.output ?? "", 4_000)}`,
        ).join("\n\n");

    const userPrompt = [
      "## User Goal",
      context.goal,
      "",
      "## Current Workflow Step",
      `kind: ${context.task.kind}`,
      `title: ${context.task.title}`,
      context.task.instruction,
      "",
      "## Environment",
      `workspace: ${context.cwd}`,
      `tools: ${context.tools.join(", ")}`,
      "",
      "## Completed Workflow History",
      history,
      "",
      "## Completion Contract",
      "Complete only this workflow step. Return a clear result; the plan step must obey its JSON contract.",
    ].join("\n");

    return [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: truncateMiddle(userPrompt, this.maxPromptChars) },
    ];
  }
}
