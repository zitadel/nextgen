import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MANDATORY_GATES_TAG } from "@zitadel/config/template";
import {
  AssignTag,
  CaseTag,
  CommentTag,
  filters as builtinFilters,
  ForTag,
  IfTag,
  Liquid,
  Output,
  Tag,
  TypeGuards,
  UnlessTag,
  type Template,
  type Token,
  type Value,
} from "liquidjs";

/**
 * The structural plugin shape both Vite and Rolldown (tsdown) accept.
 */
type LiquidPlugin = {
  /**
   * The plugin's name in build output.
   */
  name: string;
  /**
   * Runs before Vite's own loaders, which would parse Liquid as JavaScript.
   */
  enforce: "pre";
  /**
   * Tags `.liquid` imports with a virtual prefix.
   */
  resolveId: (
    this: {
      resolve: (
        source: string,
        importer: string,
        options: object,
      ) => Promise<{ id: string } | null>;
    },
    source: string,
    importer: string | undefined,
    options: object,
  ) => Promise<string | null>;
  /**
   * Emits a template as a string or as a compiled render function.
   */
  load: (id: string) => string | null;
};

const RAW_PREFIX = "\0liquid:";
const COMPILED_PREFIX = "\0liquid-compiled:";
const COMPILED_QUERY = "?compiled";

/**
 * The runtime the compiled templates import, by absolute path so the virtual
 * module can reach it from any bundler.
 */
const RUNTIME_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "src/orchestrator/template-runtime.ts",
);

/**
 * Built-in filters the runtime reproduces. Any other built-in is refused at
 * compile time, so a template never renders differently from the engine.
 */
const RUNTIME_FILTERS: ReadonlyMap<string, string> = new Map([
  ["where", "where"],
  ["first", "first"],
  ["json", "json"],
  ["escape", "escapeOutput"],
]);

/**
 * Built-ins the dialect overrides; they dispatch to the dialect's own filter.
 */
const OVERRIDDEN_FILTERS = new Set(["raw"]);

/**
 * Vite/Rollup plugin for `.liquid` imports.
 *
 * `import tpl from "./file.liquid"` default-exports the source as a string.
 * `import render from "./file.liquid?compiled"` default-exports the template
 * compiled at build time to a plain function of its context, filters and tags
 * (see {@link compileLiquid}), so the page renders it without LiquidJS.
 *
 * `resolveId` tags both with a virtual prefix so Vite's built-in loaders don't
 * try to parse the Liquid syntax as JS.
 *
 * Shared by every consumer of `@zitadel/components` source: the package's own
 * `vitest.config.ts`, its `tsdown.config.ts` and the Storybook dev server
 * (`apps/storybook/.storybook/main.ts`).
 *
 * @returns The plugin.
 */
export function liquidRaw(): LiquidPlugin {
  return {
    name: "liquid-raw",
    enforce: "pre",
    async resolveId(source, importer, options) {
      const compiled = source.endsWith(`.liquid${COMPILED_QUERY}`);
      if ((!source.endsWith(".liquid") && !compiled) || !importer) {
        return null;
      }
      const prefix = compiled ? COMPILED_PREFIX : RAW_PREFIX;
      const file = compiled ? source.slice(0, -COMPILED_QUERY.length) : source;
      if (file.startsWith(".")) {
        const dir = importer.replace(/\/[^/]*$/, "");
        return `${prefix}${resolve(dir, file)}`;
      }
      // A package specifier (`@zitadel/config/defaults/…`): resolve it through
      // the package's exports as Vite would.
      const resolved = await this.resolve(file, importer, { ...options, skipSelf: true });
      return resolved ? `${prefix}${resolved.id}` : null;
    },
    load(id) {
      if (id.startsWith(COMPILED_PREFIX)) {
        return compileLiquid(readFileSync(id.slice(COMPILED_PREFIX.length), "utf-8"));
      }
      if (id.startsWith(RAW_PREFIX)) {
        const content = readFileSync(id.slice(RAW_PREFIX.length), "utf-8");
        return `export default ${JSON.stringify(content)};`;
      }
      return null;
    },
  };
}

/**
 * Compiles a Liquid template to an ES module whose default export renders it
 * with `template-runtime.ts`.
 *
 * The template is parsed by LiquidJS itself, so whitespace control and the
 * tag grammar are the engine's own; only rendering moves to the generated
 * code. A tag, filter or operator the runtime does not reproduce fails the
 * build instead of rendering differently.
 *
 * @param source - The Liquid source.
 * @returns The module's JavaScript.
 * @throws {Error} When the template uses something the runtime does not support.
 */
export function compileLiquid(source: string): string {
  const engine = new Liquid();
  engine.registerTag(MANDATORY_GATES_TAG, {
    parse() {
      // No body and no arguments.
    },
    render() {
      return "";
    },
  });
  const compiler = { next: 0, loops: [] as Array<{ name: string; scope: string }> };
  const body = compileTemplates(engine.parse(source), compiler);
  return [
    `import * as rt from ${JSON.stringify(RUNTIME_PATH)};`,
    "export default function render(env, filters, tags) {",
    "  const scope = { env, assigns: {} };",
    '  let out = "";',
    body,
    "  return out;",
    "}",
    "",
  ].join("\n");
}

