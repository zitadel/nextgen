/**
 * Which task runner the contributor scripts build through, and how to call it.
 *
 * A few scripts (run-server, run-server-debug, run-cli, the console's
 * dev-real, the journey's local registry) build parts of the workspace
 * through the task graph instead of calling the tools directly, so the
 * graph's dependencies and caches apply. They name their targets in moon's
 * `project:task` form and go through here, which maps them to the runner in
 * use: moon by default, turbo with NEXTGEN_TASK_RUNNER=turbo. That lets both
 * runners be exercised during the dual-run period of
 * docs/design/build/turborepo-migration.md; at the cutover the default flips.
 */

/** Moon project ids whose turbo package is not `@zitadel/<id>`. */
const PACKAGE_OF_PROJECT = new Map([
  ["workspace", "//"],
  ["release", "@zitadel/release"],
  ["bench", "@zitadel/bench"],
]);

/** Moon task names whose package.json script is spelled differently. */
const SCRIPT_OF_TASK = new Map([
  ["dev-real", "dev:real"],
  ["dev-claim", "dev:claim"],
  ["sync-export", "sync:export"],
  ["test-integration", "test:integration"],
]);

export function taskRunner(env = process.env) {
  const runner = env.NEXTGEN_TASK_RUNNER || "moon";
  if (runner !== "moon" && runner !== "turbo") {
    throw new Error(`NEXTGEN_TASK_RUNNER must be "moon" or "turbo", not "${runner}"`);
  }
  return runner;
}

/**
 * The command that runs `targets` (moon `project:task` ids) under the
 * selected runner. Under turbo every named task runs in every named package,
 * so callers pass targets that share one task name (`console:build
 * login-ui:build`), which is what the scripts do.
 */
export function runnerCommand(targets, env = process.env) {
  if (targets.length === 0) {
    throw new Error("runnerCommand needs at least one target");
  }
  if (taskRunner(env) === "moon") {
    return { command: "moon", args: ["run", ...targets] };
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
export function runnerLabel(targets, env = process.env) {
  const { command, args } = runnerCommand(targets, env);
  return [command, ...args].join(" ");
}
