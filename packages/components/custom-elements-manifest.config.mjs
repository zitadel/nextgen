/**
 * Config for `@custom-elements-manifest/analyzer` (`pnpm cem`).
 *
 * `litelement: true` turns on the bundled Lit plugin so `@property()` and
 * `accessor` members become attributes. The stock analyzer only sees events
 * dispatched through `host.dispatchEvent(new CustomEvent(...))`; every element
 * here emits through the `emit(host, "name", detail, opts)` helper in
 * `src/internal/emit.ts`, so {@link emitEventsPlugin} walks those calls and
 * registers each event on its emitting class.
 */

// Each event's detail type, by name. Mirrors the source of truth —
// `@zitadel/sdk-core` `src/types.ts` for the `zitadel-*` details and
// `src/atoms/events.ts` for the `zl-*` ones — so the manifest reuses the
// published type names rather than a re-derived shape.
const EVENT_DETAIL = {
  "zitadel-flow-step": "ZitadelFlowStepDetail",
  "zitadel-flow-input": "ZitadelFlowInputDetail",
  "zitadel-flow-complete": "ZitadelFlowCompleteDetail",
  "zitadel-flow-redirect": "ZitadelFlowRedirectDetail",
  "zitadel-flow-error": "ZitadelFlowErrorDetail",
  "zitadel-signout": "ZitadelSignoutDetail",
  "zl-submit": "ZlSubmitDetail",
  "zl-input": "ZlFieldInputDetail",
  "zl-change": "ZlCheckboxChangeDetail | ZlSelectChangeDetail",
  "zl-dismiss": "null",
  "zl-sso-select": "ZlSsoSelectDetail",
  "zl-passkey-started": "ZlPasskeyStartedDetail",
  "zl-passkey-result": "ZlPasskeyResultDetail",
  "zl-passkey-error": "ZlPasskeyErrorDetail",
};

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
      const detail = EVENT_DETAIL[name] ?? "unknown";
      declaration.events ??= [];
      if (!declaration.events.some((event) => event.name === name)) {
        declaration.events.push({ name, type: { text: `CustomEvent<${detail}>` } });
      }
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
  plugins: [emitEventsPlugin()],
};
