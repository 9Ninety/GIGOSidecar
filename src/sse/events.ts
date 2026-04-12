import { SseEventType } from "./types.ts";

export type SseAnnotation = Record<string, unknown>;

export interface ReasoningSummaryTextPart {
  type: "summary_text";
  text: string;
}

export interface ReasoningItem {
  id: string;
  type: "reasoning";
  summary: ReasoningSummaryTextPart[];
  encrypted_content?: string;
}

export interface OutputTextPart {
  type: "output_text";
  text: string;
  annotations: SseAnnotation[];
}

export interface MessageItem {
  id: string;
  type: "message";
  role: "assistant";
  status: "in_progress" | "completed";
  content: OutputTextPart[];
  phase?: string;
}

export function serializeSseEvent<TPayload extends object>(
  event: string,
  payload: TPayload,
): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export function buildSseEvent<TFields extends object>(
  type: string,
  fields: TFields,
): string {
  return serializeSseEvent(type, { type, ...fields });
}

export function buildReasoningSummaryText(title: string, content: string): string {
  return `**${title}**\n\n${content}\n\n`;
}

export function buildReasoningItem({
  itemId,
  summary = [],
  encryptedContent,
}: {
  itemId: string;
  summary?: ReasoningSummaryTextPart[];
  encryptedContent?: string;
}): ReasoningItem {
  return {
    id: itemId,
    type: "reasoning",
    summary,
    ...(encryptedContent ? { encrypted_content: encryptedContent } : {}),
  };
}

export function buildMessageItem({
  itemId,
  text = "",
  annotations = [],
  status = "in_progress",
  phase = "final_answer",
}: {
  itemId: string;
  text?: string;
  annotations?: SseAnnotation[];
  status?: MessageItem["status"];
  phase?: string;
}): MessageItem {
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

const BUFFERED_ANSWER_TYPES = new Set<string>([
  SseEventType.OutputTextDelta,
  SseEventType.OutputTextDone,
  SseEventType.ContentPartAdded,
  SseEventType.ContentPartDone,
  SseEventType.Completed,
]);

export function isReasoningEvent(type = ""): boolean {
  return type.startsWith("response.reasoning_");
}

export function isBufferedAnswerEvent(
  type = "",
  json: { item?: { type?: unknown } } | null = null,
): boolean {
  if (BUFFERED_ANSWER_TYPES.has(type)) {
    return true;
  }

  if (type === SseEventType.OutputItemAdded || type === SseEventType.OutputItemDone) {
    return json?.item?.type === "message";
  }

  return false;
}
