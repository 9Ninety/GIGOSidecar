import {
  DEFAULT_POLISH_API_BASE,
  DEFAULT_POLISH_API_KEY,
  DEFAULT_POLISH_MODEL,
  REWRITE_PROMPT,
} from "../config.mjs";
import { normalizeBaseUrl } from "../utils/url.mjs";

function buildRewritePayload({ input, model, prompt }) {
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

function extractChunkDelta(payload) {
  return payload?.choices?.[0]?.delta?.content || "";
}

export async function* rewriteTextStream({
  input,
  apiBase = DEFAULT_POLISH_API_BASE,
  apiKey = DEFAULT_POLISH_API_KEY,
  model = DEFAULT_POLISH_MODEL,
  prompt = REWRITE_PROMPT,
  signal,
} = {}) {
  const base = normalizeBaseUrl(apiBase);
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: buildRewritePayload({ input, model, prompt }),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Polish request failed with ${response.status}: ${errorBody}`,
    );
  }

  let buffer = "";
  const decoder = new TextDecoder("utf-8");

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");

    let index;
    while ((index = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 2);

      if (!block) {
        continue;
      }

      const dataLines = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart());

      if (!dataLines.length) {
        continue;
      }

      const payload = dataLines.join("\n");

      if (payload === "[DONE]") {
        return;
      }

      try {
        const delta = extractChunkDelta(JSON.parse(payload));

        if (delta) {
          yield delta;
        }
      } catch (error) {
        throw new Error(`Failed to parse polish SSE payload: ${error.message}`);
      }
    }
  }

  if (buffer.trim()) {
    throw new Error(`Unparsed polish SSE tail: ${buffer.trim().slice(0, 500)}`);
  }
}

export async function rewriteText(options = {}) {
  let fullText = "";

  for await (const delta of rewriteTextStream(options)) {
    fullText += delta;
  }

  return fullText;
}
