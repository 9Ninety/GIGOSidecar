export function normalizeBaseUrl(apiBase) {
  return apiBase.endsWith("/") ? apiBase.slice(0, -1) : apiBase;
}
