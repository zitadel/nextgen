import { useEffect, useState } from "react";

import { TYPING_PAUSE_MS, useDebounced } from "./use-debounced";

/**
 * A search field whose settled term lives elsewhere, such as the URL: the
 * field's draft, and its setter.
 *
 * Once typing pauses, the trimmed draft is handed to `write`. What the field
 * wrote last is its echo. `committed` coming back as that echo is the field's
 * own write landing, and leaves the draft alone, so nothing typed since is
 * rewound. Any other committed value came from somewhere else (a link that
 * clears the search, the back button) and replaces the draft.
 */
export function useSearchDraft(
  committed: string,
  write: (term: string) => void,
): [string, (draft: string) => void] {
  const [draft, setDraft] = useState(committed);
  const [echo, setEcho] = useState(committed);
  const [seen, setSeen] = useState(committed);
  if (committed !== seen) {
    setSeen(committed);
    if (committed !== echo) {
      setEcho(committed);
      setDraft(committed);
    }
  }

  const typed = useDebounced(draft.trim(), TYPING_PAUSE_MS);
  useEffect(() => {
    // Only a settled draft is written: a pause that began before the draft was
    // replaced must not write the old one back.
    if (typed !== draft.trim() || typed === echo) return;
    setEcho(typed);
    write(typed);
  }, [typed, draft, echo, write]);

  return [draft, setDraft];
}
