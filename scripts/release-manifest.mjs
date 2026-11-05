export const SERVER_PLATFORM_PACKAGES = [
  {
    goos: "linux",
    goarch: "amd64",
    packageName: "@zitadel/server-linux-x64",
    packageDir: "apps/server-linux-x64",
  },
  {
    goos: "linux",
    goarch: "arm64",
    packageName: "@zitadel/server-linux-arm64",
    packageDir: "apps/server-linux-arm64",
  },
  {
    goos: "darwin",
    goarch: "amd64",
    packageName: "@zitadel/server-darwin-x64",
    packageDir: "apps/server-darwin-x64",
  },
  {
    goos: "darwin",
    goarch: "arm64",
    packageName: "@zitadel/server-darwin-arm64",
    packageDir: "apps/server-darwin-arm64",
  },
  {
    goos: "windows",
    goarch: "amd64",
    packageName: "@zitadel/server-win32-x64",
    packageDir: "apps/server-win32-x64",
  },
];

export const PUBLIC_RELEASE_PACKAGES = [
  {
    name: "@zitadel/cli",
    dir: "apps/cli",
    moonProject: "cli",
    buildTarget: "cli:build-release",
  },
  {
    name: "@zitadel/server",
    dir: "apps/server",
    moonProject: "server",
  },
  ...SERVER_PLATFORM_PACKAGES.map((platform) => ({
    name: platform.packageName,
    dir: platform.packageDir,
  })),
  {
    name: "@zitadel/api",
    dir: "packages/api",
    moonProject: "api",
    buildTarget: "api:build-release",
  },
  {
    name: "@zitadel/config",
    dir: "packages/config",
    moonProject: "config",
    buildTarget: "config:build-release",
  },
  {
    name: "@zitadel/components",
    dir: "packages/components",
    moonProject: "components",
    buildTarget: "components:build-release",
  },
  {
    name: "@zitadel/sdk-core",
    dir: "packages/sdk-core",
    moonProject: "sdk-core",
    buildTarget: "sdk-core:build-release",
  },
  {
    name: "@zitadel/sdk-next",
    dir: "packages/sdk-next",
    moonProject: "sdk-next",
    buildTarget: "sdk-next:build-release",
  },
  {
    name: "@zitadel/sdk-nuxt",
    dir: "packages/sdk-nuxt",
    moonProject: "sdk-nuxt",
    buildTarget: "sdk-nuxt:build-release",
  },
  {
    name: "@zitadel/sdk-react",
    dir: "packages/sdk-react",
    moonProject: "sdk-react",
    buildTarget: "sdk-react:build-release",
  },
  {
    name: "@zitadel/sdk-vue",
    dir: "packages/sdk-vue",
    moonProject: "sdk-vue",
    buildTarget: "sdk-vue:build-release",
  },
  {
    name: "@zitadel/sdk-angular",
    dir: "packages/sdk-angular",
    moonProject: "sdk-angular",
    buildTarget: "sdk-angular:build-release",
  },
  {
    name: "@zitadel/sdk-solid",
    dir: "packages/sdk-solid",
    moonProject: "sdk-solid",
    buildTarget: "sdk-solid:build-release",
  },
  {
    name: "@zitadel/sdk-svelte",
    dir: "packages/sdk-svelte",
    moonProject: "sdk-svelte",
    buildTarget: "sdk-svelte:build-release",
  },
  {
    name: "@zitadel/sdk-qwik",
    dir: "packages/sdk-qwik",
    moonProject: "sdk-qwik",
    buildTarget: "sdk-qwik:build-release",
  },
  {
    name: "@zitadel/sdk-sveltekit",
    dir: "packages/sdk-sveltekit",
    moonProject: "sdk-sveltekit",
    buildTarget: "sdk-sveltekit:build-release",
  },
  {
    name: "@zitadel/sdk-solid-start",
    dir: "packages/sdk-solid-start",
    moonProject: "sdk-solid-start",
    buildTarget: "sdk-solid-start:build-release",
  },
  {
    name: "@zitadel/sdk-qwik-router",
    dir: "packages/sdk-qwik-router",
    moonProject: "sdk-qwik-router",
    buildTarget: "sdk-qwik-router:build-release",
  },
  {
    name: "@zitadel/sdk-tanstack-start",
    dir: "packages/sdk-tanstack-start",
    moonProject: "sdk-tanstack-start",
    buildTarget: "sdk-tanstack-start:build-release",
  },
  {
    name: "@zitadel/testing",
    dir: "packages/testing",
    moonProject: "testing",
    buildTarget: "testing:build-release",
  },
];

export const PUBLIC_PACKAGE_DIRS = PUBLIC_RELEASE_PACKAGES.map((pkg) => pkg.dir);
export const PUBLIC_PACKAGE_NAMES = PUBLIC_RELEASE_PACKAGES.map((pkg) => pkg.name);
export const PUBLIC_PACKAGE_BUILD_TARGETS = PUBLIC_RELEASE_PACKAGES.map(
  (pkg) => pkg.buildTarget,
).filter(Boolean);

// What `setup` installs into a generated app: the SDKs and the packages they
// depend on, not the CLI, the server or the test kit (which depends on the
// CLI). The contributor CLI wrapper (scripts/run-cli.mjs) publishes only
// these, from their cached dev builds, to its local registry.
export const APP_RELEASE_PACKAGES = PUBLIC_RELEASE_PACKAGES.filter(
  (pkg) =>
    !["@zitadel/cli", "@zitadel/testing"].includes(pkg.name) &&
    !pkg.name.startsWith("@zitadel/server"),
);
