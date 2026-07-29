import type { ToolCall, ToolResult } from "../types.js";
import { toolFailure } from "../types.js";
import type { ToolContext } from "../tools/Tool.js";
import type { ToolRegistry } from "../tools/ToolRegistry.js";
import type { PermissionPolicy } from "./PermissionPolicy.js";

export class ToolExecutor {
  constructor(
    readonly registry: ToolRegistry,
    readonly policy: PermissionPolicy,
    readonly context: ToolContext,
  ) {}

  async execute(call: ToolCall): Promise<ToolResult> {
    const tool = this.registry.get(call.name);
    if (!tool) return toolFailure("UNKNOWN_TOOL", `Unknown tool: ${call.name}`);

    let input: unknown;
    try {
      input = tool.validate(call.arguments);
    } catch (error) {
      return toolFailure("INVALID_ARGUMENTS", error instanceof Error ? error.message : String(error));
    }

    const decision = await this.policy.authorize(tool, input);
    if (!decision.allow) {
      return toolFailure("PERMISSION_DENIED", decision.reason ?? "Tool call denied.");
    }

    try {
      return await tool.execute(input, this.context);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return toolFailure("ABORTED", "Tool execution was aborted.");
      }
      return toolFailure("TOOL_EXECUTION_FAILED", error instanceof Error ? error.message : String(error));
    }
  }
}
