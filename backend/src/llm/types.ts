export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChatMessage {
  role: "user" | "model" | "tool";
  content: string;
  /** Present when role is "tool" — links result to a prior tool call. */
  toolCallId?: string;
  /** Present when role is "model" and the model requested tools. */
  toolCalls?: ToolCall[];
}

export interface LLMChatRequest {
  system?: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
}

export interface LLMChatResponse {
  text?: string;
  toolCalls: ToolCall[];
  raw: unknown;
}

export interface LLMClient {
  chat(args: LLMChatRequest): Promise<LLMChatResponse>;
}
