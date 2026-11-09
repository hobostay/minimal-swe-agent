import type { ParsedPlanItem } from "../types.js";

export type ParsedOutput = {
  text: string;
  plan: ParsedPlanItem[];
  hasPlan: boolean;
  finalAnswer?: string;
  errors: string[];
};

export type Verification = { status: "passed" | "failed" | "not_run"; summary: string };

function jsonCandidates(text: string): unknown[] {
  const values: unknown[] = [];
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    try {
      values.push(JSON.parse(match[1]!.trim()));
    } catch {
      // The caller receives a parse error below.
    }
  }
  try {
    values.push(JSON.parse(text.trim()));
  } catch {
    // Normal prose is allowed.
  }
  return values;
}

function parsePlan(raw: unknown): ParsedPlanItem[] {
  if (!Array.isArray(raw)) throw new Error("The plan must be an array.");
  return raw.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`Invalid plan item ${index + 1}.`);
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const instruction = typeof record.instruction === "string" ? record.instruction.trim() : "";
    const deps = record.dependencies;
    if (!id || !title || !instruction || !Array.isArray(deps)
      || !deps.every((dep): dep is string => typeof dep === "string" && Boolean(dep.trim()))) {
      throw new Error(`Plan item ${index + 1} requires an id, title, instruction, and dependency id array.`);
    }
    return { id, title, instruction, dependencies: deps.map(dep => dep.trim()) };
  });
}

export class OutputParser {
  parse(text: string): ParsedOutput {
    const candidates = jsonCandidates(text).filter(value => value && typeof value === "object" && "plan" in value) as { plan: unknown }[];
    const finalAnswer = text.match(/<final>([\s\S]*?)<\/final>/i)?.[1]?.trim();
    try {
      if (candidates.length > 1) throw new Error("Expected one plan object.");
      return { text, plan: candidates.length ? parsePlan(candidates[0]!.plan) : [], hasPlan: candidates.length === 1, finalAnswer, errors: [] };
    } catch (error) {
      return { text, plan: [], hasPlan: false, finalAnswer, errors: [String((error as Error).message)] };
    }
  }

  parseVerification(text: string): Verification {
    const candidates = jsonCandidates(text).filter(value => value && typeof value === "object" && "status" in value) as Record<string, unknown>[];
    const { status, summary } = candidates[0] ?? {};
    if (candidates.length !== 1 || (status !== "passed" && status !== "failed" && status !== "not_run")
      || typeof summary !== "string" || !summary.trim()) {
      throw new Error("Expected one verification object with status passed, failed, or not_run and a non-empty summary.");
    }
    return { status, summary: summary.trim() };
  }
}
