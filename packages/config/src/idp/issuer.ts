import idpConnectionMetaSchema from "../../meta-schemas/idp-connection.json" with { type: "json" };

/**
 * The issuer values a connection may name: HTTPS anywhere, or HTTP on
 * `localhost`/`127.0.0.1` for a local stand-in.
 *
 * Read out of the generated meta-schema rather than restated here, so a prompt
 * that accepts a value and the document written from it cannot disagree. That
 * file is generated from the OpenAPI YAML the server embeds, which makes it
 * also what the server will enforce — `http://idp.internal:9100` would be
 * taken by a hand-rolled URL check and then rejected on apply.
 */
function issuerPattern(): RegExp {
  const oidc = (idpConnectionMetaSchema as { properties?: Record<string, unknown> }).properties
    ?.oidc;
  const issuer = (oidc as { properties?: Record<string, unknown> } | undefined)?.properties?.issuer;
  const pattern = (issuer as { pattern?: unknown } | undefined)?.pattern;
  if (typeof pattern !== "string") {
    // Silently accepting everything would be the worst outcome: the prompt
    // would go on reporting success for connections the server refuses.
    throw new Error(
      "idp-connection.json no longer states properties.oidc.properties.issuer.pattern",
    );
  }
  return new RegExp(pattern);
}

let compiled: RegExp | undefined;

/** Whether a connection may name this issuer. */
export function isSupportedIssuer(value: string): boolean {
  compiled ??= issuerPattern();
  return compiled.test(value.trim());
}

/** What to tell someone who typed an issuer the contract does not allow. */
export const ISSUER_REQUIREMENT = "Use an https:// URL, or http:// on localhost or 127.0.0.1.";
