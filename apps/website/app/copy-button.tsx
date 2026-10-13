"use client";

import { useEffect, useState } from "react";

// Copies the commands beside it, and says so for two seconds. Where the
// browser offers no clipboard (an insecure origin), it does nothing: the
// commands stay selectable. Icons from zitadel/new-website's components/icons.
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const reset = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(reset);
  }, [copied]);

  const copy = () =>
    navigator.clipboard?.writeText(text).then(
      () => setCopied(true),
      () => {},
    );

  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={label}
        title={copied ? "Copied" : label}
        className="absolute top-3 right-3 flex size-8 cursor-pointer items-center justify-center rounded-md border border-border-primary bg-surface-black-secondary text-text-primary transition-colors hover:bg-background"
      >
        {copied ? <Check /> : <Copy />}
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
