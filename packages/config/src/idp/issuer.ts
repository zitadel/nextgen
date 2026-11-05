import { connectionLimits } from "./meta.js";

/**
 * The issuer values a connection may name: HTTPS anywhere, or HTTP on
 * `localhost`/`127.0.0.1` for a local stand-in.
 *
 * Read out of the generated meta-schema (see `meta.ts`), so a prompt that
 * accepts a value and the document written from it cannot disagree:
 * `http://idp.internal:9100` would be taken by a hand-rolled URL check and then
 * rejected on apply.
 */
let compiled: RegExp | undefined;

/** Whether a connection may name this issuer. */
export function isSupportedIssuer(value: string): boolean {
  const pattern = connectionLimits.issuer.pattern;
  if (pattern === undefined) {
    throw new Error("idp-connection.json no longer states properties.oidc.issuer.pattern");
  }
  compiled ??= new RegExp(pattern);
  return compiled.test(value.trim());
}

/** What to tell someone who typed an issuer the contract does not allow. */
export const ISSUER_REQUIREMENT = "Use an https:// URL, or http:// on localhost or 127.0.0.1.";

/** Whether an issuer is on this machine, which the server only reaches when its allow list says so. */
export function isLoopbackIssuer(value: string): boolean {
  try {
    const { hostname } = new URL(value.trim());
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}
