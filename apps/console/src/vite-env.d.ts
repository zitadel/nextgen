/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Same-origin base path for API requests. Defaults to `/api`. */
  readonly VITE_CONSOLE_API_BASE?: string;
  /**
   * Opt-in for builds that run without a runtime document (`vite preview`):
   * treat failed discovery as the standalone
   * fallback instead of an error (Console ADR 0004 §3). Never set for the
   * embedded production build.
   */
  readonly VITE_CONSOLE_RUNTIME_FALLBACK?: string;
  /**
   * `1` in the hosted cloud's build (repo-root `vercel.json`): the console
   * then sends Vercel Web Analytics and Speed Insights, which only Vercel
   * serves. Never set for the build the Go server embeds. Not VITE_-prefixed
   * (vite.config.ts says why) and inlined there through `define`, an empty
   * string when unset.
   */
  readonly CONSOLE_VERCEL_INSIGHTS: string;
  /**
   * The share of page loads that send Speed Insights in the hosted cloud's
   * build, from `0` (none) to `1` (every one, the default when empty); set
   * per environment on Vercel. Not VITE_-prefixed: vite.config.ts inlines it
   * through `define`, an empty string when unset. Web Analytics has no
   * sampling.
   */
  readonly CONSOLE_SPEED_INSIGHTS_SAMPLE_RATE: string;
  /**
   * The commit the hosted cloud's build comes from (Vercel's
   * `VERCEL_GIT_COMMIT_SHA`), which the console's analytics events report as
   * `console_version` (src/lib/analytics.ts). Inlined by vite.config.ts
   * through `define`; an empty string outside Vercel.
   */
  readonly CONSOLE_VERSION: string;
  /**
   * The Zitadel server's origin under the dev loop, where the page runs on
   * Vite's origin and reaches the server through its proxy. Inlined by
   * vite.config.ts through `define`; an empty string in a build.
   */
  readonly CONSOLE_SERVER_ORIGIN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
