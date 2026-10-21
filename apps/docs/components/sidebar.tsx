"use client";

import { usePathname } from "fumadocs-core/framework";
import type * as PageTree from "fumadocs-core/page-tree";
import { TreeContextProvider, useTreeContext, useTreePath } from "fumadocs-ui/contexts/tree";
import {
  Sidebar as SpaciousSidebar,
  SidebarDrawer as SpaciousSidebarDrawer,
  SidebarProvider as SpaciousSidebarProvider,
} from "fumadocs-ui/layouts/spacious/slots/sidebar";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ComponentProps, createContext, type ReactNode, use, useMemo, useState } from "react";

import { SIDEBAR_ITEM, SIDEBAR_ITEM_ACTIVE } from "@/lib/layout.shared";

// The sidebar steps down into a section, as Vercel's docs do. A folder marked
// `root` in its meta.json is a section: Fumadocs lists only the open one. This
// adds the rest: at the top level a section is one row that opens its page, and
// inside it a row steps back up to the top level without leaving the page.
// Only the sidebar sees this tree; the page's breadcrumb, table of contents and
// footer keep Fumadocs' own.

type SidebarTree = { tree: PageTree.Root; step: (up: boolean) => void };

const SidebarTreeContext = createContext<SidebarTree | null>(null);

function useSidebarTree() {
  const context = use(SidebarTreeContext);
  if (!context) throw new Error("Render the docs sidebar under its SidebarProvider.");
  return context;
}

function isSection(node: PageTree.Node): node is PageTree.Folder {
  return node.type === "folder" && Boolean(node.root);
}

// The chevron of Fumadocs' folder rows, smaller than an item's icon: the `!`
// wins over the item's `[&_svg]:size-4`.
const CHEVRON = "ms-auto size-3.5!";

// Fumadocs keeps a tree until its $id changes, so each variant needs its own.
function sectionId(section: PageTree.Folder) {
  return section.$id ?? section.index?.url ?? String(section.name);
}

/** The nodes, with every section among them, at any depth, replaced. */
function mapSections(
  nodes: PageTree.Node[],
  replace: (section: PageTree.Folder) => PageTree.Node[],
): PageTree.Node[] {
  return nodes.flatMap((node) => {
    if (node.type !== "folder") return [node];
    if (node.root) return replace(node);
    return [{ ...node, children: mapSections(node.children, replace) }];
  });
}

/**
 * The top level: each section is a row that opens its page. The section the
 * page is in, when the reader stepped up out of it, is a row back in.
 */
function topLevel(full: PageTree.Root, current: PageTree.Folder | undefined): PageTree.Root {
  return {
    ...full,
    $id: `${full.$id}:top:${current ? sectionId(current) : ""}`,
    children: mapSections(full.children, (section) => {
      if (section === current) return [stepRow(section.name, false)];
      const url = section.index?.url ?? section.children.find((node) => node.type === "page")?.url;
      if (!url) return [];
      const name = (
        <>
          {section.name}
          <ChevronRight className={CHEVRON} />
        </>
      );
      return [{ type: "page", name, url, icon: section.icon }];
    }),
  };
}

/** The open section: a row back up, the section's own page, then its pages. */
function insideSection(full: PageTree.Root, open: PageTree.Folder): PageTree.Root {
  return {
    ...full,
    $id: `${full.$id}:${sectionId(open)}`,
    children: mapSections(full.children, (section) => {
      if (section !== open) return [section];
      const overview = section.index ? [{ ...section.index, name: "Overview" }] : [];
      return [
        { ...section, children: [stepRow(section.name, true), ...overview, ...section.children] },
      ];
    }),
  };
}

// A row of the sidebar's own is a button, which the page tree carries in a
// separator. The sidebar takes the separator's look off its paragraph, so the
// row sits as the tree's other rows do.
const ROW_PARAGRAPH =
  "[&_p:has(>[data-sidebar-row])]:m-0 [&_p:has(>[data-sidebar-row])]:p-0 [&_p:has(>[data-sidebar-row])]:[font:inherit]";

function stepRow(name: ReactNode, up: boolean): PageTree.Separator {
  return { type: "separator", name: <StepRow up={up}>{name}</StepRow> };
}

function StepRow({ up, children }: { up: boolean; children: ReactNode }) {
  const { step } = useSidebarTree();
  return (
    <button
      type="button"
      data-sidebar-row
      data-active={!up}
      onClick={() => step(up)}
      className={`${SIDEBAR_ITEM} ${up ? "font-medium text-fd-foreground" : SIDEBAR_ITEM_ACTIVE}`}
    >
      {up && <ChevronLeft className="size-3.5!" />}
      {up && <span className="sr-only">Back to all sections from </span>}
      {children}
      {!up && <ChevronRight className={CHEVRON} />}
    </button>
  );
}

/**
 * No title: the site bar above (components/site-header.tsx) carries the logo.
 * The empty box keeps the title's place, so the buttons beside it stay at the
 * row's end.
 */
export function SidebarTitle({ className }: ComponentProps<"a">) {
  return <span className={className} />;
}

/** Fumadocs' provider, with the tree the sidebar shows for the page. */
export function SidebarProvider(props: ComponentProps<typeof SpaciousSidebarProvider>) {
  const { full } = useTreeContext();
  const section = useTreePath().filter(isSection).at(-1);
  const pathname = usePathname();
  // The page at which the reader stepped up: the top level shows until they
  // step back in or go to another page.
  const [upAt, setUpAt] = useState<string>();
  const inside = section !== undefined && upAt !== pathname;

  const tree = useMemo(
    () => (section && inside ? insideSection(full, section) : topLevel(full, section)),
    [full, section, inside],
  );
  const value = useMemo(
    () => ({ tree, step: (up: boolean) => setUpAt(up ? pathname : undefined) }),
    [tree, pathname],
  );

  return (
    <SidebarTreeContext value={value}>
      <SpaciousSidebarProvider {...props} />
    </SidebarTreeContext>
  );
}

export function Sidebar({ className, ...props }: ComponentProps<typeof SpaciousSidebar>) {
  return (
    <TreeContextProvider tree={useSidebarTree().tree}>
      <SpaciousSidebar className={`${ROW_PARAGRAPH} ${className ?? ""}`} {...props} />
    </TreeContextProvider>
  );
}

// Fumadocs' drawer takes no class, so a box that draws nothing carries it.
export function SidebarDrawer() {
  return (
    <TreeContextProvider tree={useSidebarTree().tree}>
      <div className={`contents ${ROW_PARAGRAPH}`}>
        <SpaciousSidebarDrawer />
      </div>
    </TreeContextProvider>
  );
}
