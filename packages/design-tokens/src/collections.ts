/**
 * What each Figma collection *is*.
 *
 * `sync-from-export.ts` used to infer this from a collection's shape — "the one
 * with Light/Dark modes is the semantic colour surface, anything else
 * multi-mode is viewport typography". That inference broke the moment Figma
 * shipped a second and third Light/Dark collection (`Syntax`, `Gradient
 * Colors`): they were routed into the viewport bucket, where they collided and
 * one silently replaced the other.
 *
 * Roles are declared here instead. A collection the sync has never seen stops
 * the sync until someone decides what it is, rather than being auto-routed
 * somewhere by shape.
 *
 * Keys are the Figma collection name (`$metadata.collection`), falling back to
 * the file stem for exports the plugin writes without metadata — the same name
 * that appears in `$source.collections`. Deliberately *not* the file name: the
 * plugin is free to rename, split, or reorder files.
 */

export type CollectionRole =
  /** Owns `color.*` — the shadcn semantic roles, read from its `base/*` group. Exactly one. */
  | "semantic"
  /** A Light/Dark group of its own: `themed.<group>.<name>` -> `--zl-<group>-<name>`. */
  | "themed"
  /** Multi-mode on an axis that isn't theme (Desktop/Mobile) -> `typography.<mode>`. */
  | "viewport"
  /** Single-mode source of the primitive groups (`radius`, `text`, `font`, `font-weight`, `container`). */
  | "primitives"
  /** Ingested only so `{alias}` chains resolve through it. Surfaces nothing itself. */
  | "registry-only";

export const collectionRoles: Record<string, CollectionRole> = {
  // Tailwind's raw ramps. Referenced as `{tailwind colors.neutral.900}` by
  // `2--theme`; nothing reads it directly.
  "1--tailwindcss": "registry-only",
  // Named theme pairs (`colors.primary-light`) plus the radius/text/font/
  // container scales that the primitive groups are built from.
  "2--theme": "primitives",
  // `base/*` per Light/Dark — the consumer-facing semantic colours.
  "3. Mode": "semantic",
  "4. Custom": "viewport",
  "5--icon-library": "registry-only",
  // Brand palette. Only reached through `{brand.*}` aliases from `Syntax`.
  brand: "registry-only",
  "Gradient Colors": "themed",
  // Restates `font/font-serif` as a literal per heading size; nothing consumes
  // it. Left registry-only rather than dropped, so the sync stays green while
  // the duplication is fixed in Figma.
  "heading-typography": "registry-only",
  Syntax: "themed",
};
