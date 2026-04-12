export interface ReasoningSummary {
  title: string;
  content: string;
}

export function normalizeInlineText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
}

export function parseReasoningSummary(text: string): ReasoningSummary | null {
  const normalized = text.replace(/\r\n/g, "\n").trim();

  if (!normalized) {
    return null;
  }

  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length === 0) {
    return null;
  }

  const titleBlock = blocks[0];
  if (!titleBlock) {
    return null;
  }

  const contentBlocks = blocks.slice(1);

  return {
    title: normalizeInlineText(titleBlock.replace(/^\*\*(.*?)\*\*$/, "$1")),
    content: normalizeInlineText(contentBlocks.join(" ")),
  };
}
