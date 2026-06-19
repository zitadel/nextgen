/**
 * Document-level font stylesheet injection for `<zitadel-login>`.
 *
 * Two faces can be linked into the host document's `<head>`:
 *
 * - The **design-system default** (`applyDefaultFont`) — the brand body face
 *   (Arimo, named first in `--zl-font-family-sans`). The component ships this
 *   so the auth screens render in the brand font out of the box, even when the
 *   server returns no branding. This is the "default users can override" layer.
 * - The **tenant override** (`applyFontUrl`) — `branding.font_url`, resolved
 *   server-side from the app → team → project branding hierarchy.
 *
 * Both must live at document level, not inside the shadow root: browsers ignore
 * `@font-face` rules declared in shadow-tree stylesheets, so a shadow-scoped
 * link would never register the font faces and every branded font silently
 * falls back to the system stack. `font-family` references inside the shadow
 * tree resolve against document-level faces.
 *
 * Both injectors are idempotent: calling with the same URL is a no-op; calling
 * with a new URL replaces the previous link; calling with `null`/`undefined`
 * removes any previously injected link.
 */
const TENANT_LINK_ID = "zl-font-link";
const DEFAULT_LINK_ID = "zl-default-font-link";

/**
 * Design-system default brand font. Arimo is the Figma body face and leads the
 * `--zl-font-family-sans` stack; loading it here makes the unbranded auth UI
 * paint in the brand font instead of the system fallback. Tenants override it
 * with `branding.font_url`. Exported so a privacy- or offline-sensitive
 * deployment can self-host the same face and swap this single URL.
 */
export const DEFAULT_BRAND_FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Arimo:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap";

/**
 * Inject the tenant's `branding.font_url` stylesheet. Pass `null`/`undefined`
 * to remove it (e.g. when a flow resolves with no tenant font).
 */
export function applyFontUrl(shadowRoot: ShadowRoot, fontUrl: string | null | undefined): void {
  applyLinkedStylesheet(shadowRoot, TENANT_LINK_ID, fontUrl);
}

/**
 * Inject the design-system default font stylesheet. Defaults to
 * {@link DEFAULT_BRAND_FONT_HREF}; pass `null` to remove it (the orchestrator
 * does this when a tenant `font_url` takes over, to avoid a redundant request).
 */
export function applyDefaultFont(
  shadowRoot: ShadowRoot,
  href: string | null | undefined = DEFAULT_BRAND_FONT_HREF,
): void {
  applyLinkedStylesheet(shadowRoot, DEFAULT_LINK_ID, href);
}

function applyLinkedStylesheet(
  shadowRoot: ShadowRoot,
  linkId: string,
  href: string | null | undefined,
): void {
  const ownerDocument = shadowRoot.ownerDocument ?? document;
  // Scope the lookup to our own `<link>` so we only ever touch the element this
  // id owns, then reuse it across re-renders instead of removing and
  // re-fetching the font.
  const existing = ownerDocument.head.querySelector<HTMLLinkElement>(`link#${linkId}`);
  if (!href) {
    existing?.remove();
    return;
  }
  const link = existing ?? ownerDocument.createElement("link");
  link.id = linkId;
  link.rel = "stylesheet";
  if (link.href !== href) {
    link.href = href;
  }
  if (!existing) {
    ownerDocument.head.appendChild(link);
  }
}
