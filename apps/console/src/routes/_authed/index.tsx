import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Home.
 *
 * **There is no Home screen, so `/` lands on Teams.** The designed overview is a
 * set of figures nothing can compute: the stat cards need an aggregate or count
 * endpoint (`POST /users/query` and `POST /projects/query` return pages),
 * "Total Projects" and its trend need a multi-project list and a time series,
 * and the "Browse all" rows have no resource behind them at all. Rendering a
 * page that explains this is worse than going somewhere useful, because `/` is
 * where sign-in, the logo and the claim flow's "Open the console" all land.
 *
 * Teams is the target because it is where a developer arriving through those
 * paths belongs: the claim flow hands the project to a team, so "Open the
 * console" should show the team that now owns it rather than a user list.
 * Point this at the overview when the figures behind it exist, restoring the
 * mock parked below and replacing its dummy constants with loader data.
 */
export const Route = createFileRoute("/_authed/")({
  beforeLoad: () => {
    // Teams pins its tab in the URL, so the redirect has to name one.
    throw redirect({ to: "/teams", search: { status: "active" } });
  },
});

// --- Parked design mock (see the note above) --------------------------------
//
// import { FolderCheck, Plus, Search, Trash2 } from "lucide-react";
// import { useState } from "react";
//
// import { Badge } from "@/components/ui/badge";
// import { Button } from "@/components/ui/button";
// import { Input } from "@/components/ui/input";
// import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
//
// import { Page } from "../../components/layout";
//
// const STAT_CARDS = [
//   { title: "SL Mobbin", subtitle: "142 items" },
//   { title: "SL Mobbin", subtitle: "142 items" },
// ] as const;
//
// const TABS = ["Statistics", "Tab 2", "Tab 3", "Tab 4", "Tab 5"] as const;
//
// const BROWSE_ROWS = [
//   { title: "AS Mobbin", description: "Contains various files and project workflows for AS Mobbin." },
//   { title: "Demo folder", description: "Contains various files and project workflows for Demo folder." },
//   { title: "SL Mobbin", description: "Contains various files and project workflows for SL Mobbin." },
//   { title: "SL Mobbin", description: "Contains various files and project workflows for SL Mobbin." },
//   { title: "SL Mobbin", description: "Contains various files and project workflows for SL Mobbin." },
// ] as const;
//
// function Dashboard() {
//   const [query, setQuery] = useState("");
//   const [activeTab, setActiveTab] = useState(0);
//   const rows = BROWSE_ROWS.filter((row) => row.title.toLowerCase().includes(query.trim().toLowerCase()));
//
//   return (
//     <Page>
//       <header className="flex items-center justify-between gap-4">
//         <div className="flex flex-col gap-2">
//           <h1 className="font-serif text-2xl tracking-tight text-foreground">General</h1>
//           <p className="text-sm text-muted-foreground">This is a sub headline</p>
//         </div>
//         <Button>
//           Primary action
//           <Plus aria-hidden />
//         </Button>
//       </header>
//
//       <Tabs
//         value={String(activeTab)}
//         onValueChange={(value) => setActiveTab(Number(value))}
//         className="mt-6"
//       >
//         <TabsList aria-label="Views">
//           {TABS.map((tab, index) => (
//             <TabsTrigger key={tab} value={String(index)}>
//               {tab}
//             </TabsTrigger>
//           ))}
//         </TabsList>
//       </Tabs>
//
//       <div className="mt-8 grid gap-3 md:grid-cols-3">
//         {STAT_CARDS.map((card, index) => (
//           <div key={index} className="flex flex-col gap-4 rounded-lg bg-card p-6">
//             <FolderCheck size={24} className="text-foreground" aria-hidden />
//             <div className="flex flex-col gap-1">
//               <p className="text-base font-semibold leading-6 text-foreground">{card.title}</p>
//               <p className="text-xs leading-4 text-muted-foreground">{card.subtitle}</p>
//             </div>
//           </div>
//         ))}
//         <div className="flex flex-col gap-4 rounded-lg bg-card p-6">
//           <p className="text-2xl font-semibold tracking-[-0.5px] text-foreground">142</p>
//           <div className="flex flex-wrap items-center gap-1.5">
//             <p className="text-sm text-muted-foreground">Total Projects</p>
//             <Badge variant="secondary">+ 18,0%</Badge>
//           </div>
//         </div>
//       </div>
//
//       <section className="mt-8 pt-5">
//         <div className="mb-5 flex items-center justify-between gap-4">
//           <h2 className="font-serif text-base text-foreground">Browse all</h2>
//           <div className="relative w-full max-w-[360px]">
//             <Search
//               size={16}
//               className="pointer-events-none absolute left-3 top-1/2 shrink-0 -translate-y-1/2 text-foreground"
//               aria-hidden
//             />
//             <Input
//               type="search"
//               name="folder-search"
//               value={query}
//               onChange={(event) => setQuery(event.target.value)}
//               placeholder="Search"
//               aria-label="Search"
//               className="pl-9"
//             />
//           </div>
//         </div>
//
//         <div className="overflow-hidden rounded-lg border border-border">
//           {rows.length === 0 ? (
//             <p className="p-5 text-sm text-muted-foreground">No results for “{query}”.</p>
//           ) : (
//             rows.map((row, index) => (
//               <div
//                 key={index}
//                 className="flex cursor-pointer items-center gap-5 border-b border-border p-5 transition-colors last:border-b-0 hover:bg-accent"
//               >
//                 <FolderCheck size={24} className="shrink-0 text-foreground" aria-hidden />
//                 <div className="flex min-w-0 flex-1 flex-col gap-0.5">
//                   <p className="text-sm font-semibold text-foreground">{row.title}</p>
//                   <p className="truncate text-xs text-muted-foreground">{row.description}</p>
//                 </div>
//                 <span className="shrink-0 text-xs text-muted-foreground">Alex Smith</span>
//                 <button
//                   type="button"
//                   aria-label={`Remove ${row.title}`}
//                   className="shrink-0 text-muted-foreground hover:text-foreground"
//                 >
//                   <Trash2 size={20} aria-hidden />
//                 </button>
//               </div>
//             ))
//           )}
//         </div>
//       </section>
//     </Page>
//   );
// }
