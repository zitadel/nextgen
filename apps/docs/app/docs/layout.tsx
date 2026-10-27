import { DocsLayout } from "fumadocs-ui/layouts/spacious";

import { Sidebar, SidebarDrawer, SidebarProvider } from "@/components/sidebar";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";

export default function Layout({ children }: LayoutProps<"/docs">) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      // A section steps down in the sidebar (components/sidebar.tsx) in place of
      // Fumadocs' menu of root folders.
      tabs={false}
      slots={{ sidebar: { provider: SidebarProvider, main: Sidebar, drawer: SidebarDrawer } }}
      {...baseOptions()}
    >
      {children}
    </DocsLayout>
  );
}
