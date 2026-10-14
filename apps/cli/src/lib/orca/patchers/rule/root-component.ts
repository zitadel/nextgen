import { readFile, stat } from "node:fs/promises";
import { join, posix } from "node:path";

import { parseModule } from "magicast";

import { ZitadelError } from "../../../errors";
import { isObject } from "../../../json";
import { PREFLIGHT_FORCE_NOTE } from "./base";

/**
 * How a single-page app mounts the root component its patcher writes.
 *
 * The patcher writes the root to one fixed path, and the file-writer conflicts
 * only on a file at exactly that path. An app whose root component lives
 * somewhere else — a Vite JavaScript template's `src/App.jsx`, Angular 17–19's
 * `src/app/app.component.ts` — would get the managed root beside its own and
 * keep loading its own. {@link assertMountsRootComponent} reads the app's entry
 * to catch that before anything is written.
 */
export type RootMount = Readonly<{
  /** The root component the patcher writes, relative to the project root. */
  path: string;
  /** What the managed root exports: `export default App` or `export class App`. */
  binding: Readonly<{ name: string; named: boolean }>;
  /**
   * Whether the suggested import names the file extension. A Vite app needs
   * it: `./App` would still resolve to an `App.jsx` left beside the managed
   * `App.tsx`. Angular's TypeScript resolution takes none.
   */
  extension: boolean;
  /** The calls that mount the root, by callee or method name. */
  calls: ReadonlyArray<string>;
  /**
   * Where a mount call names the root: as its first argument
   * (`createApp(App)`, `bootstrapApplication(App)`) or as the JSX it renders
   * (`createRoot(el).render(<App />)`).
   */
  mounts: "argument" | "jsx";
  /**
   * The extension of components the entry mounts with `new Root({ target })`
   * (Svelte 3 and 4). Limited to it so an unrelated `new Router()` is never
   * mistaken for the root.
   */
  constructs?: string;
}>;

/**
 * Vite's own extension order for a specifier without one (its
 * `resolve.extensions` default, minus JSON). The order matters: with an
 * `App.jsx` beside an `App.tsx`, Vite resolves `./App` to the `.jsx`.
 */
const SCRIPT_EXTENSIONS = [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx"] as const;

/** The TypeScript files a `.js`-style specifier resolves to from a TypeScript importer. */
const TYPESCRIPT_FOR_JAVASCRIPT: Readonly<Record<string, ReadonlyArray<string>>> = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
};

/**
 * Throws `E_CONFLICT` when the app's entry mounts a root component from a
 * file other than `root.path`, so setup stops before it creates a project
 * instead of writing a root component the app never loads.
 *
 * Conservative by design: it stops only on a root it can see, a local file
 * the entry mounts. An entry it cannot find or parse, a mount it does not
 * recognise, or a root it cannot resolve (an unfamiliar alias, a component
 * from a package) all let setup go ahead as before.
 */
export async function assertMountsRootComponent(
  cwd: string,
  entry: string | undefined,
  root: RootMount,
): Promise<void> {
  if (entry === undefined) {
    return;
  }
  const source = await readTextIfExists(join(cwd, entry));
  if (source === undefined) {
    return;
  }
  const mounted = mountedSpecifiers(source, root);
  const foreign: string[] = [];
  for (const specifier of mounted) {
    const file = await resolveLocalModule(cwd, entry, specifier, root.path);
    if (file === root.path) {
      return;
    }
    if (file !== undefined) {
      foreign.push(file);
    }
  }
  // Several candidates only come from JSX that renders siblings, such as a
  // toaster beside the app; the one named like the root is the one to report.
  const mountedRoot = foreign.find((file) => stem(file) === stem(root.path)) ?? foreign[0];
  if (mountedRoot === undefined) {
    return;
  }
  const statement = importStatement(entry, root);
  throw new ZitadelError(
    "E_CONFLICT",
    `${entry} mounts ${mountedRoot}, not the ${root.path} setup writes`,
    {
      hint:
        `Your app would keep loading ${mountedRoot}, and the root component setup writes would ` +
        `never run. In ${entry}, import the root as \`${statement}\` and mount that instead, ` +
        `then rerun setup and move what you need from ${mountedRoot} into ${root.path}. ` +
        PREFLIGHT_FORCE_NOTE,
      details: { path: mountedRoot, entry, writes: root.path },
    },
  );
}

/**
 * The module script a Vite app's `index.html` loads, relative to the project
 * root: the entry that mounts the root component. `undefined` when there is
 * no `index.html` or it loads no local module.
 */
