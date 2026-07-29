import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { Tool } from "../tools/Tool.js";

export type PermissionMode = "ask" | "auto";

export class PermissionPolicy {
  constructor(readonly mode: PermissionMode) {}

  async authorize(tool: Tool, input: unknown): Promise<{ allow: boolean; reason?: string }> {
    if (!tool.mutates || this.mode === "auto") return { allow: true };
    if (!stdin.isTTY) {
      return {
        allow: false,
        reason: `Tool ${tool.definition.name} requires approval. Re-run with --yes in a trusted workspace.`,
      };
    }
    const rl = readline.createInterface({ input: stdin, output: stdout });
    try {
      stdout.write(`\nTool request: ${tool.definition.name}\n${JSON.stringify(input, null, 2)}\n`);
      const answer = (await rl.question("Allow? [y/N] ")).trim().toLowerCase();
      return answer === "y" || answer === "yes"
        ? { allow: true }
        : { allow: false, reason: "User denied the tool call." };
    } finally {
      rl.close();
    }
  }
}
