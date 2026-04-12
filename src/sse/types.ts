export const SseEventType = {
  ReasoningSummaryPartAdded: "response.reasoning_summary_part.added",
  ReasoningSummaryPartDone: "response.reasoning_summary_part.done",
  ReasoningSummaryTextDelta: "response.reasoning_summary_text.delta",
  ReasoningSummaryTextDone: "response.reasoning_summary_text.done",
  OutputTextDone: "response.output_text.done",
  OutputTextDelta: "response.output_text.delta",
  Completed: "response.completed",
  ContentPartAdded: "response.content_part.added",
  ContentPartDone: "response.content_part.done",
  OutputItemAdded: "response.output_item.added",
  OutputItemDone: "response.output_item.done",
} as const;

export type SseEventType = (typeof SseEventType)[keyof typeof SseEventType];
