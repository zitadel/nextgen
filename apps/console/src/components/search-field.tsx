import { Search } from "lucide-react";
import type { Ref } from "react";

import { Input } from "@/components/ui/input";
import { useSearchDraft } from "@/hooks/use-search-draft";
import { cn } from "@/lib/utils";

/**
 * A list's search field. A pause in typing settles the term into the URL
 * (`?q=`), whose loader sends it to the server (`useSearchDraft`). `label` is
 * both the placeholder and the accessible name, so it says what the field reads.
 */
export function SearchField({
  query,
  onSearch,
  label,
  className,
  inputRef,
}: {
  query: string;
  onSearch: (q: string) => void;
  label: string;
  /** The field's width. */
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const [draft, setDraft] = useSearchDraft(query, onSearch);

  return (
    <div className={cn("relative", className)}>
      <Search
        aria-hidden
        strokeWidth={1.5}
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
      />
      <Input
        ref={inputRef}
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={label}
        aria-label={label}
        className="pl-8"
      />
    </div>
  );
}
