// Types for task-runner.mjs, for the TypeScript scripts that import it
// (apps/console/scripts/dev-real.mts). Keep in step with the module.
export type TaskRunner = "moon" | "turbo";

export function taskRunner(env?: NodeJS.ProcessEnv): TaskRunner;

export function runnerCommand(
  targets: readonly string[],
  env?: NodeJS.ProcessEnv,
): { command: string; args: string[] };

export function runnerLabel(targets: readonly string[], env?: NodeJS.ProcessEnv): string;

export function workspaceCommand(
  tasks: readonly string[],
  env?: NodeJS.ProcessEnv,
): { command: string; args: string[] };

export function moonTargetOf(packageName: string, taskName: string): string;
