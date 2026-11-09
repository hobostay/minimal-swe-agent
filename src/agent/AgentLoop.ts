import type {
  AgentEvent,
  AgentMessage,
  AgentRunResult,
  ModelClient,
  ToolCall,
} from "../types.js";
import type { ToolAccess, ToolExecutor } from "../executor/ToolExecutor.js";
import type { ToolRegistry } from "../tools/ToolRegistry.js";

export type AgentLoopOptions = {
  maxSteps?: number;
  maxRepeatedCalls?: number;
  onEvent?: (event: AgentEvent) => void | Promise<void>;
};

const MAX_TOOL_OUTPUT_CHARS = 16_000;

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

  availableTools(access: ToolAccess) {
    return this.tools.definitions().filter(tool => this.executor.canUse(tool.name, access));
  }

  async run(messages: AgentMessage[], signal = this.executor.context.signal, access: ToolAccess | boolean = "all"): Promise<AgentRunResult> {
    const history = [...messages];
    const failedFingerprints = new Map<string, number>();
    const tools = this.availableTools(typeof access === "boolean" ? (access ? "read-only" : "all") : access);
    let steps = 0;
    const aborted = (): AgentRunResult => ({ status: "aborted", output: "", messages: history, steps });
    const fail = (error: string): AgentRunResult => ({ status: "failed", output: "", messages: history, steps, error });

    try {
      for (let step = 1; step <= this.maxSteps; step += 1) {
        if (signal?.aborted) return aborted();
        await this.emit({ type: "model_start", step });
        if (signal?.aborted) return aborted();
        steps = step;
        const response = await this.model.generate({
          messages: history,
          tools,
          signal,
        });
        await this.emit({ type: "model_end", step, response });
        if (signal?.aborted) return aborted();
        if (response.finishReason === "length" || response.finishReason === "unknown") {
          return fail(`Model did not finish normally (${response.finishReason}).`);
        }
        history.push({ role: "assistant", content: response.content, toolCalls: response.toolCalls });

        if (response.toolCalls.length === 0) {
          if (response.finishReason !== "stop" || !response.content.trim()) {
            return fail("Model returned neither a final answer nor a tool call.");
          }
          return { status: "completed", output: response.content, messages: history, steps: step };
        }

        for (const call of response.toolCalls) {
          if (signal?.aborted) return aborted();
          await this.emit({ type: "tool_start", step, call });
          if (signal?.aborted) return aborted();
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
            result = await this.executor.execute(call, signal, access);
          }
          if (result.output.length > MAX_TOOL_OUTPUT_CHARS) {
            result = {
              ...result,
              output: `${result.output.slice(0, 8_000)}\n[... tool output truncated ...]\n${result.output.slice(-8_000)}`,
              metadata: { ...result.metadata, truncated: true },
            };
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
          if (signal?.aborted) return aborted();
        }
      }
      return { status: "max_steps", output: "", messages: history, steps: this.maxSteps };
    } catch (error) {
      return signal?.aborted ? aborted() : fail(error instanceof Error ? error.message : String(error));
    }
  }
}
