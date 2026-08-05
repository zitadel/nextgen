/**
 * Forwards atom-internal CSS Shadow Parts through the orchestrator boundary.
 *
 * Atoms stamp `part="..."` on their internals and declare the public set in
 * their manifest (`parts`). Those parts are visible one shadow boundary up —
 * inside the orchestrator's shadow root — but not to the embedding page,
 * because `::part()` pierces a single boundary unless each host in the chain
 * re-exports (`exportparts`). Templates never author the forwarding (the
 * sanitiser strips `exportparts`); the orchestrator stamps it after every
 * render commit so the mapping stays canonical for template-rendered and
 * gate-patched atoms alike.
 *
 * Exported names are mechanical, collision-free, and public contract
 * (override-ladder Tier 2, same stability rules as token names):
 * `<atom>-<part>` with the `zl-` prefix dropped — `zl-field`'s `input` part
 * becomes `zitadel-login::part(field-input)` on the host page. Manifests are
 * the canonical part catalogue; this module derives, never curates.
 */
import { manifestRegistry } from "../manifests.js";

const exportpartsByTag: ReadonlyMap<string, string> = new Map(
  manifestRegistry
    .filter((manifest) => manifest.parts.length > 0)
    .map((manifest) => {
      const short = manifest.tag.replace(/^zl-/, "");
      const value = manifest.parts.map((part) => `${part}: ${short}-${part}`).join(", ");
      return [manifest.tag, value] as const;
    }),
);

/** The `exportparts` value an atom tag gets, or `undefined` for part-less atoms. */
export function exportpartsFor(tag: string): string | undefined {
  return exportpartsByTag.get(tag);
}

/**
 * Stamps `exportparts` onto every known atom in `scope`. Idempotent — call
 * after each render commit: `unsafeHTML` re-parses replace previously
 * stamped nodes, and the mandatory-gates patcher appends atoms after
 * sanitisation.
 */
export function stampExportparts(scope: ParentNode): void {
  for (const [tag, value] of exportpartsByTag) {
    for (const el of scope.querySelectorAll(tag)) {
      if (el.getAttribute("exportparts") !== value) {
        el.setAttribute("exportparts", value);
      }
    }
  }
}
