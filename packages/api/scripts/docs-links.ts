import type { InputTransformerFn } from "orval";

/**
 * The docs site the client's JSDoc links to. The spec links its docs pages
 * root-relative (`/docs/concepts/...`), which the docs site resolves against
 * whichever deployment serves it. A published package is built once, so its
 * JSDoc names this one host instead. The host's home is `DocsOrigin` in
 * apps/api/api/client/client.go, whose test fails when this copy drifts.
 */
export const DOCS_ORIGIN = "https://preview.zitadel.com";

const RELATIVE_DOCS_LINK = "](/docs/";

/**
 * orval's input transformer (`input.override.transformer` in
 * `orval.config.ts`): rewrites every root-relative Markdown link to a docs
 * page in the spec's strings into one on {@link DOCS_ORIGIN}, so a link in
 * the generated JSDoc opens from an editor.
 */
export const absoluteDocsLinks: InputTransformerFn = (spec) => {
  // The dereferenced spec shares one object wherever a `$ref` pointed, and
  // may cycle.
  const seen = new WeakSet<object>();
  const visit = (node: unknown): void => {
    if (typeof node !== "object" || node === null || seen.has(node)) return;
    seen.add(node);
    const record = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === "string") {
        record[key] = value.replaceAll(RELATIVE_DOCS_LINK, `](${DOCS_ORIGIN}/docs/`);
      } else {
        visit(value);
      }
    }
  };
  visit(spec);
  return spec;
};
