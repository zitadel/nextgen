/**
 * The @zitadel/testing consumer configuration, exactly as the kit README
 * documents it for a customer's app. Deliberately absent: serverBinary and
 * every NEXTGEN_* env var — the `zitadel` CLI resolves the published
 * @zitadel/server binary (embedded UIs included) on its own. Only the ports
 * arrive via env, because the journey runner allocates them.
 */
import { defineConfig } from "@playwright/test";
import { nextAppEnv, withZitadel } from "@zitadel/testing/playwright";

const appPort = Number(process.env.TESTKIT_APP_PORT ?? 3000);
const appOrigin = `http://localhost:${appPort}`;

export default defineConfig({
  testDir: "./zitadel-e2e",
  use: {
    baseURL: appOrigin,
    trace: "on-first-retry",
  },
  ...withZitadel({
    configDir: import.meta.dirname,
    port: Number(process.env.TESTKIT_ZITADEL_PORT ?? 8092),
    appOrigin,
    app: {
      command: ["npm", "run", "dev", "--", "--hostname", "localhost", "--port", String(appPort)],
      cwd: import.meta.dirname,
      readyPath: "/login",
      env: nextAppEnv,
    },
  }),
});
