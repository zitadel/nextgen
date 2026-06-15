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
  // Scope the lookup to `<link>` so we only ever touch our own element, then
  // reuse it across re-renders instead of removing and re-fetching the font.
  const existing = ownerDocument.head.querySelector<HTMLLinkElement>(`link#${LINK_ID}`);
  if (!fontUrl) {
    existing?.remove();
    return;
  }
  const link = existing ?? ownerDocument.createElement("link");
  link.id = LINK_ID;
  link.rel = "stylesheet";
  if (link.href !== fontUrl) {
    link.href = fontUrl;
  }
  if (!existing) {
    ownerDocument.head.appendChild(link);
  }
}
