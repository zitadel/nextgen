import { contrastIssues, type ContrastIssue } from "@zitadel/config/branding-contrast";
import { ChevronDown, TriangleAlert } from "lucide-react";
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
  withTypography,
  withSideLogo,
} from "@/lib/branding-draft";

// Geometry from the design: a 108px label column, a 12px gap and a 156px value
// column inside the panel's 276px content width. Rows sit on a 26px rhythm,
// colour rows on 28px, and a value is left-aligned in its column rather than
// flush to the panel edge.
const ROW = "flex items-center gap-3 py-px text-sm";
const COLOUR_ROW = "flex items-center gap-3 py-0.5 text-sm";
const ROW_LABEL = "w-[108px] shrink-0 text-muted-foreground";
const ROW_VALUE = "flex w-[156px] items-center gap-2";
const SECTION_TITLE = "text-sm font-medium text-foreground";
const VALUE_INPUT =
  "h-6 w-full border-transparent bg-transparent px-1 text-sm shadow-none hover:border-input focus-visible:border-input";
// The trigger reads as the value it holds until you reach for it, matching the
// text rows beside it. `dark:bg-transparent` is explicit because the component's
// own `dark:bg-input/30` is a different variant, which tailwind-merge keeps.
const VALUE_SELECT =
  "h-6 w-full border-transparent bg-transparent px-1 text-sm shadow-none dark:bg-transparent hover:border-input dark:hover:bg-input/30 focus-visible:border-input data-[size=sm]:h-6";

/** Radix treats "" as no selection, so the cleared state needs a value of its own. */
const DEFAULT_OPTION = "__default";

type Props = {
  draft: BrandingDraft;
  onChange: (next: BrandingDraft) => void;
};

