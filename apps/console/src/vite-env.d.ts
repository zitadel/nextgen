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
   * serves. Never set for the build the Go server embeds.
   */
  readonly VITE_CONSOLE_VERCEL_INSIGHTS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
