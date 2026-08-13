/**
 * Broken-branding-asset degradation.
 *
 * A `logo_url` / `hero_url` that is well-formed but unreachable clears every
 * gate on the way in — the CLI's zod shape check, the server's save gate —
 * and then renders as a 0×0 `<img>`: a silent hole where the brand should
 * be, with nothing in the console and nothing in `plan` output. The split
 * designs are the worst case, because their `.zl-split__placeholder` is
 * keyed on *no asset being configured*, so a configured-but-dead asset
 * leaves the whole brand pane blank.
 *
 * The templates cannot fix this themselves. They go through DOMPurify
 * (`sanitiser.ts`), which strips `onerror` along with every other inline
 * handler, so the recovery has to be orchestrator-side: arm a real `error`
 * listener on each rendered image after every commit, hide what fails, and
 * put the placeholder back when that empties a brand pane.
 */

/** Marks an image whose `error` listener is already attached. */
const ARMED_ATTR = "data-zl-asset-armed";

/** Marks an image that failed to load; `layout-chrome.css` hides it. */
const BROKEN_ATTR = "data-zl-asset-broken";

const BRAND_PANE_SELECTOR = ".zl-split__brand";
const PLACEHOLDER_CLASS = "zl-split__placeholder";

/**
 * Arm every not-yet-armed `<img>` under `root`, and repair anything already
 * broken. Idempotent: safe to call on every Lit commit, since `unsafeHTML`
 * only re-parses when the rendered string actually changes and re-parsed
 * nodes arrive without the marker attribute.
 */
export function armAssetFallbacks(root: ParentNode): void {
  let repairNeeded = false;

  for (const img of root.querySelectorAll("img")) {
    if (img.hasAttribute(ARMED_ATTR)) {
      continue;
    }
    img.setAttribute(ARMED_ATTR, "");

    // An image that finished loading before we got here reports its verdict
    // through `complete` + `naturalWidth`, not through an event we can still
    // catch — the error already fired.
    if (img.getAttribute("src") && img.complete && img.naturalWidth === 0) {
      markBroken(img);
      repairNeeded = true;
      continue;
    }
    img.addEventListener(
      "error",
      () => {
        markBroken(img);
        repairBrandPanes(root);
      },
      { once: true },
    );
  }

  if (repairNeeded) {
    repairBrandPanes(root);
  }
}

function markBroken(img: HTMLImageElement): void {
  img.setAttribute(BROKEN_ATTR, "");
  // The failure is invisible by construction — say so once, out loud.
  console.warn(
    `[zitadel-login] branding asset failed to load, hiding it: ${img.getAttribute("src") ?? ""}`,
  );
}

/**
 * Restore `.zl-split__placeholder` in any split brand pane whose only content
 * was assets that all failed. Deliberately narrow: a pane is only repaired
 * when it actually holds a broken image, so a pane an author left empty on
 * purpose — or a hero design whose landing copy still renders — is never
 * given decoration it did not ask for.
 */
function repairBrandPanes(root: ParentNode): void {
  for (const pane of root.querySelectorAll(BRAND_PANE_SELECTOR)) {
    if (pane.querySelector(`.${PLACEHOLDER_CLASS}`)) {
      continue;
    }
    const children = Array.from(pane.children);
    if (!children.some(isBrokenImage)) {
      continue;
    }
    if (children.some((child) => !isBrokenImage(child))) {
      continue;
    }
    const placeholder = pane.ownerDocument.createElement("div");
    placeholder.className = PLACEHOLDER_CLASS;
    placeholder.setAttribute("aria-hidden", "true");
    pane.append(placeholder);
  }
}

function isBrokenImage(node: Element): boolean {
  return node.tagName === "IMG" && node.hasAttribute(BROKEN_ATTR);
}