/**
 * Compiler state threaded through one compilation.
 */
type Compiler = {
  /**
   * Counter for unique local names.
   */
  next: number;
  /**
   * The enclosing `{% for %}` loops, innermost last.
   */
  loops: Array<{ name: string; scope: string }>;
};

/**
 * Compiles a list of templates to statements that append to `out`.
 *
 * @param templates - The parsed templates.
 * @param compiler - The compiler state.
 * @returns The statements.
 */
function compileTemplates(templates: readonly Template[], compiler: Compiler): string {
  return templates.map((template) => compileTemplate(template, compiler)).join("\n");
}

/**
 * Compiles one template node.
 *
 * @param template - The node.
 * @param compiler - The compiler state.
 * @returns The statements.
 * @throws {Error} For a tag the runtime does not reproduce.
 */
function compileTemplate(template: Template, compiler: Compiler): string {
  if (template instanceof Output) {
    return `out += rt.escapeOutput(${compileValue(template.value, compiler)});`;
  }
  if (!(template instanceof Tag)) {
    const html = (template as unknown as { str: string }).str;
    return `out += ${JSON.stringify(html)};`;
  }
  if (template instanceof CommentTag) {
    return "";
  }
  if (template instanceof IfTag) {
    return compileBranches(
      template.branches.map((branch) => ({
        test: `rt.truthy(${compileValue(branch.value, compiler)})`,
        templates: branch.templates,
      })),
      template.elseTemplates ?? [],
      compiler,
    );
  }
  if (template instanceof UnlessTag) {
    return compileBranches(
      template.branches.map((branch, index) => {
        const value = compileValue(branch.value, compiler);
        return {
          test: index === 0 ? `!rt.truthy(${value})` : `rt.truthy(${value})`,
          templates: branch.templates,
        };
      }),
      template.elseTemplates,
      compiler,
    );
  }
  if (template instanceof ForTag) {
    return compileFor(template, compiler);
  }
  if (template instanceof CaseTag) {
    return compileCase(template, compiler);
  }
  if (template instanceof AssignTag) {
    const assign = template as unknown as { key: string; value: Value };
    return `scope.assigns[${JSON.stringify(assign.key)}] = ${compileValue(assign.value, compiler)};`;
  }
  if (template.name === MANDATORY_GATES_TAG) {
    return `out += rt.stringify(tags[${JSON.stringify(template.name)}]());`;
  }
  throw new Error(`compileLiquid: the tag "${template.name}" is not supported`);
}

/**
 * Compiles `if`/`elsif`/`else` shaped branches.
 *
 * @param branches - Each branch's test and body.
 * @param elseTemplates - The `else` body.
 * @param compiler - The compiler state.
 * @returns The statements.
 */
function compileBranches(
  branches: ReadonlyArray<{ test: string; templates: readonly Template[] }>,
  elseTemplates: readonly Template[],
  compiler: Compiler,
): string {
  const parts = branches.map(
    (branch, index) =>
      `${index === 0 ? "if" : "else if"} (${branch.test}) {\n${compileTemplates(branch.templates, compiler)}\n}`,
  );
  parts.push(`else {\n${compileTemplates(elseTemplates, compiler)}\n}`);
  return parts.join(" ");
}

/**
 * Compiles a `{% for %}` loop. Its variable shadows every other scope, as the
 * loop's own scope does in the engine.
 *
 * @param tag - The loop.
 * @param compiler - The compiler state.
 * @returns The statements.
 * @throws {Error} For loop modifiers (`limit`, `offset`, `reversed`).
 */
function compileFor(tag: ForTag, compiler: Compiler): string {
  if (Object.keys(tag.hash.hash).length > 0) {
    throw new Error("compileLiquid: for-loop modifiers are not supported");
  }
  const id = compiler.next++;
  const items = `items${id}`;
  const loopScope = `loop${id}`;
  const collection = compileToken(tag.collection, compiler);
  compiler.loops.push({ name: tag.variable, scope: loopScope });
  const body = compileTemplates(tag.templates, compiler);
  compiler.loops.pop();
  return [
    `const ${items} = rt.toEnumerable(${collection});`,
    `if (${items}.length === 0) {\n${compileTemplates(tag.elseTemplates, compiler)}\n} else {`,
    `const ${loopScope} = {};`,
    `for (const item of ${items}) {`,
    `${loopScope}[${JSON.stringify(tag.variable)}] = item;`,
    body,
    "}",
    "}",
  ].join("\n");
}

/**
 * Compiles a `{% case %}`. Every matching `when` renders, as in the engine.
 *
 * @param tag - The case.
 * @param compiler - The compiler state.
 * @returns The statements.
 */
