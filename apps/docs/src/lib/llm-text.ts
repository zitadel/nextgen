type StructuredEntry = {
  content: string;
  heading: string | undefined;
};

type StructuredHeading = {
  id: string;
  content: string;
};

type StructuredData = {
  headings: StructuredHeading[];
  contents: StructuredEntry[];
};

export async function pageToLLMText(page: unknown): Promise<string | undefined> {
  const normalized = normalizePage(page);
  const title = normalized.title ?? normalized.url;
  const description = normalized.description ?? "";
  const markdown = findString(normalized.data, ["processedMarkdown", "markdown", "content", "body"]);
  const structuredData = await resolveStructuredData(normalized.data.structuredData);
  const structured = structuredData?.contents
    ?.map((entry) => [entry.heading, entry.content].filter(Boolean).join("\n"))
    .filter(Boolean)
    .join("\n\n");
  const body = markdown ?? structured ?? description;

  if (!body.trim()) return undefined;

  return [`# ${title} (${normalized.url})`, description, body]
    .filter((part, index) => index === 0 || part.trim().length > 0)
    .join("\n\n");
}

export async function pageToFlexsearchIndex(page: unknown) {
  const normalized = normalizePage(page);
  const structuredData = await resolveStructuredData(normalized.data.structuredData);

  return {
    id: normalized.url,
    title: normalized.title ?? normalized.url,
    description: normalized.description ?? "",
    url: normalized.url,
    content: (await pageToLLMText(page)) ?? normalized.description ?? "",
    locale: normalized.locale ?? "",
    structuredData,
    tag: normalized.path?.split("/")[0] ?? "docs",
  };
}

export async function pageToMcpIndex(page: unknown) {
  const normalized = normalizePage(page);

  return {
    title: normalized.title ?? normalized.url,
    description: normalized.description ?? "",
    url: normalized.url,
    content: (await pageToLLMText(page)) ?? normalized.description ?? "",
    locale: normalized.locale ?? "",
  };
}

function findString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }

  return undefined;
}

function normalizePage(page: unknown) {
  const record = asRecord(page);
  const data = asRecord(record.data);

  return {
    url: typeof record.url === "string" ? record.url : "",
    path: typeof record.path === "string" ? record.path : undefined,
    locale: typeof record.locale === "string" ? record.locale : undefined,
    title: typeof data.title === "string" ? data.title : undefined,
    description: typeof data.description === "string" ? data.description : undefined,
    data,
  };
}

async function resolveStructuredData(value: unknown): Promise<StructuredData> {
  const resolved = typeof value === "function" ? await value() : value;
  const record = asRecord(resolved);
  const contents = Array.isArray(record.contents)
    ? record.contents.flatMap((entry) => {
        const item = asRecord(entry);
        const content = typeof item.content === "string" ? item.content : "";
        if (!content) return [];

        return [
          {
            heading: typeof item.heading === "string" ? item.heading : undefined,
            content,
          },
        ];
      })
    : [];
  const headings = Array.isArray(record.headings)
    ? record.headings.flatMap((entry) => {
        const item = asRecord(entry);
        const id = typeof item.id === "string" ? item.id : "";
        const content = typeof item.content === "string" ? item.content : "";
        if (!id || !content) return [];

        return [{ id, content }];
      })
    : [];

  return {
    headings,
    contents,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
