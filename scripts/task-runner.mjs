/**
 * How the contributor scripts run tasks through turbo.
 *
 * A few scripts (run-server, run-server-debug, run-cli, run-cloud, the
 * console's dev-real, the journey's local registry, check) build parts of the
 * workspace through the task graph instead of calling the tools directly, so
 * the graph's dependencies and caches apply. They name their targets as
 * `project:task` (`server:build`, `release:pack`), which this maps to a
 * `turbo run` over the matching packages.
 */

/**
 * Projects whose turbo package is not `@zitadel/<id>`. Turbo names a Go
 * module's package after its module path (go.work, turbo.json).
 */
const PACKAGE_OF_PROJECT = new Map([
  ["workspace", "//"],
  ["release", "@zitadel/release"],
  ["bench", "bench"],
  ["go", "zitadel/v5"],
  ["oidc-mock", "oidc-mock"],
]);

/** Task names whose package.json script is spelled differently. */
const SCRIPT_OF_TASK = new Map([
  ["dev-real", "dev:real"],
  ["dev-claim", "dev:claim"],
  ["sync-export", "sync:export"],
  ["test-integration", "test:integration"],
  ["test-postgres", "test:postgres"],
  ["test-spanner", "test:spanner"],
  ["test-sqlite", "test:sqlite"],
]);

/**
 * The command that runs `targets` (`project:task` ids). Turbo runs every
 * named task in every named package, so callers pass targets that share one
 * task name (`sdk-react:build components:build`), which is what the scripts
 * do.
 */
export function runnerCommand(targets) {
  if (targets.length === 0) {
    throw new Error("runnerCommand needs at least one target");
  }
  const tasks = new Set();
  const filters = new Set();
  for (const target of targets) {
    const [project, task, ...rest] = target.split(":");
    if (!project || !task || rest.length > 0) {
      throw new Error(`not a project:task target: ${target}`);
    }
    tasks.add(SCRIPT_OF_TASK.get(task) ?? task);
    filters.add(PACKAGE_OF_PROJECT.get(project) ?? `@zitadel/${project}`);
  }
  return {
    command: "turbo",
    args: ["run", ...tasks, ...[...filters].map((filter) => `--filter=${filter}`)],
  };
}

/** The command line as a person would type it, for log lines. */
export function runnerLabel(targets) {
  const { command, args } = runnerCommand(targets);
  return [command, ...args].join(" ");
}

/**
 * The command that runs the named tasks across the whole workspace. Turbo runs
 * every task and lets the cache skip the unchanged ones; CI also selects with
 * `--affected` from the pull request's base (scripts/ci.sh), which a local run
 * has no reliable equivalent of.
 */
export function workspaceCommand(tasks) {
  return { command: "turbo", args: ["run", ...tasks, "--continue=dependencies-successful"] };
}
