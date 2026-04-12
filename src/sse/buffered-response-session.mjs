import {
  buildSseEvent,
  buildMessageItem,
  buildReasoningItem,
  buildReasoningSummaryText,
  isBufferedAnswerEvent,
} from "./events.mjs";
import { SseEventType } from "./types.mjs";

export class BufferedResponseSession {
  constructor({
    res,
    logger,
    requestId,
    targetHost,
    rewriteTextStream,
    polishApiBase,
    polishApiKey,
    polishModel,
    mockTemplates,
    mockIntervalMs,
    mockWatchdogMs,
    syntheticResponseId,
    syntheticMessageItemId,
    syntheticReasoningItemId,
  }) {
    this.res = res;
    this.logger = logger;
    this.requestId = requestId;
    this.targetHost = targetHost;
    this.rewriteTextStream = rewriteTextStream;
    this.polishApiBase = polishApiBase;
    this.polishApiKey = polishApiKey;
    this.polishModel = polishModel;
    this.mockTemplates = mockTemplates;
    this.mockIntervalMs = mockIntervalMs;
    this.mockWatchdogMs = mockWatchdogMs;
    this.syntheticResponseId = syntheticResponseId;

    this.sseBuffer = "";
    this.bufferedAnswer = "";
    this.bufferedAnswerStarted = false;
    this.bufferedAnswerDone = false;
    this.bufferedAnswerReleased = false;
    this.bufferedCompletedEvent = null;
    this.bufferedAnswerItemId = syntheticMessageItemId;
    this.bufferedAnswerOutputIndex = null;
    this.bufferedAnswerContentIndex = 0;
    this.bufferedAnswerPhase = "final_answer";
    this.bufferedAnswerAnnotations = [];
    this.bufferedAnswerEnvelopeStarted = false;

    this.mockReasoningIndex = 0;
    this.mockReasoningTimer = null;
    this.mockReasoningWatchdog = null;
    this.lastSequenceNumber = 0;
    this.maxOutputIndexSeen = -1;
    this.mockReasoningState = {
      started: false,
      done: false,
      itemId: syntheticReasoningItemId,
      outputIndex: null,
      summaries: [],
    };

    this.abortController = new AbortController();
    this.res.on("close", () => {
      this.clearMockReasoning();
      this.abortController.abort();
    });
  }

  nextSequenceNumber() {
    this.lastSequenceNumber += 1;
    return this.lastSequenceNumber;
  }

  rememberEventOrdering(json) {
    if (Number.isInteger(json?.sequence_number)) {
      this.lastSequenceNumber = Math.max(
        this.lastSequenceNumber,
        json.sequence_number,
      );
    }

    if (Number.isInteger(json?.output_index)) {
      this.maxOutputIndexSeen = Math.max(
        this.maxOutputIndexSeen,
        json.output_index,
      );
    }
  }

  writeSse(event) {
    if (!this.res.writableEnded) {
      this.res.write(event);
    }
  }

  ensureBufferedAnswerOutputIndex() {
    if (!Number.isInteger(this.bufferedAnswerOutputIndex)) {
      this.bufferedAnswerOutputIndex = this.maxOutputIndexSeen + 1;
      this.maxOutputIndexSeen = Math.max(
        this.maxOutputIndexSeen,
        this.bufferedAnswerOutputIndex,
      );
    }

    return this.bufferedAnswerOutputIndex;
  }

  ensureMockReasoningOutputIndex() {
    if (!Number.isInteger(this.mockReasoningState.outputIndex)) {
      this.mockReasoningState.outputIndex = this.maxOutputIndexSeen + 1;
      this.maxOutputIndexSeen = Math.max(
        this.maxOutputIndexSeen,
        this.mockReasoningState.outputIndex,
      );
    }

    return this.mockReasoningState.outputIndex;
  }

  getCompletedMockReasoningItem() {
    if (!this.mockReasoningState.started) {
      return null;
    }

    return buildReasoningItem({
      itemId: this.mockReasoningState.itemId,
      summary: this.mockReasoningState.summaries,
      status: "completed",
    });
  }

