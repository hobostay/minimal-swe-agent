export type ToolCall = {
  id: string;
  name: string;
  arguments: unknown;
};

export type AgentMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; toolCalls: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ModelRequest = {
  messages: AgentMessage[];
  tools: ToolDefinition[];
  signal?: AbortSignal;
};

export type ModelResponse = {
  content: string;
  toolCalls: ToolCall[];
  finishReason: "stop" | "tool_calls" | "length" | "unknown";
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
};

export interface ModelClient {
  generate(request: ModelRequest): Promise<ModelResponse>;
}

export type ToolResult = {
  ok: boolean;
  output: string;
  error?: {
    code: string;
    message: string;
  };
  metadata?: Record<string, unknown>;
};

export type AgentEvent =
  | { type: "model_start"; step: number }
  | { type: "model_end"; step: number; response: ModelResponse }
  | { type: "tool_start"; step: number; call: ToolCall }
  | { type: "tool_end"; step: number; call: ToolCall; result: ToolResult };

export type WorkflowTaskKind = "inspect" | "plan" | "execute" | "verify" | "summarize";
export type WorkflowTaskStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export type WorkflowTask = {
  id: string;
  kind: WorkflowTaskKind;
  title: string;
  instruction: string;
  dependencies: string[];
  status: WorkflowTaskStatus;
  attempts: number;
  maxAttempts: number;
  output?: string;
  error?: string;
};

export type ParsedPlanItem = {
  id: string;
  title: string;
  instruction: string;
  dependencies: string[];
};

export type AgentRunResult = {
  status: "completed" | "max_steps" | "aborted" | "failed";
  output: string;
  messages: AgentMessage[];
  steps: number;
  error?: string;
};

export function toolSuccess(
  output: string,
  metadata?: Record<string, unknown>,
): ToolResult {
  return { ok: true, output, metadata };
}

export function toolFailure(code: string, message: string, output = ""): ToolResult {
  return { ok: false, output, error: { code, message } };
}
