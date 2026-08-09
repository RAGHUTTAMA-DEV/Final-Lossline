import { env } from "../config/env.js";
import { GeminiLLMClient } from "./gemini.js";
import type { LLMClient } from "./types.js";

export type { ChatMessage, LLMChatRequest, LLMChatResponse, LLMClient, ToolCall, ToolDef } from "./types.js";
export { GeminiLLMClient } from "./gemini.js";

/**
 * Factory for the configured LLM provider.
 * Phase 0 / API boot does not call this — Phase 2 investigation loop will.
 * Throws if GEMINI_API_KEY is missing so misconfig fails loudly at agent start.
 */
export function createLLMClient(): LLMClient {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_gemini_api_key_here") {
    throw new Error(
      "GEMINI_API_KEY is not set. Add a valid key to .env before using the investigation agent.",
    );
  }
  return new GeminiLLMClient(apiKey, env.GEMINI_MODEL);
}
