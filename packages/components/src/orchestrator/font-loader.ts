/**
 * Inject `branding.font_url` as `<link rel="stylesheet">` into the host
 * document's `<head>`. Per `docs/design/branding/templates.md`:
 *
 *   "The `font_url` stylesheet is injected by the orchestrator; the template
 *    does not emit the `<link>` tag itself."
 *
 * The link must live at document level, not inside the shadow root:
 * browsers ignore `@font-face` rules declared in shadow-tree stylesheets,
 * so a shadow-scoped link would never register the font faces and every
 * branded font silently falls back to the system stack. `font-family`
 * references inside the shadow tree resolve against document-level faces.
 *
 * Idempotent: calling with the same URL is a no-op; calling with a new URL
 * replaces the previous link. Calling with `null`/`undefined` removes any
 * previously injected link.
 */
const LINK_ID = "zl-font-link";

export function applyFontUrl(shadowRoot: ShadowRoot, fontUrl: string | null | undefined): void {
  const ownerDocument = shadowRoot.ownerDocument ?? document;
  // Legacy cleanup — earlier versions injected into the shadow root itself.
  (shadowRoot.getElementById?.(LINK_ID) as HTMLLinkElement | null)?.remove();
  const existing = ownerDocument.getElementById(LINK_ID) as HTMLLinkElement | null;
  if (!fontUrl) {
    existing?.remove();
    return;
  }
  if (existing && existing.href === fontUrl) {
    return;
  }
  existing?.remove();
  const link = ownerDocument.createElement("link");
  link.id = LINK_ID;
  link.rel = "stylesheet";
  link.href = fontUrl;
  ownerDocument.head.appendChild(link);
}
