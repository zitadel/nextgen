"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";

/**
 * A button that shows and hides a panel of links under it: the disclosure
 * pattern, not an ARIA menu, so the links keep their reading order and Tab
 * walks them. Open, it closes on Escape, which gives the button its focus
 * back, on a click or a tap outside it, and when the keyboard moves focus
 * out of it. A focus change with no element to go to (Safari's click on a
 * link) is left to the click, or the panel would close before its link opens.
 */
export function Disclosure({
  label,
  buttonClassName,
  panelClassName,
  children,
}: {
  /** The button's content; give it text a screen reader can read. */
  label: ReactNode;
  buttonClassName: string;
  panelClassName: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useId();

  useEffect(() => {
    const element = root.current;
    if (!open || !element) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !element.contains(event.target)) {
        setOpen(false);
      }
    };
    const onFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && !element.contains(event.relatedTarget)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("focusout", onFocusOut);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((shown) => !shown)}
        className={`cursor-pointer ${buttonClassName}`}
      >
        {label}
      </button>
      <div id={panel} hidden={!open} className={panelClassName}>
        {children}
      </div>
    </div>
  );
}
