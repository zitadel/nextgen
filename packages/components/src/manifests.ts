import {
  zlActionManifest,
  zlErrorManifest,
  zlFieldManifest,
  zlPasskeyManifest,
  zlSubmitManifest,
} from "./atoms/index.js";
/**
 * Aggregate registry of every shipped `<zl-*>` atom's manifest.
 *
 * The structural validator (`docs/design/branding/validator.md`) rejects any
 * `<zl-*>` tag not registered here. Editor tooling drives autocomplete from
 * this same registry. Adding a new atom = exporting it from `./atoms/` and
 * adding its manifest to {@link manifestRegistry}.
 */
import type { AtomManifest } from "./manifest.js";

export const manifestRegistry: readonly AtomManifest[] = [
  zlFieldManifest,
  zlSubmitManifest,
  zlActionManifest,
  zlErrorManifest,
  zlPasskeyManifest,
] as const;

export function findManifest(tag: string): AtomManifest | undefined {
  return manifestRegistry.find((manifest) => manifest.tag === tag);
}

export function listKnownTags(): readonly string[] {
  return manifestRegistry.map((manifest) => manifest.tag);
}

export type { AtomManifest } from "./manifest.js";