export function SettingsPanel({ draft, onChange }: Props) {
  // Recomputed on every edit: the counts are the panel's live feedback, and
  // the check is a pure function over a dozen colours.
  const issues = useMemo(() => contrastIssues(draft), [draft]);

  return (
    <div className="flex h-full flex-col overflow-y-auto px-3 pt-4 pb-3">
      <header className="pb-2">
        <h2 className={SECTION_TITLE}>Branding</h2>
        <p className="mt-2 text-xs text-muted-foreground">
          Override the corresponding theme tokens in your project configuration.
        </p>
      </header>

      <Section title="Appearance">
        <SelectRow
          label="Theme"
          value={draft.theme?.mode ?? ""}
          options={THEME_MODES}
          onChange={(value) =>
            onChange({ ...draft, theme: { ...draft.theme, mode: themeMode(value) } })
          }
        />
      </Section>

      <Section title="Typography">
        <TextRow
          label="Font family"
          value={draft.typography?.font_family ?? ""}
          placeholder="Arimo"
          onChange={(value) => onChange(withFontFamily(draft, value))}
        />
        <TextRow
          label="Font URL"
          value={draft.typography?.font_url ?? ""}
          placeholder="https://…/font.css"
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
      </Section>

      <Section title="Shape">
        <RadiusRows draft={draft} onChange={onChange} />
        <SelectRow
          label="Density"
          value={draft.shape?.density ?? ""}
          options={DENSITIES}
          onChange={(value) =>
            onChange({ ...draft, shape: { ...draft.shape, density: densityValue(value) } })
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
      </Section>

      <Section title="Assets">
        <TextRow
          label="Logo light"
          value={draft.theme?.light?.logo_url ?? ""}
          placeholder="https://…/logo-on-light.svg"
          onChange={(value) => onChange(withSideLogo(draft, "light", value))}
        />
        <TextRow
          label="Logo dark"
          value={draft.theme?.dark?.logo_url ?? ""}
          placeholder="https://…/logo-on-dark.svg"
          onChange={(value) => onChange(withSideLogo(draft, "dark", value))}
        />
      </Section>

      <PaletteSection side="dark" draft={draft} issues={issues} onChange={onChange} />
      <PaletteSection side="light" draft={draft} issues={issues} onChange={onChange} />
    </div>
  );
}

/**
 * Corner radius is a preset name or a pixel value, so the control is both: a
 * preset list with a `custom` entry that reveals the pixel field. Typing a
 * number into a preset field was the alternative, which is a field that
 * accepts two vocabularies and validates neither.
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
        options={[...RADIUS_PRESETS, "custom"]}
        onChange={(value) =>
          onChange({
            ...draft,
            shape: {
              ...draft.shape,
              radius: value === "custom" ? 8 : radiusPreset(value),
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border py-4">
      {/* Each section frame carries 8px of its own padding and sits 8px from
          the separator, so a row clears the next heading by 32px. */}
      <h3 className={`${SECTION_TITLE} mb-[10px]`}>{title}</h3>
      {children}
    </section>
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

  return (
    <section className="border-t border-border py-4">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className={SECTION_TITLE}>Colors {side} mode</span>
        <span className="flex items-center gap-2">
          {sideIssues.length > 0 && (
            <Badge variant="destructive">
              {sideIssues.length} {sideIssues.length === 1 ? "issue" : "issues"}
            </Badge>
          )}
          <ChevronDown
            className={`size-4 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
          />
        </span>
      </button>

      {open && (
        <div className="mt-2">
          {PALETTE_KEYS.map((key) => (
            <PaletteRow
              key={key}
              paletteKey={key}
              side={side}
              value={palette[key] ?? ""}
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
  issue,
  onChange,
}: {
  paletteKey: PaletteKey;
  side: ThemeSide;
  value: string;
  issue: ContrastIssue | undefined;
  onChange: (value: string) => void;
}) {
  // Both sides carry a row called "Primary". The visible label sits under its
  // section heading, but the accessible name has to stand on its own — a
  // screen reader reaching two fields both called "Primary" cannot tell which
  // surface it is editing.
  const name = `${PALETTE_LABELS[paletteKey]} (${side} mode)`;
  return (
    <div className={COLOUR_ROW}>
      <span className={ROW_LABEL}>{PALETTE_LABELS[paletteKey]}</span>
      <span className={ROW_VALUE}>
        <span
          aria-hidden
          className="size-3.5 shrink-0 rounded-sm border border-border"
          style={{ background: value || "transparent" }}
        />
        <Input
          aria-label={name}
          className={VALUE_INPUT}
          value={value}
          placeholder="default"
          onChange={(event) => onChange(event.target.value)}
        />
        {/* The design puts the contrast mark at the value column's right edge,
            after the value rather than before the swatch. */}
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

/**
 * A value the contract constrains to a named set. A text field here loses
 * input silently — "regula" is not a density, so it would clear the field
 * with nothing to say why.
 */
function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className={ROW}>
      <span className={ROW_LABEL}>{label}</span>
      <span className={ROW_VALUE}>
        {/* `default` is its own option rather than an empty value: Radix reads
            an empty string as "no value", which would make clearing the field
            unselectable. */}
        <Select
          value={value === "" ? DEFAULT_OPTION : value}
          onValueChange={(next) => onChange(next === DEFAULT_OPTION ? "" : next)}
        >
          <SelectTrigger aria-label={label} className={VALUE_SELECT} size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT_OPTION}>default</SelectItem>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </span>
    </div>
  );
}

/** A bounded number. The range is the contract's, so the control carries it. */
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
          placeholder="default"
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
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
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
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
    </div>
  );
}

function radiusPreset(value: string): BrandingRadius | undefined {
  return RADIUS_PRESETS.includes(value as (typeof RADIUS_PRESETS)[number])
    ? (value as BrandingRadius)
    : undefined;
}

/** Which sides may run. Anything else clears the field. */
function themeMode(value: string): BrandingThemeMode | undefined {
  const trimmed = value.trim();
  return THEME_MODES.includes(trimmed as BrandingThemeMode)
    ? (trimmed as BrandingThemeMode)
    : undefined;
}

function densityValue(value: string): BrandingDensity | undefined {
  const trimmed = value.trim();
  return DENSITIES.includes(trimmed as BrandingDensity) ? (trimmed as BrandingDensity) : undefined;
}
