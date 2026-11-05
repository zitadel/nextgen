"use client";

import { useEffect, useState } from "react";
import { THEME_KEY } from "./theme";
import { SEGMENTS, segment } from "./window";

/** The visitor's choice: a side, or whatever their system shows. */
export type ThemeChoice = "system" | "light" | "dark";

// Told on every choice, so the header's toggle and the footer's switch agree.
const CHOICE_EVENT = "zitadel-theme";

function storedChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

/**
 * Makes `choice` the page's theme: kept for the next visit, or forgotten for
 * System, which then follows the system as theme.ts's script does.
 */
function setTheme(choice: ThemeChoice) {
  try {
    if (choice === "system") {
      localStorage.removeItem(THEME_KEY);
    } else {
      localStorage.setItem(THEME_KEY, choice);
    }
  } catch {
    // Private mode: the choice lasts until the page reloads.
  }
  const system = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.dataset.theme = choice === "system" ? system : choice;
  window.dispatchEvent(new Event(CHOICE_EVENT));
}

/** Whether the page shows its light side, following every change (theme.ts). */
export function usePageLight(): boolean {
  const [light, setLight] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setLight(root.dataset.theme === "light");
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return light;
}

/** The visitor's current choice, following the other controls and tabs. */
function useThemeChoice(): ThemeChoice {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    const read = () => setChoice(storedChoice());
    read();
    window.addEventListener(CHOICE_EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(CHOICE_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);

  return choice;
}

/** A sun for light, a moon for dark, a screen for the system's. */
export function ThemeIcon({ theme }: { theme: ThemeChoice }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
    >
      {theme === "light" && (
        <>
          <circle cx="8" cy="8" r="3" />
          <path d="M8 1.5v1.25M8 13.25v1.25M1.5 8h1.25M13.25 8h1.25M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9" />
        </>
      )}
      {theme === "dark" && <path d="M13.5 9.6A5.75 5.75 0 0 1 6.4 2.5a5.75 5.75 0 1 0 7.1 7.1Z" />}
      {theme === "system" && (
        <>
          <rect x="1.75" y="2.5" width="12.5" height="8.5" rx="1.5" />
          <path d="M5.5 13.75h5M8 11v2.75" />
        </>
      )}
    </svg>
  );
}

/** The header's quick flip between the page's sides; the choice holds from then on. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const light = usePageLight();
  return (
    <button
      type="button"
      aria-label="Light mode"
      aria-pressed={light}
      title={light ? "Switch to dark mode" : "Switch to light mode"}
      onClick={() => setTheme(light ? "dark" : "light")}
      className={`cursor-pointer ${className}`}
    >
      <ThemeIcon theme={light ? "light" : "dark"} />
    </button>
  );
}

const CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** The footer's switch between the system's theme and either side. */
export function ThemeSwitch() {
  const choice = useThemeChoice();
  return (
    <fieldset className={SEGMENTS}>
      <legend className="sr-only">Theme</legend>
      {CHOICES.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          aria-pressed={choice === value}
          aria-label={label}
          title={label}
          onClick={() => setTheme(value)}
          className={`${segment(choice === value)} inline-flex items-center`}
        >
          <ThemeIcon theme={value} />
        </button>
      ))}
    </fieldset>
  );
}
