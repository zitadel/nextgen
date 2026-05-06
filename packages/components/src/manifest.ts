/**
 * Atom manifest contract.
 *
 * Each `<zl-*>` atom ships a machine-readable manifest that the structural
 * validator and editor consume. Names follow the schema in
 * `docs/design/branding/validator.md`.
 *
 * The manifest is the single source of truth for:
 * - which step capability the atom binds to (`consumes` / `satisfies_gate`),
 * - the public attribute surface (`attrs`),
 * - the public `::part()` hooks (`parts`) — tier 2 of the override ladder,
 * - the public named slot set (`slots`) — tier 3 of the override ladder,
 * - the `CustomEvent` names the atom emits (`events`).
 *
 * Renaming any value here is a breaking change to the override contract.
 */
export type ConsumesField = {
  readonly required?: boolean;
};

export type ConsumesAction = {
  readonly kind: string;
  readonly required?: boolean;
};

export type AtomManifest = {
  readonly tag: `zl-${string}`;
  readonly consumes?: {
    readonly field?: ConsumesField;
    readonly action?: ConsumesAction;
  };
  readonly satisfies_gate?: string;
  readonly attrs: readonly string[];
  readonly parts: readonly string[];
  readonly slots: readonly string[];
  readonly events: readonly string[];
};
