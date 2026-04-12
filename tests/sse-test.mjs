// SSE Proxy Test - Tests the local proxy server
// Usage: TEST_API_KEY=xxx node tests/sse-test.mjs [proxy-port]

import { existsSync } from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { Logger } from "../src/lib/logger.mjs";
import { normalizeSseChunk, parseSseBlock } from "../src/sse/parser.mjs";
import { SseEventType } from "../src/sse/types.mjs";
import { parseReasoningSummary } from "../src/utils/text.mjs";

const envFilePath = fileURLToPath(new URL("../.env.local", import.meta.url));

if (existsSync(envFilePath)) {
  process.loadEnvFile(envFilePath);
}

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const logger = new Logger();
const PORT = parseInt(process.argv[2] || "8080", 10);
const API_BASE = `http://localhost:${PORT}`;
const API_KEY = requireEnv("TEST_API_KEY");

const MODEL = requireEnv("TEST_MODEL");
const PROMPT = requireEnv("TEST_PROMPT");

function printReasoningSummary(part) {
  if (!part) return;
  if (part.title) process.stdout.write(`${part.title}\n`);
  if (part.content) process.stdout.write(`${part.content}\n`);
  process.stdout.write("\n");
}

const body = JSON.stringify({
  model: MODEL,
  stream: true,
  reasoning: { effort: "high", summary: "detailed" },
  input: [{ role: "user", content: PROMPT }],
});

const url = new URL("/v1/responses", API_BASE);

const opts = {
  hostname: url.hostname,
  port: url.port || 80,
  path: url.pathname + url.search,
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
    "Content-Length": Buffer.byteLength(body),
  },
};

logger.info(`Testing proxy at ${API_BASE}`);

const req = http.request(opts, (res) => {
  if (res.statusCode !== 200) {
    let errorBody = "";
    res.on("data", (chunk) => {
      errorBody += chunk;
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

  res.on("data", (raw) => {
    sseBuffer += normalizeSseChunk(raw.toString());

    let boundaryIndex;
    while ((boundaryIndex = sseBuffer.indexOf("\n\n")) !== -1) {
      const rawBlock = sseBuffer.slice(0, boundaryIndex);
      sseBuffer = sseBuffer.slice(boundaryIndex + 2);

      if (!rawBlock.trim()) continue;

      const parsed = parseSseBlock(rawBlock);
      const { type, json } = parsed;
      eventCount++;

      if (!type) continue;

      switch (type) {
        case SseEventType.OutputTextDelta:
          answer += json?.delta || "";
          process.stdout.write(json?.delta || "");
          answerStreaming = true;
          break;

        case SseEventType.OutputTextDone:
          answer = json?.text || answer;
          if (!answerStreaming) process.stdout.write(answer);
          process.stdout.write("\n");
          answerStreaming = false;
          break;

        case SseEventType.ReasoningSummaryPartDone:
          printReasoningSummary(parseReasoningSummary(json?.part?.text));
          break;

        case SseEventType.Completed:
          logger.info(
            `Stream completed. Events: ${eventCount}, Answer: ${answer.length} chars`,
          );
          break;
      }
    }
  });

  res.on("end", () => {
    if (sseBuffer.trim()) {
      logger.warn(`Unparsed SSE tail: ${sseBuffer.trim().slice(0, 200)}`);
    }
    logger.info("Test completed");
  });
});

req.on("error", (err) => {
  logger.error(`Request failed: ${err.message}`);
  process.exit(1);
});

req.write(body);
req.end();
