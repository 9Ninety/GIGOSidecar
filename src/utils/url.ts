export function normalizeBaseUrl(apiBase: string): string {
  const trimmed = apiBase.trim();

  if (!trimmed) {
    throw new Error("API base URL must not be empty");
  }

  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}