  finalizeMockReasoning() {
    if (!this.mockReasoningState.started || this.mockReasoningState.done) {
      return;
    }

    this.mockReasoningState.done = true;
    this.writeSse(
      buildSseEvent(SseEventType.OutputItemDone, {
        item: this.getCompletedMockReasoningItem(),
        output_index: this.ensureMockReasoningOutputIndex(),
        sequence_number: this.nextSequenceNumber(),
      }),
    );
  }

  ensureBufferedAnswerEnvelope() {
    if (this.bufferedAnswerEnvelopeStarted) {
      return;
    }

    this.bufferedAnswerEnvelopeStarted = true;

    this.writeSse(
      buildSseEvent(SseEventType.OutputItemAdded, {
        item: buildMessageItem({
          itemId: this.bufferedAnswerItemId,
          status: "in_progress",
          phase: this.bufferedAnswerPhase,
        }),
        output_index: this.ensureBufferedAnswerOutputIndex(),
        sequence_number: this.nextSequenceNumber(),
      }),
    );
    this.writeSse(
      buildSseEvent(SseEventType.ContentPartAdded, {
        item_id: this.bufferedAnswerItemId,
        output_index: this.ensureBufferedAnswerOutputIndex(),
        content_index: this.bufferedAnswerContentIndex,
        part: {
          type: "output_text",
          text: "",
          annotations: this.bufferedAnswerAnnotations,
        },
        sequence_number: this.nextSequenceNumber(),
      }),
    );
  }

  buildCompletedResponse({ responseId, model, sourceModel, rewritten, messageItem }) {
    const baseResponse = this.bufferedCompletedEvent?.json?.response;
    const upstreamOutput = Array.isArray(baseResponse?.output)
      ? [...baseResponse.output]
      : [];

    if (
      this.mockReasoningState.started &&
      Number.isInteger(this.mockReasoningState.outputIndex)
    ) {
      upstreamOutput[this.mockReasoningState.outputIndex] =
        this.getCompletedMockReasoningItem();
    }

    if (Number.isInteger(this.bufferedAnswerOutputIndex)) {
      upstreamOutput[this.bufferedAnswerOutputIndex] = messageItem;
    } else {
      upstreamOutput.push(messageItem);
    }

    const metadataBase =
      baseResponse?.metadata && typeof baseResponse.metadata === "object"
        ? baseResponse.metadata
        : {};
    const now = Math.floor(Date.now() / 1000);

    return {
      ...(baseResponse && typeof baseResponse === "object" ? baseResponse : {}),
      id: responseId,
      object: "response",
      status: "completed",
      completed_at: baseResponse?.completed_at || now,
      model,
      output: upstreamOutput.filter(Boolean),
      metadata: {
        ...metadataBase,
        rewritten,
        source_model: sourceModel,
      },
    };
  }

  clearMockReasoning() {
    if (this.mockReasoningTimer) {
      clearInterval(this.mockReasoningTimer);
      this.mockReasoningTimer = null;
    }

    if (this.mockReasoningWatchdog) {
      clearTimeout(this.mockReasoningWatchdog);
      this.mockReasoningWatchdog = null;
    }
  }

