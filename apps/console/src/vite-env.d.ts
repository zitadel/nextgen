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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
