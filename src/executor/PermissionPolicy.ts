import readline from "node:readline/promises";
import { stdin, stderr } from "node:process";
import type { Tool } from "../tools/Tool.js";

export type PermissionMode = "ask" | "auto";

export class PermissionPolicy {
  constructor(readonly mode: PermissionMode, private readonly onInterrupt?: () => void) {}

  async authorize(tool: Tool, input: unknown, signal?: AbortSignal): Promise<{ allow: boolean; reason?: string }> {
    if (!tool.mutates || this.mode === "auto") return { allow: true };
    if (!stdin.isTTY) {
      return {
        allow: false,
        reason: `Tool ${tool.definition.name} requires approval. Re-run with --yes in a trusted workspace.`,
      };
    }
    const rl = readline.createInterface({ input: stdin, output: stderr });
    try {
      const closed = new Promise<string>(resolve => rl.once("close", () => resolve("")));
      rl.once("SIGINT", () => {
        this.onInterrupt?.();
        rl.close();
      });
      stderr.write(`\nTool request: ${tool.definition.name}\n${JSON.stringify(input, null, 2)}\n`);
      const answer = (await Promise.race([rl.question("Allow? [y/N] ", { signal }), closed])).trim().toLowerCase();
      return answer === "y" || answer === "yes"
        ? { allow: true }
        : { allow: false, reason: "User denied the tool call." };
    } finally {
      rl.close();
    }
  }
}