function compileCase(tag: CaseTag, compiler: Compiler): string {
  const id = compiler.next++;
  const target = `target${id}`;
  const hit = `hit${id}`;
  const branches = tag.branches.map((branch) => {
    const tests = branch.values.map(
      (value) => `rt.equals(${target}, ${compileToken(value, compiler)})`,
    );
    return `if (${tests.join(" || ")}) {\n${hit} = true;\n${compileTemplates(branch.templates, compiler)}\n}`;
  });
  return [
    `const ${target} = rt.toValue(${compileValue(tag.value, compiler)});`,
    `let ${hit} = false;`,
    ...branches,
    `if (!${hit}) {\n${compileTemplates(tag.elseTemplates, compiler)}\n}`,
  ].join("\n");
}

/**
 * Compiles a value with its filters.
 *
 * @param value - The value.
 * @param compiler - The compiler state.
 * @returns A JavaScript expression.
 * @throws {Error} For a built-in filter the runtime does not reproduce.
 */
function compileValue(value: Value, compiler: Compiler): string {
  let expression = compileExpression(value.initial.postfix, compiler);
  for (const filter of value.filters) {
    const args = filter.args.map((arg) => {
      if (Array.isArray(arg)) {
        throw new Error(`compileLiquid: keyword arguments to "${filter.name}" are not supported`);
      }
      return compileToken(arg as Token, compiler);
    });
    const runtimeFilter = RUNTIME_FILTERS.get(filter.name);
    if (runtimeFilter !== undefined) {
      expression = `rt.${runtimeFilter}(${[expression, ...args].join(", ")})`;
    } else if (filter.name in builtinFilters && !OVERRIDDEN_FILTERS.has(filter.name)) {
      throw new Error(`compileLiquid: the built-in filter "${filter.name}" is not supported`);
    } else {
      expression = `rt.filter(filters, ${JSON.stringify(filter.name)}, ${expression}, [${args.join(", ")}])`;
    }
  }
  return expression;
}

/**
 * Compiles an expression from its postfix tokens.
 *
 * @param postfix - The tokens in postfix order.
 * @param compiler - The compiler state.
 * @returns A JavaScript expression.
 * @throws {Error} For an operator the runtime does not reproduce.
 */
function compileExpression(postfix: readonly Token[], compiler: Compiler): string {
  const operands: string[] = [];
  const operators: Readonly<Record<string, (left: string, right: string) => string>> = {
    "==": (left, right) => `rt.equals(${left}, ${right})`,
    "!=": (left, right) => `!rt.equals(${left}, ${right})`,
    and: (left, right) => `rt.and(${left}, ${right})`,
    or: (left, right) => `rt.or(${left}, ${right})`,
    ">": (left, right) => `rt.compare(">", ${left}, ${right})`,
    "<": (left, right) => `rt.compare("<", ${left}, ${right})`,
    ">=": (left, right) => `rt.compare(">=", ${left}, ${right})`,
    "<=": (left, right) => `rt.compare("<=", ${left}, ${right})`,
  };
  for (const token of postfix) {
    if (TypeGuards.isOperatorToken(token)) {
      const operator = operators[token.operator];
      if (operator === undefined) {
        throw new Error(`compileLiquid: the operator "${token.operator}" is not supported`);
      }
      const right = operands.pop() ?? "undefined";
      const left = operands.pop() ?? "undefined";
      operands.push(operator(left, right));
    } else {
      operands.push(compileToken(token, compiler));
    }
  }
  return operands[0] ?? "undefined";
}

/**
 * Compiles one operand.
 *
 * @param token - A literal, quoted string, number or property access.
 * @param compiler - The compiler state.
 * @returns A JavaScript expression.
 * @throws {Error} For ranges and other operands the runtime does not reproduce.
 */
function compileToken(token: Token, compiler: Compiler): string {
  if (TypeGuards.isLiteralToken(token)) {
    return `rt.literal(${JSON.stringify(token.literal)})`;
  }
  if (TypeGuards.isQuotedToken(token) || TypeGuards.isNumberToken(token)) {
    return JSON.stringify(token.content);
  }
  if (TypeGuards.isPropertyAccessToken(token) && token.variable === undefined) {
    const path = token.props.map((prop) => {
      if ("content" in prop) {
        return JSON.stringify((prop as { content: unknown }).content);
      }
      return `rt.toValue(${compileToken(prop, compiler)})`;
    });
    const root = token.props[0];
    if (root === undefined || !("content" in root) || typeof root.content !== "string") {
      throw new Error("compileLiquid: a variable must start with a name");
    }
    if (root.content === "forloop" && compiler.loops.length > 0) {
      throw new Error("compileLiquid: forloop is not supported");
    }
    const loop = [...compiler.loops].reverse().find((candidate) => candidate.name === root.content);
    const scope = loop ? loop.scope : `rt.scopeOf(scope, ${JSON.stringify(root.content)})`;
    return `rt.get(${scope}, [${path.join(", ")}])`;
  }
  throw new Error(`compileLiquid: the expression "${token.getText()}" is not supported`);
}
