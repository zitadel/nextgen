/**
 * The server's redirect-target check, ported for the mock.
 *
 * `parseRedirectTarget` mirrors `httputil.ParseRedirectTarget`
 * (`internal/httputil/redirect.go`): it refuses the same targets, for the same
 * reasons, so a client written against the mock meets the refusals the server
 * gives. Both are tested against one list of rows,
 * `internal/httputil/testdata/redirect_targets.json`; a new way around the
 * check is added there and in both implementations, never in one of them.
 *
 * A browser and a URL parser read the same string differently, so the target
 * is checked in the form a browser reads it, and `new URL` is not used: it
 * normalizes the very things that make a target unsafe.
 */

/** The longest redirect target accepted, in bytes (the API spec's maxLength). */
export const MAX_REDIRECT_TARGET_LENGTH = 2048;

/** How many distinct readings of a path are followed before it is refused. */
const MAX_READINGS = 64;

const MAX_PORT = 65535;

/** A target the server would accept, as the mock stores and later emits it. */
export interface RedirectTarget {
  /** The target as stored: a stray `%` written as `%25`, the scheme folded. */
  href: string;
  /** `scheme://host`, which the caller compares with the request origin. */
  origin: string;
}

/** Thrown for a refused target; the message says why, as the server's does. */
export class RedirectTargetError extends Error {
  constructor(why: string) {
    super(`not a valid redirect target: ${why}`);
    this.name = "RedirectTargetError";
  }
}

function refusal(why: string): never {
  throw new RedirectTargetError(why);
}

const encoder = new TextEncoder();

