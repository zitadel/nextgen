import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { useSearchDraft } from "@/hooks/use-search-draft";
import { cn } from "@/lib/utils";

/**
 * The search over every project the person can act on: beside the Projects
 * title as a list's filter is (D25), and over the list where a screen asks
 * for a project first (`ProjectPicker`). A pause in typing settles the term
 * where `onSearch` keeps it (the URL's `?q=`, whose loader sends it to the
 * server), so it is never matched against the rows already loaded
 * (`useSearchDraft`).
 */
export function ProjectSearch({
  query,
  onSearch,
  className,
}: {
  query: string;
  onSearch: (q: string) => void;
  /** The field's width, which each place sets. It fills its parent otherwise. */
  className?: string;
}) {
  const [draft, setDraft] = useSearchDraft(query, onSearch);

  return (
    <div className={cn("relative w-full", className)}>
      <Search
        aria-hidden
        strokeWidth={1.5}
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
      />
      <Input
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Search projects"
        aria-label="Search projects"
        className="pl-8"
      />
    </div>
  );
}
