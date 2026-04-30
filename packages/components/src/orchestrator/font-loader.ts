/**
 * Inject `branding.font_url` as `<link rel="stylesheet">` inside the
 * `<zitadel-login>` Shadow DOM. Per `docs/design/branding/templates.md`:
 *
 *   "The `font_url` stylesheet is injected by the orchestrator; the template
 *    does not emit the `<link>` tag itself."
 *
 * Idempotent: calling with the same URL is a no-op; calling with a new URL
 * replaces the previous link. Calling with `null`/`undefined` removes any
 * previously injected link.
 */
const LINK_ID = "zl-font-link";

export function applyFontUrl(shadowRoot: ShadowRoot, fontUrl: string | null | undefined): void {
  const existing = shadowRoot.getElementById?.(LINK_ID) as HTMLLinkElement | null;
  if (!fontUrl) {
    existing?.remove();
    return;
  }
  if (existing && existing.href === fontUrl) {
    return;
  }
  existing?.remove();
  const ownerDocument = shadowRoot.ownerDocument ?? document;
  const link = ownerDocument.createElement("link");
  link.id = LINK_ID;
  link.rel = "stylesheet";
  link.href = fontUrl;
  shadowRoot.prepend(link);
}