  emitMockReasoning() {
    if (this.bufferedAnswerDone || this.res.writableEnded) {
      return;
    }

    const template =
      this.mockTemplates[
        this.mockReasoningIndex % this.mockTemplates.length
      ];
    this.mockReasoningIndex += 1;

    const text = buildReasoningSummaryText(template.title, template.content);
    const outputIndex = this.ensureMockReasoningOutputIndex();
    const summaryIndex = this.mockReasoningState.summaries.length;
    const { itemId } = this.mockReasoningState;

    if (!this.mockReasoningState.started) {
      this.mockReasoningState.started = true;
      this.writeSse(
        buildSseEvent(SseEventType.OutputItemAdded, {
          item: buildReasoningItem({
            itemId,
            summary: [],
            status: "in_progress",
          }),
          output_index: outputIndex,
          sequence_number: this.nextSequenceNumber(),
        }),
      );
    }

    const common = {
      item_id: itemId,
      output_index: outputIndex,
      summary_index: summaryIndex,
    };

    for (const ev of [
      buildSseEvent(SseEventType.ReasoningSummaryPartAdded, {
        ...common,
        part: { type: "summary_text", text: "" },
        sequence_number: this.nextSequenceNumber(),
      }),
      buildSseEvent(SseEventType.ReasoningSummaryTextDelta, {
        ...common,
        delta: text,
        sequence_number: this.nextSequenceNumber(),
      }),
      buildSseEvent(SseEventType.ReasoningSummaryTextDone, {
        ...common,
        text,
        sequence_number: this.nextSequenceNumber(),
      }),
      buildSseEvent(SseEventType.ReasoningSummaryPartDone, {
        ...common,
        part: { type: "summary_text", text },
        sequence_number: this.nextSequenceNumber(),
      }),
    ]) {
      this.writeSse(ev);
    }

    this.mockReasoningState.summaries.push({ type: "summary_text", text });
  }

  startMockReasoning() {
    if (this.mockReasoningTimer) {
      return;
    }

    this.emitMockReasoning();
    this.mockReasoningTimer = setInterval(
      () => this.emitMockReasoning(),
      this.mockIntervalMs,
    );
    this.mockReasoningWatchdog = setTimeout(() => {
      this.logger.warn(`[${this.requestId}] mock reasoning watchdog fired`);
      this.clearMockReasoning();
    }, this.mockWatchdogMs);
  }

  markBufferedAnswerComplete() {
    if (this.bufferedAnswerDone) {
      return;
    }

    this.bufferedAnswerDone = true;
    this.clearMockReasoning();
    this.logger.info(
      `[${this.requestId}] buffer done, ${this.bufferedAnswer.length} chars`,
    );
  }

  captureMessageItem(json) {
    this.bufferedAnswerStarted = true;
    this.bufferedAnswerItemId = json.item.id;
    this.bufferedAnswerOutputIndex = json.output_index;
    this.bufferedAnswerPhase = json.item.phase || this.bufferedAnswerPhase;
  }

  captureMessageDone(json) {
    this.captureMessageItem(json);

    const outputText = Array.isArray(json.item.content)
      ? json.item.content.find((part) => part?.type === "output_text")
      : null;

    if (Array.isArray(outputText?.annotations)) {
      this.bufferedAnswerAnnotations = outputText.annotations;
    }
  }

  captureContentPart(json) {
    this.bufferedAnswerStarted = true;
    this.bufferedAnswerItemId = json.item_id;
    this.bufferedAnswerOutputIndex = json.output_index;
    this.bufferedAnswerContentIndex = json.content_index;

    if (Array.isArray(json?.part?.annotations)) {
      this.bufferedAnswerAnnotations = json.part.annotations;
    }
  }

  captureOutputText(json) {
    this.bufferedAnswerStarted = true;
    this.bufferedAnswerItemId = json.item_id;
    this.bufferedAnswerOutputIndex = json.output_index;
    this.bufferedAnswerContentIndex = json.content_index;
  }

  handleParsedEvent(parsed) {
    const { type, json } = parsed;

    this.rememberEventOrdering(json);

    if (
      type === SseEventType.OutputItemAdded &&
      json?.item?.type === "message"
    ) {
      this.captureMessageItem(json);
      this.startMockReasoning();
      return true;
    }

    if (
      type === SseEventType.OutputItemDone &&
      json?.item?.type === "message"
    ) {
      this.captureMessageDone(json);
      return true;
    }

    if (type === SseEventType.OutputTextDelta) {
      this.captureOutputText(json);
      this.bufferedAnswer += json?.delta || "";
      this.startMockReasoning();
      return true;
    }

    if (type === SseEventType.OutputTextDone) {
      this.captureOutputText(json);
      this.bufferedAnswer = json?.text || this.bufferedAnswer;
      this.markBufferedAnswerComplete();
      return true;
    }

    if (type === SseEventType.ContentPartAdded) {
      this.captureContentPart(json);
      this.startMockReasoning();
      return true;
    }

    if (type === SseEventType.ContentPartDone) {
      this.captureContentPart(json);
      this.bufferedAnswer = json?.part?.text || this.bufferedAnswer;
      return true;
    }

    if (type === SseEventType.Completed) {
      this.bufferedCompletedEvent = parsed;
      return true;
    }

    if (isBufferedAnswerEvent(type, json)) {
      if (!this.bufferedAnswerStarted) {
        this.bufferedAnswerStarted = true;
        this.startMockReasoning();
      }

      return true;
    }

    return false;
  }

