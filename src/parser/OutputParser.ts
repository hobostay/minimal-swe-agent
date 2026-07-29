import type { ParsedPlanItem } from "../types.js";

export type ParsedOutput = {
  text: string;
  plan: ParsedPlanItem[];
  finalAnswer?: string;
  errors: string[];
};

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

function parsePlan(value: unknown): ParsedPlanItem[] {
  if (!value || typeof value !== "object") return [];
  const raw = (value as Record<string, unknown>).plan;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const instruction = typeof record.instruction === "string" ? record.instruction.trim() : "";
    if (!title || !instruction) return [];
    return [{
      id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `step-${index + 1}`,
      title,
      instruction,
      dependencies: Array.isArray(record.dependencies)
        ? record.dependencies.filter((dep): dep is string => typeof dep === "string")
        : [],
    }];
  });
}

export class OutputParser {
  parse(text: string): ParsedOutput {
    const candidates = jsonCandidates(text);
    const plan = candidates.flatMap(parsePlan);
    const finalAnswer = text.match(/<final>([\s\S]*?)<\/final>/i)?.[1]?.trim();
    return {
      text,
      plan,
      finalAnswer,
      errors: text.includes("```json") && candidates.length === 0
        ? ["A JSON fence was present but could not be parsed."]
        : [],
    };
  }
}
