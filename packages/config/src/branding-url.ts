const CANONICAL_LOOPBACK_HTTP_URL =
  /^http:\/\/(?:localhost|127\.(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})|\[::1\])(?::[0-9]+)?(?:[/?#]|$)/i;

/**
 * Reports whether value is an absolute HTTP URL using one of the canonical
 * loopback spellings shared by the config and component gates.
 *
 * The raw-pattern check deliberately runs before WHATWG URL normalisation so
 * shorthand, integer, hexadecimal, leading-zero, and userinfo forms cannot
 * become a loopback host in one JavaScript layer while the Go save gate rejects
 * them.
 */
export function isCanonicalLoopbackHttpUrl(value: string): boolean {
  if (!CANONICAL_LOOPBACK_HTTP_URL.test(value)) return false;
  try {
    return new URL(value).protocol === "http:";
  } catch {
    return false;
  }
}
