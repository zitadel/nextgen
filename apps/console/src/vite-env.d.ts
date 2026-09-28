/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Same-origin base path for API requests. Defaults to `/api`. */
  readonly VITE_CONSOLE_API_BASE?: string;
  /** Non-secret project id used to scope list/detail API calls. */
  readonly VITE_CONSOLE_PROJECT_ID?: string;
  /**
   * Opt-in for builds that run without a runtime document (`vite preview`,
   * the api-mock dev loop): treat failed discovery as the standalone
   * fallback instead of an error (Console ADR 0004 §3). Never set for the
   * embedded production build.
   */
  readonly VITE_CONSOLE_RUNTIME_FALLBACK?: string;
  /**
   * Dev server only: fall back to the Figma design-review fixtures
   * (`src/dev/fixtures/`) when the backend answers with an error or an empty
   * list. Ignored by production builds.
   */
  readonly VITE_CONSOLE_FIXTURES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
