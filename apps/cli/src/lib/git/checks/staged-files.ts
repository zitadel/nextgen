/** Lists every file staged under the directory, relative to it, as NUL-separated paths. */
export const STAGED_FILES = ["diff", "--cached", "-z", "--name-only", "--no-renames", "--relative"];
