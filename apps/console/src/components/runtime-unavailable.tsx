import { useState } from "react";

import {
  STANDALONE_BODY,
  StandaloneMessage,
  StandaloneScreen,
} from "@/components/standalone-screen";
import { Button } from "@/components/ui/button";
import { InlineCode } from "@/components/ui/inline-code";
import { RUNTIME_URL, type ConsoleRuntimeFailure } from "@/runtime/runtime";

/**
 * Boot-time connectivity error (Console ADR 0004 §3).
 *
 * Rendered by `main.tsx` in place of the router when runtime discovery finds
 * the endpoint unreachable, erroring, or unreadable. It is deliberately the
 * one console screen that renders without the router: with no runtime
 * document there is no sign-in project, so every route below the guard would
 * fail the same way, and the login screen's "No project yet" hint — the state
 * this screen exists to be distinguishable from — would send an operator to
 * run `zitadel setup` against a server problem setup cannot fix.
 *
 * Retry re-runs discovery in place rather than reloading: an operator who
 * starts the server (or fixes the proxy) in another window gets the console
 * on one click, and a reload would cost the same round trip anyway.
 */
export interface RuntimeUnavailableProps {
  failure: ConsoleRuntimeFailure;
  /** Re-runs discovery; resolves once the next attempt has been rendered. */
  onRetry: () => Promise<void>;
}

export function RuntimeUnavailable({ failure, onRetry }: RuntimeUnavailableProps) {
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      // A successful retry has already swapped this screen for the router,
      // so this only lands when the server is still unreachable.
      setRetrying(false);
    }
  };

  return (
    <StandaloneScreen>
      <StandaloneMessage title="Server unavailable" level={1} className="items-center gap-4">
        <p className={STANDALONE_BODY}>
          The console could not read its runtime configuration from{" "}
          <InlineCode>{RUNTIME_URL}</InlineCode> — {failure.detail}. Until it can, the console
          cannot tell whether this deployment has a project yet, so it stops here instead of
          guessing. Check that the Zitadel server is running and reachable from this origin, then
          try again.
        </p>
        <Button onClick={handleRetry} disabled={retrying}>
          {retrying ? "Retrying…" : "Try again"}
        </Button>
      </StandaloneMessage>
    </StandaloneScreen>
  );
}
