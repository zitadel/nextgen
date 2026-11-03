import type { Target } from "../../../lib/api/operations";
import { type PathValues, pathValuesOf } from "../../../lib/api/request";
import { requirement } from "../../../lib/oclif/requirements";
import type { Chosen } from "./operation";

/**
 * Every path parameter's value the command line gives: from the path itself
 * when the target was a path, else from the words after the operation in the
 * order the path has them, with a `project_id` left out filled from the project
 * at hand. It refuses a word too many, and one given both in the path and as an
 * argument. The names still without a value are asked for, so they are reported
 * rather than refused. An operation still to be chosen takes no words.
 */
export function pathValuesFromWords(
  target: Target | undefined,
  argv: readonly string[],
  named: boolean,
  projectId: string | undefined,
): PathValues {
  if (target === undefined) {
    return {
      values: {},
      missing: [],
    };
  }
  return pathValuesOf(target, argv.slice(named ? 1 : 0), projectId);
}

export const apiPath = requirement<PathValues>({
  resolve: async ({ args, argv, resolved }) =>
    pathValuesFromWords(
      (resolved.operation as Chosen).target,
      argv,
      args.operation !== undefined,
      (resolved.secret as { secret?: { project_id: string } }).secret?.project_id,
    ),
});
