import Link from "fumadocs-core/link";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import type { ComponentProps } from "react";

// A file the docs serve beside the pages, such as /docs/openapi.json, is a
// plain <a>: next/link fetches it twice as a page before the browser loads
// it. No page's URL has a dot in it.
export function MdxLink(props: ComponentProps<"a">) {
  if (/^\/docs\/[^?#]*\.\w+$/.test(props.href ?? "")) return <a {...props} />;
  return <Link {...props} />;
}

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    a: MdxLink,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
