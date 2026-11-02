import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Temp directories a test makes, all removed by one `clean()` in an `afterEach`. */
export const tempDirs = (): {
  make: (prefix: string) => Promise<string>;
  clean: () => Promise<void>;
} => {
  const made: string[] = [];
  return {
    async make(prefix) {
      const dir = await mkdtemp(join(tmpdir(), prefix));
      made.push(dir);
      return dir;
    },
    async clean() {
      await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
    },
  };
};
