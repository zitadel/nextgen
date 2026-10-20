import { createFromSource } from "fumadocs-core/search/server";

import { searchIndex, source } from "@/lib/source";

export const { GET } = createFromSource(source, { buildIndex: searchIndex });
