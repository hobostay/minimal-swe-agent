import type {
  AgentMessage,
  ModelClient,
  ModelRequest,
  ModelResponse,
  ToolCall,
} from "../types.js";

type OpenAICompatibleClientOptions = {
  apiKey: string;
  model: string;
  baseUrl?: string;
  temperature?: number;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  error?: { message?: string };
};

function toProviderMessage(message: AgentMessage): Record<string, unknown> {
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map(call => ({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments: JSON.stringify(call.arguments),
        },
      })),
    };
  }
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      name: message.name,
      content: message.content,
    };
  }
  return message;
}

function parseArguments(raw: string | undefined): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { __parseError: "Tool arguments were not valid JSON.", __raw: raw };
  }
}

function parseFinishReason(reason: string | null | undefined): ModelResponse["finishReason"] {
  if (reason === "stop" || reason === "tool_calls" || reason === "length") return reason;
  return "unknown";
}

export class OpenAICompatibleClient implements ModelClient {
  readonly baseUrl: string;

  constructor(readonly options: OpenAICompatibleClientOptions) {
    this.baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.options.model,
        temperature: this.options.temperature ?? 0,
        messages: request.messages.map(toProviderMessage),
        tools: request.tools.map(tool => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        })),
        tool_choice: "auto",
      }),
      signal: request.signal,
    });

    const body = (await response.json()) as ChatCompletionResponse;
    if (!response.ok) {
      throw new Error(body.error?.message ?? `Model request failed with HTTP ${response.status}`);
    }

    const choice = body.choices?.[0];
    if (!choice?.message) throw new Error("Model response contained no choice.");

    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((call, index) => ({
      id: call.id ?? `call-${Date.now()}-${index}`,
      name: call.function?.name ?? "",
      arguments: parseArguments(call.function?.arguments),
    }));

    return {
      content: choice.message.content ?? "",
      toolCalls,
      finishReason: parseFinishReason(choice.finish_reason),
      usage: body.usage
        ? {
            inputTokens: body.usage.prompt_tokens ?? 0,
            outputTokens: body.usage.completion_tokens ?? 0,
          }
        : undefined,
    };
  }
}
