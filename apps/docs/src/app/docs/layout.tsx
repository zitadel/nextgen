import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import { guideSource } from "@/lib/source";

export default function DocsLayoutWrapper({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <DocsLayout
      tree={guideSource.pageTree}
      nav={{
        title: "ZITADEL Docs",
        url: "/",
      }}
      links={[
        { text: "Guides", url: "/docs", active: "nested-url" },
        { text: "API Reference", url: "/api", active: "nested-url" },
      ]}
    >
      {children}
    </DocsLayout>
  );
}
