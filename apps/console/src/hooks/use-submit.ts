import { useCallback, useRef, useState } from "react";

import { describeError } from "@/lib/api-error";

/**
 * One mutation's pending and error state.
 *
 * `run` ignores a call made while one is in flight, clears the previous error,
 * and turns a rejection into the operator-facing message (`describeError`).
 * `setError` is for a refusal the form decides itself, before any request.
 */
export function useSubmit(action: () => Promise<void>, fallback: string) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  // The latest closure, so `run` stays stable while the form's values change.
  const actionRef = useRef(action);
  actionRef.current = action;
  const pendingRef = useRef(false);

  const run = useCallback(async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(undefined);
    try {
      await actionRef.current();
    } catch (cause) {
      setError(describeError(cause, fallback));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }, [fallback]);

  const clearError = useCallback(() => setError(undefined), []);

  return { run, pending, error, setError, clearError };
}
