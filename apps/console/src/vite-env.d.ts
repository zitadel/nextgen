/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** A path or origin to put in front of the API's `/api/v1`. Defaults to the page's own origin. */
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
   * The Zitadel server's origin under the dev loop, where the page runs on
   * Vite's origin and reaches the server through its proxy. Inlined by
   * vite.config.ts through `define`; an empty string in a build.
   */
  readonly CONSOLE_SERVER_ORIGIN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
