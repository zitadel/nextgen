import { ZitadelError } from "../../../../errors";
import { withLfLineEnds } from "../utils/line-ends";
import { parseConfigModule } from "../utils/magicast";

/**
 * The settings the hook passes to `createNextgenHandle`, read from
 * `$app/env/private`. SvelteKit keeps a declared variable server-only unless it
 * is marked `public`, and shows the description on hover.
 */
const HOOK_VARIABLES = [
  { name: "ZITADEL_URL", description: "The Zitadel server the hook proxies /__nextgen to." },
  {
    name: "ZITADEL_PROJECT_SECRET",
    description: "The project's service key, sent on the session exchange only.",
  },
  { name: "ZITADEL_PROJECT_ID", description: "The project whose sessions count as signed in." },
] as const;

/** What the edit and its errors call the file it reads. */
const ENV_LABEL = "src/env.ts";

/** One `defineEnvVars` entry, e.g. `ZITADEL_URL: { description: "…" }`. */
function entry(variable: (typeof HOOK_VARIABLES)[number]): string {
  return `${variable.name}: { description: ${JSON.stringify(variable.description)} }`;
}

/**
 * `src/env.ts` for an app that has none: declares the hook's three settings, so
 * SvelteKit 3 serves them from `$app/env/private`, from `.env.local` in dev and
 * from the platform's environment in production. A missing one fails each
 * request with an error naming it, rather than the hook falling back to a
 * default backend. It carries no managed marker: SvelteKit reads every env
 * variable an app declares from this one file, so the developer's own entries
 * belong in it too.
 */
export function envTemplate(): string {
  return `import { defineEnvVars } from "@sveltejs/kit/env";

export const variables = defineEnvVars({
${HOOK_VARIABLES.map((variable) => `  ${entry(variable)},`).join("\n")}
});
`;
}

/** The slice of a babel AST node {@link envVarsEdit} reads. */
interface AstNode {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  /** An object property's key: an identifier's `name`, a string literal's `value`. */
  readonly key?: { readonly name?: string; readonly value?: unknown };
  readonly properties?: ReadonlyArray<AstNode>;
}

/**
 * Builds the `edit` transform for the app's env declarations (`src/env.ts`, or
 * an existing `src/env.js`): writes {@link envTemplate} when the app has none,
 * and otherwise adds whichever of the hook's settings its
 * `defineEnvVars({ ... })` call lacks after the last entry, at that entry's
 * indentation, leaving the rest of the file as it is. Idempotent: a file that
 * declares all three is returned untouched, which is how the doctor reads the
 * wiring as applied. Line ends are the file's own. Throws `E_VALIDATION` when
 * the file does not export `variables` as an object literal or as a call with
 * one as its argument, with a hint to declare the three by hand.
 */
export function envVarsEdit(): (source: string | undefined) => string {
  return (source) => {
    if (source === undefined) {
      return envTemplate();
    }
    return withLfLineEnds(source, (text) => {
      const object = variablesObject(text);
      const properties = object.properties ?? [];
      const missing = HOOK_VARIABLES.filter(
        (variable) => !properties.some((property) => keyOf(property) === variable.name),
      );
      if (missing.length === 0) {
        return text;
      }
      const last = properties.at(-1);
      if (!last) {
        // `defineEnvVars({})`: one entry per line, a level in from the call.
        const lineStart = text.lastIndexOf("\n", object.start - 1) + 1;
        const indent = /^[\t ]*/.exec(text.slice(lineStart))?.[0] ?? "";
        const unit = /^\t/m.test(text) ? "\t" : "  ";
        const body = missing.map((variable) => `${indent}${unit}${entry(variable)},\n`).join("");
        return `${text.slice(0, object.start)}{\n${body}${indent}}${text.slice(object.end)}`;
      }
      const lineStart = text.lastIndexOf("\n", last.start - 1) + 1;
      // An object written on one line stays on one line.
      const separator =
        lineStart <= object.start
          ? ", "
          : `,\n${/^[\t ]*/.exec(text.slice(lineStart, last.start))?.[0] ?? ""}`;
      const added = missing.map((variable) => `${separator}${entry(variable)}`).join("");
      return `${text.slice(0, last.end)}${added}${text.slice(last.end)}`;
    });
  };
}

/**
 * The slice of a magicast proxy {@link variablesObject} reads. magicast's
 * published types don't model a named export, so it is described here.
 */
interface ProxyNode {
  readonly $type?: string;
  readonly $args?: ReadonlyArray<ProxyNode | undefined>;
  readonly $ast?: unknown;
}

/** The object literal of `export const variables`, read from `text` (LF line ends). */
function variablesObject(text: string): AstNode {
  // At tabWidth 1 the node offsets index the source itself; at recast's
  // default a tab counts as four, which a tab-indented file would expose.
  const mod = parseConfigModule(text, ENV_LABEL, { tabWidth: 1 });
  const variables = (mod.exports as { variables?: ProxyNode } | undefined)?.variables;
  const object = variables?.$type === "function-call" ? variables.$args?.[0] : variables;
  if (object?.$type !== "object") {
    throw new ZitadelError(
      "E_VALIDATION",
      `Could not find the env variables ${ENV_LABEL} declares`,
      {
        hint: `Export them as \`export const variables = defineEnvVars({ ... })\` from @sveltejs/kit/env, or declare ${HOOK_VARIABLES.map((variable) => variable.name).join(", ")} there by hand.`,
      },
    );
  }
  return object.$ast as AstNode;
}

/** The key an object literal property declares, if it is a plain one. */
function keyOf(property: AstNode): unknown {
  return property.type === "ObjectProperty" || property.type === "ObjectMethod"
    ? (property.key?.name ?? property.key?.value)
    : undefined;
}
