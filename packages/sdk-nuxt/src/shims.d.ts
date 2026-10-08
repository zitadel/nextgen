/**
 * Minimal ambient declarations for Nuxt virtual modules that are only
 * resolvable inside a running Nuxt application.  These stubs satisfy
 * TypeScript's standalone typecheck (`tsc --noEmit`) without requiring a
 * full Nuxt environment.  At runtime, Nuxt replaces these imports with its
 * real implementations.
 */

declare module "#imports" {
  export function useState<T>(key: string, init: () => T): { readonly value: T };
  export function defineNuxtPlugin(setup: () => void): unknown;
  // Nuxt returns the h3 event; its context is augmented with `nextgenAuth`
  // by runtime/server/middleware.ts.
  export function useRequestEvent(): import("h3").H3Event | undefined;
  export function useRuntimeConfig(): {
    nextgen?: {
      url?: string;
      issuerUrl?: string;
      loginPath?: string;
      protectedRoutes?: string[];
    };
    public: Record<string, unknown>;
  };
}
