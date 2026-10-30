import { type Plugin, loadEnv } from "vite";

/** Where `moon run cloud-functions:dev` answers. */
const defaultFunctionsUrl = "http://localhost:5180";

/**
 * The add-on's part of the console's build (Console ADR 0006 §4), which
 * apps/console/vite.config.ts loads from this folder when `CONSOLE_ADDON`
 * names it: the settings the add-on reads from `import.meta.env`
 * (`src/vite-env.d.ts`), and under the dev server a proxy from the console's
 * origin to the cloud's functions, which the cloud serves on the same origin:
 * the add-on's calls (`src/cloud-api.ts`) and the sign-in widget's. Node runs this file as it is, so it uses only syntax
 * that erasing the types leaves valid.
 */
export default function cloudConsole(): Plugin {
  return {
    name: "zitadel-cloud-console",
    config(config, { command, mode, isPreview }) {
      const env = loadEnv(mode, config.envDir || config.root || process.cwd(), "");
      return {
        define: {
          "import.meta.env.CONSOLE_SPEED_INSIGHTS_SAMPLE_RATE": JSON.stringify(
            speedInsightsSampleRate(env),
          ),
          // The commit Vercel builds the cloud from, reported with every event.
          // It changes with every commit, so the cloud's console build is never
          // restored from the cache, which is why this folder's files need not
          // be inputs of the console's build.
          "import.meta.env.CONSOLE_VERSION": JSON.stringify(env.VERCEL_GIT_COMMIT_SHA ?? ""),
          "import.meta.env.CLOUD_STAGE": JSON.stringify(env.VERCEL_ENV ?? ""),
        },
        server:
          command === "serve" && !isPreview
            ? {
                proxy: {
                  // X-Forwarded-Host keeps the console's host, as Vercel's
                  // edge does: the functions compare `Origin` with it, and
                  // forward it to the server for its CSRF and passkey checks.
                  "/cloud/": {
                    target: env.CLOUD_FUNCTIONS_URL || defaultFunctionsUrl,
                    changeOrigin: true,
                    xfwd: true,
                  },
                },
              }
            : undefined,
      };
    },
  };
}

// Named like the docs' DOCS_SPEED_INSIGHTS_SAMPLE_RATE, without the VITE_
// prefix (the console's vite.config.ts says why). A value outside 0–1 fails
// the build rather than reaching the browser unnoticed.
function speedInsightsSampleRate(env: Record<string, string>): string {
  const name = "CONSOLE_SPEED_INSIGHTS_SAMPLE_RATE";
  const value = env[name] ?? "";
  if (value && !(Number(value) >= 0 && Number(value) <= 1)) {
    throw new Error(`${name} must be a number from 0 to 1, got "${value}".`);
  }
  return value;
}
