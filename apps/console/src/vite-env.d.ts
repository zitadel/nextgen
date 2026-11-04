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
   * The Zitadel server's origin under the dev loop, where the page runs on
   * Vite's origin and reaches the server through its proxy. Inlined by
   * vite.config.ts through `define`; an empty string in a build.
   */
  readonly CONSOLE_SERVER_ORIGIN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
