export const CIMD_METADATA_PATH = "/.well-known/oauth-client";
export const CIMD_CALLBACK_PATH = "/oauth/callback";

export type CimdClientMetadata = {
  client_name: string;
  grant_types: string[];
  redirect_uris: string[];
  response_types: string[];
  token_endpoint_auth_method: "none";
};

export function isCimdCompatibleOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

export function cimdClientIdUrl(publicOrigin: string): string {
  return `${trimTrailingSlash(publicOrigin)}${CIMD_METADATA_PATH}`;
}

export function cimdRedirectUri(publicOrigin: string): string {
  return `${trimTrailingSlash(publicOrigin)}${CIMD_CALLBACK_PATH}`;
}

export function buildCimdClientMetadata(publicOrigin: string): CimdClientMetadata {
  return {
    client_name: "mcp-mock-server CIMD probe client",
    grant_types: ["authorization_code", "refresh_token"],
    redirect_uris: [cimdRedirectUri(publicOrigin)],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
