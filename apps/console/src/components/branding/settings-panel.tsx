import {
  BRANDING_CONTRAST_PAIRS,
  CONTRAST_AA_LARGE,
  contrastIssues,
  type ContrastIssue,
} from "@zitadel/config/branding-contrast";
import { parseCssColor } from "@zitadel/config/css-color";
import { ChevronDown, ChevronUp, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator as BaseSeparator } from "@/components/ui/separator";
import { MAINTAINED_FONT_FAMILY, maintainedPalette } from "@/lib/branding-defaults";
import {
  type BrandingRevision,
  PALETTE_KEYS,
  PALETTE_LABELS,
  type PaletteKey,
  type ThemeSide,
} from "@/lib/branding-palette";

// The design's separators are zero-height lines, so they add nothing to the
// 8px gap either side of them.
function Separator() {
  return <BaseSeparator className="-my-px" />;
}

const PANEL_TITLE = "font-serif text-base leading-5 font-normal text-foreground";
const SECTION_TITLE = "font-serif text-sm leading-5 font-normal text-foreground";
const SECTION = "flex flex-col gap-[10px] py-2";

// A row is 16px on a 26px rhythm.
const ROW = "flex h-4 items-center justify-between";
const ROW_LABEL = "w-[108px] shrink-0 text-xs leading-4 text-foreground";
const ROW_VALUE = "flex w-[156px] items-center";
const VALUE_TEXT = "truncate text-xs leading-4 font-normal text-muted-foreground";

const COLOUR_ROW = "flex h-5 items-center justify-between";
const SWATCH = "size-3.5 shrink-0 rounded-[3px] border border-border";
const ISSUE_BADGE = "rounded-4xl bg-destructive/10 text-destructive dark:bg-destructive/20";

// Keyed by the wire enums, so a lookup is total under noUncheckedIndexedAccess
// and a value the contract adds fails here rather than rendering blank.
type ThemeMode = NonNullable<NonNullable<BrandingRevision["theme"]>["mode"]>;
type Density = NonNullable<NonNullable<BrandingRevision["shape"]>["density"]>;
type RadiusPreset = Exclude<NonNullable<NonNullable<BrandingRevision["shape"]>["radius"]>, number>;

const THEME_LABELS: Record<ThemeMode, string> = { light: "Light", dark: "Dark", auto: "Auto" };
const DENSITY_LABELS: Record<Density, string> = {
  compact: "Compact",
  regular: "Regular",
  comfortable: "Comfortable",
};
const RADIUS_LABELS: Record<RadiusPreset, string> = {
  none: "None",
  sm: "Small",
  md: "Medium",
  lg: "Large",
  full: "Full",
};

type Props = {
  /** The revision in use. */
  revision: BrandingRevision;
};

/**
 * The branding in use, read-only. Values are changed in the project
 * configuration; the panel shows what the login resolves each one to, so a
 * key the revision omits reads as the maintained default rather than as
 * blank.
 */
export function SettingsPanel({ revision }: Props) {
  const issues = useMemo(() => publishedContrastIssues(revision), [revision]);
  const radius = revision.shape?.radius;

  return (
    // A landmark named by its own title, so the panel is addressable as a
    // region: the screen's h1 is "Branding" too, and a test that walks up
    // from the h2 lands on the header, not the panel.
    <section
      aria-labelledby="branding-panel-title"
      className="flex h-full flex-col gap-2 overflow-y-auto px-3 py-4"
    >
      <header className="flex flex-col gap-2 py-2">
        <h2 id="branding-panel-title" className={PANEL_TITLE}>
          Branding
        </h2>
        {/* The design ends this with a "Learn more" link. Held back until the
            docs page it should point at exists — the current branding page
            covers ejecting Liquid templates, not these settings. */}
        <p className="text-xs leading-4 text-muted-foreground">
          Override the corresponding theme tokens in your project configuration.
        </p>
      </header>

      <Separator />
      <section className={SECTION}>
        <h3 className={SECTION_TITLE}>Appearance</h3>
        <dl className="contents">
          <ValueRow label="Theme" value={THEME_LABELS[revision.theme?.mode ?? "auto"]} />
        </dl>
      </section>

      <Separator />
      <section className={SECTION}>
        <h3 className={SECTION_TITLE}>Typography</h3>
        <dl className="contents">
          <ValueRow
            label="Font family"
            value={revision.typography?.font_family ?? MAINTAINED_FONT_FAMILY}
          />
          <ValueRow label="Font URL" value={revision.typography?.font_url ?? "None"} />
          <ValueRow label="Type scale" value={String(revision.typography?.scale ?? 1)} />
        </dl>
      </section>

      <Separator />
      <section className={SECTION}>
        <h3 className={SECTION_TITLE}>Shape</h3>
        <dl className="contents">
          <ValueRow
            label="Corner radius"
            value={typeof radius === "number" ? `${radius}px` : RADIUS_LABELS[radius ?? "md"]}
          />
          <ValueRow label="Density" value={DENSITY_LABELS[revision.shape?.density ?? "regular"]} />
          <ValueRow label="Logo scale" value={String(revision.shape?.logo_scale ?? 1)} />
        </dl>
      </section>

      <Separator />
      <section className={SECTION}>
        <h3 className={SECTION_TITLE}>Assets</h3>
        <dl className="contents">
          <ValueRow label="Logo light" value={revision.theme?.light?.logo_url ?? "None"} />
          <ValueRow label="Logo dark" value={revision.theme?.dark?.logo_url ?? "None"} />
        </dl>
      </section>

      <Separator />
      <PaletteSection side="dark" revision={revision} issues={issues} />
      <PaletteSection side="light" revision={revision} issues={issues} />
      <Separator />
    </section>
  );
}

