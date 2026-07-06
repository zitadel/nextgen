import type { McpMockServerConfig } from "./config.js";

export type TokenValidationResult =
  | { active: true; subject?: string }
  | { active: false; reason: string };

type IntrospectionResponse = {
  active?: boolean;
  aud?: string | string[];
  client_id?: string;
  scope?: string;
  sub?: string;
  username?: string;
};

export async function validateAccessToken(
  token: string,
  config: McpMockServerConfig,
): Promise<TokenValidationResult> {
  if (!token) {
    return { active: false, reason: "missing bearer token" };
  }

  if (!config.introspect) {
    return { active: true, subject: "mock-subject" };
  }

  const credentials = Buffer.from(
    `${config.introspectClientId}:${config.introspectClientSecret}`,
  ).toString("base64");
  const body = new URLSearchParams({ token });
  const response = await fetch(`${config.authorizationServer}/oauth/v2/introspect`, {
    body,
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  if (!response.ok) {
    return {
      active: false,
      reason: `introspection failed with HTTP ${response.status}`,
    };
  }

  const payload = (await response.json()) as IntrospectionResponse;
  if (!payload.active) {
    return { active: false, reason: "token is not active" };
  }

  return {
    active: true,
    subject: payload.sub ?? payload.username ?? payload.client_id,
  };
}
