/**
 * The query parameter a signed-out request for a protected route brings to the
 * login page: every server SDK's middleware sends such a request to its
 * `loginPath` with `?next=<the path it asked for>`.
 */
const RETURN_PATH_PARAM = "next";

/**
 * `value` as a path on `base`'s origin to send the browser to after sign-in,
 * or `undefined` when it is anything else.
 *
 * The value comes from the page URL, so whoever wrote the link chose it, and
 * one that left this origin would make the login page an open redirect: a
 * link to the real sign-in page that ends on another site. So it has to be a
 * path: one `/` not followed by another, since `//evil.example` names another
 * host, and no `\` or control character anywhere, since browsers read `\` as
 * `/` and drop tabs and newlines, which turn `/\evil.example` and
 * `/<tab>/evil.example` into `//evil.example`. What passes is resolved against
 * `base`, must keep its origin, and must still be a path once `.` and `..`
 * segments collapse, which turns `/.//evil.example` into `//evil.example`.
 */
export function safeReturnPath(value: string | null | undefined, base: string): string | undefined {
  if (!value?.startsWith("/") || value.startsWith("//")) return undefined;
  if ([...value].some((char) => char === "\\" || char < " " || char === "\u007f")) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return undefined;
  }
  const path = `${url.pathname}${url.search}${url.hash}`;
  return url.origin === new URL(base).origin && !path.startsWith("//") ? path : undefined;
}

/**
 * The path the page's `next` query parameter names, when it is a safe one to
 * return to ({@link safeReturnPath}).
 */
export function returnPathFromLocation(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const value = new URLSearchParams(window.location.search).get(RETURN_PATH_PARAM);
  return safeReturnPath(value, window.location.href);
}
