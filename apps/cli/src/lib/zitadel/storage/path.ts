import { dirname, relative, resolve, sep } from "node:path";

import type { FileSystem } from "@/lib/zitadel/storage/types";

/**
 * An absolute, normalised filesystem path, as a value: every operation returns
 * a new one, so a path is never changed in place.
 *
 * @remarks
 * Hand-rolled because no well-supported npm package fits. `node:path`,
 * `pathe` and `upath` are functions over strings, which is what this replaces;
 * `path-scurry`, the one widely used object-oriented API (glob's), is a
 * filesystem walker whose path objects are mutable and cache what they find on
 * disk, so they go stale under a store that writes, and it has no notion of
 * one path containing another. Everything here but {@link Path.resolveReal} is pure.
 */
export class Path {
  /**
   * The path as `path.resolve` spells it: absolute, normalised, and with the
   * platform's separator.
   */
  private readonly value: string;

  /**
   * Wraps a path that is already absolute and normalised; {@link Path.of}
   * makes one from anything else.
   *
   * @param value - The path, already absolute and normalised.
   */
  private constructor(value: string) {
    this.value = value;
  }

  /**
   * A path from segments, resolved right to left as `path.resolve` does: an
   * absolute segment starts over, and the working directory is the base when
   * none is absolute.
   *
   * @param segments - The segments.
   * @returns The path.
   */
  static of(...segments: readonly string[]): Path {
    return new Path(resolve(...segments));
  }

  /**
   * The directory this path is in; the filesystem root is its own parent.
   *
   * @returns The parent.
   */
  get parent(): Path {
    return new Path(dirname(this.value));
  }

  /**
   * Every directory above this path, nearest first, up to the filesystem root.
   *
   * @returns The ancestors, or none for the filesystem root.
   */
  get ancestors(): readonly Path[] {
    const parent = this.parent;
    if (parent.equals(this)) {
      return [];
    }
    return [parent, ...parent.ancestors];
  }

  /**
   * A path resolved against this one as a directory, so a relative segment
   * lands beneath it and `..` climbs out of it.
   *
   * @param segments - The segments, such as a `$file` reference as written.
   * @returns The resolved path.
   */
  resolve(...segments: readonly string[]): Path {
    return Path.of(this.value, ...segments);
  }

  /**
   * Whether another path is this one or lies anywhere beneath it. It compares
   * whole segments, so `/a/bc` is not inside `/a/b`.
   *
   * @param other - The path to test.
   * @returns Whether it is inside.
   */
  contains(other: Path): boolean {
    return [other, ...other.ancestors].some((path) => {
      return path.equals(this);
    });
  }

  /**
   * Whether another path is this same path.
   *
   * @param other - The path to compare.
   * @returns Whether both spell the same path.
   */
  equals(other: Path): boolean {
    return other.value === this.value;
  }

  /**
   * This path relative to a base, spelled with `/` whatever the platform, the
   * way the library spells a project-relative path.
   *
   * @param base - The directory to be relative to.
   * @returns The relative path, with `..` segments when it is not beneath the
   *   base, and empty when it is the base.
   */
  relativeTo(base: Path): string {
    return relative(base.value, this.value).split(sep).join("/");
  }

  /**
   * Resolve this path with every symlink on it, symlinked parent directories
   * included, even when its last segments do not exist yet. Unlike the rest of
   * the class, this reads a filesystem.
   *
   * @param fs - The filesystem the path is in.
   * @returns The real path, or `undefined` when a segment is a symlink that
   *   resolves nowhere, since what it names could be anywhere.
   */
  resolveReal(fs: Pick<FileSystem, "existsSync" | "lstatSync" | "realpathSync">): Path | undefined {
    const lineage = [this, ...this.ancestors];
    const missing = lineage.filter((path) => {
      return !fs.existsSync(path.value);
    });
    const dangling = missing.some((path) => {
      try {
        return fs.lstatSync(path.value).isSymbolicLink();
      } catch {
        // Nothing there, or a file where a directory would be: no link either way.
        return false;
      }
    });
    if (dangling) {
      return undefined;
    }
    // Whatever exists, exists from the root down, so the first one that is
    // not missing is the nearest; the filesystem root always is.
    const nearest = lineage[missing.length] ?? this;
    return Path.of(fs.realpathSync(nearest.value).toString(), this.relativeTo(nearest));
  }

  /**
   * The path as a string, for the `node:fs` call that takes it.
   *
   * @returns The absolute path.
   */
  toString(): string {
    return this.value;
  }
}
