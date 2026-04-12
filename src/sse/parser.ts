export type JsonObject = Record<string, unknown>;

export interface ParsedSseBlock {
  raw: string;
  event: string;
  data: string;
  json: JsonObject | null;
  type: string;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(data: string): JsonObject | null {
  try {
    const parsed = JSON.parse(data) as unknown;
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function normalizeSseChunk(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

export function parseSseBlock(block: string): ParsedSseBlock {
  const lines = block.split("\n");
  const dataLines: string[] = [];
  let event = "";

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  const data = dataLines.join("\n");
  const json = data && data !== "[DONE]" ? parseJsonObject(data) : null;
  const type = typeof json?.type === "string" ? json.type : event;

  return {
    raw: `${block}\n\n`,
    event,
    data,
    json,
    type,
  };
}
