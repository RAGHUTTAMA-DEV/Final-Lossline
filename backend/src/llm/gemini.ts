import {
  FunctionCallingMode,
  GoogleGenerativeAI,
  SchemaType,
  type Content,
  type FunctionDeclaration,
  type Part,
  type Tool,
} from "@google/generative-ai";
import { randomUUID } from "node:crypto";
import type {
  ChatMessage,
  LLMChatRequest,
  LLMChatResponse,
  LLMClient,
  ToolCall,
  ToolDef,
} from "./types.js";

function toGeminiFunctionDeclarations(tools: ToolDef[]): FunctionDeclaration[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: {
      type: SchemaType.OBJECT,
      ...(tool.parameters as object),
    } as FunctionDeclaration["parameters"],
  }));
}

function toGeminiContents(messages: ChatMessage[]): Content[] {
  const contents: Content[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      contents.push({
        role: "user",
        parts: [{ text: message.content }],
      });
      continue;
    }

    if (message.role === "model") {
      const parts: Part[] = [];
      if (message.content) {
        parts.push({ text: message.content });
      }
      if (message.toolCalls?.length) {
        for (const call of message.toolCalls) {
          parts.push({
            functionCall: {
              name: call.name,
              args: call.args,
            },
          });
        }
      }
      if (parts.length === 0) {
        parts.push({ text: "" });
      }
      contents.push({ role: "model", parts });
      continue;
    }

    // role === "tool" — Gemini expects a user turn with functionResponse parts
    const nameFromId = message.toolCallId ?? "unknown";
    let responsePayload: unknown = message.content;
    try {
      responsePayload = JSON.parse(message.content) as unknown;
    } catch {
      responsePayload = { result: message.content };
    }

    // Prefer attaching to previous user functionResponse batch if last content is already tool results
    const last = contents[contents.length - 1];
    const functionResponsePart: Part = {
      functionResponse: {
        name: nameFromId,
        response:
          typeof responsePayload === "object" && responsePayload !== null
            ? (responsePayload as object)
            : { result: responsePayload },
      },
    };

    if (last?.role === "user" && last.parts.some((p) => "functionResponse" in p)) {
      last.parts.push(functionResponsePart);
    } else {
      contents.push({
        role: "user",
        parts: [functionResponsePart],
      });
    }
  }

  return contents;
}

/**
 * Gemini function responses need the tool *name*, not our synthetic id.
 * Callers should set toolCallId to the tool name when feeding results back,
 * or we look up name from prior model toolCalls in the conversation.
 */
function resolveToolName(message: ChatMessage, history: ChatMessage[]): string {
  if (message.toolCallId) {
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const prior = history[i];
      const match = prior.toolCalls?.find((c) => c.id === message.toolCallId);
      if (match) return match.name;
    }
    // If toolCallId was already the name, use it
    return message.toolCallId;
  }
  return "unknown";
}

export class GeminiLLMClient implements LLMClient {
  private readonly genAI: GoogleGenerativeAI;
  private readonly modelName: string;

  constructor(apiKey: string, modelName: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.modelName = modelName;
  }

  async chat(args: LLMChatRequest): Promise<LLMChatResponse> {
    const geminiTools: Tool[] | undefined = args.tools?.length
      ? [{ functionDeclarations: toGeminiFunctionDeclarations(args.tools) }]
      : undefined;

    const model = this.genAI.getGenerativeModel({
      model: this.modelName,
      systemInstruction: args.system,
      tools: geminiTools,
      toolConfig: geminiTools
        ? { functionCallingConfig: { mode: FunctionCallingMode.AUTO } }
        : undefined,
    });

    // Rewrite tool messages so functionResponse.name is the real tool name
    const normalized: ChatMessage[] = args.messages.map((m) => {
      if (m.role !== "tool") return m;
      return {
        ...m,
        toolCallId: resolveToolName(m, args.messages),
      };
    });

    const contents = toGeminiContents(normalized);
    const result = await model.generateContent({ contents });
    const response = result.response;
    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];

    let text: string | undefined;
    const toolCalls: ToolCall[] = [];

    for (const part of parts) {
      if ("text" in part && part.text) {
        text = (text ?? "") + part.text;
      }
      if ("functionCall" in part && part.functionCall) {
        toolCalls.push({
          id: randomUUID(),
          name: part.functionCall.name,
          args: (part.functionCall.args ?? {}) as Record<string, unknown>,
        });
      }
    }

    return {
      text: text?.trim() || undefined,
      toolCalls,
      raw: response,
    };
  }
}
