import type { ToolDefinition } from "../types.js";
import type { Tool } from "./Tool.js";

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): this {
    if (this.tools.has(tool.definition.name)) {
      throw new Error(`Duplicate tool: ${tool.definition.name}`);
    }
    this.tools.set(tool.definition.name, tool);
    return this;
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  definitions(): ToolDefinition[] {
    return [...this.tools.values()].map(tool => tool.definition);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }
}
