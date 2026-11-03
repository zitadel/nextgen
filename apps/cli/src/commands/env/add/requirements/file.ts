import { stat } from "node:fs/promises";
import { join } from "node:path";

import { requirement, unmet } from "../../../../lib/oclif/requirements";

/** The file an environment is written to, and its path in the project. */
type EnvironmentFile = {
  readonly file: string;
  readonly path: string;
};

/**
 * The `.env.<name>.local` file `env add` writes. One that already exists is a
 * conflict unless `--force` says it may be overwritten.
 */
export const environmentFile = requirement<EnvironmentFile>({
  refusal: {
    code: "E_CONFLICT",
    message: "{file} already exists",
    hint: "Pass --force to overwrite it.",
  },
  resolve: async ({ args, flags, meta }) => {
    const file = `.env.${String(args.name)}.local`;
    const path = join(meta.cwd, file);
    const exists = await stat(path).then(
      () => {
        return true;
      },
      () => {
        return false;
      },
    );
    if (exists && flags.force !== true) {
      return unmet({
        file,
      });
    }
    return {
      file,
      path,
    };
  },
});
