import sortKeys from "sort-keys";

import { ZitadelError } from "@/lib/errors";
import { isObject, parseJsonObject, setTopLevelJsonKey } from "@/lib/json";
import {
  type Change,
  Operation,
  type Source,
} from "@/lib/orca/patchers/rule/file-writer/operation";

/**
 * Adds a dependency to `package.json`.
 *
 * The file is user-owned, so only the dependency map's value is spliced into the
 * document: every byte outside it stays untouched, and the map itself is
 * name-sorted, as a package manager writes it.
 *
 * A package the app needs at runtime stays in `dependencies`: a dev add never
 * demotes it, because that would break `--omit=dev` installs. A package listed
 * in both sections is never intended, and some toolchains refuse it outright,
 * so a `devDependencies` entry the developer already has moves into
 * `dependencies` instead of being duplicated. `peerDependencies` and
 * `optionalDependencies` are the developer's and are left alone.
 */
export class AddDepOp extends Operation<"add-dep"> {
  /**
   * @returns The `package.json` to add to.
   */
  protected target(): ReadonlyArray<string> {
    return ["package.json"];
  }

  /**
   * @returns `package.json` with the dependency added, or as it is when the
   * dependency is already where it belongs.
   * @throws `E_VALIDATION` when there is no `package.json`.
   */
  protected change(source: Source): Change {
    const { name, version, dev = false } = this.op;
    const extras = {
      dependency: name,
    };
    const text = source.before || "{}";
    const document = parseJsonObject(text, source.path);
    const home = dev ? "devDependencies" : "dependencies";
    const other = dev ? "dependencies" : "devDependencies";
    const owned = isObject(document[home]) ? document[home] : {};
    const foreign = isObject(document[other]) ? document[other] : {};
    const isForeign = Object.hasOwn(foreign, name);
    const isCurrent = owned[name] === version;
    const isNoop = dev ? isForeign || isCurrent : isCurrent && !isForeign;
    const added = setTopLevelJsonKey(
      text,
      source.path,
      home,
      sortKeys({
        ...owned,
        [name]: version,
      }),
    );
    const pruned = setTopLevelJsonKey(
      added,
      source.path,
      other,
      Object.fromEntries(
        Object.entries(foreign).filter(([key]) => {
          return key !== name;
        }),
      ),
    );

    if (!source.before) {
      throw new ZitadelError(
        "E_VALIDATION",
        "package.json is required to add Zitadel dependencies",
      );
    }
    if (isNoop) {
      return this.file(source, text, extras);
    }
    if (dev || !isForeign) {
      return this.file(source, added, extras);
    }

    return this.file(source, pruned, extras);
  }
}
