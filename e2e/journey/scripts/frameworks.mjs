export const frameworkIds = [
  "next",
  "nuxt",
  "react",
  "vue",
  "angular",
  "solid",
  "svelte",
  "qwik",
  "sveltekit",
  "tanstack-start",
  "solid-start",
  "qwik-router",
];

/**
 * Frameworks whose scaffolds and journey definitions are kept, and which can still
 * be run by hand (`--framework sveltekit`), but which the CI fresh-app matrix
 * intentionally skips: their `create-*@latest` scaffolders pull an upstream
 * release the day it ships (SolidStart 2, Qwik 2 already broke the journey once),
 * and a red lane for a reason outside a PR would flake the whole team. Take an id
 * off this list once its scaffold is pinned and has been stable.
 */
export const ciExcludedFrameworkIds = ["sveltekit", "tanstack-start", "solid-start", "qwik-router"];

/** The frameworks the CI fresh-app matrix runs. */
export const ciFrameworkIds = frameworkIds.filter((id) => !ciExcludedFrameworkIds.includes(id));

const viteDevArgs = (port) => ["run", "dev", "--", "--host", "localhost", "--port", String(port)];

export const frameworks = [
  {
    id: "next",
    displayName: "Next.js",
    sdkPackageDir: "packages/sdk-next",
    readyPath: "/login",
    expectsProtectedRouteRedirect: true,
    devServerArgs: (port) => [
      "run",
      "dev",
      "--",
      "--hostname",
      "localhost",
      "--port",
      String(port),
    ],
  },
  {
    id: "nuxt",
    displayName: "Nuxt",
    sdkPackageDir: "packages/sdk-nuxt",
    readyPath: "/login",
    expectsProtectedRouteRedirect: true,
    devServerArgs: viteDevArgs,
  },
  {
    id: "react",
    displayName: "React",
    sdkPackageDir: "packages/sdk-react",
    readyPath: "/login",
    expectsProtectedRouteRedirect: false,
    devServerArgs: viteDevArgs,
  },
  {
    id: "vue",
    displayName: "Vue",
    sdkPackageDir: "packages/sdk-vue",
    readyPath: "/login",
    expectsProtectedRouteRedirect: false,
    devServerArgs: viteDevArgs,
  },
  {
    id: "angular",
    displayName: "Angular",
    sdkPackageDir: "packages/sdk-angular",
    readyPath: "/login",
    expectsProtectedRouteRedirect: false,
    devServerArgs: viteDevArgs,
  },
  {
    id: "solid",
    displayName: "Solid",
    sdkPackageDir: "packages/sdk-solid",
    readyPath: "/login",
    expectsProtectedRouteRedirect: false,
    devServerArgs: viteDevArgs,
  },
  {
    id: "svelte",
    displayName: "Svelte",
    sdkPackageDir: "packages/sdk-svelte",
    readyPath: "/login",
    expectsProtectedRouteRedirect: false,
    devServerArgs: viteDevArgs,
  },
  {
    id: "qwik",
    displayName: "Qwik",
    sdkPackageDir: "packages/sdk-qwik",
    readyPath: "/login",
    expectsProtectedRouteRedirect: false,
    devServerArgs: viteDevArgs,
  },
  {
    id: "sveltekit",
    displayName: "SvelteKit",
    sdkPackageDir: "packages/sdk-sveltekit",
    readyPath: "/login",
    expectsProtectedRouteRedirect: true,
    devServerArgs: viteDevArgs,
  },
  {
    id: "tanstack-start",
    displayName: "TanStack Start",
    sdkPackageDir: "packages/sdk-tanstack-start",
    readyPath: "/login",
    expectsProtectedRouteRedirect: true,
    devServerArgs: viteDevArgs,
  },
  {
    id: "solid-start",
    displayName: "SolidStart",
    sdkPackageDir: "packages/sdk-solid-start",
    readyPath: "/login",
    expectsProtectedRouteRedirect: true,
    devServerArgs: viteDevArgs,
  },
  {
    id: "qwik-router",
    displayName: "Qwik Router",
    sdkPackageDir: "packages/sdk-qwik-router",
    readyPath: "/login",
    expectsProtectedRouteRedirect: true,
    devServerArgs: viteDevArgs,
  },
];

export function frameworkForId(id) {
  const framework = frameworks.find((candidate) => candidate.id === id);
  if (!framework) {
    throw new Error(
      `unsupported journey framework "${id}". Expected one of: ${frameworkIds.join(", ")}`,
    );
  }
  return framework;
}

export function appPortFromUrl(appUrl) {
  const url = new URL(appUrl);
  if (url.port) {
    return Number(url.port);
  }
  return url.protocol === "https:" ? 443 : 80;
}
