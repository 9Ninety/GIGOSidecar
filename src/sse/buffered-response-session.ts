import type { ServerResponse } from "node:http";
import { isNumber, isPlainObject, isString } from "es-toolkit/predicate";

import {
  type MockReasoningTemplate,
  requireEnv,
} from "../config.ts";
import type { Logger } from "../lib/logger.ts";
import type { RewriteTextStreamOptions } from "../services/polish.ts";
import {
  buildMessageItem,
  buildReasoningItem,
  buildReasoningSummaryText,
  buildSseEvent,
  isBufferedAnswerEvent,
  type MessageItem,
  type OutputTextPart,
  type ReasoningItem,
  type ReasoningSummaryTextPart,
  type SseAnnotation,
} from "./events.ts";
import type { JsonObject, ParsedSseBlock } from "./parser.ts";
import { SseEventType } from "./types.ts";

interface BufferedAnswerState {
  text: string;
  started: boolean;
  done: boolean;
  released: boolean;
  completedEvent: ParsedSseBlock | null;
  itemId: string;
  sourceOutputIndex: number | null;
  emittedOutputIndex: number | null;
  contentIndex: number;
  phase: string;
  annotations: SseAnnotation[];
  envelopeStarted: boolean;
}

interface MockReasoningState {
  timer: NodeJS.Timeout | null;
  watchdog: NodeJS.Timeout | null;
  started: boolean;
  done: boolean;
  itemId: string;
  outputIndex: number | null;
  summaries: ReasoningSummaryTextPart[];
}

interface CompletedResponse {
  id: string;
  object: "response";
  status: "completed";
  completed_at: number;
  model: string;
  output: Array<MessageItem | ReasoningItem | unknown>;
  metadata: Record<string, unknown>;
}

interface BufferedResponseSessionOptions {
  res: ServerResponse;
  logger: Logger;
  requestId: string;
  targetHost: string;
  rewriteTextStream: (
    options: RewriteTextStreamOptions,
  ) => AsyncIterable<string>;
  mockTemplates: readonly MockReasoningTemplate[];
  mockIntervalMs: number;
  mockWatchdogMs: number;
  syntheticResponseId: string;
  syntheticMessageItemId: string;
  syntheticReasoningItemId: string;
}

interface MessageEnvelope {
  itemId: string;
  outputIndex: number;
  phase: string | undefined;
  annotations: SseAnnotation[];
}

interface ContentPartEnvelope {
  itemId: string;
  outputIndex: number;
  contentIndex: number;
  text: string | undefined;
  annotations: SseAnnotation[];
}

interface OutputTextEnvelope {
  itemId: string;
  outputIndex: number;
  contentIndex: number;
  text: string | undefined;
  delta: string | undefined;
}

interface ResponsePayload extends JsonObject {
  id?: unknown;
  model?: unknown;
  completed_at?: unknown;
  output?: unknown;
  metadata?: unknown;
}

function getObject(value: unknown, fieldName: string): JsonObject {
  if (isJsonObject(value)) {
    return value;
  }

  throw new Error(`Expected object for ${fieldName}`);
}

function isJsonObject(value: unknown): value is JsonObject {
  return isPlainObject(value);
}

function getString(value: unknown, fieldName: string): string {
  if (isString(value) && value.length > 0) {
    return value;
  }

  throw new Error(`Expected non-empty string for ${fieldName}`);
}

function getInteger(value: unknown, fieldName: string): number {
  if (isNumber(value) && Number.isInteger(value)) {
    return value;
  }

  throw new Error(`Expected integer for ${fieldName}`);
}

function getAnnotations(value: unknown): SseAnnotation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (annotation): annotation is SseAnnotation => isJsonObject(annotation),
  );
}

function getOptionalString(value: unknown): string | undefined {
  return isString(value) && value.length > 0 ? value : undefined;
}

function getOutputTextPart(value: unknown): JsonObject | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const outputTextPart = value.find((part) => {
    return isJsonObject(part) && part.type === "output_text";
  });

  return outputTextPart ? getObject(outputTextPart, "output_text") : null;
}

function getItem(json: JsonObject | null): JsonObject {
  return getObject(json?.item, "item");
}

function getPart(json: JsonObject | null): JsonObject {
  return getObject(json?.part, "part");
}

function getItemType(json: JsonObject | null): string | undefined {
  const item = json?.item;
  return isJsonObject(item) ? getOptionalString(item.type) : undefined;
}

