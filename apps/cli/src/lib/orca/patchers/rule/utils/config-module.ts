import { generateCode, parseModule } from "magicast";
import { getDefaultExportOptions } from "magicast/helpers";
import type { ProxifiedArray, ProxifiedModule, ProxifiedObject } from "magicast";

import { ZitadelError, errorMessage } from "@/lib/errors";
import { tryCatch } from "@/lib/try-catch";

/**
 * A magicast object literal edited by dynamic key. magicast's own types don't
 * model arbitrary keys (the proxy is dynamic), so they read back as `unknown`.
 */
type EditableObject = ProxifiedObject<Record<string, unknown>>;

/** What the parser takes. */
type ParseOptions = Parameters<typeof parseModule>[1];

/** The one member of a raw (babel) top-level statement that {@link ConfigModule} reads. */
interface AstStatement {
  expression?: { type?: string; left?: Parameters<typeof generateCode>[0] };
}

/** An assignment target that exports from a CommonJS module: `module.exports`, `module.exports.x` or `exports.x`. */
const COMMON_JS_EXPORT = /^(module\.exports(\.[^.]+)?|exports\.[^.]+)$/;

/**
 * A config file parsed by magicast, and the reads the config patchers share
 * (Vite, Nuxt, Angular, SvelteKit). It knows nothing about any framework.
 *
 * Every method reads the same way: take a value, guard it with a `throw`
 * that says what to do instead, and repeat, then `return value`.
 */
export class ConfigModule {
  /** The parsed module, for the caller to read exports from and add imports to. */
  readonly module: ProxifiedModule;
  /** The text the module was parsed from. */
  readonly source: string;
  private readonly filename: string;

  private constructor(module: ProxifiedModule, source: string, filename: string) {
    this.module = module;
    this.source = source;
    this.filename = filename;
  }

  /**
   * Parses a config file, or throws `E_VALIDATION` when it is missing,
   * unparseable or CommonJS.
   *
   * @param source - The file's text, or `undefined` when it does not exist.
   * @param filename - Names the file in every error.
   * @param options - Go to the parser, e.g. `{ tabWidth: 1 }` for node offsets
   * that index the source even where it is indented with tabs.
   */
  static open(source: string | undefined, filename: string, options?: ParseOptions): ConfigModule {
    const isMissing = source === undefined;

    if (isMissing) {
      throw new ZitadelError("E_VALIDATION", `Cannot edit ${filename}: file not found`, {
        hint: `Run setup from a project that has ${filename}.`,
      });
    }

    const [error, module] = tryCatch(parseModule, source, options);

    if (error) {
      throw new ZitadelError("E_VALIDATION", `Could not parse ${filename}`, {
        hint: `Ensure ${filename} is valid, or apply the Zitadel changes manually.`,
        details: { cause: errorMessage(error) },
      });
    }

    const ast = module.$ast as { program?: { body?: AstStatement[] }; body?: AstStatement[] };
    const statements = ast.program?.body ?? ast.body ?? [];
    const isCommonJs = statements.some((statement) => {
      const { expression } = statement;
      const target =
        expression?.left && expression.type === "AssignmentExpression"
          ? generateCode(expression.left).code
          : "";

      return COMMON_JS_EXPORT.test(target);
    });

    if (isCommonJs) {
      throw new ZitadelError(
        "E_VALIDATION",
        `${filename} is a CommonJS module, which cannot be edited`,
        {
          hint: `The Zitadel edits use ESM imports. Convert the config to ESM (a .ts/.mts file, or set "type": "module"), or add the Zitadel block manually.`,
        },
      );
    }

    return new ConfigModule(module, source, filename);
  }

  /**
   * The object literal of the default export: the argument of
   * `export default defineConfig({...})`, or a bare `export default {...}`.
   */
  exportedObject(): EditableObject {
    const value = this.module.exports.default ? getDefaultExportOptions(this.module) : undefined;

    if (value?.$type !== "object") {
      throw new ZitadelError(
        "E_VALIDATION",
        `Could not locate the config object in ${this.filename}`,
        {
          hint: `Add the Zitadel configuration to ${this.filename} manually (see the SDK README).`,
        },
      );
    }

    return value;
  }

  /** The object literal at `parent[key]`, which a caller creates first with `parent[key] ??= {}`. */
  objectAt(parent: EditableObject, key: string): EditableObject {
    const value = parent[key] as EditableObject | undefined;

    if (value?.$type !== "object") {
      throw new ZitadelError("E_VALIDATION", `Could not edit "${key}" in the config`, {
        hint: `Set "${key}" to an inline object literal, or add the Zitadel settings manually.`,
      });
    }

    return value;
  }

  /** The string array literal at `parent[key]`, which a caller creates first with `parent[key] ??= []`. */
  arrayAt(parent: EditableObject, key: string): ProxifiedArray<string[]> {
    const value = parent[key] as ProxifiedArray<string[]> | undefined;

    if (value?.$type !== "array") {
      throw new ZitadelError("E_VALIDATION", `Could not edit "${key}" in the config`, {
        hint: `Set "${key}" to an inline array literal, or add the Zitadel settings manually.`,
      });
    }

    return value;
  }

  /**
   * The source to write back: the module's code, ending in a newline, when the
   * patcher changed anything, and the source untouched when it did not, so the
   * file-writer skips it instead of magicast reformatting a patched config.
   * Throws `E_VALIDATION` when the edit left code that no longer parses, rather
   * than writing a broken config.
   */
  render(isChanged: boolean): string {
    const value = isChanged
      ? `${generateCode(this.module).code.replace(/\n$/, "")}\n`
      : this.source;
    const [error] = tryCatch(parseModule, value);

    if (error) {
      throw new ZitadelError("E_VALIDATION", `Could not write ${this.filename}`, {
        hint: `The edit left ${this.filename} unparseable, so apply the Zitadel changes manually.`,
        details: { cause: errorMessage(error) },
      });
    }

    return value;
  }
}