export async function viteEntry(cwd: string): Promise<string | undefined> {
  const html = await readTextIfExists(join(cwd, "index.html"));
  if (html === undefined) {
    return undefined;
  }
  // A commented-out script is not the one Vite loads.
  for (const tag of withoutComments(html).match(/<script\b[^>]*>/gi) ?? []) {
    if (!/\btype\s*=\s*["']?module\b/i.test(tag)) {
      continue;
    }
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    // A URL, protocol-relative or not, is a module from elsewhere.
    if (src === undefined || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(src)) {
      continue;
    }
    return projectPath(src);
  }
  return undefined;
}

/**
 * `html` without its comments. Scanned rather than replaced by a pattern: the
 * text is only searched for a script tag, never served, but code scanning
 * reads a pattern replace over HTML as sanitizing it.
 */
function withoutComments(html: string): string {
  let text = "";
  let from = 0;
  for (let start = html.indexOf("<!--"); start !== -1; start = html.indexOf("<!--", from)) {
    text += html.slice(from, start);
    const end = html.indexOf("-->", start + 4);
    if (end === -1) {
      return text;
    }
    from = end + 3;
  }
  return text + html.slice(from);
}

/**
 * The browser entry `angular.json` builds (`browser` for the application
 * builder, `main` for the older browser builder), relative to the project
 * root. Falls back to the Angular CLI's `src/main.ts` when the workspace does
 * not say, including when it holds several projects and names no default.
 */
export async function angularEntry(cwd: string): Promise<string> {
  const fallback = "src/main.ts";
  const text = await readTextIfExists(join(cwd, "angular.json"));
  if (text === undefined) {
    return fallback;
  }
  let workspace: unknown;
  try {
    workspace = JSON.parse(text);
  } catch {
    return fallback;
  }
  if (!isObject(workspace) || !isObject(workspace.projects)) {
    return fallback;
  }
  const projects = workspace.projects;
  const names = Object.keys(projects);
  const name =
    typeof workspace.defaultProject === "string"
      ? workspace.defaultProject
      : names.length === 1
        ? names[0]
        : undefined;
  const project = name === undefined ? undefined : projects[name];
  if (!isObject(project)) {
    return fallback;
  }
  // Angular CLI has used both "architect" and "targets" for the target map.
  const targets = isObject(project.architect)
    ? project.architect
    : isObject(project.targets)
      ? project.targets
      : undefined;
  const build = targets !== undefined && isObject(targets.build) ? targets.build : undefined;
  const options = build !== undefined && isObject(build.options) ? build.options : undefined;
  const entry = options?.browser ?? options?.main;
  return typeof entry === "string" ? projectPath(entry) : fallback;
}

/**
 * The specifiers of the local modules the entry's mount calls name as the
 * root, in source order. Empty when the entry cannot be parsed or mounts
 * nothing this recognises.
 */
function mountedSpecifiers(source: string, root: RootMount): string[] {
  let program: AstNode | undefined;
  try {
    // magicast's `$ast` may be a babel `File` (with `.program`) or the
    // `Program` node itself.
    const ast = parseModule(source).$ast as AstNode;
    program = (ast.program as AstNode | undefined) ?? ast;
  } catch {
    return [];
  }
  const imports = importedSpecifiers(program);
  const names: string[] = [];
  walk(program, (node) => {
    if (node.type === "CallExpression" || node.type === "OptionalCallExpression") {
      if (!root.calls.includes(calleeName(node.callee as AstNode | undefined) ?? "")) {
        return;
      }
      const args = (node.arguments as AstNode[] | undefined) ?? [];
      if (root.mounts === "argument") {
        const [first] = args;
        if (first?.type === "Identifier" && typeof first.name === "string") {
          names.push(first.name);
        }
        return;
      }
      for (const arg of args) {
        names.push(...leafComponents(arg));
      }
      return;
    }
    if (node.type === "NewExpression" && root.constructs !== undefined) {
      const callee = node.callee as AstNode | undefined;
      const specifier =
        callee?.type === "Identifier" && typeof callee.name === "string"
          ? imports.get(callee.name)
          : undefined;
      if (specifier !== undefined && posix.extname(stripQuery(specifier)) === root.constructs) {
        names.push(callee?.name as string);
      }
    }
  });
  return names.flatMap((name) => {
    const specifier = imports.get(name);
    return specifier === undefined ? [] : [specifier];
  });
}

/** Local binding name to import specifier, for every value import. */
function importedSpecifiers(program: AstNode): Map<string, string> {
  const imports = new Map<string, string>();
  for (const statement of (program.body as AstNode[] | undefined) ?? []) {
    if (statement.type !== "ImportDeclaration" || statement.importKind === "type") {
      continue;
    }
    const specifier = (statement.source as AstNode | undefined)?.value;
    if (typeof specifier !== "string") {
      continue;
    }
    for (const binding of (statement.specifiers as AstNode[] | undefined) ?? []) {
      const local = (binding.local as AstNode | undefined)?.name;
      if (typeof local === "string" && binding.importKind !== "type") {
        imports.set(local, specifier);
      }
    }
  }
  return imports;
}

/**
 * The components a render call's argument mounts innermost: JSX components
 * with no component inside them. Providers wrap the app, so in
 * `<StrictMode><Provider><App /></Provider></StrictMode>` only `App` counts,
 * and an app rendering a router from a package names no local root at all.
 */
function leafComponents(node: AstNode): string[] {
  const leaves: string[] = [];
  walk(node, (candidate) => {
    const name = componentName(candidate);
    if (name !== undefined && !hasComponentChild(candidate)) {
      leaves.push(name);
    }
  });
  return leaves;
}

function hasComponentChild(element: AstNode): boolean {
  let found = false;
  for (const child of (element.children as AstNode[] | undefined) ?? []) {
    walk(child, (node) => {
      if (componentName(node) !== undefined) {
        found = true;
      }
    });
  }
  return found;
}

/** The name of a JSX element that renders a component (`<App />`), not a tag (`<div>`). */
function componentName(node: AstNode): string | undefined {
  if (node.type !== "JSXElement") {
    return undefined;
  }
  const name = ((node.openingElement as AstNode | undefined)?.name as AstNode | undefined) ?? {};
  return name.type === "JSXIdentifier" && typeof name.name === "string" && /^[A-Z]/.test(name.name)
    ? name.name
    : undefined;
}

/** `render` for `render(…)`, `root.render(…)` and `createRoot(el).render(…)` alike. */
function calleeName(callee: AstNode | undefined): string | undefined {
  if (callee?.type === "Identifier" && typeof callee.name === "string") {
    return callee.name;
  }
  if (
    (callee?.type === "MemberExpression" || callee?.type === "OptionalMemberExpression") &&
    callee.computed !== true
  ) {
    const property = callee.property as AstNode | undefined;
    return typeof property?.name === "string" ? property.name : undefined;
  }
  return undefined;
}

/**
 * The project file a local specifier resolves to, the way Vite resolves it,
 * counting `managed` as present (the patch is about to write it). `undefined`
 * for a package, a path outside the project, or a file that is not there.
 * `@/` and `~/` are read as `src/`, the alias the Vue and shadcn templates
 * configure; any other alias stays unresolved.
 */
async function resolveLocalModule(
  cwd: string,
  importer: string,
  specifier: string,
  managed: string,
): Promise<string | undefined> {
  const path = stripQuery(specifier);
  let base: string;
  if (path.startsWith("./") || path.startsWith("../")) {
    base = posix.join(posix.dirname(importer), path);
  } else if (path.startsWith("/")) {
    // Vite serves the project root at `/`.
    base = path.slice(1);
  } else if (path.startsWith("@/") || path.startsWith("~/")) {
    base = posix.join("src", path.slice(2));
  } else {
    return undefined;
  }
  base = posix.normalize(base);
  if (base === ".." || base.startsWith("../")) {
    return undefined;
  }
  const extension = posix.extname(base);
  const withoutExtension = base.slice(0, base.length - extension.length);
  const candidates = [
    base,
    ...SCRIPT_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...(TYPESCRIPT_FOR_JAVASCRIPT[extension] ?? []).map((ext) => `${withoutExtension}${ext}`),
    ...SCRIPT_EXTENSIONS.map((ext) => posix.join(base, `index${ext}`)),
  ];
  for (const candidate of candidates) {
    if (candidate === managed || (await isFile(join(cwd, candidate)))) {
      return candidate;
    }
  }
  return undefined;
}

/** The import line that mounts the managed root from the entry's directory. */
function importStatement(entry: string, root: RootMount): string {
  let specifier = posix.relative(posix.dirname(entry), root.path);
  if (!root.extension) {
    specifier = specifier.slice(0, specifier.length - posix.extname(specifier).length);
  }
  if (!specifier.startsWith(".")) {
    specifier = `./${specifier}`;
  }
  const binding = root.binding.named ? `{ ${root.binding.name} }` : root.binding.name;
  return `import ${binding} from "${specifier}"`;
}

/** `app` for `src/app/app.component.ts` and `src/App.tsx` alike. */
function stem(path: string): string {
  return (posix.basename(path).split(".")[0] ?? "").toLowerCase();
}

/** A path from `index.html` or `angular.json`, made relative to the project root. */
function projectPath(path: string): string {
  return posix.normalize(path.replace(/^\.?\//, ""));
}

function stripQuery(specifier: string): string {
  return specifier.split(/[?#]/)[0] ?? specifier;
}

/** The slice of a babel AST node this module reads. */
type AstNode = { type?: string; [key: string]: unknown };

/** Visits `node` and every node below it, depth first and in source order. */
function walk(node: unknown, visit: (node: AstNode) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      walk(item, visit);
    }
    return;
  }
  if (typeof node !== "object" || node === null || typeof (node as AstNode).type !== "string") {
    return;
  }
  visit(node as AstNode);
  for (const [key, value] of Object.entries(node)) {
    // Position data and comments hold no nodes worth visiting.
    if (key === "loc" || key === "comments" || key === "leadingComments" || key === "tokens") {
      continue;
    }
    if (typeof value === "object" && value !== null) {
      walk(value, visit);
    }
  }
}

async function readTextIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
