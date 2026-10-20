/**
 * The build-time flag that closes the shadow roots, declared in
 * `src/internal/shadow-root.ts`. `tsdown.config.ts` applies it to every
 * artifact that ships and `vitest.config.ts` to the `closed-roots` project;
 * nothing else defines it, so every other build runs open roots.
 */
export const CLOSED_SHADOW_ROOTS = {
  __ZITADEL_SHADOW_ROOT_MODE__: JSON.stringify("closed"),
};
