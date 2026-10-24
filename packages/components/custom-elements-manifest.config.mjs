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
 * {@link cssPartsPlugin} publishes the `::part()` names, tier 2 of
 * `docs/design/branding/override-ladder.md`, as `cssParts`. An atom lists the
 * bare names its manifest declares. An orchestrator lists its own `@csspart`
 * tags, then the `<atom>-<part>` names it forwards
 * (`src/orchestrator/exportparts.ts`) for every atom it can render: the atoms
 * its `html` templates name or, for an element that renders template markup
 * through `unsafeHTML`, every registered atom, since the sanitiser admits
 * exactly the registry. The manifests are read from source, so `manifests.ts`
 * stays the one part catalogue. The stable tokens need no plugin: they are
 * `@cssprop` tags on the orchestrators' base class, which the analyzer
 * inherits onto each orchestrator.
 *
 * {@link sortModulesPlugin} sorts the modules by `path` so the manifest is byte
 * identical regardless of the filesystem's directory-traversal order, which
 * differs between machines and CI.
 */

function ownerClass(ts, node) {
  let owner = node.parent;
  while (owner && !ts.isClassLike(owner)) {
    owner = owner.parent;
  }
  return owner;
}

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
      const owner = ownerClass(ts, node);
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

function cssPartsPlugin() {
  // Manifest variable name to `{ tag, parts }`, as the atom modules declare them.
  const manifests = new Map();
  // The manifest variable names, in `manifestRegistry` order.
  let registry = [];
  // `<module path>#<class name>` to what the class renders.
  const renders = new Map();

  return {
    name: "zitadel-css-parts",
    analyzePhase({ ts, node, moduleDoc }) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const value = unwrapExpression(ts, node.initializer);
        const type = node.type;
        if (type && ts.isTypeReferenceNode(type) && type.typeName.getText() === "AtomManifest") {
          manifests.set(node.name.text, {
            tag: literalProperty(ts, value, "tag", node.name.text),
            parts: literalProperty(ts, value, "parts", node.name.text),
          });
        } else if (node.name.text === "manifestRegistry" && ts.isArrayLiteralExpression(value)) {
          registry = value.elements.map((element) => element.getText());
        }
        return;
      }
      const html =
        ts.isTaggedTemplateExpression(node) &&
        ts.isIdentifier(node.tag) &&
        node.tag.text === "html";
      const templates =
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "unsafeHTML";
      if (!html && !templates) {
        return;
      }
      const owner = ownerClass(ts, node);
      if (!owner?.name) {
        return;
      }
      const key = `${moduleDoc.path}#${owner.name.text}`;
      const rendered = renders.get(key) ?? { templates: false, tags: new Set() };
      renders.set(key, rendered);
      if (templates) {
        rendered.templates = true;
        return;
      }
      for (const [, tag] of node.template.getText().matchAll(/<(zl-[a-z0-9-]+)/g)) {
        rendered.tags.add(tag);
      }
    },
    packageLinkPhase({ customElementsManifest }) {
      const atoms = registry.map((name) => {
        const manifest = manifests.get(name);
        if (!manifest) {
          throw new Error(
            `manifestRegistry lists ${name}, which no module declares as an AtomManifest`,
          );
        }
        return manifest;
      });
      for (const module of customElementsManifest.modules) {
        for (const declaration of module.declarations ?? []) {
          if (!declaration.tagName) {
            continue;
          }
          const documented = declaration.cssParts ?? [];
          const atom = atoms.find(({ tag }) => tag === declaration.tagName);
          const rendered = renders.get(`${module.path}#${declaration.name}`);
          let cssParts = documented;
          if (atom) {
            // The manifest decides which parts exist; a `@csspart` tag can only describe one.
            cssParts = atom.parts.map(
              (name) => documented.find((part) => part.name === name) ?? { name },
            );
          } else if (rendered) {
            const forwarded = atoms
              .filter(({ tag }) => rendered.templates || rendered.tags.has(tag))
              .flatMap(({ tag, parts }) =>
                parts.map((part) => ({
                  description: `Forwarded \`${part}\` part of \`<${tag}>\`.`,
                  name: `${tag.replace(/^zl-/, "")}-${part}`,
                })),
              );
            cssParts = [...documented, ...forwarded];
          }
          if (cssParts.length > 0) {
            declaration.cssParts = cssParts;
          } else {
            delete declaration.cssParts;
          }
        }
      }
    },
  };
}

/** Strips `as const`, `satisfies` and parentheses off an initializer. */
function unwrapExpression(ts, node) {
  let expression = node;
  while (
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isParenthesizedExpression(expression)
  ) {
    expression = expression.expression;
  }
  return expression;
}

/**
 * A manifest's `tag` string or `parts` array, read from its object literal.
 * Anything but literals throws rather than drop a part the analyzer cannot see.
 */
function literalProperty(ts, object, key, manifest) {
  const property = ts.isObjectLiteralExpression(object)
    ? object.properties.find(
        (candidate) => ts.isPropertyAssignment(candidate) && candidate.name.getText() === key,
      )
    : undefined;
  const value = property && unwrapExpression(ts, property.initializer);
  if (value && ts.isStringLiteralLike(value)) {
    return value.text;
  }
  if (value && ts.isArrayLiteralExpression(value) && value.elements.every(ts.isStringLiteralLike)) {
    return value.elements.map((element) => element.text);
  }
  throw new Error(`${manifest}.${key} must be a literal for custom-elements.json to list it`);
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
  plugins: [emitEventsPlugin(), cssPartsPlugin(), sortModulesPlugin()],
};
