import { SseEventType } from "./types.mjs";

export function serializeSseEvent(event, payload) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export function buildSseEvent(type, fields) {
  const payload = { type, ...fields };
  return serializeSseEvent(type, payload);
}

export function buildReasoningSummaryText(title, content) {
  return `**${title}**\n\n${content}`;
}

export function buildReasoningItem({
  itemId,
  summary = [],
  status = "in_progress",
  encryptedContent = null,
}) {
  const item = {
    id: itemId,
    type: "reasoning",
    summary,
    status,
  };

  if (encryptedContent != null) {
    item.encrypted_content = encryptedContent;
  }

  return item;
}

export function buildMessageItem({
  itemId,
  text = "",
  annotations = [],
  status = "in_progress",
  phase = "final_answer",
}) {
  return {
    id: itemId,
    type: "message",
    role: "assistant",
    status,
    content:
      status === "completed"
        ? [{ type: "output_text", text, annotations }]
        : [],
    ...(phase ? { phase } : {}),
  };
}

export function isReasoningEvent(type = "") {
  return type.startsWith("response.reasoning_");
}

const BUFFERED_ANSWER_TYPES = new Set([
  SseEventType.OutputTextDelta,
  SseEventType.OutputTextDone,
  SseEventType.ContentPartAdded,
  SseEventType.ContentPartDone,
  SseEventType.Completed,
]);

export function isBufferedAnswerEvent(type = "", json = null) {
  if (BUFFERED_ANSWER_TYPES.has(type)) {
    return true;
  }

  if (
    type === SseEventType.OutputItemAdded ||
    type === SseEventType.OutputItemDone
  ) {
    return json?.item?.type === "message";
  }

  return false;
}
