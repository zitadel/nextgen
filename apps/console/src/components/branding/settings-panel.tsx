import { contrastIssues, type ContrastIssue } from "@zitadel/config/branding-contrast";
import { parseCssColor } from "@zitadel/config/css-color";
import { ChevronDown, ChevronUp, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator as BaseSeparator } from "@/components/ui/separator";
import { MAINTAINED_FONT_FAMILY, maintainedPalette } from "@/lib/branding-defaults";
import {
  type BrandingDensity,
  type BrandingDraft,
  type BrandingRadius,
  type BrandingThemeMode,
  DENSITIES,
  PALETTE_KEYS,
  PALETTE_LABELS,
  type PaletteKey,
  RADIUS_PRESETS,
  THEME_MODES,
  type ThemeSide,
  withFontFamily,
  withPaletteValue,
  withSideLogo,
  withTypography,
} from "@/lib/branding-draft";

/** Where the panel's "Learn more" goes. */
const BRANDING_DOCS_URL = "https://zitadel.com/docs/cli/customize-design";

// The design's separators are zero-height lines, so they add nothing to the
// 8px gap either side of them.
function Separator() {
  return <BaseSeparator className="-my-px" />;
}

const PANEL_TITLE = "font-serif text-base leading-5 font-normal text-foreground";
const SECTION_TITLE = "font-serif text-sm leading-5 font-normal text-foreground";
const SECTION = "flex flex-col gap-[10px] py-2";

// A row is 16px on a 26px rhythm. The control inside is 24px so it stays a
// usable target, and overflows the row by 4px each side rather than pushing
// the rhythm apart.
const ROW = "flex h-4 items-center justify-between";
const ROW_LABEL = "w-[108px] shrink-0 text-xs leading-4 text-foreground";
const ROW_VALUE = "flex w-[156px] items-center";
const VALUE_TEXT = "text-xs leading-4 font-normal text-muted-foreground";
const VALUE_INPUT = `-my-1 h-6 w-full rounded-none border-transparent bg-transparent px-0 shadow-none placeholder:text-muted-foreground hover:border-b-input focus-visible:border-b-input focus-visible:ring-0 md:text-xs ${VALUE_TEXT}`;
// `dark:bg-transparent` is explicit: the trigger's own `dark:bg-input/30` is a
// different variant, which tailwind-merge keeps.
// The chevron appears on hover and focus only: at rest the row reads as the
// plain value the design shows.
const VALUE_SELECT = `-my-1 h-6 w-full rounded-none border-transparent bg-transparent px-0 shadow-none data-[size=sm]:h-6 dark:bg-transparent [&_svg]:opacity-0 hover:[&_svg]:opacity-100 focus-visible:[&_svg]:opacity-100 ${VALUE_TEXT}`;

const COLOUR_ROW = "flex h-5 items-center justify-between";
const SWATCH =
  "size-3.5 shrink-0 cursor-pointer appearance-none rounded-[3px] border border-border bg-transparent p-0 [&::-moz-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-[2px] [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:p-0";
const ISSUE_BADGE = "rounded-4xl bg-destructive/10 text-destructive dark:bg-destructive/20";

const THEME_LABELS: Record<BrandingThemeMode, string> = {
  light: "Light",
  dark: "Dark",
  auto: "Auto",
};
const DENSITY_LABELS: Record<BrandingDensity, string> = {
  compact: "Compact",
  regular: "Regular",
  comfortable: "Comfortable",
};
const RADIUS_LABELS: Record<string, string> = {
  none: "None",
  sm: "Small",
  md: "Medium",
  lg: "Large",
  full: "Full",
  custom: "Custom",
};

type Props = {
  draft: BrandingDraft;
  onChange: (next: BrandingDraft) => void;
};

