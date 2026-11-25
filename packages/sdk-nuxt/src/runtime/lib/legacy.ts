/**
 * The places an app may still carry a setting of the old `nextgen` configuration.
 */
export interface LegacySources {
  /**
   * The process environment to scan for `NUXT_NEXTGEN_*` and `NUXT_PUBLIC_NEXTGEN_*`
   * variables.
   */
  readonly env: Readonly<Record<string, string | undefined>>;
  /**
   * The `nextgen` key of `nuxt.config.ts`, which the module no longer reads.
   */
  readonly nextgen?: unknown;
  /**
   * The private `runtimeConfig` object, searched for the old `nextgen` key.
   */
  readonly runtimeConfig?: Record<string, unknown>;
  /**
   * The `runtimeConfig.public` object, searched for `nextgenProxyPath` and `nextgenApiBase`.
   */
  readonly publicConfig?: Record<string, unknown>;
}

/**
 * Lists the settings of the old `nextgen` configuration that an app still carries.
 *
 * The configuration key was renamed from `nextgen` to `zitadel`, together with the
 * `NUXT_NEXTGEN_*` and `NUXT_PUBLIC_NEXTGEN_*` environment variables and the public
 * `nextgenProxyPath` and `nextgenApiBase` runtime settings. Nuxt does not complain about a key
 * nothing reads, so an app that kept an old name would lose the setting silently, including
 * `protectedRoutes`, and its protected pages would open to signed-out visitors. The module calls
 * this while it loads, which sees the environment of the build, and the server handler calls it
 * when the server starts, which sees the environment the server runs in. A variable set only
 * on the running server is caught by the second call only.
 *
 * @param sources - Where to look for the old settings.
 * @returns One line per old setting found, or an empty list when the app uses the new names.
 */
export function legacyConfigProblems(sources: LegacySources): string[] {
  const problems: string[] = [];
  if (sources.nextgen !== undefined) {
    problems.push("the `nextgen` key in nuxt.config.ts is now `zitadel`");
  }
  if (sources.runtimeConfig?.nextgen !== undefined) {
    problems.push("runtimeConfig.nextgen is now runtimeConfig.zitadel");
  }
  for (const name of ["nextgenProxyPath", "nextgenApiBase"]) {
    if (sources.publicConfig?.[name] !== undefined) {
      problems.push(
        `runtimeConfig.public.${name} is now runtimeConfig.public.${name.replace("nextgen", "zitadel")}`,
      );
    }
  }
  for (const name of Object.keys(sources.env)) {
    if (name.startsWith("NUXT_NEXTGEN_") || name.startsWith("NUXT_PUBLIC_NEXTGEN_")) {
      problems.push(`${name} is now ${name.replace("NEXTGEN_", "ZITADEL_")}`);
    }
  }
  return problems;
}

/**
 * Throws when an app still carries a setting of the old `nextgen` configuration.
 *
 * @param sources - Where to look for the old settings.
 * @throws {Error} Naming each old setting and its replacement.
 */
export function refuseLegacyConfig(sources: LegacySources): void {
  const problems = legacyConfigProblems(sources);
  if (problems.length > 0) {
    throw new Error(
      `[zitadel] The Nuxt module was renamed from "nextgen" to "zitadel", and these settings are ` +
        `no longer read, so routes in \`protectedRoutes\` would not be protected: ` +
        `${problems.join("; ")}.`,
    );
  }
}
