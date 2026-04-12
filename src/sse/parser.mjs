export function normalizeSseChunk(text) {
  return text.replace(/\r\n/g, "\n");
}

export function parseSseBlock(block) {
  const lines = block.split("\n");
  const dataLines = [];
  let event = "";

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  const data = dataLines.join("\n");
  let json = null;

  if (data && data !== "[DONE]") {
    try {
      json = JSON.parse(data);
    } catch {
      json = null;
    }
  }

  return { raw: `${block}\n\n`, event, data, json, type: json?.type || event };
}