export function SettingsPanel({ draft, onChange }: Props) {
  const issues = useMemo(() => chosenContrastIssues(draft), [draft]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto px-3 py-4">
      <header className="flex flex-col gap-2 py-2">
        <h2 className={PANEL_TITLE}>Branding</h2>
        <p className="text-xs leading-4 text-muted-foreground">
          Override the corresponding theme tokens in your project configuration.{" "}
          <a href={BRANDING_DOCS_URL} target="_blank" rel="noreferrer" className="underline">
            Learn more
          </a>
        </p>
      </header>

      <Separator />
      <section className={SECTION}>
        <h3 className={SECTION_TITLE}>Appearance</h3>
        <SelectRow
          label="Theme"
          value={draft.theme?.mode ?? ""}
          fallback="auto"
          options={THEME_MODES}
          labels={THEME_LABELS}
          onChange={(value) =>
            onChange({ ...draft, theme: { ...draft.theme, mode: value as BrandingThemeMode } })
          }
        />
      </section>

      <Separator />
      <section className={SECTION}>
        <h3 className={SECTION_TITLE}>Typography</h3>
        <TextRow
          label="Font family"
          value={draft.typography?.font_family ?? ""}
          fallback={MAINTAINED_FONT_FAMILY}
          onChange={(value) => onChange(withFontFamily(draft, value))}
        />
        <TextRow
          label="Font URL"
          value={draft.typography?.font_url ?? ""}
          fallback="None"
          onChange={(value) => onChange(withTypography(draft, "font_url", value))}
        />
        <NumberRow
          label="Type scale"
          value={draft.typography?.scale}
          min={0.75}
          max={1.25}
          step={0.05}
          onChange={(scale) => onChange({ ...draft, typography: { ...draft.typography, scale } })}
        />
      </section>

      <Separator />
      <section className={SECTION}>
        <h3 className={SECTION_TITLE}>Shape</h3>
        <RadiusRows draft={draft} onChange={onChange} />
        <SelectRow
          label="Density"
          value={draft.shape?.density ?? ""}
          fallback="regular"
          options={DENSITIES}
          labels={DENSITY_LABELS}
          onChange={(value) =>
            onChange({ ...draft, shape: { ...draft.shape, density: value as BrandingDensity } })
          }
        />
        <NumberRow
          label="Logo scale"
          value={draft.shape?.logo_scale}
          min={0.5}
          max={2}
          step={0.1}
          onChange={(logo_scale) => onChange({ ...draft, shape: { ...draft.shape, logo_scale } })}
        />
      </section>

      <Separator />
      <section className={SECTION}>
        <h3 className={SECTION_TITLE}>Assets</h3>
        <TextRow
          label="Logo light"
          value={draft.theme?.light?.logo_url ?? ""}
          fallback="None"
          onChange={(value) => onChange(withSideLogo(draft, "light", value))}
        />
        <TextRow
          label="Logo dark"
          value={draft.theme?.dark?.logo_url ?? ""}
          fallback="None"
          onChange={(value) => onChange(withSideLogo(draft, "dark", value))}
        />
      </section>

      <Separator />
      <PaletteSection side="dark" draft={draft} issues={issues} onChange={onChange} />
      <PaletteSection side="light" draft={draft} issues={issues} onChange={onChange} />
      <Separator />
    </div>
  );
}

/**
 * Contrast measured on what renders — the draft over the maintained defaults —
 * but reported only for pairs the customer has touched. A primary set against
 * the default label still warns; the defaults on their own do not.
 */
function chosenContrastIssues(draft: BrandingDraft): ContrastIssue[] {
  const effective = { theme: {} as Record<ThemeSide, { palette: Record<string, string> }> };
  for (const side of ["light", "dark"] as const) {
    effective.theme[side] = {
      palette: { ...maintainedPalette(side), ...(draft.theme?.[side]?.palette ?? {}) },
    };
  }
  return contrastIssues(effective).filter((issue) => {
    const chosen = draft.theme?.[issue.theme]?.palette ?? {};
    return issue.pair.split("/").some((key) => chosen[key as PaletteKey] !== undefined);
  });
}

/**
 * Corner radius is a preset name or a pixel value, so the control is both: a
 * preset list with a `custom` entry that reveals the pixel field.
 */
function RadiusRows({
  draft,
  onChange,
}: {
  draft: BrandingDraft;
  onChange: (next: BrandingDraft) => void;
}) {
  const radius = draft.shape?.radius;
  const custom = typeof radius === "number";
  return (
    <>
      <SelectRow
        label="Corner radius"
        value={custom ? "custom" : (radius ?? "")}
        fallback="md"
        options={[...RADIUS_PRESETS, "custom"]}
        labels={RADIUS_LABELS}
        onChange={(value) =>
          onChange({
            ...draft,
            shape: {
              ...draft.shape,
              radius: value === "custom" ? 8 : (value as BrandingRadius),
            },
          })
        }
      />
      {custom && (
        <NumberRow
          label="Radius in pixels"
          value={radius}
          min={0}
          max={32}
          step={1}
          onChange={(pixels) =>
            onChange({ ...draft, shape: { ...draft.shape, radius: pixels ?? 0 } })
          }
        />
      )}
    </>
  );
}

