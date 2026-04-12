export function normalizeInlineText(text) {
  return (text || '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
}

export function parseReasoningSummary(text) {
  const normalized = (text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return null;
  }

  const blocks = normalized.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  if (!blocks.length) {
    return null;
  }

  return {
    title: normalizeInlineText(blocks[0].replace(/^\*\*(.*?)\*\*$/, '$1')),
    content: normalizeInlineText(blocks.slice(1).join(' ')),
  };
}
