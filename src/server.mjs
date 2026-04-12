// SSE Pipe Proxy, intercepts upstream SSE, buffers answer text, polishes via LLM
// Usage: node src/server.mjs --port 8080 --target https://api.openai.com [--expose]

import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import { parseArgs } from "node:util";
import { Logger } from "./lib/logger.mjs";
import {
  MOCK_REASONING_INTERVAL_MS,
  MOCK_REASONING_WATCHDOG_MS,
  MOCK_REASONING_TEMPLATES,
  DEFAULT_POLISH_API_KEY,
  DEFAULT_POLISH_MODEL,
} from "./config.mjs";
import { generateRequestId } from "./utils/id.mjs";
import { rewriteTextStream } from "./services/polish.mjs";
import { normalizeSseChunk, parseSseBlock } from "./sse/parser.mjs";
import { BufferedResponseSession } from "./sse/buffered-response-session.mjs";

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    port: { type: "string", short: "p", default: "8080" },
    target: { type: "string", short: "t" },
    expose: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: false,
});

if (args.help) {
  console.log(`
SSE Pipe Proxy - Intercepts upstream SSE, buffers answer text, polishes via LLM

Usage: node src/server.mjs [options]

Options:
 -p, --port <number>    Port to listen on (default: 8080)
  -t, --target <url>     Upstream API base URL
      --expose           Listen on 0.0.0.0 instead of 127.0.0.1
  -h, --help            Show this help message

Environment Variables:
  UPSTREAM_API_BASE     Upstream API base URL
  POLISH_API_BASE       Base URL for polish service
  POLISH_API_KEY        API key for polish service
  POLISH_MODEL          Model for text polishing
`);
  process.exit(0);
}

const PORT = parseInt(args.port, 10);
const TARGET = args.target || process.env.UPSTREAM_API_BASE || "https://api.openai.com";
const HOST = args.expose ? "0.0.0.0" : "127.0.0.1";
const POLISH_API_BASE =
  process.env.POLISH_API_BASE ||
  new URL("/v1", TARGET).toString().replace(/\/$/, "");

const logger = new Logger();

const targetUrl = new URL(TARGET);
const client = targetUrl.protocol === "https:" ? https : http;

function createSession({ req, res, requestId, targetHost }) {
  const polishApiKey =
    String(req.headers.authorization || "").replace(/^Bearer\s+/i, "") ||
    DEFAULT_POLISH_API_KEY;

  return new BufferedResponseSession({
    res,
    logger,
    requestId,
    targetHost,
    rewriteTextStream,
    polishApiBase: POLISH_API_BASE,
    polishApiKey,
    polishModel: DEFAULT_POLISH_MODEL,
    mockTemplates: MOCK_REASONING_TEMPLATES,
    mockIntervalMs: MOCK_REASONING_INTERVAL_MS,
    mockWatchdogMs: MOCK_REASONING_WATCHDOG_MS,
    syntheticResponseId: `resp_mock_${crypto.randomUUID()}`,
    syntheticMessageItemId: `msg_mock_${crypto.randomUUID()}`,
    syntheticReasoningItemId: `rs_mock_${crypto.randomUUID()}`,
  });
}

async function pipeSseResponse({ proxyRes, res, session }) {
  let sseBuffer = "";

  for await (const chunk of proxyRes) {
    sseBuffer += normalizeSseChunk(chunk.toString());

    let boundaryIndex;
    while ((boundaryIndex = sseBuffer.indexOf("\n\n")) !== -1) {
      const rawBlock = sseBuffer.slice(0, boundaryIndex);
      sseBuffer = sseBuffer.slice(boundaryIndex + 2);

      if (!rawBlock.trim()) {
        continue;
      }

      const parsed = parseSseBlock(rawBlock);
      if (!parsed.type) {
        res.write(parsed.raw);
        continue;
      }

      if (!session.handleParsedEvent(parsed)) {
        res.write(parsed.raw);
      }
    }
  }

  await session.finish({ tail: sseBuffer });
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    });
    res.end();
    return;
  }

  const id = generateRequestId();
  const path = req.url;

  logger.info(`[${id}] [${req.method}] -> ${path}`);

  const upstreamUrl = new URL(path, TARGET);
  const headers = { ...req.headers, host: upstreamUrl.host };
  const opts = {
    hostname: upstreamUrl.hostname,
    port: upstreamUrl.port,
    path: upstreamUrl.pathname + upstreamUrl.search,
    method: req.method,
    headers,
  };

  const proxyReq = client.request(opts, (proxyRes) => {
    const isSSE = (proxyRes.headers["content-type"] || "").includes(
      "text/event-stream",
    );

    logger.info(`[${id}] [SSE] upstream ${proxyRes.statusCode} sse=${isSSE}`);

    res.writeHead(proxyRes.statusCode, {
      ...proxyRes.headers,
      "access-control-allow-origin": "*",
    });

    if (!isSSE) {
      proxyRes.on("end", () => logger.info(`[${id}] non-SSE response forwarded`));
      proxyRes.pipe(res);
      return;
    }

    const session = createSession({
      req,
      res,
      requestId: id,
      targetHost: targetUrl.hostname,
    });

    void pipeSseResponse({ proxyRes, res, session }).catch((err) => {
      logger.error(`[${id}] upstream error: ${err.message}`);
      if (!res.writableEnded) {
        res.end();
      }
    });
  });

  proxyReq.on("error", (err) => {
    logger.error(`[${id}] proxy request failed: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
    }
    res.end(JSON.stringify({ error: `Proxy error: ${err.message}` }));
  });

  req.pipe(proxyReq);
});

server.listen(PORT, HOST, () => {
  logger.info(`listening on http://${HOST}:${PORT} -> ${TARGET}`);
});
