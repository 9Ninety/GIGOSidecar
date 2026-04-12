import { existsSync } from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";

import { Logger } from "../src/lib/logger.ts";
import {
  type JsonObject,
  normalizeSseChunk,
  parseSseBlock,
} from "../src/sse/parser.ts";
import { SseEventType } from "../src/sse/types.ts";
import { parseReasoningSummary } from "../src/utils/text.ts";

const envFilePath = fileURLToPath(new URL("../.env.local", import.meta.url));

if (existsSync(envFilePath)) {
  process.loadEnvFile(envFilePath);
}

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid port: ${value}`);
  }

  return port;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getPartText(json: JsonObject | null): string {
  const part = json?.part;
  return isRecord(part) && typeof part.text === "string" ? part.text : "";
}

function getString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function printReasoningSummary(
  part: ReturnType<typeof parseReasoningSummary>,
): void {
  if (!part) {
    return;
  }

  if (part.title) {
    process.stdout.write(`${part.title}\n`);
  }

  if (part.content) {
    process.stdout.write(`${part.content}\n`);
  }

  process.stdout.write("\n");
}

const logger = new Logger();
const port = parsePort(process.argv[2] ?? "8080");
const apiBase = `http://localhost:${port}`;
const apiKey = requireEnv("TEST_API_KEY");
const model = requireEnv("TEST_MODEL");
const prompt = requireEnv("TEST_PROMPT");

const body = JSON.stringify({
  model,
  stream: true,
  reasoning: { effort: "high", summary: "detailed" },
  input: [{ role: "user", content: prompt }],
});
const url = new URL("/v1/responses", apiBase);

logger.info(`Testing proxy at ${apiBase}`);

const req = http.request(
  {
    hostname: url.hostname,
    port: url.port || 80,
    path: url.pathname + url.search,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Length": Buffer.byteLength(body),
    },
  },
  (res) => {
    if (res.statusCode !== 200) {
      let errorBody = "";

      res.on("data", (chunk: Buffer) => {
        errorBody += chunk.toString();
      });
      res.on("end", () => {
        logger.error(`Proxy returned ${res.statusCode}: ${errorBody}`);
        process.exit(1);
      });
      return;
    }

    let sseBuffer = "";
    let answer = "";
    let answerStreaming = false;
    let eventCount = 0;

    res.on("data", (raw: Buffer) => {
      sseBuffer += normalizeSseChunk(raw.toString());

      let boundaryIndex = sseBuffer.indexOf("\n\n");
      while (boundaryIndex !== -1) {
        const rawBlock = sseBuffer.slice(0, boundaryIndex);
        sseBuffer = sseBuffer.slice(boundaryIndex + 2);

        if (rawBlock.trim()) {
          const parsed = parseSseBlock(rawBlock);
          const { type, json } = parsed;
          eventCount += 1;

          switch (type) {
            case SseEventType.OutputTextDelta: {
              const delta = getString(json?.delta);
              answer += delta;
              process.stdout.write(delta);
              answerStreaming = true;
              break;
            }

            case SseEventType.OutputTextDone: {
              answer = getString(json?.text) || answer;
              if (!answerStreaming) {
                process.stdout.write(answer);
              }
              process.stdout.write("\n");
              answerStreaming = false;
              break;
            }

            case SseEventType.ReasoningSummaryPartDone:
              printReasoningSummary(parseReasoningSummary(getPartText(json)));
              break;

            case SseEventType.Completed:
              logger.info(
                `Stream completed. Events: ${eventCount}, Answer: ${answer.length} chars`,
              );
              break;

            default:
              break;
          }
        }

        boundaryIndex = sseBuffer.indexOf("\n\n");
      }
    });

    res.on("end", () => {
      if (sseBuffer.trim()) {
        logger.warn(`Unparsed SSE tail: ${sseBuffer.trim().slice(0, 200)}`);
      }

      logger.info("Test completed");
    });
  },
);

req.on("error", (error) => {
  logger.error(`Request failed: ${error.message}`);
  process.exit(1);
});

req.write(body);
req.end();
