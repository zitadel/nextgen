import { type RefObject, useEffect } from "react";

/** Platform-correct label for the find shortcut (⌘ on Apple, Ctrl elsewhere). */
export function findShortcutLabel(): string {
  if (typeof navigator === "undefined") return "Ctrl+F";
  const apple =
    /Mac|iPhone|iPad|iPod/.test(navigator.platform) ||
    /Mac OS|iPhone|iPad|iPod/.test(navigator.userAgent);
  return apple ? "⌘F" : "Ctrl+F";
}

/**
 * ⌘F / Ctrl+F focuses `target` instead of the browser find bar, unless the
 * event already targets an editable field.
 */
export function useFindShortcut(target: RefObject<HTMLElement | null>) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "f") return;
      const source = event.target;
      if (source instanceof HTMLElement) {
        const tag = source.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || source.isContentEditable) {
          return;
        }
      }
      event.preventDefault();
      target.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [target]);
}
