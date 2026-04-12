import crypto from "node:crypto";
import http, {
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type RequestOptions,
  type ServerResponse,
} from "node:http";
import https from "node:https";
import { parseArgs } from "node:util";

import {
  DEFAULT_UPSTREAM_API_BASE,
  MOCK_REASONING_INTERVAL_MS,
  MOCK_REASONING_TEMPLATES,
  MOCK_REASONING_WATCHDOG_MS,
} from "./config.ts";
import { Logger } from "./lib/logger.ts";
import { rewriteTextStream } from "./services/polish.ts";
import { BufferedResponseSession } from "./sse/buffered-response-session.ts";
import { normalizeSseChunk, parseSseBlock } from "./sse/parser.ts";
import { generateRequestId } from "./utils/id.ts";
import { normalizeBaseUrl } from "./utils/url.ts";

interface CliOptions {
  port: string;
  target?: string;
  expose: boolean;
  help: boolean;
}

interface RuntimeConfig {
  host: string;
  port: number;
  target: string;
  targetUrl: URL;
  client: typeof http | typeof https;
}

function printHelp(): void {
  console.log(`
SSE Pipe Proxy - Intercepts upstream SSE, buffers answer text, polishes via LLM

Usage: node --experimental-strip-types src/server.ts [options]

Options:
  -p, --port <number>    Port to listen on (default: 8080)
  -t, --target <url>     Upstream API base URL
      --expose           Listen on 0.0.0.0 instead of 127.0.0.1
  -h, --help             Show this help message

Environment Variables:
  UPSTREAM_API_BASE      Upstream API base URL
  POLISH_API_BASE        Base URL for polish service
  POLISH_API_KEY         API key for polish service
  POLISH_MODEL           Model for text polishing
`);
}

function parseCliOptions(): CliOptions {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      port: { type: "string", short: "p", default: "8080" },
      target: { type: "string", short: "t" },
      expose: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  return values as CliOptions;
}

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid port: ${value}`);
  }

  return port;
}

function getHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return value ?? "";
}

function requireRequestPath(req: IncomingMessage): string {
  if (!req.url) {
    throw new Error("Incoming request URL is missing");
  }

  return req.url;
}

function resolveRuntimeConfig(cli: CliOptions): RuntimeConfig {
  const target = cli.target?.trim() || process.env.UPSTREAM_API_BASE?.trim() || DEFAULT_UPSTREAM_API_BASE;
  const targetUrl = new URL(target);

  return {
    host: cli.expose ? "0.0.0.0" : "127.0.0.1",
    port: parsePort(cli.port),
    target,
    targetUrl,
    client: targetUrl.protocol === "https:" ? https : http,
  };
}

function createSession({
  req,
  res,
  requestId,
  targetHost,
  logger,
}: {
  req: IncomingMessage;
  res: ServerResponse;
  requestId: string;
  targetHost: string;
  logger: Logger;
}): BufferedResponseSession {
  return new BufferedResponseSession({
    res,
    logger,
    requestId,
    targetHost,
    rewriteTextStream,
    mockTemplates: MOCK_REASONING_TEMPLATES,
    mockIntervalMs: MOCK_REASONING_INTERVAL_MS,
    mockWatchdogMs: MOCK_REASONING_WATCHDOG_MS,
    syntheticResponseId: `resp_mock_${crypto.randomUUID()}`,
    syntheticMessageItemId: `msg_mock_${crypto.randomUUID()}`,
    syntheticReasoningItemId: `rs_mock_${crypto.randomUUID()}`,
  });
}

async function pipeSseResponse({
  proxyRes,
  res,
  session,
}: {
  proxyRes: IncomingMessage;
  res: ServerResponse;
  session: BufferedResponseSession;
}): Promise<void> {
  let sseBuffer = "";

  for await (const chunk of proxyRes) {
    sseBuffer += normalizeSseChunk(chunk.toString());

    let boundaryIndex = sseBuffer.indexOf("\n\n");
    while (boundaryIndex !== -1) {
      const rawBlock = sseBuffer.slice(0, boundaryIndex);
      sseBuffer = sseBuffer.slice(boundaryIndex + 2);

      if (rawBlock.trim()) {
        const parsed = parseSseBlock(rawBlock);

        if (!parsed.type) {
          session.writeParsedEvent(parsed);
        } else if (!session.handleParsedEvent(parsed)) {
          session.writeParsedEvent(parsed);
        }
      }

      boundaryIndex = sseBuffer.indexOf("\n\n");
    }
  }

  await session.finish({ tail: sseBuffer });
}

function createProxyHeaders(
  req: IncomingMessage,
  upstreamHost: string,
): OutgoingHttpHeaders {
  return { ...req.headers, host: upstreamHost };
}

function createProxyOptions(req: IncomingMessage, targetUrl: URL): RequestOptions {
  const requestPath = requireRequestPath(req);
  const upstreamUrl = new URL(requestPath, targetUrl);

  return {
    hostname: upstreamUrl.hostname,
    port: upstreamUrl.port,
    path: upstreamUrl.pathname + upstreamUrl.search,
    method: req.method ?? "GET",
    headers: createProxyHeaders(req, upstreamUrl.host),
  };
}

function startServer(): void {
  const cli = parseCliOptions();
  if (cli.help) {
    printHelp();
    return;
  }

  const runtime = resolveRuntimeConfig(cli);
  const logger = new Logger();

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

    const requestId = generateRequestId();
    const requestPath = requireRequestPath(req);

    logger.info(`[${requestId}] [${req.method ?? "UNKNOWN"}] -> ${requestPath}`);

    const proxyReq = runtime.client.request(
      createProxyOptions(req, runtime.targetUrl),
      (proxyRes) => {
        const isSse = getHeaderValue(proxyRes.headers["content-type"]).includes(
          "text/event-stream",
        );

        logger.info(
          `[${requestId}] [SSE] upstream ${proxyRes.statusCode ?? 0} sse=${isSse}`,
        );

        res.writeHead(proxyRes.statusCode ?? 502, {
          ...proxyRes.headers,
          "access-control-allow-origin": "*",
        });

        if (!isSse) {
          proxyRes.on("end", () => {
            logger.info(`[${requestId}] non-SSE response forwarded`);
          });
          proxyRes.pipe(res);
          return;
        }

        try {
          const session = createSession({
            req,
            res,
            requestId,
            targetHost: runtime.targetUrl.hostname,
            logger,
          });

          void pipeSseResponse({ proxyRes, res, session }).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);

            logger.error(`[${requestId}] upstream error: ${message}`);
            if (!res.writableEnded) {
              res.end();
            }
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);

          logger.error(`[${requestId}] session setup failed: ${message}`);
          proxyRes.resume();
          if (!res.writableEnded) {
            res.end();
          }
        }
      },
    );

    proxyReq.on("error", (error) => {
      logger.error(`[${requestId}] proxy request failed: ${error.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json" });
      }
      res.end(JSON.stringify({ error: `Proxy error: ${error.message}` }));
    });

    req.on("aborted", () => {
      proxyReq.destroy();
    });
    req.pipe(proxyReq);
  });

  server.listen(runtime.port, runtime.host, () => {
    logger.info(`listening on http://${runtime.host}:${runtime.port} -> ${runtime.target}`);
  });
}

startServer();
