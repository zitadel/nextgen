import { Monitor, Moon, Sun } from "lucide-react";
import { type KeyboardEvent, useRef } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type ThemePreference, useTheme } from "@/theme";

// `hint` is what the icon cannot say on its own — a monitor glyph reads as
// "display", not "follow the operating system". The label stays the short
// name so the radio's accessible name is not a sentence.
const THEME_OPTIONS: { value: ThemePreference; label: string; hint: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", hint: "Light theme", icon: Sun },
  { value: "dark", label: "Dark", hint: "Dark theme", icon: Moon },
  { value: "system", label: "System", hint: "Match system theme", icon: Monitor },
];

export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectIndex = (index: number) => {
    const next = THEME_OPTIONS[index];
    if (!next) return;
    setPreference(next.value);
    optionRefs.current[index]?.focus();
  };

  const onOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = THEME_OPTIONS.length - 1;
    let nextIndex: number | null = null;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = index === last ? 0 : index + 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = index === 0 ? last : index - 1;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    selectIndex(nextIndex);
  };

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="hidden shrink-0 items-center gap-0.5 rounded-md border border-border p-0.5 sm:inline-flex"
    >
      {THEME_OPTIONS.map(({ value, label, hint, icon: Icon }, index) => {
        const active = preference === value;
        return (
          <Tooltip key={value}>
            <TooltipTrigger asChild>
              {/* biome-ignore lint/a11y/useSemanticElements: ARIA radiogroup pattern with roving tabindex and arrow-key handling; native radio inputs cannot carry the icon styling or the ref array this control needs */}
              <button
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={label}
                tabIndex={active ? 0 : -1}
                onClick={() => setPreference(value)}
                onKeyDown={(event) => onOptionKeyDown(event, index)}
                className={`inline-flex size-7 items-center justify-center rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                  active
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon size={15} aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent>{hint}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
