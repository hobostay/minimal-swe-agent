import type { ToolCall, ToolResult } from "../types.js";
import { toolFailure } from "../types.js";
import type { Tool, ToolContext } from "../tools/Tool.js";
import type { ToolRegistry } from "../tools/ToolRegistry.js";
import type { PermissionPolicy } from "./PermissionPolicy.js";

export type ToolAccess = "all" | "read-only" | "no-terminal" | "none";

function allowed(tool: Tool, access: ToolAccess): boolean {
  return access !== "none" && (access === "all" || !tool.terminal)
    && (access !== "read-only" || !tool.mutates);
}

export class ToolExecutor {
  constructor(
    readonly registry: ToolRegistry,
    readonly policy: PermissionPolicy,
    readonly context: ToolContext,
  ) {}

  canUse(name: string, access: ToolAccess): boolean {
    const tool = this.registry.get(name);
    return tool !== undefined && allowed(tool, access);
  }

  async execute(call: ToolCall, signal = this.context.signal, access: ToolAccess | boolean = "all"): Promise<ToolResult> {
    if (signal?.aborted) return toolFailure("ABORTED", "Tool execution was aborted.");
    const tool = this.registry.get(call.name);
    if (!tool) return toolFailure("UNKNOWN_TOOL", `Unknown tool: ${call.name}`);
    const scope = typeof access === "boolean" ? (access ? "read-only" : "all") : access;
    if (!allowed(tool, scope)) return toolFailure(scope === "read-only" ? "READ_ONLY" : "TOOL_DISABLED", `${call.name} is disabled in this workflow phase.`);

    let input: unknown;
    try {
      input = tool.validate(call.arguments);
    } catch (error) {
      return toolFailure("INVALID_ARGUMENTS", error instanceof Error ? error.message : String(error));
    }

    try {
      const decision = await this.policy.authorize(tool, input, signal);
      if (signal?.aborted) return toolFailure("ABORTED", "Tool execution was aborted.");
      if (!decision.allow) return toolFailure("PERMISSION_DENIED", decision.reason ?? "Tool call denied.");
      return await tool.execute(input, { ...this.context, signal });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return toolFailure("ABORTED", "Tool execution was aborted.");
      }
      return toolFailure("TOOL_EXECUTION_FAILED", error instanceof Error ? error.message : String(error));
    }
  }
}
