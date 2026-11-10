import * as fsp from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

import { DiskStore } from "@/lib/zitadel";

import { MemoryStore } from "./memory";

/**
 * The calls that arrange what a project holds, written the way `node:fs/promises`
 * writes them, so one set of arranging code serves a disk and memory.
 */
type Arranging = {
  mkdir(path: string, options: { readonly recursive: true }): Promise<unknown>;
  writeFile(path: string, data: string): Promise<void>;
  symlink(target: string, path: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  readFile(path: string, encoding: "utf8"): Promise<string | Buffer>;
};

/**
 * What a test arranges in a project, and reads back from it, whichever store
 * the project is in.
 */
export type Project = {
  /**
   * Put files in the project, creating the directories they need.
   *
   * @param files - The text of each file, by project-relative path.
   */
  write(files: Readonly<Record<string, string>>): Promise<void>;

  /**
   * Put a directory in the project.
   *
   * @param path - The project-relative path.
   */
  directory(path: string): Promise<void>;

  /**
   * Put a symlink in the project.
   *
   * @param target - Where it points: a project-relative path, or an absolute
   *   one, such as the directory {@link Project.outside} gave.
   * @param at - The project-relative path of the link.
   */
  symlink(target: string, at: string): Promise<void>;

  /**
   * Change who may use a file or directory. The `dir` fixture gives a disk's
   * modes back when the test ends, so its temporary directory can be removed.
   *
   * @param path - The project-relative path.
   * @param mode - The mode to set.
   */
  restrict(path: string, mode: number): Promise<void>;

  /**
   * Put files in a directory outside the project.
   *
   * @param files - The text of each file, by path inside that directory.
   * @returns The absolute path of the directory.
   */
  outside(files: Readonly<Record<string, string>>): Promise<string>;

  /**
   * Read a file of the project, as the text it holds.
   *
   * @param path - The project-relative path.
   * @returns The text.
   */
  text(path: string): Promise<string>;
};

/**
 * A store opened for a test, with the project it keeps.
 */
export type Opened = {
  /**
   * The store.
   */
  readonly store: DiskStore | MemoryStore;

  /**
   * What the test arranges in the project and reads back from it.
   */
  readonly project: Project;
};

/**
 * A kind of store a test is run over.
 */
export type Backend = {
  /**
   * The store's class name.
   */
  readonly name: string;

  /**
   * Open an empty project in a store.
   *
   * @param dir - A temporary directory the project may be in.
   * @param other - A second temporary directory, outside the project.
   * @returns The store and its project.
   */
  readonly open: (dir: string, other: string) => Opened;
};

/**
 * Arranging code over one filesystem, rooted at one project and one directory
 * outside it.
 *
 * @param fs - The filesystem's calls.
 * @param root - The project's directory in it.
 * @param elsewhere - A directory in it that is not in the project.
 * @returns The project.
 */
function projectIn(fs: Arranging, root: string, elsewhere: string): Project {
  const place = (path: string): string => {
    return isAbsolute(path) ? path : join(root, path);
  };
  const put = async (base: string, files: Readonly<Record<string, string>>): Promise<void> => {
    for (const [path, text] of Object.entries(files)) {
      await fs.mkdir(dirname(join(base, path)), { recursive: true });
      await fs.writeFile(join(base, path), text);
    }
  };
  return {
    write: (files) => {
      return put(root, files);
    },
    directory: async (path) => {
      await fs.mkdir(place(path), { recursive: true });
    },
    symlink: async (target, at) => {
      await fs.mkdir(dirname(place(at)), { recursive: true });
      await fs.symlink(place(target), place(at));
    },
    restrict: async (path, mode) => {
      await fs.chmod(place(path), mode);
    },
    outside: async (files) => {
      await put(elsewhere, files);
      return elsewhere;
    },
    text: async (path) => {
      return (await fs.readFile(place(path), "utf8")).toString();
    },
  };
}

/**
 * Every store a test of the store contract is run over: the one on a real
 * disk and the one in memory.
 */
export const BACKENDS: readonly Backend[] = [
  {
    name: "DiskStore",
    open: (dir, other) => {
      return { store: new DiskStore(dir), project: projectIn(fsp, dir, other) };
    },
  },
  {
    name: "MemoryStore",
    open: () => {
      const store = new MemoryStore();
      return {
        store,
        project: projectIn(store.volume.promises, MemoryStore.ROOT, "/outside"),
      };
    },
  },
];
