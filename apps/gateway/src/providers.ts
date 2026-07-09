/**
 * Provider router. Providers speak the OpenAI Chat Completions wire format for
 * M6 (the canonical model maps onto it); Anthropic/Responses adapters are added
 * in M9. Only REDACTED text ever reaches here.
 *
 * "mock" targets the local provider mock container (splits placeholders across
 * SSE chunks to exercise the un-redactor). "openai" proxies to the real API.
 */
import { request, type Dispatcher } from "undici";
import { config } from "./config.js";

export interface ProviderResponse {
  statusCode: number;
  /** Raw response body stream (OpenAI SSE for stream=true, JSON otherwise). */
  body: Dispatcher.ResponseData["body"];
  headers: Record<string, string | string[] | undefined>;
}

/** OpenAI content is either a plain string or multimodal parts (text + images). */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface OutboundRequest {
  model: string;
  messages: Array<{ role: string; content: string | ContentPart[]; name?: string; tool_call_id?: string }>;
  stream: boolean;
  max_tokens?: number;
  temperature?: number;
}

function target(provider: string): { url: string; apiKey: string } {
  switch (provider) {
    case "mock":
      return { url: `${config.mockProviderUrl}/v1/chat/completions`, apiKey: "mock" };
    case "openai":
    case "azure-openai":
      return { url: `${config.openaiBaseUrl}/chat/completions`, apiKey: config.openaiApiKey };
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

export async function forwardChat(provider: string, body: OutboundRequest): Promise<ProviderResponse> {
  const { url, apiKey } = target(provider);
  const res = await request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { statusCode: res.statusCode, body: res.body, headers: res.headers as ProviderResponse["headers"] };
}

/** Which provider to use, honoring policy.allowed_providers when set. */
export function chooseProvider(allowed: string[]): string {
  if (allowed.length === 0) return config.defaultProvider;
  if (allowed.includes(config.defaultProvider)) return config.defaultProvider;
  return allowed[0]!;
}
