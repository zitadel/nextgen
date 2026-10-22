import { stripVTControlCharacters } from "node:util";
import { createLogger, type Logger, type Plugin, type ResolvedConfig } from "vite";

import { PLUGIN_PREFIX } from "./defaults.ts";

/** The parts of a bundler log or warning the warning policy reads. */
export interface BuildLog {
  readonly code?: string;
  /** A plugin warning's own code: the bundler files the log itself under `PLUGIN_WARNING`. */
  readonly pluginCode?: unknown;
  readonly id?: string;
  readonly message: string;
}

/** Log codes that are reports, not problems: never a failure. */
export const REPORT_CODES: readonly string[] = ["PLUGIN_TIMINGS"];

/** Whether `code` is a report or listed in `allow`. */
export function isAllowed(code: string | undefined, allow: readonly string[]): boolean {
  return code !== undefined && (REPORT_CODES.includes(code) || allow.includes(code));
}

/**
 * Whether a build has failed so far. Rolldown reports the warnings a format raises only after its
 * files are written, and `closeBundle` runs (without the error) after a failed build too: the
 * steps that run after the bundle read this instead, so a failed build leaves no declarations or
 * further builds behind. It describes one build: every build (each rebuild under `--watch`)
 * starts it over.
 */
export interface BuildOutcome {
  failed: boolean;
}

/** Whether a log is allowed by its code, or a plugin warning by the code its plugin gave it. */
function isAllowedLog(log: BuildLog, allow: readonly string[]): boolean {
  return (
    isAllowed(log.code, allow) ||
    (typeof log.pluginCode === "string" && isAllowed(log.pluginCode, allow))
  );
}

/** The error a disallowed warning fails the build with, named by the code that would allow it. */
function failure(log: BuildLog): Error {
  const code = typeof log.pluginCode === "string" ? log.pluginCode : log.code;
  return new Error(`${code ?? "warning"}: ${log.message}`);
}

/**
 * The warnings-as-errors policy of the module build: every warning fails it, except reports and
 * the codes in `allow`. Both hooks are needed: some warnings (e.g. EMPTY_IMPORT_META, raised
 * while a format renders) never reach `onwarn`. A failure is recorded in `outcome`.
 */
export function failOnWarnings(
  allow: readonly string[],
  outcome: BuildOutcome = { failed: false },
) {
  const fail = (log: BuildLog): never => {
    outcome.failed = true;
    throw failure(log);
  };
  return {
    onLog<L extends string, T extends BuildLog>(
      level: L,
      log: T,
      handler: (level: L, log: T) => void,
    ): void {
      if (level === "warn" && !isAllowedLog(log, allow)) fail(log);
      handler(level, log);
    },
    onwarn(warning: BuildLog): void {
      if (!isAllowedLog(warning, allow)) fail(warning);
    },
  };
}

/**
 * The warning policy of a declaration pass, a Rolldown build run after the JS one: the JS build's
 * (see {@link failOnWarnings}), except that a timing report, the JS build's to print, is dropped.
 */
export function failOnDeclarationWarnings(allow: readonly string[]) {
  const policy = failOnWarnings(allow);
  return <L extends string, T extends BuildLog>(
    level: L,
    log: T,
    handler: (level: L, log: T) => void,
  ): void => {
    if (log.code && REPORT_CODES.includes(log.code)) return;
    policy.onLog(level, log, handler);
  };
}

/** Name of the plugin that carries a build's {@link BuildOutcome} (see {@link afterBuild}). */
export const WARNINGS_PLUGIN = `${PLUGIN_PREFIX}:warnings`;

/** What the warnings plugin shares with the other plugins of its build. */
export interface WarningsApi {
  readonly outcome: BuildOutcome;
}