/**
 * Contrast measured on what renders — the revision over the maintained
 * defaults — but reported only for pairs the revision sets. A primary set
 * against the default label still warns; the defaults on their own do not.
 */
function publishedContrastIssues(revision: BrandingRevision): ContrastIssue[] {
  const effective = { theme: {} as Record<ThemeSide, { palette: Record<string, string> }> };
  for (const side of ["light", "dark"] as const) {
    effective.theme[side] = {
      palette: { ...maintainedPalette(side), ...(revision.theme?.[side]?.palette ?? {}) },
    };
  }
  return contrastIssues(effective).filter((issue) => {
    const set = revision.theme?.[issue.theme]?.palette ?? {};
    return issue.pair.split("/").some((key) => set[key as PaletteKey] !== undefined);
  });
}

function PaletteSection({
  side,
  revision,
  issues,
}: {
  side: ThemeSide;
  revision: BrandingRevision;
  issues: ContrastIssue[];
}) {
  const [open, setOpen] = useState(side === "dark");
  const sideIssues = issues.filter((issue) => issue.theme === side);
  const palette = revision.theme?.[side]?.palette ?? {};
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
        <dl className="flex flex-col gap-2 py-2">
          {PALETTE_KEYS.map((key) => (
            <PaletteRow
              key={key}
              paletteKey={key}
              side={side}
              value={palette[key] ?? defaults[key]}
              // Both rows of a pair carry the marker, so a failing pair is
              // found from either colour in it.
              issues={sideIssues.filter((candidate) => candidate.pair.split("/").includes(key))}
            />
          ))}
        </dl>
      )}
    </section>
  );
}

function PaletteRow({
  paletteKey,
  side,
  value,
  issues,
}: {
  paletteKey: PaletteKey;
  side: ThemeSide;
  value: string;
  issues: ContrastIssue[];
}) {
  return (
    <div className={COLOUR_ROW}>
      {/* Both sides carry a row called "Primary", so the term carries the
          side for assistive tech: visually the section heading says it. */}
      <dt className={ROW_LABEL} aria-label={`${PALETTE_LABELS[paletteKey]} (${side} mode)`}>
        {PALETTE_LABELS[paletteKey]}
      </dt>
      <dd className={`${ROW_VALUE} gap-1.5`}>
        <span className={SWATCH} style={{ backgroundColor: toHex(value) }} aria-hidden />
        <span className={`${VALUE_TEXT} font-medium leading-5`}>{value.toUpperCase()}</span>
        {issues.length > 0 && <ContrastIssueMarker issues={issues} />}
      </dd>
    </div>
  );
}

/**
 * The warning on a failing row, and the detail behind it. The row has space for
 * a glyph only, so the ratios and the rules they miss live in a popover rather
 * than a title attribute a keyboard or a touch device never sees.
 *
 * A colour can fail against more than one surface — `text` is painted on the
 * page, the card and the secondary button — and the section badge counts each
 * of those. One marker per row carries them all, so every counted failure can
 * be opened.
 */
function ContrastIssueMarker({ issues }: { issues: ContrastIssue[] }) {
  const detailed = issues.map((issue) => ({
    label: pairLabel(issue.pair),
    // WCAG holds text to 4.5:1 and a user-interface component boundary to 3:1,
    // so the sentence names which rule this pair is being held to.
    detail: `${issue.ratio}:1 — fails AA for ${
      issue.required === CONTRAST_AA_LARGE ? "user interface components" : "normal text"
    } (${issue.required}:1 required).`,
  }));

  return (
    <Popover>
      <PopoverTrigger
        className="shrink-0 cursor-pointer text-destructive"
        aria-label={detailed.map((entry) => `${entry.label}: ${entry.detail}`).join(" ")}
      >
        <TriangleAlert className="size-3.5" aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex w-auto max-w-[240px] flex-col gap-2.5 border-foreground/10 p-2"
      >
        {detailed.map((entry) => (
          <PopoverHeader key={entry.label} className="gap-0.5 text-xs leading-4">
            <PopoverTitle>{entry.label}</PopoverTitle>
            <PopoverDescription>{entry.detail}</PopoverDescription>
          </PopoverHeader>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** `foreground/background` reads as the surface first, as the design labels it. */
function pairLabel(pair: string): string {
  const found = BRANDING_CONTRAST_PAIRS.find((candidate) => candidate.id === pair);
  if (!found) return pair;
  const name = (key: string) => PALETTE_LABELS[key as PaletteKey] ?? key;
  return `${name(found.background)} / ${name(found.foreground)}`;
}

/** The swatch paints a resolved colour; a value that does not parse paints nothing. */
function toHex(color: string): string | undefined {
  const parsed = parseCssColor(color);
  if (!parsed) return undefined;
  const channel = (n: number): string => Math.round(n).toString(16).padStart(2, "0");
  return `#${channel(parsed.r)}${channel(parsed.g)}${channel(parsed.b)}`;
}

function ValueRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={ROW}>
      <dt className={ROW_LABEL}>{label}</dt>
      <dd className={ROW_VALUE}>
        <span className={VALUE_TEXT} title={value}>
          {value}
        </span>
      </dd>
    </div>
  );
}