function PaletteSection({
  side,
  draft,
  issues,
  onChange,
}: {
  side: ThemeSide;
  draft: BrandingDraft;
  issues: ContrastIssue[];
  onChange: (next: BrandingDraft) => void;
}) {
  const [open, setOpen] = useState(side === "dark");
  const sideIssues = issues.filter((issue) => issue.theme === side);
  const palette = draft.theme?.[side]?.palette ?? {};
  const defaults = maintainedPalette(side);
  const Chevron = open ? ChevronUp : ChevronDown;

  return (
    <section className={open ? "flex flex-col border-b border-border" : "flex flex-col"}>
      <button
        type="button"
        className="flex w-full cursor-pointer items-center justify-between py-2"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className={SECTION_TITLE}>Colors {side} mode</span>
        <span className="flex items-center gap-2">
          {sideIssues.length > 0 && (
            <Badge variant="destructive" className={ISSUE_BADGE}>
              {sideIssues.length} {sideIssues.length === 1 ? "issue" : "issues"}
            </Badge>
          )}
          <Chevron className="size-4 text-foreground" aria-hidden />
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-2 py-2">
          {PALETTE_KEYS.map((key) => (
            <PaletteRow
              key={key}
              paletteKey={key}
              side={side}
              value={palette[key] ?? ""}
              fallback={defaults[key]}
              issue={sideIssues.find((candidate) => candidate.pair.startsWith(`${key}/`))}
              onChange={(value) => onChange(withPaletteValue(draft, side, key, value))}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PaletteRow({
  paletteKey,
  side,
  value,
  fallback,
  issue,
  onChange,
}: {
  paletteKey: PaletteKey;
  side: ThemeSide;
  value: string;
  fallback: string;
  issue: ContrastIssue | undefined;
  onChange: (value: string) => void;
}) {
  // Both sides carry a row called "Primary", so the accessible name carries
  // the side: a screen reader cannot see which section heading it sits under.
  const name = `${PALETTE_LABELS[paletteKey]} (${side} mode)`;
  const shown = value || fallback;

  return (
    <div className={COLOUR_ROW}>
      <span className={ROW_LABEL}>{PALETTE_LABELS[paletteKey]}</span>
      <span className={`${ROW_VALUE} gap-1.5`}>
        {/* The swatch is the picker. It speaks hex only, so a value written as a
            colour function is converted for it while the text keeps the original. */}
        <input
          type="color"
          aria-label={`${name} picker`}
          className={SWATCH}
          value={toHex(shown)}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
        />
        <Input
          aria-label={name}
          className={`${VALUE_INPUT} font-medium leading-5`}
          value={value}
          placeholder={fallback.toUpperCase()}
          onChange={(event) => onChange(event.target.value)}
        />
        {issue && (
          <span
            className="shrink-0 text-destructive"
            title={`Contrast ${issue.ratio}:1, needs ${issue.required}:1`}
          >
            <TriangleAlert className="size-3.5" aria-hidden />
            <span className="sr-only">
              Contrast {issue.ratio} to 1, needs {issue.required} to 1
            </span>
          </span>
        )}
      </span>
    </div>
  );
}

/** A native colour input takes `#rrggbb` only. */
function toHex(color: string): string {
  const parsed = parseCssColor(color);
  if (!parsed) return "#000000";
  const channel = (n: number): string => Math.round(n).toString(16).padStart(2, "0");
  return `#${channel(parsed.r)}${channel(parsed.g)}${channel(parsed.b)}`;
}

function SelectRow({
  label,
  value,
  fallback,
  options,
  labels,
  onChange,
}: {
  label: string;
  value: string;
  fallback: string;
  options: readonly string[];
  labels: Record<string, string>;
  onChange: (value: string) => void;
}) {
  return (
    <div className={ROW}>
      <span className={ROW_LABEL}>{label}</span>
      <span className={ROW_VALUE}>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger aria-label={label} className={VALUE_SELECT} size="sm">
            {/* Unset shows what the login actually uses, not a word for "unset". */}
            <SelectValue placeholder={labels[fallback] ?? fallback} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {labels[option] ?? option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </span>
    </div>
  );
}

function NumberRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  step: number;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <div className={ROW}>
      <span className={ROW_LABEL}>{label}</span>
      <span className={ROW_VALUE}>
        <Input
          aria-label={label}
          type="number"
          min={min}
          max={max}
          step={step}
          className={VALUE_INPUT}
          value={value ?? ""}
          placeholder="1"
          onChange={(event) =>
            onChange(event.target.value === "" ? undefined : Number(event.target.value))
          }
        />
      </span>
    </div>
  );
}

function TextRow({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string;
  fallback: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className={ROW}>
      <span className={ROW_LABEL}>{label}</span>
      <span className={ROW_VALUE}>
        <Input
          aria-label={label}
          className={VALUE_INPUT}
          value={value}
          placeholder={fallback}
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
    </div>
  );
}
