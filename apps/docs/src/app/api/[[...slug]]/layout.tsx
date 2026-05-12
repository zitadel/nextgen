import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import { apiSource } from "@/lib/source";

export default function APILayoutWrapper({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <DocsLayout
      tree={apiSource.pageTree}
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
