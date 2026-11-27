/**
 * Which packages a knip run asks for, read from its command line as knip
 * reads `--workspace`: `--workspace <x>`, `--workspace=<x>`, `-W <x>` or
 * `-W<x>`, repeatable, each a package name or directory.
 *
 * @param {readonly string[]} argv - The knip process's arguments.
 * @returns {(name: string, dir: string) => boolean} Whether to load a
 *   package's knip config: every package when there is no filter, a filter has
 *   no value, or a filter is a glob or negation; otherwise only those named.
 */
export function wantedWorkspaces(argv) {
  const filters = argv.flatMap((arg, at) => {
    if (arg === "--workspace" || arg === "-W") {
      return [argv[at + 1]];
    }
    if (arg.startsWith("--workspace=")) {
      return [arg.slice("--workspace=".length)];
    }
    if (arg.startsWith("-W")) {
      return [arg.slice("-W".length)];
    }
    return [];
  });
  const exact =
    filters.length > 0 &&
    filters.every((filter) => {
      return typeof filter === "string" && filter !== "" && !/[*?{[!]/.test(filter);
    });
  if (!exact) {
    return () => {
      return true;
    };
  }
  const wanted = new Set(
    filters.map((filter) => {
      return filter.replace(/^\.\//, "").replace(/\/$/, "");
    }),
  );
  return (name, dir) => {
    return wanted.has(name) || wanted.has(dir);
  };
}
