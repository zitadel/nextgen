/**
 * Test-only stub for Nuxt's auto-import virtual module `#imports`. Vitest
 * resolves `#imports` to this file (see `vitest.config.ts`) so the middleware
 * source under test can `import { useRuntimeConfig } from '#imports'` without
 * pulling in the Nuxt module-resolver. Returns whatever vitest tests set via
 * `setRuntimeConfig`, defaulting to an empty `nextgen` block.
 */
type RuntimeConfig = Record<string, unknown>;

let current: RuntimeConfig = { nextgen: {} };

export function setRuntimeConfig(value: RuntimeConfig): void {
  current = value;
}

export function useRuntimeConfig(): RuntimeConfig {
  return current;
}