/** Parse `raw` as an absolute http(s) URL, or throw a {@link RedirectTargetError}. */
export function parseRedirectTarget(raw: string): RedirectTarget {
  if (raw === "") refusal("it is empty");
  if (encoder.encode(raw).length > MAX_REDIRECT_TARGET_LENGTH) {
    refusal(`it is too long: over ${MAX_REDIRECT_TARGET_LENGTH} bytes`);
  }
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c <= 0x20 || c >= 0x7f) {
      const offset = encoder.encode(raw.slice(0, i)).length;
      refusal(`it contains a control, space or non-ASCII byte at offset ${offset}`);
    }
  }

  // Checked before parsing, so the answer does not depend on what a parser
  // happens to reject: a browser reads a backslash before the query as a slash.
  const hierarchicalEnd = raw.search(/[?#]/);
  const hierarchical = hierarchicalEnd >= 0 ? raw.slice(0, hierarchicalEnd) : raw;
  if (hierarchical.includes("\\")) refusal("its authority or path contains a backslash");

  const target = sanitize(raw);
  if (target.length > MAX_REDIRECT_TARGET_LENGTH) {
    refusal(
      `it is longer than ${MAX_REDIRECT_TARGET_LENGTH} bytes once its escapes are written out`,
    );
  }

  const parsed = parse(target);
  if (parsed.scheme !== "http" && parsed.scheme !== "https") {
    refusal("its scheme is not http or https");
  }
  if (parsed.opaque || parsed.host === "") refusal("it has no host");
  if (parsed.hasUser) refusal("it carries userinfo");
  checkHost(parsed.host);

  const path = pathOf(parsed.rest);
  checkPath(path);
  return { href: `${parsed.scheme}:${parsed.rest}`, origin: `${parsed.scheme}://${parsed.host}` };
}

interface Parsed {
  scheme: string;
  /** What follows "scheme:", as written (authority, path, query, fragment). */
  rest: string;
  opaque: boolean;
  host: string;
  hasUser: boolean;
}

function notAUrl(): never {
  return refusal("it is not a URL");
}

/** The parts of Go's `url.Parse` the check reads, on a sanitized target. */
function parse(target: string): Parsed {
  let scheme = "";
  let rest = target;
  const colon = target.indexOf(":");
  if (colon > 0 && /^[A-Za-z][A-Za-z0-9+.-]*$/.test(target.slice(0, colon))) {
    scheme = target.slice(0, colon).toLowerCase();
    rest = target.slice(colon + 1);
  } else if (colon === 0) {
    return notAUrl();
  }
  if (scheme === "") {
    // No scheme: a relative reference, which has no host. A colon in the first
    // segment of a relative path is a parse error.
    const firstSegment = rest.split(/[/?#]/, 1)[0] ?? "";
    if (!rest.startsWith("/") && firstSegment.includes(":")) return notAUrl();
    return { scheme, rest, opaque: false, host: "", hasUser: false };
  }

  const beforeFragment = rest.split("#", 1)[0] ?? "";
  if (!beforeFragment.startsWith("/")) {
    return { scheme, rest, opaque: beforeFragment !== "", host: "", hasUser: false };
  }
  if (!beforeFragment.startsWith("//")) {
    return { scheme, rest, opaque: false, host: "", hasUser: false };
  }
  const afterSlashes = beforeFragment.slice(2);
  const authorityEnd = afterSlashes.search(/[/?]/);
  const authority = authorityEnd >= 0 ? afterSlashes.slice(0, authorityEnd) : afterSlashes;

  const at = authority.lastIndexOf("@");
  if (at >= 0) {
    if (!validUserinfo(authority.slice(0, at))) notAUrl();
    return { scheme, rest, opaque: false, host: parseHost(authority.slice(at + 1)), hasUser: true };
  }
  return { scheme, rest, opaque: false, host: parseHost(authority), hasUser: false };
}

function validUserinfo(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string;
    if (/[A-Za-z0-9]/.test(c) || "-._:~!$&'()*+,;=%@".includes(c)) {
      if (c === "%" && !isEscapeAt(s, i)) return false;
      continue;
    }
    return false;
  }
  return true;
}

function validOptionalPort(port: string): boolean {
  if (port === "") return true;
  if (!port.startsWith(":")) return false;
  return /^[0-9]*$/.test(port.slice(1));
}

/** Go's host parse: a decoded host, or "not a URL" for one it cannot read. */
function parseHost(host: string): string {
  if (host.startsWith("[")) {
    const close = host.lastIndexOf("]");
    if (close < 0) return notAUrl();
    if (!validOptionalPort(host.slice(close + 1))) return notAUrl();
    const inside = host.slice(1, close);
    const zone = inside.indexOf("%25");
    const address = zone >= 0 ? inside.slice(0, zone) : inside;
    if (!isIPv6(address)) return notAUrl();
    if (zone >= 0 && inside.length === zone + 3) return notAUrl();
    return `[${zone >= 0 ? `${address}%${inside.slice(zone + 3)}` : address}]${host.slice(close + 1)}`;
  }
  const lastColon = host.lastIndexOf(":");
  if (lastColon >= 0 && !validOptionalPort(host.slice(lastColon))) return notAUrl();
  let decoded = "";
  for (let i = 0; i < host.length; i++) {
    const c = host[i] as string;
    if (c === "%") {
      if (!isEscapeAt(host, i)) return notAUrl();
      // Go refuses an escape in a host unless it is "%25" or names a byte
      // from 0x80 up.
      if (parseInt(host[i + 1] as string, 16) < 8 && host.slice(i, i + 3) !== "%25") {
        return notAUrl();
      }
      decoded += String.fromCharCode(parseInt(host.slice(i + 1, i + 3), 16));
      i += 2;
      continue;
    }
    if (!/[A-Za-z0-9\-_.~!$&'()*+,;=:[\]<>"]/.test(c)) return notAUrl();
    decoded += c;
  }
  return decoded;
}

/** The host's name without its port, as Go's `Hostname` reads it. */
function hostname(host: string): string {
  if (host.startsWith("[")) {
    const close = host.lastIndexOf("]");
    return close >= 0 ? host.slice(1, close) : host;
  }
  const colon = host.lastIndexOf(":");
  return colon >= 0 && validOptionalPort(host.slice(colon)) ? host.slice(0, colon) : host;
}

function port(host: string): string {
  const close = host.lastIndexOf("]");
  const colon = host.lastIndexOf(":");
  if (colon < 0 || colon < close || !validOptionalPort(host.slice(colon))) return "";
  return host.slice(colon + 1);
}

function isIPv6(s: string): boolean {
  const halves = s.split("::");
  if (halves.length > 2) return false;
  const groups = (half: string): string[] | null => (half === "" ? [] : half.split(":"));
  const parts = halves.map(groups);
  const all = parts.flat();
  let count = 0;
  for (let i = 0; i < all.length; i++) {
    const g = all[i] as string;
    const isLast = i === all.length - 1 && (parts[parts.length - 1] as string[]).length > 0;
    if (/^[0-9A-Fa-f]{1,4}$/.test(g)) {
      count += 1;
    } else if (
      isLast &&
      /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(g)
    ) {
      count += 2;
    } else {
      return false;
    }
  }
  return halves.length === 2 ? count <= 7 : count === 8;
}

/** Accepts an ASCII host name, an IPv4 address or an unzoned IPv6 literal. */
function checkHost(host: string): void {
  const name = hostname(host);
  if (name === "") refusal("it has no host");
  if (host.startsWith("[")) {
    if (name.includes("%") || !isIPv6(name)) refusal("its host is not a plain IP literal");
  } else if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    refusal("its host contains a character other than letters, digits, dot, dash and underscore");
  }
  const p = port(host);
  if (p !== "") {
    let n = 0;
    for (const digit of p) {
      n = n * 10 + Number(digit);
      if (n > MAX_PORT) refusal("its port is out of range");
    }
  }
}

/**
 * Write the path and the fragment so a parser keeps them as written: a `%` that
 * starts no two-digit escape becomes `%25`, and a byte Go would re-encode
 * becomes its escape. The query is left as written.
 */
function sanitize(raw: string): string {
  let out = "";
  let inQuery = false;
  let inFragment = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i] as string;
    if (c === "#" && !inFragment) {
      inQuery = false;
      inFragment = true;
    } else if (c === "#" && inFragment) {
      out += "%23";
      continue;
    } else if (c === "?" && !inFragment) {
      inQuery = true;
    }
    if (inQuery) {
      out += c;
    } else if (c === "%" && !isEscapeAt(raw, i)) {
      out += "%25";
    } else if ('"<>^`{|}'.includes(c) || (c === "\\" && inFragment)) {
      out += `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
    } else {
      out += c;
    }
  }
  return out;
}

function isEscapeAt(s: string, i: number): boolean {
  if (i + 2 >= s.length) return false;
  return /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3));
}

/** What follows the authority of the target, up to its query or fragment. */
function pathOf(rest: string): string {
  // rest starts "//authority..."; the parse already took the authority.
  const afterSlashes = rest.slice(2);
  const start = afterSlashes.search(/[/?#]/);
  if (start < 0 || afterSlashes[start] !== "/") return "";
  let path = afterSlashes.slice(start);
  const end = path.search(/[?#]/);
  if (end >= 0) path = path.slice(0, end);
  return path;
}

/**
 * Refuse a path that any reader would take to start with an empty segment,
 * which reads as another host once the scheme and host are removed. Every text
 * reachable from the path by decoding, resolving dot segments, reading
 * backslashes as slashes, dropping `;` parameters and cutting at a query or
 * fragment mark, in any order and any number of times, is tested.
 */
function checkPath(path: string): void {
  const seen = new Set<string>([path]);
  const pending = [path];
  while (pending.length > 0) {
    const text = pending.shift() as string;
    if (text.replaceAll("\\", "/").startsWith("//")) {
      refusal("its path starts with an empty segment, which reads as another host");
    }
    const decoded = unescapeLeniently(text);
    const steps = [
      decoded,
      resolveDots(text),
      text.replaceAll("\\", "/"),
      dropParameters(text),
      cutAtQuery(text),
      onPath(text, resolveDots),
      onPath(text, dropParameters),
    ];
    for (const step of steps) {
      if (seen.has(step)) continue;
      if (step === decoded) {
        for (let i = 0; i < step.length; i++) {
          const c = step.charCodeAt(i);
          if (c < 0x20 || c === 0x7f) refusal("its path decodes to a control character");
        }
      }
      if (seen.size >= MAX_READINGS) refusal("its path has too many readings to check");
      seen.add(step);
      pending.push(step);
    }
  }
}

function cutAtQuery(p: string): string {
  const i = p.search(/[?#]/);
  return i >= 0 ? p.slice(0, i) : p;
}

function onPath(p: string, f: (path: string) => string): string {
  const i = p.search(/[?#]/);
  return i >= 0 ? f(p.slice(0, i)) + p.slice(i) : f(p);
}

function dropParameters(p: string): string {
  if (!p.includes(";")) return p;
  return p
    .split("/")
    .map((segment) => {
      const i = segment.indexOf(";");
      return i >= 0 ? segment.slice(0, i) : segment;
    })
    .join("/");
}

function resolveDots(p: string): string {
  if (!p.startsWith("/")) return p;
  const segments = p.slice(1).split("/");
  const resolved: string[] = [];
  segments.forEach((segment, i) => {
    const final = i === segments.length - 1;
    switch (dotKind(segment)) {
      case "single":
        if (final) resolved.push("");
        break;
      case "double":
        resolved.pop();
        if (final) resolved.push("");
        break;
      default:
        resolved.push(segment);
    }
  });
  return `/${resolved.join("/")}`;
}

function dotKind(segment: string): "single" | "double" | "none" {
  switch (segment.toLowerCase()) {
    case ".":
    case "%2e":
      return "single";
    case "..":
    case ".%2e":
    case "%2e.":
    case "%2e%2e":
      return "double";
    default:
      return "none";
  }
}

/** Decode every valid `%XX` escape and leave any other `%` alone. */
function unescapeLeniently(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "%" && isEscapeAt(s, i)) {
      out += String.fromCharCode(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
      continue;
    }
    out += s[i];
  }
  return out;
}