  emitOutputTextDelta(delta) {
    this.writeSse(
      buildSseEvent(SseEventType.OutputTextDelta, {
        item_id: this.bufferedAnswerItemId,
        output_index: this.ensureBufferedAnswerOutputIndex(),
        content_index: this.bufferedAnswerContentIndex,
        delta,
        logprobs: [],
        sequence_number: this.nextSequenceNumber(),
      }),
    );
  }

  async releaseBufferedAnswer() {
    if (this.bufferedAnswerReleased) {
      return;
    }

    this.bufferedAnswerReleased = true;
    this.finalizeMockReasoning();

    let polishedAnswer = "";
    let chunkCount = 0;
    let usedFallback = false;
    const sourceModel =
      this.bufferedCompletedEvent?.json?.response?.model || this.targetHost;
    const completedResponseId =
      this.bufferedCompletedEvent?.json?.response?.id || this.syntheticResponseId;

    this.logger.info(
      `[${this.requestId}] polish start, model=${this.polishModel} input=${this.bufferedAnswer.length}`,
    );

    try {
      this.ensureBufferedAnswerEnvelope();

      for await (const delta of this.rewriteTextStream({
        input: this.bufferedAnswer,
        apiBase: this.polishApiBase,
        apiKey: this.polishApiKey,
        model: this.polishModel,
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
      this.logger.error(`[${this.requestId}] polish failed: ${error.message}`);
      polishedAnswer = this.bufferedAnswer;
      chunkCount = 1;
      usedFallback = true;
      this.ensureBufferedAnswerEnvelope();
      this.emitOutputTextDelta(this.bufferedAnswer);
    }

    if (this.res.writableEnded) {
      return;
    }

    const contentPart = {
      type: "output_text",
      text: polishedAnswer,
      annotations: this.bufferedAnswerAnnotations,
    };
    const messageItem = buildMessageItem({
      itemId: this.bufferedAnswerItemId,
      text: polishedAnswer,
      annotations: this.bufferedAnswerAnnotations,
      status: "completed",
      phase: this.bufferedAnswerPhase,
    });
    const outputIndex = this.ensureBufferedAnswerOutputIndex();

    this.writeSse(
      buildSseEvent(SseEventType.OutputTextDone, {
        item_id: this.bufferedAnswerItemId,
        output_index: outputIndex,
        content_index: this.bufferedAnswerContentIndex,
        text: polishedAnswer,
        logprobs: [],
        sequence_number: this.nextSequenceNumber(),
      }),
    );
    this.writeSse(
      buildSseEvent(SseEventType.ContentPartDone, {
        item_id: this.bufferedAnswerItemId,
        output_index: outputIndex,
        content_index: this.bufferedAnswerContentIndex,
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

  async finish({ tail = "" } = {}) {
    if (tail.trim()) {
      this.logger.warn(
        `[${this.requestId}] unparsed SSE tail: ${tail.trim().slice(0, 200)}`,
      );
    }

    this.clearMockReasoning();

    if (
      this.bufferedAnswerStarted &&
      this.bufferedAnswer &&
      !this.bufferedAnswerDone
    ) {
      this.markBufferedAnswerComplete();
    }

    if (this.bufferedAnswerDone) {
      await this.releaseBufferedAnswer();
      return;
    }

    if (this.bufferedCompletedEvent) {
      this.writeSse(this.bufferedCompletedEvent.raw);
    }

    this.logger.info(`[${this.requestId}] stream ended`);
    this.res.end();
  }
}
