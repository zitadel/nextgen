/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Same-origin base path for API requests. Defaults to `/api`. */
  readonly VITE_CONSOLE_API_BASE?: string;
  /** Non-secret project id used to scope list/detail API calls. */
  readonly VITE_CONSOLE_PROJECT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
