"use client";

import { useEffect, useState } from "react";
import { type Placement, type Snippet, trackEvent } from "./analytics";
import { BAR_BUTTON } from "./window";

// Copies `text`, and says so for a moment. Where the browser offers no
// clipboard (an insecure origin), it does nothing: the text stays selectable.
// `label` names what it copies for screen readers; `withLabel` shows the word
// beside the icon; `event` reports a copy as `copied_command`
// (analytics.ts), and a button without one reports nothing. Icons from
// zitadel/new-website's components/icons.
export function CopyButton({
  text,
  label,
  withLabel = false,
  event,
  className = "",
}: {
  text: string;
  label: string;
  withLabel?: boolean;
  event?: { snippet: Snippet; placement: Placement };
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const reset = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(reset);
  }, [copied]);

  const copy = () =>
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        if (event) {
          trackEvent("copied_command", event);
        }
      },
      () => {},
    );

  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={withLabel ? undefined : `Copy ${label}`}
        className={`${BAR_BUTTON} ${copied ? "text-success" : "text-text-secondary"} ${className}`}
      >
        {copied ? <Check /> : <Copy />}
        {withLabel && (
          <span>
            {copied ? "Copied" : "Copy"}
            <span className="sr-only"> {label}</span>
          </span>
        )}
      </button>
      <span role="status" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
    </>
  );
}

function Check() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="size-4">
      <path
        d="M20 6L9 17L4 12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Copy() {
  return (
    <svg aria-hidden="true" viewBox="0 0 10 10" fill="none" className="size-3.5">
      <path
        d="M8 3.2H4c-.44 0-.8.36-.8.8v4c0 .44.36.8.8.8h4c.44 0 .8-.36.8-.8V4c0-.44-.36-.8-.8-.8Z"
        stroke="currentColor"
        strokeWidth="0.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M1.6 6.4c-.44 0-.8-.36-.8-.8v-4c0-.44.36-.8.8-.8h4c.44 0 .8.36.8.8"
        stroke="currentColor"
        strokeWidth="0.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
