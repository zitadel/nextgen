/**
 * Document-level font stylesheet injection for the orchestrator surfaces.
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
 * Each `<link>` is shared per document but **owned collectively**: every
 * calling surface (identified by its shadow root) registers the href it wants,
 * and passing `null`/`undefined` withdraws only that surface's registration —
 * never the link another surface still needs. Multiple surfaces now call these
 * helpers on every update (`<zitadel-login>` and `<zitadel-session>` via the
 * shared surface base), so a widget-mode session mounting next to a page-mode
 * login must not strip the login's fonts. The rendered href is the most
 * recently registered one (matching the old single-owner behavior when only
 * one surface is present); the link is removed once no surface wants it.
 * Registrations from since-disconnected surfaces are pruned lazily on the
 * next call, so a removed element neither pins a link forever nor leaks its
 * shadow root — while the link itself stays in place until another surface
 * actually updates, exactly like the pre-ownership behavior.
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
 * Only the body face is loaded here.
 *
 * The design draws card titles, field labels and alert titles in APK Futural,
 * a licensed display face. First-party surfaces declare it themselves and point
 * `--zl-font-family-heading` at it — see `apps/login-ui/src/styles.css` and
 * `apps/console/src/styles.css`. An embedded widget runs on a customer's own
 * origin, so serving them the binary from here is a licensing question rather
 * than an engineering one, and it is not answered yet. Until it is, embedded
 * headings fall through the token's stack to Arimo, which is what the stack is
 * for. A host page that has licensed the face can opt in today by declaring an
 * `@font-face` and setting `--zl-font-family-heading` on the element.
 */

/** Per-document, per-link-id map of each owner's desired href. */
const registries = new WeakMap<Document, Map<string, Map<ShadowRoot, string>>>();

/**
 * Inject the tenant's `branding.font_url` stylesheet. Pass `null`/`undefined`
 * to withdraw this surface's registration (e.g. when a flow resolves with no
 * tenant font); the link disappears once no surface registers a URL.
 */
export function applyFontUrl(shadowRoot: ShadowRoot, fontUrl: string | null | undefined): void {
  applyLinkedStylesheet(shadowRoot, TENANT_LINK_ID, fontUrl);
}

/**
 * Inject the design-system default font stylesheet. Defaults to
 * {@link DEFAULT_BRAND_FONT_HREF}; pass `null` to withdraw this surface's
 * registration (the orchestrator does this when a tenant `font_url` takes
 * over, to avoid a redundant request).
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

  let registry = registries.get(ownerDocument);
  if (!registry) {
    registry = new Map();
    registries.set(ownerDocument, registry);
  }
  let desires = registry.get(linkId);
  if (!desires) {
    desires = new Map();
    registry.set(linkId, desires);
  }
  // Disconnected surfaces no longer vote; prune them so a removed element's
  // registration can neither pin the link nor resurrect it later.
  for (const owner of desires.keys()) {
    if (!owner.host.isConnected) desires.delete(owner);
  }
  if (href) {
    // Delete-then-set moves this owner to the end of the insertion order, so
    // the effective href below is always the most recent registration.
    desires.delete(shadowRoot);
    desires.set(shadowRoot, href);
  } else {
    desires.delete(shadowRoot);
  }

  const effective = [...desires.values()].at(-1) ?? null;

  // Scope the lookup to our own `<link>` so we only ever touch the element this
  // id owns, then reuse it across re-renders instead of removing and
  // re-fetching the font.
  const existing = ownerDocument.head.querySelector<HTMLLinkElement>(`link#${linkId}`);
  if (!effective) {
    existing?.remove();
    return;
  }
  if (!href) {
    // A withdrawal keeps the shared link current for the remaining owners but
    // never materialises one: if the link is gone (e.g. the host page pruned
    // it), only a surface positively registering a font may bring it back.
    if (existing && existing.href !== effective) {
      existing.href = effective;
    }
    return;
  }
  const link = existing ?? ownerDocument.createElement("link");
  link.id = linkId;
  link.rel = "stylesheet";
  if (link.href !== effective) {
    link.href = effective;
  }
  if (!existing) {
    ownerDocument.head.appendChild(link);
  }
}
