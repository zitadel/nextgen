/// <reference types="vite/client" />

// The build settings the add-on reads. Its own plugin (vite.ts) inlines them
// through `define`, an empty string when unset; none is VITE_-prefixed, for
// the reason the console's vite.config.ts gives.
interface ImportMetaEnv {
  /**
   * The commit the hosted cloud's build comes from (Vercel's
   * `VERCEL_GIT_COMMIT_SHA`), which every console event reports as
   * `console_version` (src/analytics.ts).
   */
  readonly CONSOLE_VERSION: string;
  /**
   * The share of page loads that send Speed Insights, from `0` (none) to `1`
   * (every one, the default when empty); set per environment on Vercel. Web
   * Analytics has no sampling.
   */
  readonly CONSOLE_SPEED_INSIGHTS_SAMPLE_RATE: string;
  /**
   * Vercel's `VERCEL_ENV` the build ran in (`production`, `preview`,
   * `development`), empty outside Vercel; production leaves out the screens
   * whose functions are still mocks (src/index.ts).
   */
  readonly CLOUD_STAGE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
