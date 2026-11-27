/**
 * Minimal ambient declarations for the Nuxt virtual modules, which resolve only inside a running
 * Nuxt application.
 *
 * The stubs satisfy the standalone type check of this package without a full Nuxt environment. At
 * run time Nuxt replaces these imports with its real implementations.
 */

// Nuxt's build flag; nuxt/dist/app/types/augments.d.ts declares it the same way.
interface ImportMeta {
  server: boolean;
}

declare module "#imports" {
  export function useState<T>(key: string, init: () => T): { readonly value: T };
  export function defineNuxtPlugin(setup: () => void): unknown;
  // Nuxt returns the h3 event; its context is augmented with `zitadelAuth`
  // by runtime/server/middleware.ts.
  export function useRequestEvent(): import("h3").H3Event | undefined;
  export function useRuntimeConfig(): {
    zitadel?: {
      url?: string;
      issuerUrl?: string;
      proxyPath?: string;
      loginPath?: string;
      protectedRoutes?: string[];
    };
    public: Record<string, unknown>;
  };
}
