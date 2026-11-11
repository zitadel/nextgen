/**
 * Config for `@custom-elements-manifest/analyzer` (`pnpm cem`).
 *
 * `litelement: true` turns on the bundled Lit plugin so `@property()` and
 * `accessor` members become attributes, and the analyzer reads each element's
 * `@fires {CustomEvent<Detail>} name` JSDoc tags natively — those tags on the
 * element classes are the single source of truth for the events and their
 * detail types (the real exported names from `@zitadel/sdk-core` `types.ts` and
 * `src/atoms/events.ts`).
 *
 * {@link emitEventsPlugin} is a completeness guard only: the stock analyzer
 * sees events through `@fires`, so an event dispatched via the
 * `emit(host, "name", …)` helper but never documented with a `@fires` tag
 * would otherwise be missing. The plugin walks those `emit`/`emitThenSettle`
 * calls and registers any name that has no `@fires` tag, so a new emit without
 * a tag still shows up in the manifest (untyped) and trips the drift test. It
 * holds no detail-type strings — types come from `@fires` alone.
 *
 * {@link sortModulesPlugin} sorts the modules by `path` so the manifest is byte
 * identical regardless of the filesystem's directory-traversal order, which
 * differs between machines and CI.
 */

function emitEventsPlugin() {
  return {
    name: "zitadel-emit-events",
    analyzePhase({ ts, node, moduleDoc }) {
      if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) {
        return;
      }
      if (node.expression.text !== "emit" && node.expression.text !== "emitThenSettle") {
        return;
      }
      const nameArg = node.arguments[1];
      if (!nameArg || !ts.isStringLiteralLike(nameArg)) {
        return;
      }
      let owner = node.parent;
      while (owner && !ts.isClassLike(owner)) {
        owner = owner.parent;
      }
      const declaration = moduleDoc.declarations.find((d) => d.name === owner?.name?.text);
      if (!declaration) {
        return;
      }
      const name = nameArg.text;
      declaration.events ??= [];
      if (!declaration.events.some((event) => event.name === name)) {
        declaration.events.push({ name });
      }
    },
  };
}

function sortModulesPlugin() {
  return {
    name: "zitadel-sort-modules",
    packageLinkPhase({ customElementsManifest }) {
      customElementsManifest.modules.sort((a, b) =>
        a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
      );
    },
  };
}

export default {
  globs: ["src/**/*.ts"],
  exclude: ["src/**/*.spec.ts", "src/**/*.d.ts"],
  outdir: ".",
  // The `"customElements"` field is committed to package.json by hand; keep the
  // analyzer from rewriting it (it would point the field at a test's temp dir).
  packagejson: false,
  litelement: true,
  plugins: [emitEventsPlugin(), sortModulesPlugin()],
};
