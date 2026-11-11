import { useEffect, useState } from "react";

/** How long typing pauses before a search goes out: one request per pause, not per keystroke. */
export const TYPING_PAUSE_MS = 200;

/** `value`, once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
