/**
 * Aggregate registry of every shipped `<zl-*>` atom's manifest.
 *
 * The sanitiser allows only the tags and attributes registered here, and the
 * orchestrator derives its `exportparts` forwarding from the same registry. Adding a new atom = exporting it from `./atoms/` and
 * adding its manifest to {@link manifestRegistry}.
 */
import {
  zlAccountManifest,
  zlAlertManifest,
  zlAvatarManifest,
  zlButtonManifest,
  zlCardManifest,
  zlCheckboxManifest,
  zlFieldManifest,
  zlIconManifest,
  zlPageShellManifest,
  zlPasskeyManifest,
  zlPillManifest,
  zlSelectManifest,
  zlSsoProvidersManifest,
} from "./atoms/index.js";
import type { AtomManifest } from "./manifest.js";

export const manifestRegistry: readonly AtomManifest[] = [
  zlAccountManifest,
  zlAlertManifest,
  zlAvatarManifest,
  zlButtonManifest,
  zlCardManifest,
  zlCheckboxManifest,
  zlFieldManifest,
  zlIconManifest,
  zlPageShellManifest,
  zlPasskeyManifest,
  zlPillManifest,
  zlSelectManifest,
  zlSsoProvidersManifest,
] as const;

export function findManifest(tag: string): AtomManifest | undefined {
  return manifestRegistry.find((manifest) => manifest.tag === tag);
}

export function listKnownTags(): readonly string[] {
  return manifestRegistry.map((manifest) => manifest.tag);
}

export type { AtomManifest } from "./manifest.js";
