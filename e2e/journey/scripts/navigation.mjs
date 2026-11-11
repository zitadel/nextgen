/**
 * A logout destination, checked by pathname so the scheme's `//` cannot match
 * the SPA's root path while the browser is still on a signed-in page.
 * @param {URL} url
 * @param {boolean} expectsProtectedRouteRedirect
 */
export function isLoggedOutUrl(url, expectsProtectedRouteRedirect) {
  return (
    /^\/login(?:\/|$)/.test(url.pathname) ||
    (!expectsProtectedRouteRedirect && url.pathname === "/")
  );
}
