// Types for task-runner.mjs, for the TypeScript scripts that import it
// (apps/console/scripts/dev-real.mts). Keep in step with the module.
export function runnerCommand(targets: readonly string[]): { command: string; args: string[] };

export function runnerLabel(targets: readonly string[]): string;

export function workspaceCommand(tasks: readonly string[]): { command: string; args: string[] };
