import type { MetaData, Source } from "fumadocs-core/source";

// The API's error codes, a schema per code and each operation's error set,
// bundled by scripts/bundle-openapi.mjs and imported as a module, so they ship
// inside the build.
import catalog from "../.generated/errors.mjs";
import { type MarkdownPageData, markdownPageData, text } from "./markdown.ts";

// The API reference's Errors page: every code the server defines, what it
// means, and the operations that can return it, grouped by the code's
// namespace, the part before its dot. The page is Markdown (lib/markdown.ts)
// and links each operation's page. llms-full.txt leaves the operations out, so
// there an operation's name is text, and the link is to its section's page.

export type ErrorCatalog = {
  /** Every code the server defines, with what its schema says it means. */
  codes: { code: string; description: string }[];
  /** Each operation's error set, the codes it can return, by operationId. */
  errorSets: Record<string, string[]>;
};

/** An operation of the API, in the reference's order. */
export type ApiOperation = {
  operationId: string;
  summary: string;
  method: string;
  path: string;
  /** The operation's page. */
  url: string;
  /** The reference's section the operation's page is in. */
  section: { title: string; url: string };
  /** Whether the operation declares a `429` response. */
  rateLimited: boolean;
};

const description =
  "Every error code of the API, what it means, and the operations that return it.";

// A heading's anchor is the code itself, /docs/reference/api/errors#user.not_found,
// and a namespace's its name.
const heading = (depth: number, name: string, id: string) =>
  `${"#".repeat(depth)} \`${name}\` [#${id}]`;

const sentence = (value: string) => text(/[.!?]$/.test(value) ? value : `${value}.`);

type Links = { linkOperation: boolean };

/** The operations, by section, in the reference's order. */
function operationList(operations: ApiOperation[], { linkOperation }: Links) {
  const sections = new Map<string, { title: string; names: string[] }>();
  for (const { summary, method, path, url, section } of operations) {
    const entry = sections.get(section.url) ?? { title: section.title, names: [] };
    const name = linkOperation ? `[${text(summary)}](${url})` : text(summary);
    entry.names.push(`${name} (\`${method.toUpperCase()} ${path}\`)`);
    sections.set(section.url, entry);
  }
  return [...sections]
    .map(([url, { title, names }]) => `- [${text(title)}](${url}): ${names.join(", ")}`)
    .join("\n");
}

// A code most operations can return lists the ones that cannot.
function returnedBy(code: string, operations: ApiOperation[], links: Links) {
  const returning = operations.filter(({ operationId }) =>
    catalog.errorSets[operationId]?.includes(code),
  );
  if (returning.length === 0) return "No operation's error set includes it.";
  if (returning.length === operations.length) return "Every operation can return it.";
  if (returning.length > operations.length / 2) {
    const others = operations.filter((operation) => !returning.includes(operation));
    return `Every operation can return it, except:\n\n${operationList(others, links)}`;
  }
  return `Returned by:\n\n${operationList(returning, links)}`;
}

function errorsMarkdown(operations: ApiOperation[], apiUrl: string, links: Links) {
  const namespaces = new Map<string, ErrorCatalog["codes"]>();
  for (const entry of [...catalog.codes].sort((a, b) => (a.code < b.code ? -1 : 1))) {
    const [namespace = ""] = entry.code.includes(".") ? entry.code.split(".") : [];
    namespaces.set(namespace, [...(namespaces.get(namespace) ?? []), entry]);
  }
  // The codes without a namespace first: they are about no resource.
  const groups = [...namespaces].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : 0));

  const rateLimited = operations.filter((operation) => operation.rateLimited);
  return [
    `Every error the API returns is the [error envelope](${apiUrl}#errors), a JSON object whose \`code\` says what went wrong. This page lists every code the server defines, generated from the API's error schemas, with what it means and the operations that can return it. An operation's error set, the codes it can return, is generated from the server's code.`,
    "The API document ties no code to an HTTP status: branch on `code`, not on the status.",
    ...(rateLimited.length > 0
      ? [
          "## Too many requests [#too-many-requests]",
          `These operations declare a \`429 Too Many Requests\` response, with the error envelope as its body ([rate limits](${apiUrl}#rate-limits)):`,
          operationList(rateLimited, links),
        ]
      : []),
    ...groups.flatMap(([namespace, codes]) => [
      namespace === ""
        ? "## Without a namespace [#no-namespace]"
        : heading(2, namespace, namespace),
      ...codes.flatMap(({ code, description: meaning }) => [
        heading(3, code, code),
        sentence(meaning),
        returnedBy(code, operations, links),
      ]),
    ]),
  ].join("\n\n");
}

/**
 * The page, at `${baseDir}/errors`, beside the API's operations: its table of
 * contents lists the namespaces, not each of the codes.
 */
export function errorSource(
  baseDir: string,
  apiUrl: string,
  operations: ApiOperation[],
): Source<{ pageData: MarkdownPageData; metaData: MetaData }> {
  const data = markdownPageData(
    "Errors",
    description,
    errorsMarkdown(operations, apiUrl, { linkOperation: true }),
    errorsMarkdown(operations, apiUrl, { linkOperation: false }),
  );
  return {
    files: [
      {
        type: "page",
        path: `${baseDir}/errors.mdx`,
        data: { ...data, toc: data.toc.filter((item) => item.depth <= 2) },
      },
    ],
  };
}
