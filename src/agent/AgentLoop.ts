import type {
  AgentEvent,
  AgentMessage,
  AgentRunResult,
  ModelClient,
  ToolCall,
} from "../types.js";
import type { ToolExecutor } from "../executor/ToolExecutor.js";
import type { ToolRegistry } from "../tools/ToolRegistry.js";

export type AgentLoopOptions = {
  maxSteps?: number;
  maxRepeatedCalls?: number;
  onEvent?: (event: AgentEvent) => void | Promise<void>;
};

function fingerprint(call: ToolCall): string {
  return `${call.name}:${JSON.stringify(call.arguments)}`;
}

export class AgentLoop {
  readonly maxSteps: number;
  readonly maxRepeatedCalls: number;

  constructor(
    readonly model: ModelClient,
    readonly tools: ToolRegistry,
    readonly executor: ToolExecutor,
    readonly options: AgentLoopOptions = {},
  ) {
    this.maxSteps = options.maxSteps ?? 40;
    this.maxRepeatedCalls = options.maxRepeatedCalls ?? 3;
  }

  private async emit(event: AgentEvent): Promise<void> {
    await this.options.onEvent?.(event);
  }

  async run(messages: AgentMessage[], signal?: AbortSignal): Promise<AgentRunResult> {
    const history = [...messages];
    const failedFingerprints = new Map<string, number>();

    try {
      for (let step = 1; step <= this.maxSteps; step += 1) {
        if (signal?.aborted) return { status: "aborted", output: "", messages: history, steps: step - 1 };
        await this.emit({ type: "model_start", step });
        const response = await this.model.generate({
          messages: history,
          tools: this.tools.definitions(),
          signal,
        });
        history.push({ role: "assistant", content: response.content, toolCalls: response.toolCalls });
        await this.emit({ type: "model_end", step, response });

        if (response.toolCalls.length === 0) {
          return { status: "completed", output: response.content, messages: history, steps: step };
        }

        for (const call of response.toolCalls) {
          await this.emit({ type: "tool_start", step, call });
          const key = fingerprint(call);
          let result;
          if ((failedFingerprints.get(key) ?? 0) >= this.maxRepeatedCalls) {
            result = {
              ok: false,
              output: "",
              error: {
                code: "REPEATED_FAILED_ACTION",
                message: "This exact tool call already failed repeatedly. Choose a different action.",
              },
            };
          } else {
            result = await this.executor.execute(call);
          }
          if (!result.ok) failedFingerprints.set(key, (failedFingerprints.get(key) ?? 0) + 1);
          else failedFingerprints.delete(key);

          history.push({
            role: "tool",
            toolCallId: call.id,
            name: call.name,
            content: JSON.stringify(result),
          });
          await this.emit({ type: "tool_end", step, call, result });
        }
      }
      return { status: "max_steps", output: "", messages: history, steps: this.maxSteps };
    } catch (error) {
      if (signal?.aborted) return { status: "aborted", output: "", messages: history, steps: 0 };
      return {
        status: "failed",
        output: "",
        messages: history,
        steps: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
