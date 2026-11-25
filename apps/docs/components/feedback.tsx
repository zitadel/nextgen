"use client";
import { usePathname } from "fumadocs-core/framework";
import { buttonVariants } from "fumadocs-ui/components/ui/button";
import { Collapsible, CollapsibleContent } from "fumadocs-ui/components/ui/collapsible";
import { type ReactNode, type SyntheticEvent, useEffect, useState } from "react";

import {
  feedbackRoute,
  MAX_LENGTH,
  OPINIONS,
  type PageFeedback,
  pageFeedback,
} from "@/lib/feedback";

// Fumadocs' page feedback (`@fumadocs/cli add feedback`) on Vercel's docs'
// four-face scale. A rating goes to feedbackRoute, which sends it on to Vercel
// Web Analytics as a custom event; its block feedback and GitHub link are left
// out.

type Opinion = PageFeedback["opinion"];

// Each face on a 24px grid, drawn as Lucide draws its faces.
const FACES: Record<Opinion, { label: string; features: ReactNode }> = {
  awful: {
    label: "Not helpful at all",
    features: (
      <>
        <path d="M7.5 9c.7.6 1.8.6 2.5 0M14 9c.7.6 1.8.6 2.5 0" />
        <path d="M10 17.5c.3-1 1-1.5 2-1.5s1.7.5 2 1.5" />
        <path d="M8.75 11.5v3M15.25 11.5v3" />
      </>
    ),
  },
  bad: {
    label: "Not very helpful",
    features: (
      <>
        <path d="M9 9h.01M15 9h.01" strokeWidth={2.5} />
        <path d="M8 16s1.5-2 4-2 4 2 4 2" />
      </>
    ),
  },
  good: {
    label: "Helpful",
    features: (
      <>
        <path d="M9 9h.01M15 9h.01" strokeWidth={2.5} />
        <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      </>
    ),
  },
  great: {
    label: "Very helpful",
    features: (
      <>
        <path
          className="fill-(--zl-warning) stroke-(--zl-warning)"
          strokeWidth={0.75}
          d="M8.5 7.4l.53 1.37 1.47.08-1.14.93.37 1.42-1.23-.8-1.23.8.37-1.42-1.14-.93 1.47-.08ZM15.5 7.4l.53 1.37 1.47.08-1.14.93.37 1.42-1.23-.8-1.23.8.37-1.42-1.14-.93 1.47-.08Z"
        />
        <path d="M8 13.5h8a4 4 0 0 1-8 0Z" />
      </>
    ),
  },
};

/** Rates the page it ends: lib/feedback.ts's event in Web Analytics. */
export function Feedback() {
  const page = usePathname();
  const { previous, setPrevious } = useSubmissionStorage(page);
  const [opinion, setOpinion] = useState<Opinion | null>(null);
  const [message, setMessage] = useState("");

  function submit(e?: SyntheticEvent) {
    e?.preventDefault();
    if (opinion == null) return;

    const feedback: PageFeedback = { opinion, page, message: message.trim().slice(0, MAX_LENGTH) };
    // The reader is thanked either way: a lost rating is not theirs to retry.
    fetch(feedbackRoute, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(feedback),
      // Outlives a navigation away right after Send.
      keepalive: true,
    }).catch(() => {});
    setPrevious(feedback);
    setMessage("");
    setOpinion(null);
  }

  const activeOpinion = previous?.opinion ?? opinion;

  return (
    <Collapsible
      open={opinion !== null || previous !== null}
      onOpenChange={(v) => {
        if (!v) setOpinion(null);
      }}
      className="mx-auto w-full max-w-lg rounded-xl border bg-fd-card text-fd-card-foreground"
    >
      <div className="flex flex-row flex-wrap items-center justify-center gap-1 p-3">
        <p className="text-sm text-fd-muted-foreground pe-3">Was this helpful?</p>
        {OPINIONS.map((value) => (
          <button
            key={value}
            type="button"
            title={FACES[value].label}
            aria-label={FACES[value].label}
            aria-pressed={activeOpinion === value}
            disabled={previous !== null}
            className={`inline-flex size-10 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed ${
              activeOpinion === value
                ? "bg-fd-accent text-fd-accent-foreground"
                : "text-fd-muted-foreground hover:enabled:bg-fd-accent hover:enabled:text-fd-accent-foreground"
            }`}
            onClick={() => setOpinion(value)}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="size-7"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              {FACES[value].features}
            </svg>
          </button>
        ))}
      </div>
      <CollapsibleContent>
        {previous ? (
          <div className="flex flex-col items-center gap-3 border-t px-3 py-6 text-sm text-fd-muted-foreground">
            <p>Thank you for your feedback!</p>
            <button
              type="button"
              className={`${buttonVariants({ variant: "secondary" })} text-xs`}
              onClick={() => {
                setOpinion(previous.opinion);
                setPrevious(null);
              }}
            >
              Submit again
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="px-3 pt-1 pb-3">
              <textarea
                // biome-ignore lint/a11y/noAutofocus: it opens on the reader's own click, as in Fumadocs.
                autoFocus
                aria-label="Your feedback"
                maxLength={MAX_LENGTH}
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full rounded-lg border bg-fd-background p-3 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring placeholder:text-fd-muted-foreground"
                placeholder="Your feedback… (optional)"
                onKeyDown={(e) => {
                  // keyCode 229: Safari fires `compositionend` before this keydown, `isComposing` is already false
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                  if (!e.shiftKey && e.key === "Enter") submit(e);
                }}
              />
            </div>
            <div className="flex justify-end border-t p-3">
              <button type="submit" className={`${buttonVariants({ variant: "primary" })} px-4`}>
                Send
              </button>
            </div>
          </form>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// Remembers a page's feedback in this browser, so a reload shows the thanks
// and not a second rating.
function useSubmissionStorage(page: string) {
  const storageKey = `docs-feedback-${page}`;
  const [value, setValue] = useState<PageFeedback | null>(null);

  useEffect(() => {
    try {
      const item = localStorage.getItem(storageKey);
      const result = item === null ? null : pageFeedback.safeParse(JSON.parse(item));
      setValue(result?.success ? result.data : null);
    } catch {
      setValue(null);
    }
  }, [storageKey]);

  return {
    previous: value,
    setPrevious(result: PageFeedback | null) {
      try {
        if (result) localStorage.setItem(storageKey, JSON.stringify(result));
        else localStorage.removeItem(storageKey);
      } catch {
        // Without storage the thanks lasts until the next page load.
      }
      setValue(result);
    },
  };
}
