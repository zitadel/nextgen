import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** Every `.ts` file under `dir`, for a unit test that scans the source tree. */
export async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? sourceFiles(join(dir, entry.name))
        : Promise.resolve(entry.name.endsWith(".ts") ? [join(dir, entry.name)] : []),
    ),
  );
  return nested.flat();
}
