import type { McpMockServerConfig } from "./config.js";

export type ProtectedResourceMetadata = {
  authorization_servers: string[];
  bearer_methods_supported: string[];
  resource: string;
  scopes_supported: string[];
};

export function buildProtectedResourceMetadata(
  config: McpMockServerConfig,
): ProtectedResourceMetadata {
  return {
    resource: config.resourceUri,
    authorization_servers: [config.authorizationServer],
    bearer_methods_supported: ["header"],
    scopes_supported: ["openid", "profile", "email"],
  };
}

export function protectedResourceMetadataPath(config: McpMockServerConfig): string {
  const resourcePath = new URL(config.resourceUri).pathname;
  if (resourcePath === "/" || resourcePath === "") {
    return "/.well-known/oauth-protected-resource";
  }
  return `/.well-known/oauth-protected-resource${resourcePath}`;
}

export function protectedResourceMetadataUrl(config: McpMockServerConfig): string {
  return `${config.publicOrigin}${protectedResourceMetadataPath(config)}`;
}

export function buildWwwAuthenticateHeader(
  config: McpMockServerConfig,
  message = "Authorization required",
): string {
  const metadataUrl = protectedResourceMetadataUrl(config);
  return `Bearer error="invalid_token", error_description="${message}", resource_metadata="${metadataUrl}"`;
}
