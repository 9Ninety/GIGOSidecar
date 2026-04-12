import {
  DEFAULT_POLISH_API_BASE,
  DEFAULT_POLISH_API_KEY,
  DEFAULT_POLISH_MODEL,
  REWRITE_PROMPT,
  requireConfig,
} from "../config.ts";
import { normalizeBaseUrl } from "../utils/url.ts";

export interface RewriteTextStreamOptions {
  input: string;
  apiBase?: string;
  apiKey?: string;
  model?: string;
  prompt?: string;
  signal?: AbortSignal;
}

interface ChatCompletionChunk {
  choices?: Array<{
    delta?: {
      content?: string;
    };
  }>;
}

function buildRewritePayload({
  input,
  model,
  prompt,
}: {
  input: string;
  model: string;
  prompt: string;
}): string {
  return JSON.stringify({
    model,
    stream: true,
    messages: [
      { role: "system", content: prompt },
      {
        role: "user",
        content: `<text_to_rewrite>\n${input}\n</text_to_rewrite>`,
      },
    ],
  });
}

function extractChunkDelta(payload: ChatCompletionChunk): string {
  return payload.choices?.[0]?.delta?.content ?? "";
}

function getResponseBody(response: Response): ReadableStream<Uint8Array> {
  if (!response.body) {
    throw new Error("Polish response body is empty");
  }

  return response.body;
}

export async function* rewriteTextStream({
  input,
  apiBase = DEFAULT_POLISH_API_BASE,
  apiKey = DEFAULT_POLISH_API_KEY,
  model = DEFAULT_POLISH_MODEL,
  prompt = REWRITE_PROMPT,
  signal,
}: RewriteTextStreamOptions): AsyncGenerator<string> {
  if (signal?.aborted) {
    throw new Error("Polish request aborted before start");
  }

  const resolvedApiBase = normalizeBaseUrl(
    requireConfig("POLISH_API_BASE", apiBase),
  );
  const resolvedApiKey = requireConfig("POLISH_API_KEY", apiKey);
  const resolvedModel = requireConfig("POLISH_MODEL", model);
  const response = await fetch(`${resolvedApiBase}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resolvedApiKey}`,
    },
    body: buildRewritePayload({ input, model: resolvedModel, prompt }),
    signal: signal ?? null,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Polish request failed with ${response.status}: ${errorBody}`,
    );
  }

  let buffer = "";
  const decoder = new TextDecoder("utf-8");

  for await (const chunk of getResponseBody(response)) {
    buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");

    let boundaryIndex = buffer.indexOf("\n\n");
    while (boundaryIndex !== -1) {
      const block = buffer.slice(0, boundaryIndex).trim();
      buffer = buffer.slice(boundaryIndex + 2);

      if (block) {
        const dataLines = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart());

        if (dataLines.length > 0) {
          const payload = dataLines.join("\n");

          if (payload === "[DONE]") {
            return;
          }

          try {
            const delta = extractChunkDelta(JSON.parse(payload) as ChatCompletionChunk);

            if (delta) {
              yield delta;
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to parse polish SSE payload: ${message}`);
          }
        }
      }

      boundaryIndex = buffer.indexOf("\n\n");
    }
  }

  if (buffer.trim()) {
    throw new Error(`Unparsed polish SSE tail: ${buffer.trim().slice(0, 500)}`);
  }
}

export async function rewriteText(options: RewriteTextStreamOptions): Promise<string> {
  let fullText = "";

  for await (const delta of rewriteTextStream(options)) {
    fullText += delta;
  }

  return fullText;
}
