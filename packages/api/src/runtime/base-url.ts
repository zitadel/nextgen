let apiBaseUrl = "";

export function getApiBaseUrl(): string {
  return apiBaseUrl;
}

export function setApiBaseUrl(baseUrl: string): void {
  apiBaseUrl = normalizeApiBaseUrl(baseUrl);
}

export function resetApiBaseUrl(): void {
  apiBaseUrl = "";
}

function normalizeApiBaseUrl(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.trim();
  return normalizedBaseUrl.replace(/\/+$/, "");
}