/**
 * Vite's own warnings (config deprecations, an output option Vite ignores, a chunk-size report)
 * go to its logger, never to Rolldown's `onLog`. `customLogger` records each one (and prints it
 * at the configured `logLevel`); `plugin` fails the build on them: those logged while the config
 * resolved at `buildStart`, the rest once the bundle is written, before any step that runs after
 * it. The plugin also carries the build's {@link BuildOutcome}.
 */
export function failOnLoggedWarnings(outcome: BuildOutcome): {
  readonly customLogger: Logger;
  readonly plugin: Plugin;
} {
  // `customLogger` replaces Vite's own logger and with it `logLevel`: the level is read in `config`.
  let base = createLogger();
  const warnings: string[] = [];
  const record = (message: string): void => {
    warnings.push(stripVTControlCharacters(message).trim());
  };
  const customLogger: Logger = {
    info: (message, options) => base.info(message, options),
    warn: (message, options) => {
      record(message);
      base.warn(message, options);
    },
    warnOnce: (message, options) => {
      record(message);
      base.warnOnce(message, options);
    },
    error: (message, options) => base.error(message, options),
    clearScreen: (type) => base.clearScreen(type),
    hasErrorLogged: (error) => base.hasErrorLogged(error),
    get hasWarned() {
      return base.hasWarned;
    },
  };
  const check = (): void => {
    if (warnings.length === 0) return;
    outcome.failed = true;
    throw new Error(`Vite warned:\n${warnings.splice(0).join("\n")}`);
  };
  // A failed build's own error is its report: the warnings it logged go with it, not into the next build.
  const failed = (): void => {
    outcome.failed = true;
    warnings.length = 0;
  };
  const plugin: Plugin & { api: WarningsApi } = {
    name: WARNINGS_PLUGIN,
    apply: "build",
    api: { outcome },
    config(config) {
      base = createLogger(config.logLevel, { allowClearScreen: config.clearScreen });
    },
    buildStart: {
      order: "pre",
      handler() {
        outcome.failed = false;
        check();
      },
    },
    buildEnd(error) {
      if (error) failed();
    },
    renderError: failed,
    closeBundle: { order: "pre", handler: check },
  };
  return { customLogger, plugin };
}

/** A plugin that reads its build's {@link BuildOutcome} once the bundle is closed and hands it to `run`. */
function onClose(
  name: string,
  run: (config: ResolvedConfig, failed: boolean) => unknown,
  options: Omit<
    Plugin,
    "name" | "apply" | "configResolved" | "buildStart" | "buildEnd" | "renderError" | "closeBundle"
  > = {},
): Plugin {
  let config: ResolvedConfig | undefined;
  let outcome: BuildOutcome = { failed: false };
  // Without a warnings plugin, this step keeps the outcome itself, and starts it over every build.
  let own = true;
  return {
    ...options,
    name,
    apply: "build",
    configResolved(resolved) {
      config = resolved;
      const shared = resolved.plugins.find((p) => p.name === WARNINGS_PLUGIN)?.api as
        | WarningsApi
        | undefined;
      if (shared) outcome = shared.outcome;
      own = !shared;
    },
    buildStart: {
      order: "pre",
      handler() {
        if (own) outcome.failed = false;
      },
    },
    buildEnd(error) {
      if (error) outcome.failed = true;
    },
    renderError() {
      outcome.failed = true;
    },
    async closeBundle() {
      if (config) await run(config, outcome.failed);
    },
  };
}

/**
 * A step that runs once the bundle is written (declarations, copies, a further build), skipped
 * when the build failed: `closeBundle` also runs after a failed build, and a step run then would
 * leave a half-built package behind or hide the real error behind its own. The build's outcome
 * comes from the warnings plugin of `nuxtModule()` when the build has one.
 */
export function afterBuild(
  name: string,
  step: (config: ResolvedConfig) => unknown,
  options: Parameters<typeof onClose>[2] = {},
): Plugin {
  return onClose(name, (config, failed) => (failed ? undefined : step(config)), options);
}
