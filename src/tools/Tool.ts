import type { ToolDefinition, ToolResult } from "../types.js";

export type ToolContext = {
  cwd: string;
  signal?: AbortSignal;
};

export interface Tool<TInput = unknown> {
  readonly definition: ToolDefinition;
  readonly mutates: boolean;
  readonly terminal?: boolean;
  validate(input: unknown): TInput;
  execute(input: TInput, context: ToolContext): Promise<ToolResult>;
}

export function objectInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Tool arguments must be an object.");
  }
  const value = input as Record<string, unknown>;
  if ("__parseError" in value) {
    throw new Error(String(value.__parseError));
  }
  return value;
}

export function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} must be a non-empty string.`);
  }
  return value;
}

export function optionalNumber(
  record: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = record[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${key} must be a non-negative number.`);
  }
  return value;
}
