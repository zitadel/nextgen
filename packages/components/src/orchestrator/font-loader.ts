/**
 * Document-level injection of the tenant's font stylesheet
 * (`branding.typography.font_url`).
 *
 * The package loads no face of its own: the `--zl-font-family-*` stacks name
 * the brand face first and fall back to the system stack, so an unbranded
 * surface makes no font request at all (ADR 025, amended). A first-party app
 * that wants the brand face self-hosts it, as `apps/login-ui` and
 * `apps/console` do; a tenant opts in to any face, third-party CDN included,
 * through `font_url`.
 *
 * The link must live at document level, not inside the shadow root: browsers
 * ignore `@font-face` rules declared in shadow-tree stylesheets, so a
 * shadow-scoped link would never register the font faces. `font-family`
 * references inside the shadow tree resolve against document-level faces.
 *
 * The `<link>` is shared per document but **owned collectively**: every
 * calling surface (identified by its shadow root) registers the href it wants,
 * and passing `null`/`undefined` withdraws only that surface's registration —
 * never the link another surface still needs. `<zitadel-login>` and
 * `<zitadel-session>` call this on every update, so a widget-mode session
 * mounting next to a page-mode login must not strip the login's font. The
 * rendered href is the most recently registered one; the link is removed once
 * no surface wants it. Registrations from since-disconnected surfaces are
 * pruned lazily on the next call, so a removed element neither pins a link
 * forever nor leaks its shadow root.
 */
const TENANT_LINK_ID = "zl-font-link";

/** Per-document map of each owner's desired href. */
const registries = new WeakMap<Document, Map<ShadowRoot, string>>();

/**
 * Inject the tenant's `branding.typography.font_url` stylesheet. Pass `null`/`undefined`
 * to withdraw this surface's registration (e.g. when a flow resolves with no
 * tenant font); the link disappears once no surface registers a URL.
 */
export function applyFontUrl(shadowRoot: ShadowRoot, fontUrl: string | null | undefined): void {
  const ownerDocument = shadowRoot.ownerDocument ?? document;

  let desires = registries.get(ownerDocument);
  if (!desires) {
    desires = new Map();
    registries.set(ownerDocument, desires);
  }
  // Disconnected surfaces no longer vote; prune them so a removed element's
  // registration can neither pin the link nor resurrect it later.
  for (const owner of desires.keys()) {
    if (!owner.host.isConnected) desires.delete(owner);
  }
  // Delete-then-set moves this owner to the end of the insertion order, so
  // the effective href below is always the most recent registration.
  desires.delete(shadowRoot);
  if (fontUrl) desires.set(shadowRoot, fontUrl);

  const effective = [...desires.values()].at(-1) ?? null;

  // Scope the lookup to our own `<link>` so we only ever touch the element
  // this id owns, then reuse it across re-renders instead of removing and
  // re-fetching the font.
  const existing = ownerDocument.head.querySelector<HTMLLinkElement>(`link#${TENANT_LINK_ID}`);
  if (!effective) {
    existing?.remove();
    return;
  }
  if (!fontUrl) {
    // A withdrawal keeps the shared link current for the remaining owners but
    // never materialises one: if the link is gone (e.g. the host page pruned
    // it), only a surface positively registering a font may bring it back.
    if (existing && existing.href !== effective) {
      existing.href = effective;
    }
    return;
  }
  const link = existing ?? ownerDocument.createElement("link");
  link.id = TENANT_LINK_ID;
  link.rel = "stylesheet";
  if (link.href !== effective) {
    link.href = effective;
  }
  if (!existing) {
    ownerDocument.head.appendChild(link);
  }
}
