export type DecodedJwt = {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
};

function decodePart(part: string): Record<string, unknown> {
  const json = Buffer.from(part, "base64url").toString("utf8");
  return JSON.parse(json) as Record<string, unknown>;
}

export function decodeJwt(token: string): DecodedJwt | undefined {
  const parts = token.split(".");
  if (parts.length < 2) {
    return undefined;
  }
  try {
    return {
      header: decodePart(parts[0] ?? ""),
      payload: decodePart(parts[1] ?? ""),
    };
  } catch {
    return undefined;
  }
}

export function audienceMatchesResource(
  payload: Record<string, unknown>,
  resourceUri: string,
): boolean {
  const aud = payload.aud;
  if (typeof aud === "string") {
    return aud === resourceUri;
  }
  if (Array.isArray(aud)) {
    return aud.includes(resourceUri);
  }
  return false;
}