function getResponsePayload(json: JsonObject | null): ResponsePayload | null {
  const response = json?.response;
  return isJsonObject(response) ? response : null;
}

function getCompletedAt(response: JsonObject | null): number {
  const completedAt = response?.completed_at;

  return isNumber(completedAt) && Number.isInteger(completedAt)
    ? completedAt
    : Math.floor(Date.now() / 1_000);
}

function splitReasoningSummaryDelta(text: string): string[] {
  const chunkCount = text.length > 240 ? 3 : text.length > 120 ? 2 : 1;

  if (chunkCount === 1) {
    return [text];
  }

  const chunks: string[] = [];
  let offset = 0;

  for (let index = 0; index < chunkCount; index += 1) {
    const remaining = text.length - offset;
    const remainingChunks = chunkCount - index;
    const chunkSize = Math.ceil(remaining / remainingChunks);
    const nextOffset = offset + chunkSize;

    chunks.push(text.slice(offset, nextOffset));
    offset = nextOffset;
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

function getResponseOutput(response: JsonObject | null): unknown[] {
  return Array.isArray(response?.output) ? [...response.output] : [];
}

function getResponseMetadata(response: JsonObject | null): Record<string, unknown> {
  const metadata = response?.metadata;
  return isJsonObject(metadata) ? metadata : {};
}

function getResponseId(response: JsonObject | null, fallback: string): string {
  return isString(response?.id) && response.id ? response.id : fallback;
}

function getResponseModel(response: JsonObject | null, fallback: string): string {
  return isString(response?.model) && response.model
    ? response.model
    : fallback;
}

function readMessageEnvelope(json: JsonObject | null): MessageEnvelope {
  const item = getItem(json);
  const outputTextPart = getOutputTextPart(item.content);

  return {
    itemId: getString(item.id, "item.id"),
    outputIndex: getInteger(json?.output_index, "output_index"),
    phase: getOptionalString(item.phase),
    annotations: outputTextPart ? getAnnotations(outputTextPart.annotations) : [],
  };
}

function readContentPartEnvelope(json: JsonObject | null): ContentPartEnvelope {
  const part = getPart(json);

  return {
    itemId: getString(json?.item_id, "item_id"),
    outputIndex: getInteger(json?.output_index, "output_index"),
    contentIndex: getInteger(json?.content_index, "content_index"),
    text: getOptionalString(part.text),
    annotations: getAnnotations(part.annotations),
  };
}

function readOutputTextEnvelope(json: JsonObject | null): OutputTextEnvelope {
  return {
    itemId: getString(json?.item_id, "item_id"),
    outputIndex: getInteger(json?.output_index, "output_index"),
    contentIndex: getInteger(json?.content_index, "content_index"),
    text: getOptionalString(json?.text),
    delta: getOptionalString(json?.delta),
  };
}

export class BufferedResponseSession {
  private readonly res: ServerResponse;
  private readonly logger: Logger;
  private readonly requestId: string;
  private readonly targetHost: string;
  private readonly rewriteTextStream: (
    options: RewriteTextStreamOptions,
  ) => AsyncIterable<string>;
  private readonly mockTemplates: readonly MockReasoningTemplate[];
  private readonly mockIntervalMs: number;
  private readonly mockWatchdogMs: number;
  private readonly syntheticResponseId: string;
  private readonly polishModel: string;
  private readonly abortController = new AbortController();

  private readonly bufferedAnswer: BufferedAnswerState;
  private readonly mockReasoning: MockReasoningState;

  private lastSequenceNumber = 0;
  private maxOutputIndexSeen = -1;

  constructor({
    res,
    logger,
    requestId,
    targetHost,
    rewriteTextStream,
    mockTemplates,
    mockIntervalMs,
    mockWatchdogMs,
    syntheticResponseId,
    syntheticMessageItemId,
    syntheticReasoningItemId,
  }: BufferedResponseSessionOptions) {
    if (mockTemplates.length === 0) {
      throw new Error("Mock reasoning templates must not be empty");
    }

    this.res = res;
    this.logger = logger;
    this.requestId = requestId;
    this.targetHost = targetHost;
    this.rewriteTextStream = rewriteTextStream;
    this.mockTemplates = mockTemplates;
    this.mockIntervalMs = mockIntervalMs;
    this.mockWatchdogMs = mockWatchdogMs;
    this.syntheticResponseId = syntheticResponseId;
    this.polishModel = requireEnv("POLISH_MODEL");

    this.bufferedAnswer = {
      text: "",
      started: false,
      done: false,
      released: false,
      completedEvent: null,
      itemId: syntheticMessageItemId,
      sourceOutputIndex: null,
      emittedOutputIndex: null,
      contentIndex: 0,
      phase: "final_answer",
      annotations: [],
      envelopeStarted: false,
    };
    this.mockReasoning = {
      timer: null,
      watchdog: null,
      started: false,
      done: false,
      itemId: syntheticReasoningItemId,
      outputIndex: null,
      summaries: [],
    };

    this.res.on("close", () => {
      this.clearMockReasoning();
      this.abortController.abort();
    });
  }

  private nextSequenceNumber(): number {
    this.lastSequenceNumber += 1;
    return this.lastSequenceNumber;
  }

  private rememberEventOrdering(json: JsonObject | null): void {
    const outputIndex = json?.output_index;
    if (isNumber(outputIndex) && Number.isInteger(outputIndex)) {
      this.maxOutputIndexSeen = Math.max(this.maxOutputIndexSeen, outputIndex);
    }
  }

  private writeSse(event: string): void {
    if (!this.res.writableEnded) {
      this.res.write(event);
    }
  }

  private serializeParsedEvent(parsed: ParsedSseBlock): string {
    if (!parsed.type || !parsed.json) {
      return parsed.raw;
    }

    const sequenceNumber = parsed.json.sequence_number;
    if (!isNumber(sequenceNumber) || !Number.isInteger(sequenceNumber)) {
      return parsed.raw;
    }

    const { type: _ignoredType, sequence_number: _ignoredSequence, ...fields } = parsed.json;

    return buildSseEvent(parsed.type, {
      ...fields,
      sequence_number: this.nextSequenceNumber(),
    });
  }

  writeParsedEvent(parsed: ParsedSseBlock): void {
    this.writeSse(this.serializeParsedEvent(parsed));
  }

  private ensureBufferedAnswerOutputIndex(): number {
    if (this.bufferedAnswer.emittedOutputIndex === null) {
      const sourceOutputIndex = this.bufferedAnswer.sourceOutputIndex;
      const nextSyntheticIndex = this.maxOutputIndexSeen + 1;

      this.bufferedAnswer.emittedOutputIndex =
        sourceOutputIndex !== null && this.mockReasoning.outputIndex === sourceOutputIndex
          ? Math.max(sourceOutputIndex + 1, nextSyntheticIndex)
          : (sourceOutputIndex ?? nextSyntheticIndex);
      this.maxOutputIndexSeen = Math.max(
        this.maxOutputIndexSeen,
        this.bufferedAnswer.emittedOutputIndex,
      );
    }

    return this.bufferedAnswer.emittedOutputIndex;
  }

  private ensureMockReasoningOutputIndex(): number {
    if (this.mockReasoning.outputIndex === null) {
      this.mockReasoning.outputIndex =
        this.bufferedAnswer.sourceOutputIndex ?? this.maxOutputIndexSeen + 1;
      this.maxOutputIndexSeen = Math.max(
        this.maxOutputIndexSeen,
        this.mockReasoning.outputIndex,
      );
    }

    return this.mockReasoning.outputIndex;
  }

  private getCompletedMockReasoningItem(): ReasoningItem | null {
    if (!this.mockReasoning.started) {
      return null;
    }

    return buildReasoningItem({
      itemId: this.mockReasoning.itemId,
      summary: this.mockReasoning.summaries,
    });
  }

  private finalizeMockReasoning(): void {
    if (!this.mockReasoning.started || this.mockReasoning.done) {
      return;
    }

    this.mockReasoning.done = true;
    this.writeSse(
      buildSseEvent(SseEventType.OutputItemDone, {
        item: this.getCompletedMockReasoningItem(),
        output_index: this.ensureMockReasoningOutputIndex(),
        sequence_number: this.nextSequenceNumber(),
      }),
    );
  }

  private ensureBufferedAnswerEnvelope(): void {
    if (this.bufferedAnswer.envelopeStarted) {
      return;
    }

    this.bufferedAnswer.envelopeStarted = true;

    this.writeSse(
      buildSseEvent(SseEventType.OutputItemAdded, {
        item: buildMessageItem({
          itemId: this.bufferedAnswer.itemId,
          status: "in_progress",
          phase: this.bufferedAnswer.phase,
        }),
        output_index: this.ensureBufferedAnswerOutputIndex(),
        sequence_number: this.nextSequenceNumber(),
      }),
    );
    this.writeSse(
      buildSseEvent(SseEventType.ContentPartAdded, {
        item_id: this.bufferedAnswer.itemId,
        output_index: this.ensureBufferedAnswerOutputIndex(),
        content_index: this.bufferedAnswer.contentIndex,
        part: {
          type: "output_text",
          text: "",
          annotations: this.bufferedAnswer.annotations,
        },
        sequence_number: this.nextSequenceNumber(),
      }),
    );
  }

  private buildCompletedResponse({
    responseId,
    model,
    sourceModel,
    rewritten,
    messageItem,
  }: {
    responseId: string;
    model: string;
    sourceModel: string;
    rewritten: boolean;
    messageItem: MessageItem;
  }): CompletedResponse {
    const baseResponse = getResponsePayload(this.bufferedAnswer.completedEvent?.json ?? null);
    const upstreamOutput = getResponseOutput(baseResponse);

    const sourceOutputIndex = this.bufferedAnswer.sourceOutputIndex;
    if (sourceOutputIndex !== null) {
      upstreamOutput[sourceOutputIndex] = undefined;
    }

    if (this.mockReasoning.started && this.mockReasoning.outputIndex !== null) {
      upstreamOutput[this.mockReasoning.outputIndex] = this.getCompletedMockReasoningItem();
    }

    if (this.bufferedAnswer.emittedOutputIndex !== null) {
      upstreamOutput[this.bufferedAnswer.emittedOutputIndex] = messageItem;
    } else {
      upstreamOutput.push(messageItem);
    }

    return {
      ...(baseResponse ?? {}),
      id: responseId,
      object: "response",
      status: "completed",
      completed_at: getCompletedAt(baseResponse),
      model,
      output: upstreamOutput.filter((item) => item != null),
      metadata: {
        ...getResponseMetadata(baseResponse),
        rewritten,
        source_model: sourceModel,
      },
    };
  }

  private clearMockReasoning(): void {
    if (this.mockReasoning.timer) {
      clearInterval(this.mockReasoning.timer);
      this.mockReasoning.timer = null;
    }

    if (this.mockReasoning.watchdog) {
      clearTimeout(this.mockReasoning.watchdog);
      this.mockReasoning.watchdog = null;
    }
  }

  private emitMockReasoning(): void {
    if (this.bufferedAnswer.done || this.res.writableEnded) {
      return;
    }

    const templateIndex = Math.floor(Math.random() * this.mockTemplates.length);
    const template = this.mockTemplates[templateIndex];
    if (!template) {
      throw new Error("Mock reasoning template lookup failed");
    }

    const text = buildReasoningSummaryText(template.title, template.content);
    const outputIndex = this.ensureMockReasoningOutputIndex();
    const summaryIndex = this.mockReasoning.summaries.length;
    const itemId = this.mockReasoning.itemId;

    if (!this.mockReasoning.started) {
      this.mockReasoning.started = true;
      this.writeSse(
        buildSseEvent(SseEventType.OutputItemAdded, {
          item: buildReasoningItem({
            itemId,
            summary: [],
          }),
          output_index: outputIndex,
          sequence_number: this.nextSequenceNumber(),
        }),
      );
    }

    const commonFields = {
      item_id: itemId,
      output_index: outputIndex,
      summary_index: summaryIndex,
    };
    this.writeSse(
      buildSseEvent(SseEventType.ReasoningSummaryPartAdded, {
        ...commonFields,
        part: { type: "summary_text", text: "" },
        sequence_number: this.nextSequenceNumber(),
      }),
    );

    for (const delta of splitReasoningSummaryDelta(text)) {
      this.writeSse(
        buildSseEvent(SseEventType.ReasoningSummaryTextDelta, {
          ...commonFields,
          delta,
          sequence_number: this.nextSequenceNumber(),
        }),
      );
    }

    this.writeSse(
      buildSseEvent(SseEventType.ReasoningSummaryTextDone, {
        ...commonFields,
        text,
        sequence_number: this.nextSequenceNumber(),
      }),
    );
    this.writeSse(
      buildSseEvent(SseEventType.ReasoningSummaryPartDone, {
        ...commonFields,
        part: { type: "summary_text", text },
        sequence_number: this.nextSequenceNumber(),
      }),
    );

    this.mockReasoning.summaries.push({ type: "summary_text", text });
  }

  private startMockReasoning(): void {
    if (this.mockReasoning.timer) {
      return;
    }

    this.emitMockReasoning();
    this.mockReasoning.timer = setInterval(() => {
      this.emitMockReasoning();
    }, this.mockIntervalMs);
    this.mockReasoning.watchdog = setTimeout(() => {
      this.logger.warn(`[${this.requestId}] mock reasoning watchdog fired`);
      this.clearMockReasoning();
    }, this.mockWatchdogMs);
  }

  private markBufferedAnswerComplete(): void {
    if (this.bufferedAnswer.done) {
      return;
    }

    this.bufferedAnswer.done = true;
    this.clearMockReasoning();
    this.logger.info(
      `[${this.requestId}] buffer done, ${this.bufferedAnswer.text.length} chars`,
    );
  }

  private applyBufferedAnswerTarget({
    itemId,
    outputIndex,
    contentIndex,
    phase,
    annotations,
  }: {
    itemId: string;
    outputIndex: number;
    contentIndex?: number | undefined;
    phase?: string | undefined;
    annotations?: SseAnnotation[] | undefined;
  }): void {
    this.bufferedAnswer.started = true;
    this.bufferedAnswer.itemId = itemId;
    this.bufferedAnswer.sourceOutputIndex = outputIndex;

    if (contentIndex !== undefined) {
      this.bufferedAnswer.contentIndex = contentIndex;
    }

    if (phase !== undefined) {
      this.bufferedAnswer.phase = phase;
    }

    if (annotations !== undefined) {
      this.bufferedAnswer.annotations = annotations;
    }
  }

  private captureMessageItem(json: JsonObject | null): void {
    const message = readMessageEnvelope(json);

    this.applyBufferedAnswerTarget({
      itemId: message.itemId,
      outputIndex: message.outputIndex,
      phase: message.phase,
    });
  }

  private captureMessageDone(json: JsonObject | null): void {
    const message = readMessageEnvelope(json);

    this.applyBufferedAnswerTarget({
      itemId: message.itemId,
      outputIndex: message.outputIndex,
      phase: message.phase,
      annotations: message.annotations,
    });
  }

  private captureContentPart(json: JsonObject | null): ContentPartEnvelope {
    const contentPart = readContentPartEnvelope(json);

    this.applyBufferedAnswerTarget({
      itemId: contentPart.itemId,
      outputIndex: contentPart.outputIndex,
      contentIndex: contentPart.contentIndex,
      annotations: contentPart.annotations,
    });

    return contentPart;
  }

  private captureOutputText(json: JsonObject | null): OutputTextEnvelope {
    const outputText = readOutputTextEnvelope(json);

    this.applyBufferedAnswerTarget({
      itemId: outputText.itemId,
      outputIndex: outputText.outputIndex,
      contentIndex: outputText.contentIndex,
    });

    return outputText;
  }

  handleParsedEvent(parsed: ParsedSseBlock): boolean {
    const { type, json } = parsed;

    this.rememberEventOrdering(json);

    if (type === SseEventType.OutputItemAdded && getItemType(json) === "message") {
      this.captureMessageItem(json);
      return true;
    }

    if (type === SseEventType.OutputItemDone && getItemType(json) === "message") {
      this.captureMessageDone(json);
      return true;
    }

    if (type === SseEventType.OutputTextDelta) {
      const outputText = this.captureOutputText(json);
      this.bufferedAnswer.text += outputText.delta ?? "";

      if ((outputText.delta ?? "").length > 0) {
        this.startMockReasoning();
      }

      return true;
    }

    if (type === SseEventType.OutputTextDone) {
      const outputText = this.captureOutputText(json);
      this.bufferedAnswer.text = outputText.text ?? this.bufferedAnswer.text;

      if (this.bufferedAnswer.text.length > 0) {
        this.startMockReasoning();
      }

      this.markBufferedAnswerComplete();
      return true;
    }

    if (type === SseEventType.ContentPartAdded) {
      this.captureContentPart(json);
      return true;
    }

    if (type === SseEventType.ContentPartDone) {
      const contentPart = this.captureContentPart(json);
      this.bufferedAnswer.text = contentPart.text ?? this.bufferedAnswer.text;

      if (this.bufferedAnswer.text.length > 0) {
        this.startMockReasoning();
      }

      return true;
    }

    if (type === SseEventType.Completed) {
      this.bufferedAnswer.completedEvent = parsed;
      return true;
    }

    if (isBufferedAnswerEvent(type, json)) {
      if (!this.bufferedAnswer.started) {
        this.bufferedAnswer.started = true;
      }

      return true;
    }

    return false;
  }

  private emitOutputTextDelta(delta: string): void {
    this.ensureBufferedAnswerEnvelope();
    this.writeSse(
      buildSseEvent(SseEventType.OutputTextDelta, {
        item_id: this.bufferedAnswer.itemId,
        output_index: this.ensureBufferedAnswerOutputIndex(),
        content_index: this.bufferedAnswer.contentIndex,
        delta,
        logprobs: [],
        sequence_number: this.nextSequenceNumber(),
      }),
    );
  }

  private async releaseBufferedAnswer(): Promise<void> {
    if (this.bufferedAnswer.released) {
      return;
    }

    this.bufferedAnswer.released = true;
    this.finalizeMockReasoning();

    let polishedAnswer = "";
    let chunkCount = 0;
    let usedFallback = false;
    const completedResponse = getResponsePayload(this.bufferedAnswer.completedEvent?.json ?? null);
    const sourceModel = getResponseModel(completedResponse, this.targetHost);
    const completedResponseId = getResponseId(
      completedResponse,
      this.syntheticResponseId,
    );

    this.logger.info(
      `[${this.requestId}] polish start, input=${this.bufferedAnswer.text.length}`,
    );

    try {
      for await (const delta of this.rewriteTextStream({
        input: this.bufferedAnswer.text,
        signal: this.abortController.signal,
      })) {
        if (this.abortController.signal.aborted) {
          break;
        }

        chunkCount += 1;
        polishedAnswer += delta;
        this.emitOutputTextDelta(delta);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(`[${this.requestId}] polish failed: ${message}`);
      polishedAnswer = this.bufferedAnswer.text;
      chunkCount = 1;
      usedFallback = true;
      this.ensureBufferedAnswerEnvelope();
      this.emitOutputTextDelta(this.bufferedAnswer.text);
    }

    if (this.res.writableEnded) {
      return;
    }

    const contentPart: OutputTextPart = {
      type: "output_text",
      text: polishedAnswer,
      annotations: this.bufferedAnswer.annotations,
    };
    const messageItem = buildMessageItem({
      itemId: this.bufferedAnswer.itemId,
      text: polishedAnswer,
      annotations: this.bufferedAnswer.annotations,
      status: "completed",
      phase: this.bufferedAnswer.phase,
    });
    this.ensureBufferedAnswerEnvelope();
    const outputIndex = this.ensureBufferedAnswerOutputIndex();

    this.writeSse(
      buildSseEvent(SseEventType.OutputTextDone, {
        item_id: this.bufferedAnswer.itemId,
        output_index: outputIndex,
        content_index: this.bufferedAnswer.contentIndex,
        text: polishedAnswer,
        logprobs: [],
        sequence_number: this.nextSequenceNumber(),
      }),
    );
    this.writeSse(
      buildSseEvent(SseEventType.ContentPartDone, {
        item_id: this.bufferedAnswer.itemId,
        output_index: outputIndex,
        content_index: this.bufferedAnswer.contentIndex,
        part: contentPart,
        sequence_number: this.nextSequenceNumber(),
      }),
    );
    this.writeSse(
      buildSseEvent(SseEventType.OutputItemDone, {
        item: messageItem,
        output_index: outputIndex,
        sequence_number: this.nextSequenceNumber(),
      }),
    );
    this.writeSse(
      buildSseEvent(SseEventType.Completed, {
        response: this.buildCompletedResponse({
          responseId: completedResponseId,
          model: usedFallback ? sourceModel : this.polishModel,
          sourceModel,
          rewritten: !usedFallback,
          messageItem,
        }),
        sequence_number: this.nextSequenceNumber(),
      }),
    );

    this.logger.info(
      `[${this.requestId}] polish done, chunks=${chunkCount} chars=${polishedAnswer.length}`,
    );
    this.res.end();
  }

  async finish({ tail = "" }: { tail?: string } = {}): Promise<void> {
    if (tail.trim()) {
      this.logger.warn(
        `[${this.requestId}] unparsed SSE tail: ${tail.trim().slice(0, 200)}`,
      );
    }

    this.clearMockReasoning();

    if (
      this.bufferedAnswer.started &&
      this.bufferedAnswer.text &&
      !this.bufferedAnswer.done
    ) {
      this.markBufferedAnswerComplete();
    }

    if (this.bufferedAnswer.done) {
      await this.releaseBufferedAnswer();
      return;
    }

    if (this.bufferedAnswer.completedEvent) {
      this.writeParsedEvent(this.bufferedAnswer.completedEvent);
    }

    this.logger.info(`[${this.requestId}] stream ended`);
    this.res.end();
  }
}
